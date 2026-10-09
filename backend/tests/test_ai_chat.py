# Chat privado com a IA: o histórico de um usuário NUNCA pode aparecer para
# outro, e o endpoint deve responder mesmo sem a chave do provedor configurada.
import pytest

from models.models import User
from routers import ai_chat as router
from tests.fake_mongo import FakeCollection, enrollment_db

ALUNO = User(id="user-1", nome="Carlos", email="carlos@escola.com", tipo="aluno", status="ativo", aluno_id="a-1")
OUTRO = User(id="user-2", nome="Marina", email="marina@escola.com", tipo="aluno", status="ativo", aluno_id="a-2")
PROF = User(id="prof-1", nome="Ana", email="ana@escola.com", tipo="professor", status="ativo")


@pytest.fixture
def db(monkeypatch):
    fake = enrollment_db(mensagens_ia=FakeCollection())

    async def no_network(*_args, **_kwargs):
        raise LookupError("sem chave")

    monkeypatch.setattr(router, "db", fake)
    monkeypatch.setattr(router, "_ask_gemini", no_network)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    return fake


async def test_history_is_private_per_user(db):
    await router.chat(router.ChatInput(mensagem="Como registro presença?"), user=ALUNO)
    await router.chat(router.ChatInput(mensagem="Quais são meus treinos?"), user=OUTRO)

    mine = await router.history(user=ALUNO)
    # Só as minhas (pergunta + resposta), nada do outro usuário.
    assert len(mine["mensagens"]) == 2
    assert all("outro" not in item["texto"].lower() for item in mine["mensagens"])
    assert "Quais são meus treinos?" not in [item["texto"] for item in mine["mensagens"]]

    stored_users = {doc["user_id"] for doc in db.mensagens_ia.documents}
    assert stored_users == {"user-1", "user-2"}


async def test_chat_persists_question_and_answer_and_never_breaks_without_key(db):
    result = await router.chat(router.ChatInput(mensagem="O que tem na aba presenças?"), user=ALUNO)

    assert result["pergunta"]["papel"] == "user"
    assert result["resposta"]["papel"] == "assistant"
    assert result["resposta"]["texto"].strip()
    # Sem chave configurada: degrada para contingência local (não 500).
    assert result["resposta"]["fonte"] == "local"
    assert result["ia_disponivel"] is False
    assert len(db.mensagens_ia.documents) == 2


async def test_chat_rejects_blank_message(db):
    with pytest.raises(Exception):
        await router.chat(router.ChatInput(mensagem="   "), user=ALUNO)


async def test_teacher_can_use_the_same_private_channel(db):
    await router.chat(router.ChatInput(mensagem="Como crio um subgrupo?"), user=PROF)

    history = await router.history(user=PROF)
    assert len(history["mensagens"]) == 2
    assert all(doc["user_id"] == "prof-1" for doc in db.mensagens_ia.documents)


async def test_clear_history_removes_only_own_messages(db):
    await router.chat(router.ChatInput(mensagem="Dúvida 1"), user=ALUNO)
    await router.chat(router.ChatInput(mensagem="Dúvida 2"), user=OUTRO)

    result = await router.clear_history(user=ALUNO)

    assert result["removidas"] == 2
    remaining = {doc["user_id"] for doc in db.mensagens_ia.documents}
    assert remaining == {"user-2"}


# ─── Escopo restrito (prompt + barreira no backend) ──────────────────────────
async def test_off_topic_question_is_refused_without_calling_the_provider(db, monkeypatch):
    chamadas = []

    async def spy_ask(*args, **kwargs):
        chamadas.append(args)
        return "resposta do provedor"

    monkeypatch.setattr(router, "_ask_gemini", spy_ask)

    result = await router.chat(router.ChatInput(mensagem="Quem você acha que deve ganhar a eleição?"), user=ALUNO)

    assert result["resposta"]["fonte"] == "escopo"
    assert "gestão esportiva" in result["resposta"]["texto"]
    # O provedor NÃO foi chamado: a recusa é local e determinística.
    assert chamadas == []
    # A recusa é intencional — não sinaliza provedor indisponível.
    assert result["ia_disponivel"] is True


async def test_in_scope_question_reaches_the_provider(db, monkeypatch):
    async def ok_ask(*_args, **_kwargs):
        return "Faça 3 séries de 10 repetições."

    monkeypatch.setattr(router, "_ask_gemini", ok_ask)

    result = await router.chat(router.ChatInput(mensagem="Quantas séries de agachamento devo fazer?"), user=ALUNO)

    assert result["resposta"]["fonte"] == "gemini"
    assert result["resposta"]["texto"] == "Faça 3 séries de 10 repetições."


# ─── Fallback de modelos (404/503 não derrubam o assistente) ─────────────────
async def test_model_fallback_skips_a_dead_model(monkeypatch):
    """O modelo versionado cai (404) e o alias assume: o aluno recebe resposta."""
    import httpx
    import lib.db as _db_unused  # noqa: F401 — garante o import do módulo no caminho
    from routers import ai_chat

    chamadas: list[str] = []

    class FakeResponse:
        def __init__(self, status: int, body: dict | str = ""):
            self.status_code = status
            self._body = body
            self.text = body if isinstance(body, str) else str(body)

        def json(self):
            return self._body

    async def fake_post(self, url, **_kwargs):
        # Primeiro modelo: 404 (descontinuado). Segundo: resposta válida.
        chamadas.append(url)
        if len(chamadas) == 1:
            return FakeResponse(404, '{"error":{"message":"model not found"}}')
        return FakeResponse(200, {"candidates": [{"content": {"parts": [{"text": "Faça 3 séries."}]}}]})

    monkeypatch.setenv("GEMINI_MODEL", "gemini-2.0-flash")
    monkeypatch.setenv("GEMINI_API_KEY", "chave-de-teste")
    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    texto = await ai_chat._ask_gemini([], "Quantas séries?")

    assert texto == "Faça 3 séries."
    assert len(chamadas) == 2  # tentou o morto e caiu para o próximo
    assert "gemini-2.0-flash" in chamadas[0]


async def test_invalid_key_fails_fast_without_trying_other_models(monkeypatch):
    """401/403 é chave inválida: falha na primeira, sem gastar chamadas."""
    import httpx
    from routers import ai_chat

    chamadas: list[str] = []

    class FakeResponse:
        status_code = 403
        text = '{"error":{"message":"API key not valid"}}'

        def json(self):
            return {"error": {"message": "API key not valid"}}

    async def fake_post(self, url, **_kwargs):
        chamadas.append(url)
        return FakeResponse()

    monkeypatch.setenv("GEMINI_MODEL", "gemini-2.0-flash")
    monkeypatch.setenv("GEMINI_API_KEY", "chave-invalida")
    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    with pytest.raises(RuntimeError):
        await ai_chat._ask_gemini([], "teste")

    assert len(chamadas) == 1  # não insistiu nos demais modelos
