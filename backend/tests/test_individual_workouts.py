# Individual 1-on-1 training: the assigned professor prescribes, the student
# executes and toggles completion, and both see the same session calendar.
import pytest
from fastapi import HTTPException

from models.models import User
from routers import individual_workouts as router
from tests.fake_mongo import FakeCollection, enrollment_db

PROF = User(id="prof-1", nome="Ana Souza", email="ana@escola.com", tipo="professor", status="ativo")
OTHER = User(id="prof-9", nome="Bruno Lima", email="bruno@escola.com", tipo="professor", status="ativo")
ALUNO = User(id="user-aluno", nome="Aluno Conta", email="aluno@escola.com", tipo="aluno", status="ativo", aluno_id="a-1")
RESPONSAVEL = User(id="resp-1", nome="Pai", email="pai@escola.com", tipo="responsavel", status="ativo", filhos_ids=["a-1"])


def rule_weekly():
    return {"type": "weekly", "weekdays": [1, 3, 5], "dates": []}


@pytest.fixture
def db(monkeypatch):
    fake = enrollment_db(
        turmas=FakeCollection([{"id": "t-1", "nome": "Futsal", "modalidade": "Futsal", "ano": 2026, "professor_id": "prof-1"}]),
        alunos=FakeCollection([
            {"id": "a-1", "nome": "Carlos Alves", "turma_id": "t-1"},
            {"id": "a-2", "nome": "Outra Turma", "turma_id": "t-2"},
        ]),
        individual_plan=FakeCollection(),
        individual_sessions=FakeCollection(),
    )
    events = []

    async def record(*args):
        events.append(args)

    monkeypatch.setattr(router, "db", fake)
    monkeypatch.setattr(router, "publish_user_event", record)
    monkeypatch.setattr("lib.portal_access.db", fake)
    monkeypatch.setattr("lib.notifications.db", fake)
    monkeypatch.setattr("lib.notifications.publish_event", record)
    fake.events = events
    return fake


def payload(**overrides):
    data = {
        "aluno_id": "a-1",
        "titulo": "Preparação sub-15",
        "template": "hipertrofia",
        "exercicios": [{"nome": "Supino", "series": 3, "repeticoes": "10", "carga": "40kg", "descanso_s": 60}],
        "recorrencia": rule_weekly(),
        "data_inicio": "2026-03-02",
        "data_fim": "2026-03-08",
    }
    data.update(overrides)
    return router.PlanCreate(**data)


async def create(db, professor=PROF, **overrides):
    return await router.create_plan(payload(**overrides), user=professor)


async def test_template_list_has_six_options(db):
    result = await router.list_templates(user=PROF)
    ids = {item["id"] for item in result["templates"]}
    assert ids == {"musculacao", "atletismo", "hipertrofia", "forca_maxima", "resistencia_muscular", "hiit"}


async def test_create_generates_one_session_per_matched_day(db):
    result = await create(db)

    # 2026-03-02 is a Monday; seg/qua/sex within the week -> 3 sessions.
    assert result["sessoes"] == 3
    sessions = db.individual_sessions.documents
    assert [s["data"] for s in sessions] == ["2026-03-02", "2026-03-04", "2026-03-06"]
    assert all(s["is_completed"] is False and s["completed_at"] is None for s in sessions)
    assert result["plan"]["recorrencia_label"] == "Seg · Qua · Sex"


async def test_only_assigned_professor_can_prescribe(db):
    with pytest.raises(HTTPException) as error:
        await create(db, professor=OTHER)
    assert error.value.status_code == 403
    assert db.individual_plan.documents == []


async def test_tracking_returns_sessions_with_completion(db):
    created = await create(db)

    detail = await router.plan_detail(created["plan"]["id"], user=PROF)
    assert detail["aluno"]["nome"] == "Carlos Alves"
    assert len(detail["sessoes"]) == 3

    with pytest.raises(HTTPException) as error:
        await router.plan_detail(created["plan"]["id"], user=OTHER)
    assert error.value.status_code == 403


async def test_student_completes_session_and_teacher_sees_it(db):
    created = await create(db)
    session_id = db.individual_sessions.documents[0]["id"]

    result = await router.complete_session("a-1", session_id, user=ALUNO)
    assert result["is_completed"] is True and result["completed_at"]

    detail = await router.plan_detail(created["plan"]["id"], user=PROF)
    assert sum(1 for s in detail["sessoes"] if s["is_completed"]) == 1

    # Teacher list aggregates completion counts.
    listing = await router.teacher_plans(user=PROF)
    assert listing["plans"][0]["sessoes_concluidas"] == 1

    # Reopen works and clears the timestamp.
    reopened = await router.reopen_session("a-1", session_id, user=ALUNO)
    assert reopened["is_completed"] is False and reopened["completed_at"] is None


async def test_guardian_reads_but_cannot_toggle(db):
    created = await create(db)
    session_id = db.individual_sessions.documents[0]["id"]

    reading = await router.student_plans("a-1", user=RESPONSAVEL)
    assert reading["plans"][0]["sessoes_total"] == 3

    with pytest.raises(HTTPException) as error:
        await router.complete_session("a-1", session_id, user=RESPONSAVEL)
    assert error.value.status_code == 403

    # And an unrelated student account cannot either.
    stranger = User(id="u-x", nome="X", email="x@e.com", tipo="aluno", status="ativo", aluno_id="a-2")
    with pytest.raises(HTTPException) as error:
        await router.complete_session("a-1", session_id, user=stranger)
    assert error.value.status_code == 403


async def test_custom_closed_calendar_is_supported(db):
    result = await create(db, recorrencia={"type": "custom", "weekdays": [], "dates": ["2026-03-02", "2026-03-05", "2026-03-05"]})
    assert result["sessoes"] == 2  # duplicates collapse, dates sorted
    assert [s["data"] for s in db.individual_sessions.documents] == ["2026-03-02", "2026-03-05"]


async def test_daily_rule_and_window_validation(db):
    result = await create(db, recorrencia={"type": "daily", "weekdays": [], "dates": []})
    assert result["sessoes"] == 7

    with pytest.raises(HTTPException) as error:
        await create(db, data_inicio="2026-03-08", data_fim="2026-03-02")
    assert error.value.status_code == 422


async def test_editing_schedule_regenerates_future_sessions(db):
    created = await create(db)
    plan_id = created["plan"]["id"]
    await router.complete_session("a-1", db.individual_sessions.documents[0]["id"], user=ALUNO)

    updated = await router.update_plan(plan_id, router.PlanUpdate(
        recorrencia=router.RecorrenciaInput(type="daily"),
        data_inicio="2026-03-02",
        data_fim="2026-03-04",
    ), user=PROF)

    assert updated["sessoes"] == 3  # 2, 3 and 4 March, now daily
    datas = [s["data"] for s in db.individual_sessions.documents]
    assert datas == ["2026-03-02", "2026-03-03", "2026-03-04"]


async def test_delete_removes_plan_and_sessions(db):
    created = await create(db)

    result = await router.delete_plan(created["plan"]["id"], user=PROF)

    assert result["status"] == "excluido"
    assert db.individual_plan.documents == [] and db.individual_sessions.documents == []
