# Class activities: who may manage them, student interest, seats and brackets.
import pytest
from fastapi import HTTPException

from models.models import User
from routers import class_activities as router
from tests.fake_mongo import FakeCollection, enrollment_db

TEACHER = User(id="prof-1", nome="Ana Souza", email="ana@escola.com", tipo="professor", status="ativo")
OTHER_TEACHER = User(id="prof-2", nome="Bruno Lima", email="bruno@escola.com", tipo="professor", status="ativo")
CAIO = User(id="user-1", nome="Caio Alves", email="caio@aluno.com", tipo="aluno", aluno_id="aluno-1")
DUDA = User(id="user-2", nome="Duda Reis", email="duda@aluno.com", tipo="aluno", aluno_id="aluno-2")
OUTSIDER = User(id="user-9", nome="Eva Lopes", email="eva@aluno.com", tipo="aluno", aluno_id="aluno-9")
GUARDIAN = User(id="user-5", nome="Rita Alves", email="rita@familia.com", tipo="responsavel", filhos_ids=["aluno-1"])


@pytest.fixture
def db(monkeypatch):
    fake = enrollment_db(
        alunos=FakeCollection([
            {"id": "aluno-1", "nome": "Caio Alves", "turma_id": "t-1"},
            {"id": "aluno-2", "nome": "Duda Reis", "turma_id": "t-1"},
            {"id": "aluno-3", "nome": "Fábio Melo", "turma_id": "t-1"},
            {"id": "aluno-4", "nome": "Gabi Nunes", "turma_id": "t-1"},
            {"id": "aluno-9", "nome": "Eva Lopes", "turma_id": "t-2"},
        ]),
        turmas=FakeCollection([
            {"id": "t-1", "nome": "Futsal Sub-13", "modalidade": "Futsal", "ano": 2026, "professor_id": "prof-1"},
            {"id": "t-2", "nome": "Vôlei Misto", "modalidade": "Vôlei", "ano": 2026, "professor_id": "prof-2"},
        ]),
        atividades=FakeCollection(),
    )
    events = []

    async def record(*args):
        events.append(args)

    monkeypatch.setattr(router, "db", fake)
    monkeypatch.setattr(router, "publish_class_event", record)
    monkeypatch.setattr(router, "publish_user_event", record)
    monkeypatch.setattr("lib.portal_access.db", fake)
    fake.events = events
    return fake


async def create(titulo="Torneio relâmpago", **extra):
    return await router.create_activity(router.ActivityCreate(turma_id="t-1", titulo=titulo, **extra), user=TEACHER)


# ─── Teacher management ───────────────────────────────────────────────────────
async def test_teacher_creates_many_activities_for_own_class(db):
    await create("Torneio relâmpago")
    await create("Gincana de passes", data="2026-10-20", horario="14:30", local="Quadra 2")

    listing = await router.teacher_activities(user=TEACHER)
    assert {item["titulo"] for item in listing["atividades"]} == {"Gincana de passes", "Torneio relâmpago"}
    gincana = next(item for item in listing["atividades"] if item["titulo"] == "Gincana de passes")
    assert (gincana["data"], gincana["horario"], gincana["local"]) == ("2026-10-20", "14:30", "Quadra 2")
    assert listing["turmas"][0]["id"] == "t-1"
    assert ("t-1", "activities") in db.events


async def test_teacher_cannot_use_another_teachers_class(db):
    with pytest.raises(HTTPException) as error:
        await router.create_activity(router.ActivityCreate(turma_id="t-2", titulo="Intrusa"), user=TEACHER)
    assert error.value.status_code == 403

    activity = await create()
    with pytest.raises(HTTPException) as error:
        await router.teacher_activity(activity["id"], user=OTHER_TEACHER)
    assert error.value.status_code == 403


async def test_invalid_time_and_title_are_rejected():
    with pytest.raises(ValueError):
        router.ActivityCreate(turma_id="t-1", titulo="Ok título", horario="25:00")
    with pytest.raises(ValueError):
        router.ActivityCreate(turma_id="t-1", titulo="  a  ")


async def test_teacher_adds_and_removes_class_students(db):
    activity = await create()
    detail = await router.add_participants(activity["id"], router.ParticipantsAdd(alunos_ids=["aluno-1", "aluno-2", "aluno-1"]), user=TEACHER)
    assert [item["id"] for item in detail["participantes"]] == ["aluno-1", "aluno-2"]
    assert all(item["origem"] == "professor" for item in detail["participantes"])

    with pytest.raises(HTTPException) as error:
        await router.add_participants(activity["id"], router.ParticipantsAdd(alunos_ids=["aluno-9"]), user=TEACHER)
    assert error.value.status_code == 422  # not in this class

    detail = await router.remove_participant(activity["id"], "aluno-1", user=TEACHER)
    assert [item["id"] for item in detail["participantes"]] == ["aluno-2"]


async def test_seat_limit_applies_to_teacher_and_students(db):
    activity = await create(vagas=3)
    await router.add_participants(activity["id"], router.ParticipantsAdd(alunos_ids=["aluno-3", "aluno-4"]), user=TEACHER)
    joined = await router.join_activity(activity["id"], user=CAIO)
    assert joined["vagas_restantes"] == 0

    with pytest.raises(HTTPException) as error:
        await router.join_activity(activity["id"], user=DUDA)
    assert error.value.status_code == 409
    with pytest.raises(HTTPException) as error:
        await router.add_participants(activity["id"], router.ParticipantsAdd(alunos_ids=["aluno-2"]), user=TEACHER)
    assert error.value.status_code == 409
    with pytest.raises(HTTPException) as error:
        await router.update_activity(activity["id"], router.ActivityUpdate(vagas=2), user=TEACHER)
    assert error.value.status_code == 409


# ─── Student interest ─────────────────────────────────────────────────────────
async def test_student_marks_interest_and_teacher_sees_it(db):
    activity = await create()

    joined = await router.join_activity(activity["id"], user=CAIO)
    assert joined["inscrito"] and joined["origem"] == "interesse" and joined["pode_sair"]
    assert ("prof-1", "activities") in db.events

    detail = await router.teacher_activity(activity["id"], user=TEACHER)
    assert detail["participantes"] == [{"id": "aluno-1", "nome": "Caio Alves", "origem": "interesse"}]

    again = await router.join_activity(activity["id"], user=CAIO)  # idempotent
    assert again["total_participantes"] == 1

    left = await router.leave_activity(activity["id"], user=CAIO)
    assert not left["inscrito"] and left["total_participantes"] == 0


async def test_closed_activity_refuses_interest(db):
    activity = await create(inscricoes_abertas=False)
    with pytest.raises(HTTPException) as error:
        await router.join_activity(activity["id"], user=CAIO)
    assert error.value.status_code == 409


async def test_students_only_see_their_own_class(db):
    activity = await create()
    with pytest.raises(HTTPException) as error:
        await router.join_activity(activity["id"], user=OUTSIDER)
    assert error.value.status_code == 404

    assert (await router.student_activities("aluno-9", user=OUTSIDER))["atividades"] == []
    assert len((await router.student_activities("aluno-1", user=CAIO))["atividades"]) == 1


async def test_guardian_reads_but_cannot_join(db):
    await create()
    listing = await router.student_activities("aluno-1", user=GUARDIAN)
    assert len(listing["atividades"]) == 1
    with pytest.raises(HTTPException) as error:
        await router.join_activity(listing["atividades"][0]["id"], user=GUARDIAN)
    assert error.value.status_code == 403


# ─── Brackets ─────────────────────────────────────────────────────────────────
async def with_participants(*alunos):
    activity = await create()
    await router.add_participants(activity["id"], router.ParticipantsAdd(alunos_ids=list(alunos)), user=TEACHER)
    return activity


async def test_teacher_sets_the_number_of_teams_and_students_are_dealt(db):
    activity = await with_participants("aluno-1", "aluno-2", "aluno-3", "aluno-4")

    detail = await router.create_bracket(activity["id"], router.BracketCreate(formato="mata_mata", quantidade_times=3, nomes_times=["Leões", "", "Águias"]), user=TEACHER)

    chave = detail["chaveamento"]
    assert [team["nome"] for team in chave["times"]] == ["Leões", "Time 2", "Águias"]
    assert sorted(team["total_membros"] for team in chave["times"]) == [1, 1, 2]
    assert len(chave["partidas"]) == 3 and chave["total_rodadas"] == 2
    assert detail["tem_chaveamento"] and detail["formato"] == "mata_mata"

    with pytest.raises(HTTPException) as error:
        await router.create_bracket(activity["id"], router.BracketCreate(formato="mata_mata", quantidade_times=4), user=TEACHER)
    assert error.value.status_code == 409


async def test_student_sees_only_own_team_members(db):
    activity = await with_participants("aluno-1", "aluno-2", "aluno-3", "aluno-4")
    await router.create_bracket(activity["id"], router.BracketCreate(formato="pontos_corridos", quantidade_times=2), user=TEACHER)

    view = (await router.student_activities("aluno-1", user=CAIO))["atividades"][0]
    mine = [team for team in view["chaveamento"]["times"] if team["meu_time"]]
    others = [team for team in view["chaveamento"]["times"] if not team["meu_time"]]
    assert len(mine) == 1 and "Caio A." in [member["nome"] for member in mine[0]["membros"]]
    assert all("membros" not in team for team in others)
    assert not view["pode_sair"]
    with pytest.raises(HTTPException) as error:
        await router.leave_activity(activity["id"], user=CAIO)
    assert error.value.status_code == 409


async def test_results_advance_and_round_robin_table(db):
    activity = await with_participants("aluno-1", "aluno-2")
    detail = await router.create_bracket(activity["id"], router.BracketCreate(formato="mata_mata", quantidade_times=2), user=TEACHER)
    final = detail["chaveamento"]["partidas"][0]
    team_a = final["time_a_id"]

    with pytest.raises(HTTPException) as error:
        await router.record_match(activity["id"], final["id"], router.MatchResult(placar_a=1, placar_b=1), user=TEACHER)
    assert error.value.status_code == 422

    detail = await router.record_match(activity["id"], final["id"], router.MatchResult(placar_a=3, placar_b=1), user=TEACHER)
    assert detail["chaveamento"]["campeao_id"] == team_a
    assert detail["chaveamento"]["versao"] == 2


async def test_teams_edit_rename_and_move(db):
    activity = await with_participants("aluno-1", "aluno-2", "aluno-3")
    detail = await router.create_bracket(activity["id"], router.BracketCreate(formato="pontos_corridos", quantidade_times=2), user=TEACHER)
    first, second = detail["chaveamento"]["times"]

    edit = router.TeamsUpdate(times=[
        router.TeamEdit(id=first["id"], nome="Azul", alunos_ids=["aluno-1", "aluno-2"]),
        router.TeamEdit(id=second["id"], nome="Verde", alunos_ids=["aluno-3"]),
    ])
    detail = await router.update_teams(activity["id"], edit, user=TEACHER)
    assert [(team["nome"], team["total_membros"]) for team in detail["chaveamento"]["times"]] == [("Azul", 2), ("Verde", 1)]

    duplicated = router.TeamsUpdate(times=[
        router.TeamEdit(id=first["id"], nome="Azul", alunos_ids=["aluno-1"]),
        router.TeamEdit(id=second["id"], nome="Verde", alunos_ids=["aluno-1"]),
    ])
    with pytest.raises(HTTPException) as error:
        await router.update_teams(activity["id"], duplicated, user=TEACHER)
    assert error.value.status_code == 422

    # Removing a participant takes them out of their team too.
    detail = await router.remove_participant(activity["id"], "aluno-2", user=TEACHER)
    assert detail["chaveamento"]["times"][0]["total_membros"] == 1


async def test_stale_bracket_version_is_refused(db):
    activity = await with_participants("aluno-1", "aluno-2")
    detail = await router.create_bracket(activity["id"], router.BracketCreate(formato="mata_mata", quantidade_times=2), user=TEACHER)
    stale = await db.atividades.find_one({"id": activity["id"]})
    await router.redraw_teams(activity["id"], user=TEACHER)  # bumps the version

    with pytest.raises(HTTPException) as error:
        await router._save_bracket(stale, {**stale["chaveamento"]})
    assert error.value.status_code == 409
    assert detail["chaveamento"]["versao"] == 1


async def test_delete_bracket_then_activity(db):
    activity = await with_participants("aluno-1", "aluno-2")
    await router.create_bracket(activity["id"], router.BracketCreate(formato="mata_mata", quantidade_times=2), user=TEACHER)

    detail = await router.delete_bracket(activity["id"], user=TEACHER)
    assert detail["chaveamento"] is None and detail["tem_chaveamento"] is False

    await router.delete_activity(activity["id"], user=TEACHER)
    assert db.atividades.documents == []
