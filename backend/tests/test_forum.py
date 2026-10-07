# Fórum de turma: histórico em ordem cronológica ASC (WhatsApp), membership
# por turma e delta fetch (after=) sem duplicar mensagens.
import pytest
from fastapi import HTTPException

from models.models import User
from routers import forum as router
from routers.forum import ForumMessageCreate
from tests.fake_mongo import FakeCollection, enrollment_db

PROF = User(id="prof-1", nome="Ana Souza", email="ana@escola.com", tipo="professor", status="ativo")
ALUNO = User(id="user-aluno", nome="Carlos", email="carlos@escola.com", tipo="aluno", status="ativo", aluno_id="a-1")
OUTRO = User(id="user-outro", nome="Bruno", email="bruno@escola.com", tipo="aluno", status="ativo", aluno_id="a-2")


def msg(i: int, criado_em: str) -> dict:
    return {
        "id": f"m-{i}",
        "turma_id": "t-1",
        "autor_id": "user-aluno",
        "autor_nome": "Carlos",
        "autor_tipo": "aluno",
        "autor_avatar": None,
        "texto": f"mensagem {i}",
        "criado_em": criado_em,
    }


@pytest.fixture
def db(monkeypatch):
    fake = enrollment_db(
        turmas=FakeCollection([{"id": "t-1", "nome": "Futsal", "alunos_ids": ["a-1", "a-2"], "professor_id": "prof-1"}]),
        alunos=FakeCollection([
            {"id": "a-1", "nome": "Carlos", "turma_id": "t-1", "turmas_ids": ["t-1"]},
            {"id": "a-2", "nome": "Bruno", "turma_id": "t-2", "turmas_ids": ["t-2"]},
        ]),
        forum_mensagens=FakeCollection([
            msg(1, "2026-10-07T10:00:00+00:00"),
            msg(2, "2026-10-07T11:00:00+00:00"),
            msg(3, "2026-10-07T12:00:00+00:00"),
        ]),
    )
    events = []

    async def record(*args):
        events.append(args)

    monkeypatch.setattr(router, "db", fake)
    monkeypatch.setattr(router, "publish_class_event", record)
    fake.events = events
    return fake


async def test_historico_em_ordem_cronologica_asc(db):
    result = await router.list_messages("t-1", limit=50, user=ALUNO)
    ordem = [m.id for m in result["mensagens"]]
    assert ordem == ["m-1", "m-2", "m-3"]  # mais antiga em cima, mais nova embaixo


async def test_delta_after_retorna_apenas_mensagens_novas_em_asc(db):
    result = await router.list_messages("t-1", after="2026-10-07T11:00:00+00:00", limit=50, user=ALUNO)
    ordem = [m.id for m in result["mensagens"]]
    assert ordem == ["m-3"]  # apenas a mais nova que o timestamp conhecido


async def test_before_pagina_o_historico_antigo_em_asc(db):
    result = await router.list_messages("t-1", before="2026-10-07T12:00:00+00:00", limit=3, user=ALUNO)
    ordem = [m.id for m in result["mensagens"]]
    assert ordem == ["m-1", "m-2"]  # as anteriores à mais nova, em ASC
    # Com apenas 2 mensagens anteriores e limit=3, não há mais histórico.
    assert result["has_more"] is False


async def test_nao_membro_recebe_403(db):
    with pytest.raises(HTTPException) as error:
        await router.list_messages("t-1", limit=50, user=OUTRO)
    assert error.value.status_code == 403


async def test_envio_publica_evento_da_turma(db):
    await router.send_message("t-1", ForumMessageCreate(texto="  oi  "), user=ALUNO)
    # Evento de invalidação disparado para o tempo real.
    assert any("t-1" in str(e) and "forum" in str(e) for e in db.events)
    saved = [d for d in db.forum_mensagens.documents if d["texto"] == "oi"]
    assert len(saved) == 1
    assert saved[0]["autor_nome"] == "Carlos"
    assert saved[0]["autor_tipo"] == "aluno"
