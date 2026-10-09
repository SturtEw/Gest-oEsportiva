# Invite codes, join requests and their approval: who may do what, and that a
# student can never end up in two classes or overfill one.
from datetime import timedelta

import pytest
from fastapi import HTTPException

from lib.dates import now_utc
from models.models import User
from routers import auth as auth_router
from routers import class_enrollment as router
from services import class_enrollment as service
from tests.fake_mongo import FakeCollection, enrollment_db

TEACHER = User(id="prof-1", nome="Ana Souza", email="ana@escola.com", tipo="professor", status="ativo")
OTHER_TEACHER = User(id="prof-2", nome="Bruno Lima", email="bruno@escola.com", tipo="professor", status="ativo")
STUDENT = User(id="user-1", nome="Caio Alves", email="caio@aluno.com", tipo="aluno", aluno_id="aluno-1")
STUDENT_2 = User(id="user-2", nome="Duda Reis", email="duda@aluno.com", tipo="aluno", aluno_id="aluno-2")


def turma(turma_id="t-1", professor_id="prof-1", capacidade=20, alunos_ids=None, nome="Futsal Sub-13"):
    return {"id": turma_id, "nome": nome, "modalidade": "Futsal", "ano": 2026, "capacidade": capacidade,
            "alunos_ids": list(alunos_ids or []), "professor_id": professor_id}


@pytest.fixture
def db(monkeypatch):
    fake = enrollment_db(
        alunos=FakeCollection([
            {"id": "aluno-1", "nome": "Caio Alves", "turma_id": None},
            {"id": "aluno-2", "nome": "Duda Reis", "turma_id": None},
        ]),
        turmas=FakeCollection([
            turma(),
            turma("t-2", "prof-2", nome="Vôlei Misto"),
            turma("t-3", None, nome="Basquete sem professor"),
        ]),
        users=FakeCollection([
            {"id": "prof-1", "nome": "Ana Souza"},
            {"id": "prof-2", "nome": "Bruno Lima"},
        ]),
    )
    events = []

    async def record(*args):
        events.append(args)

    for module in (service, router, auth_router):
        monkeypatch.setattr(module, "db", fake)
    monkeypatch.setattr(router, "publish_event", record)
    monkeypatch.setattr(router, "publish_user_event", record)
    monkeypatch.setattr(auth_router, "publish_user_event", record)
    monkeypatch.setattr(auth_router, "publish_event", record)
    fake.events = events
    return fake


async def student_class(db, aluno_id="aluno-1"):
    return (await db.alunos.find_one({"id": aluno_id}))["turma_id"]


# ─── Invite codes ─────────────────────────────────────────────────────────────
def test_invite_code_format_avoids_ambiguous_characters():
    codes = {service.generate_invite_code() for _ in range(300)}
    assert len(codes) == 300
    assert all(len(code) == 8 and set(code) <= set(service.INVITE_ALPHABET) for code in codes)
    assert not set("01IO") & set(service.INVITE_ALPHABET)
    assert service.normalize_invite_code(" abcd-ef 23 ") == "ABCDEF23"


async def test_teacher_generates_one_active_code_per_class(db):
    first = await router.create_invite("t-1", router.InviteCreate(), user=TEACHER)
    second = await router.create_invite("t-1", router.InviteCreate(validade_dias=7), user=TEACHER)

    assert first["codigo"] != second["codigo"]
    active = [doc for doc in db.turma_convites.documents if doc["ativo"]]
    assert [doc["codigo"] for doc in active] == [second["codigo"]]
    assert second["expira_em"] is not None

    listing = await router.teacher_invites(user=TEACHER)
    assert listing["classes"][0]["convite"]["codigo"] == second["codigo"]


async def test_teacher_cannot_manage_another_teachers_class(db):
    with pytest.raises(HTTPException) as error:
        await router.create_invite("t-2", router.InviteCreate(), user=TEACHER)
    assert error.value.status_code == 403


async def test_student_joins_directly_with_code(db):
    invite = await router.create_invite("t-1", router.InviteCreate(), user=TEACHER)

    result = await router.join_class_with_code(router.JoinWithCodeInput(codigo=invite["codigo"].lower()), user=STUDENT)

    assert result["turma"]["id"] == "t-1"
    assert await student_class(db) == "t-1"
    assert "aluno-1" in (await db.turmas.find_one({"id": "t-1"}))["alunos_ids"]
    assert (await db.turma_convites.find_one({"id": invite["id"]}))["usos"] == 1


async def test_code_joins_a_second_class_multi_enrollment(db):
    """MULTI-TURMAS: o aluno pode pertencer a mais de uma turma ao mesmo tempo.

    (Antes: o segundo convite era rejeitado com 409 e o aluno ficava preso na
    primeira turma — comportamento removido na migração multi-turmas.)
    """
    invite_1 = await router.create_invite("t-1", router.InviteCreate(), user=TEACHER)
    invite_2 = await router.create_invite("t-2", router.InviteCreate(), user=OTHER_TEACHER)
    await router.join_class_with_code(router.JoinWithCodeInput(codigo=invite_1["codigo"]), user=STUDENT)
    await router.join_class_with_code(router.JoinWithCodeInput(codigo=invite_2["codigo"]), user=STUDENT)

    student = await db.alunos.find_one({"id": "aluno-1"})
    # Está nas duas turmas; turma_id (principal/legado) continua a primeira.
    assert sorted(student["turmas_ids"]) == ["t-1", "t-2"]
    assert student["turma_id"] == "t-1"
    assert "aluno-1" in (await db.turmas.find_one({"id": "t-2"}))["alunos_ids"]


async def test_leaving_one_class_keeps_the_others(db):
    """Sair de uma turma preserva as demais e reeleição da principal."""
    invite_1 = await router.create_invite("t-1", router.InviteCreate(), user=TEACHER)
    invite_2 = await router.create_invite("t-2", router.InviteCreate(), user=OTHER_TEACHER)
    await router.join_class_with_code(router.JoinWithCodeInput(codigo=invite_1["codigo"]), user=STUDENT)
    await router.join_class_with_code(router.JoinWithCodeInput(codigo=invite_2["codigo"]), user=STUDENT)

    result = await router.leave_class("t-1", user=STUDENT)

    assert result["turmas_restantes"] == ["t-2"]
    assert result["turma_id"] == "t-2"
    student = await db.alunos.find_one({"id": "aluno-1"})
    assert student["turmas_ids"] == ["t-2"] and student["turma_id"] == "t-2"
    # Assento liberado na turma abandonada.
    assert "aluno-1" not in (await db.turmas.find_one({"id": "t-1"}))["alunos_ids"]

    # Sair da última turma deixa o aluno sem nenhuma (pode buscar de novo).
    final = await router.leave_class("t-2", user=STUDENT)
    assert final["turmas_restantes"] == [] and final["turma_id"] is None


@pytest.mark.parametrize("change", [
    {"ativo": False},
    {"expira_em": now_utc() - timedelta(minutes=1)},
])
async def test_revoked_or_expired_code_is_rejected(db, change):
    invite = await router.create_invite("t-1", router.InviteCreate(), user=TEACHER)
    await db.turma_convites.update_one({"id": invite["id"]}, {"$set": change})

    with pytest.raises(HTTPException) as error:
        await router.join_class_with_code(router.JoinWithCodeInput(codigo=invite["codigo"]), user=STUDENT)

    assert error.value.status_code == 404
    assert await student_class(db) is None


async def test_code_of_reassigned_class_stops_working(db):
    invite = await router.create_invite("t-1", router.InviteCreate(), user=TEACHER)
    await db.turmas.update_one({"id": "t-1"}, {"$set": {"professor_id": "prof-2"}})

    with pytest.raises(HTTPException) as error:
        await router.join_class_with_code(router.JoinWithCodeInput(codigo=invite["codigo"]), user=STUDENT)
    assert error.value.status_code == 404


async def test_full_class_rejects_and_leaves_student_unlinked(db):
    await db.turmas.update_one({"id": "t-1"}, {"$set": {"capacidade": 1, "alunos_ids": ["outro"]}})

    with pytest.raises(HTTPException) as error:
        await service.link_student_to_class("aluno-1", await db.turmas.find_one({"id": "t-1"}))

    assert error.value.status_code == 409
    assert await student_class(db) is None  # the student claim was compensated


# ─── Join requests ────────────────────────────────────────────────────────────
async def test_search_lists_only_classes_with_a_teacher(db):
    result = await router.search_classes(q="", user=STUDENT)
    assert [item["id"] for item in result["classes"]] == ["t-1", "t-2"]
    assert result["classes"][0]["professor_nome"] == "Ana Souza"

    filtered = await router.search_classes(q="vôlei", user=STUDENT)
    assert [item["id"] for item in filtered["classes"]] == ["t-2"]


async def test_request_then_teacher_approves(db):
    created = await router.create_request(router.JoinRequestCreate(turma_id="t-1", mensagem="  Jogo   no recreio "), user=STUDENT)
    assert created["status"] == "pendente" and created["mensagem"] == "Jogo no recreio"
    assert ("prof-1", "enrollment") in db.events

    queue = await router.teacher_requests(escopo="pendentes", user=TEACHER)
    assert queue["pendentes"] == 1 and queue["requests"][0]["aluno_nome"] == "Caio Alves"
    assert (await router.teacher_requests(escopo="pendentes", user=OTHER_TEACHER))["pendentes"] == 0

    decided = await router.decide_request(created["id"], router.JoinRequestDecision(aprovar=True), user=TEACHER)

    assert decided["status"] == "aprovada"
    assert await student_class(db) == "t-1"
    status = await router.my_requests(user=STUDENT)
    assert status["turma_id"] == "t-1" and status["requests"][0]["status"] == "aprovada"


async def test_teacher_rejects_with_reason_and_student_can_try_again(db):
    created = await router.create_request(router.JoinRequestCreate(turma_id="t-1"), user=STUDENT)
    await router.decide_request(created["id"], router.JoinRequestDecision(aprovar=False, motivo="Turma só para sub-13"), user=TEACHER)

    status = await router.my_requests(user=STUDENT)
    assert status["requests"][0]["status"] == "rejeitada"
    assert status["requests"][0]["motivo_rejeicao"] == "Turma só para sub-13"
    assert await student_class(db) is None

    again = await router.create_request(router.JoinRequestCreate(turma_id="t-2"), user=STUDENT)
    assert again["status"] == "pendente"


async def test_only_one_pending_request_per_student(db):
    await router.create_request(router.JoinRequestCreate(turma_id="t-1"), user=STUDENT)
    with pytest.raises(HTTPException) as error:
        await router.create_request(router.JoinRequestCreate(turma_id="t-2"), user=STUDENT)
    assert error.value.status_code == 409


async def test_request_for_class_without_teacher_is_refused(db):
    with pytest.raises(HTTPException) as error:
        await router.create_request(router.JoinRequestCreate(turma_id="t-3"), user=STUDENT)
    assert error.value.status_code == 404


async def test_student_cancels_pending_request(db):
    created = await router.create_request(router.JoinRequestCreate(turma_id="t-1"), user=STUDENT)
    await router.cancel_request(created["id"], user=STUDENT)

    assert (await router.my_requests(user=STUDENT))["requests"][0]["status"] == "cancelada"
    with pytest.raises(HTTPException) as error:
        await router.decide_request(created["id"], router.JoinRequestDecision(aprovar=True), user=TEACHER)
    assert error.value.status_code == 409


async def test_other_teacher_cannot_decide(db):
    created = await router.create_request(router.JoinRequestCreate(turma_id="t-1"), user=STUDENT)
    with pytest.raises(HTTPException) as error:
        await router.decide_request(created["id"], router.JoinRequestDecision(aprovar=True), user=OTHER_TEACHER)
    assert error.value.status_code == 403
    assert (await db.solicitacoes_turma.find_one({"id": created["id"]}))["status"] == "pendente"


async def test_approval_on_full_class_keeps_request_pending(db):
    created = await router.create_request(router.JoinRequestCreate(turma_id="t-1"), user=STUDENT)
    await db.turmas.update_one({"id": "t-1"}, {"$set": {"capacidade": 1, "alunos_ids": ["outro"]}})

    with pytest.raises(HTTPException) as error:
        await router.decide_request(created["id"], router.JoinRequestDecision(aprovar=True), user=TEACHER)

    assert error.value.status_code == 409
    assert (await db.solicitacoes_turma.find_one({"id": created["id"]}))["status"] == "pendente"
    assert await student_class(db) is None


async def test_joining_by_code_cancels_only_that_class_pending_request(db):
    """O convite cancela a solicitação pendente DAQUELA turma, não as outras."""
    created = await router.create_request(router.JoinRequestCreate(turma_id="t-2"), user=STUDENT)
    invite = await router.create_invite("t-1", router.InviteCreate(), user=TEACHER)

    await router.join_class_with_code(router.JoinWithCodeInput(codigo=invite["codigo"]), user=STUDENT)

    # Multi-turmas: a solicitação a t-2 segue pendente (o aluno pode entrar nela também).
    assert (await db.solicitacoes_turma.find_one({"id": created["id"]}))["status"] == "pendente"

    # E um convite PARA A MESMA turma da solicitação cancela essa solicitação.
    invite_same = await router.create_invite("t-2", router.InviteCreate(), user=OTHER_TEACHER)
    await router.join_class_with_code(router.JoinWithCodeInput(codigo=invite_same["codigo"]), user=STUDENT)
    assert (await db.solicitacoes_turma.find_one({"id": created["id"]}))["status"] == "cancelada"


async def test_teacher_and_guardian_cannot_use_student_routes(db):
    with pytest.raises(HTTPException) as error:
        await router.search_classes(q="", user=TEACHER)
    assert error.value.status_code == 403
    with pytest.raises(HTTPException) as error:
        await router.teacher_invites(user=STUDENT)
    assert error.value.status_code == 403


# ─── Registration with an invite code ─────────────────────────────────────────
def registration(**overrides):
    data = {"nome": "Elisa Prado", "email": "elisa@aluno.com", "senha": "senha-forte-123",
            "data_nascimento": "2012-05-04", "documento_tipo": "cpf", "documento_numero": "12345678909"}
    data.update(overrides)
    return auth_router.RegisterAccountInput(**data)


@pytest.fixture
def quiet_signup(monkeypatch):
    async def no_email(_document):
        return None
    monkeypatch.setattr(auth_router, "_send_confirmation_email", no_email)


async def test_signup_with_code_enters_class_directly(db, quiet_signup):
    invite = await router.create_invite("t-1", router.InviteCreate(), user=TEACHER)

    result = await auth_router._create_registration(registration(codigo_convite=f"{invite['codigo'][:4]}-{invite['codigo'][4:]}"))

    assert result["turma"]["id"] == "t-1" and result["aviso_convite"] is None
    aluno_id = result["user"]["aluno_id"]
    assert await student_class(db, aluno_id) == "t-1"


async def test_signup_with_invalid_code_creates_nothing(db, quiet_signup):
    users_before = len(db.users.documents)

    with pytest.raises(HTTPException) as error:
        await auth_router._create_registration(registration(codigo_convite="ZZZZ9999"))

    assert error.value.status_code == 404
    assert len(db.users.documents) == users_before
    assert len(db.alunos.documents) == 2


async def test_signup_without_code_has_no_class(db, quiet_signup):
    result = await auth_router._create_registration(registration())
    assert result["turma"] is None
    assert await student_class(db, result["user"]["aluno_id"]) is None
