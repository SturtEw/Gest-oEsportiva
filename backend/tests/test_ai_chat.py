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
