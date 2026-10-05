# Bracket rules: byes, advancing winners, draws, round-robin table.
import random

import pytest

from services import brackets
from services.brackets import BracketError


def teams(count):
    return [f"t{index}" for index in range(1, count + 1)]


def bracket(formato, count):
    ids = teams(count)
    matches = brackets.knockout_matches(ids) if formato == "mata_mata" else brackets.round_robin_matches(ids)
    return {"formato": formato, "times": [{"id": team, "nome": team.upper(), "alunos_ids": []} for team in ids], "partidas": matches}


def match(chave, rodada, posicao):
    return next(item for item in chave["partidas"] if item["rodada"] == rodada and item["posicao"] == posicao)


def test_seed_order_keeps_top_seeds_apart():
    assert brackets.seed_order(8) == [1, 8, 4, 5, 2, 7, 3, 6]
    assert brackets.seed_order(2) == [1, 2]


@pytest.mark.parametrize("count", range(2, 33))
def test_knockout_shape_for_any_team_count(count):
    chave = bracket("mata_mata", count)
    rounds = brackets.knockout_rounds(count)
    size = 2 ** rounds
    first = [item for item in chave["partidas"] if item["rodada"] == 1]

    assert len(chave["partidas"]) == size - 1
    assert len(first) == size // 2
    byes = [item for item in first if item["status"] == "bye"]
    assert len(byes) == size - count
    # Every team appears exactly once in round 1, and two byes never meet.
    placed = [team for item in first for team in (item["time_a_id"], item["time_b_id"]) if team]
    assert sorted(placed) == sorted(teams(count))
    assert all(item["vencedor_id"] for item in byes)


def test_bye_winner_is_already_in_round_two():
    chave = bracket("mata_mata", 3)  # t1 has the bye
    final = match(chave, 2, 1)
    assert final["time_a_id"] == "t1" and final["time_b_id"] is None and final["status"] == "aguardando"


def test_winner_advances_and_champion_is_known():
    chave = bracket("mata_mata", 4)  # semis: t1 x t4, t2 x t3
    brackets.record_result(chave, "r1-m1", 2, 0)
    brackets.record_result(chave, "r1-m2", 1, 3)
    final = match(chave, 2, 1)
    assert (final["time_a_id"], final["time_b_id"], final["status"]) == ("t1", "t3", "pendente")

    brackets.record_result(chave, "r2-m1", 1, 1, vencedor_id="t3")
    assert brackets.champion(chave) == "t3"


def test_knockout_draw_needs_a_winner():
    chave = bracket("mata_mata", 2)
    with pytest.raises(BracketError) as error:
        brackets.record_result(chave, "r1-m1", 2, 2)
    assert error.value.status == 422


def test_winner_must_match_the_score():
    chave = bracket("mata_mata", 2)
    with pytest.raises(BracketError):
        brackets.record_result(chave, "r1-m1", 3, 1, vencedor_id="t2")


def test_cannot_change_a_result_once_the_next_round_is_played():
    chave = bracket("mata_mata", 4)
    brackets.record_result(chave, "r1-m1", 2, 0)
    brackets.record_result(chave, "r1-m2", 0, 1)
    brackets.record_result(chave, "r2-m1", 1, 0)

    with pytest.raises(BracketError):
        brackets.record_result(chave, "r1-m1", 0, 2)

    brackets.record_result(chave, "r2-m1", None, None)  # undo the final first
    brackets.record_result(chave, "r1-m1", 0, 2)
    assert match(chave, 2, 1)["time_a_id"] == "t4"


def test_clearing_a_result_takes_the_team_back_out():
    chave = bracket("mata_mata", 4)
    brackets.record_result(chave, "r1-m1", 2, 0)
    brackets.record_result(chave, "r1-m1", None, None)
    final = match(chave, 2, 1)
    assert final["time_a_id"] is None and final["status"] == "aguardando"


def test_match_without_both_teams_or_bye_is_rejected():
    chave = bracket("mata_mata", 3)
    with pytest.raises(BracketError):
        brackets.record_result(chave, "r2-m1", 1, 0)
    bye = next(item for item in chave["partidas"] if item["status"] == "bye")
    with pytest.raises(BracketError):
        brackets.record_result(chave, bye["id"], 1, 0)


@pytest.mark.parametrize("count", [2, 3, 4, 5, 8, 16])
def test_round_robin_everyone_plays_everyone_once(count):
    chave = bracket("pontos_corridos", count)
    pairs = [frozenset((item["time_a_id"], item["time_b_id"])) for item in chave["partidas"]]
    assert len(pairs) == count * (count - 1) // 2
    assert len(set(pairs)) == len(pairs)
    # Nobody plays twice in the same round.
    for rodada in {item["rodada"] for item in chave["partidas"]}:
        playing = [team for item in chave["partidas"] if item["rodada"] == rodada for team in (item["time_a_id"], item["time_b_id"])]
        assert len(playing) == len(set(playing))


def test_round_robin_table_and_draws():
    chave = bracket("pontos_corridos", 3)
    for item in chave["partidas"]:
        pair = {item["time_a_id"], item["time_b_id"]}
        if pair == {"t1", "t2"}:
            brackets.record_result(chave, item["id"], 1, 1)  # draw
        elif "t3" in pair:
            a_is_3 = item["time_a_id"] == "t3"
            brackets.record_result(chave, item["id"], 0 if a_is_3 else 2, 2 if a_is_3 else 0)  # t3 loses

    table = brackets.standings(chave)
    assert [row["time_id"] for row in table][:2] in (["t1", "t2"], ["t2", "t1"])
    assert table[-1]["time_id"] == "t3" and table[-1]["pontos"] == 0
    assert table[0]["pontos"] == 4 and table[0]["empates"] == 1
    assert brackets.champion(chave) == table[0]["time_id"]


def test_distribution_is_balanced_and_complete():
    members = brackets.distribute([f"a{index}" for index in range(11)], 4, random.Random(1))
    sizes = sorted(len(team) for team in members)
    assert sizes == [2, 3, 3, 3]
    assert sorted(aluno for team in members for aluno in team) == sorted(f"a{index}" for index in range(11))


def test_team_count_limits():
    with pytest.raises(BracketError):
        brackets.validate_team_count("mata_mata", 1)
    with pytest.raises(BracketError):
        brackets.validate_team_count("pontos_corridos", 17)
    brackets.validate_team_count("mata_mata", 32)
