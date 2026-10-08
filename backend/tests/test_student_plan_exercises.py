# Regression test: the student's plan payload must include the exercises array.
# The bug report was "details invisible on the student screen" — if the backend
# ever drops `exercicios` from the /aluno route, this fails loudly.
import pytest

from models.models import User
from routers import individual_workouts as router
from tests.fake_mongo import FakeCollection, enrollment_db

PROF = User(id="prof-1", nome="Ana Souza", email="ana@escola.com", tipo="professor", status="ativo")
ALUNO = User(id="user-aluno", nome="Aluno Conta", email="aluno@escola.com", tipo="aluno", status="ativo", aluno_id="a-1")


def rule_weekly():
    return {"type": "weekly", "weekdays": [1, 3, 5], "dates": []}


@pytest.fixture
def db(monkeypatch):
    fake = enrollment_db(
        turmas=FakeCollection([{"id": "t-1", "nome": "Futsal", "modalidade": "Futsal", "ano": 2026, "professor_id": "prof-1"}]),
        alunos=FakeCollection([{"id": "a-1", "nome": "Carlos Alves", "turma_id": "t-1"}]),
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


async def create(db):
    from routers.individual_workouts import PlanCreate, ExercicioInput, RecorrenciaInput

    payload = PlanCreate(
        aluno_id="a-1",
        titulo="Força",
        template="forca_maxima",
        observacoes=None,
        exercicios=[
            ExercicioInput(nome="Agachamento", series=4, repeticoes="6", carga="60kg", descanso_s=120),
            ExercicioInput(nome="Supino", series=3, repeticoes="10", carga="40kg", descanso_s=60),
        ],
        recorrencia=RecorrenciaInput(**rule_weekly()),
        data_inicio="2026-10-05",
        data_fim="2026-10-09",
    )
    return await router.create_plan(payload, user=PROF)


async def test_student_plans_include_exercise_details(db):
    created = await create(db)

    result = await router.student_plans("a-1", user=ALUNO)
    plan = result["plans"][0]

    assert plan["exercicios"] == created["plan"]["exercicios"]
    first = plan["exercicios"][0]
    assert first["nome"] == "Agachamento"
    assert first["series"] == 4
    assert first["repeticoes"] == "6"
    assert first["carga"] == "60kg"
    assert first["descanso_s"] == 120
    # Every field the student card renders must be present, never None/missing.
    for exercise in plan["exercicios"]:
        assert set(exercise) >= {"nome", "series", "repeticoes", "descanso_s"}
