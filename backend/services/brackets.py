"""Competition brackets for class activities: knockout and round robin.

Pure functions over plain dicts (what is stored in `atividades.chaveamento`), so
the rules can be tested without a database.

Knockout ("mata_mata"): N teams fill a bracket of the next power of two. The
missing slots are byes given to the first seeds, spread so two byes never meet;
a team with a bye advances straight to round 2. Recording a result advances the
winner. A draw needs an explicit winner (penalties, tie-break set).

Round robin ("pontos_corridos"): everyone plays everyone once (circle method).
Win 3, draw 1, loss 0; ties in the table break on wins, balance, points scored.

Match ids are positional (`r{rodada}-m{posicao}`): the next knockout match is
always (rodada + 1, ceil(posicao / 2)), slot A for odd positions.
"""

import math
import random
import uuid
from typing import Any, Literal

Format = Literal["mata_mata", "pontos_corridos"]

FORMATS: tuple[Format, ...] = ("mata_mata", "pontos_corridos")
MIN_TEAMS = 2
MAX_TEAMS: dict[str, int] = {"mata_mata": 32, "pontos_corridos": 16}
MAX_SCORE = 999
TEAM_NAME_MAX = 40

POINTS_WIN = 3
POINTS_DRAW = 1


class BracketError(ValueError):
    """A rule violation; `status` is the HTTP status the router should answer with."""

    def __init__(self, message: str, status: int = 409):
        super().__init__(message)
        self.status = status


# ─── Teams ────────────────────────────────────────────────────────────────────
def default_team_names(count: int) -> list[str]:
    return [f"Time {index + 1}" for index in range(count)]


def distribute(participant_ids: list[str], team_count: int, rng: random.Random | None = None) -> list[list[str]]:
    """Shuffle and deal the participants like cards: team sizes differ by at most one."""
    shuffled = list(dict.fromkeys(participant_ids))
    (rng or random).shuffle(shuffled)
    teams: list[list[str]] = [[] for _ in range(team_count)]
    for index, aluno_id in enumerate(shuffled):
        teams[index % team_count].append(aluno_id)
    return teams


def build_teams(team_count: int, participant_ids: list[str], names: list[str] | None = None, rng: random.Random | None = None) -> list[dict[str, Any]]:
    """`team_count` teams named "Time N" (or `names`), with the participants dealt among them."""
    labels = default_team_names(team_count)
    for index, name in enumerate((names or [])[:team_count]):
        cleaned = clean_team_name(name)
        if cleaned:
            labels[index] = cleaned
    members = distribute(participant_ids, team_count, rng)
    return [{"id": str(uuid.uuid4()), "nome": labels[index], "alunos_ids": members[index]} for index in range(team_count)]


def clean_team_name(name: str | None) -> str:
    return " ".join((name or "").split())[:TEAM_NAME_MAX]


def validate_team_count(formato: str, team_count: int) -> None:
    if formato not in FORMATS:
        raise BracketError("Formato de chaveamento inválido.", 422)
    if not MIN_TEAMS <= team_count <= MAX_TEAMS[formato]:
        raise BracketError(f"Escolha entre {MIN_TEAMS} e {MAX_TEAMS[formato]} times para este formato.", 422)


# ─── Match generation ─────────────────────────────────────────────────────────
def _match(rodada: int, posicao: int, time_a: str | None, time_b: str | None, status: str) -> dict[str, Any]:
    return {
        "id": f"r{rodada}-m{posicao}",
        "rodada": rodada,
        "posicao": posicao,
        "time_a_id": time_a,
        "time_b_id": time_b,
        "placar_a": None,
        "placar_b": None,
        "vencedor_id": None,
        "status": status,
    }


def seed_order(size: int) -> list[int]:
    """Standard bracket seeding (1 vs size, 2 meets 1 only in the final...)."""
    order = [1]
    while len(order) < size:
        total = len(order) * 2 + 1
        order = [seed for current in order for seed in (current, total - current)]
    return order


def knockout_rounds(team_count: int) -> int:
    return max(1, math.ceil(math.log2(team_count)))


def knockout_matches(team_ids: list[str]) -> list[dict[str, Any]]:
    """All matches of a single-elimination bracket; byes already resolved."""
    rounds = knockout_rounds(len(team_ids))
    size = 2 ** rounds
    order = seed_order(size)
    team_for_seed = {seed: team_ids[seed - 1] for seed in range(1, len(team_ids) + 1)}

    matches: list[dict[str, Any]] = []
    for posicao in range(1, size // 2 + 1):
        time_a = team_for_seed.get(order[2 * posicao - 2])
        time_b = team_for_seed.get(order[2 * posicao - 1])
        match = _match(1, posicao, time_a, time_b, "pendente")
        if time_a is None or time_b is None:
            match["status"] = "bye"
            match["vencedor_id"] = time_a or time_b
        matches.append(match)
    for rodada in range(2, rounds + 1):
        for posicao in range(1, size // 2 ** rodada + 1):
            matches.append(_match(rodada, posicao, None, None, "aguardando"))
    propagate(matches)
    return matches


def round_robin_matches(team_ids: list[str]) -> list[dict[str, Any]]:
    """Circle method: n-1 rounds (n with a rest round when n is odd)."""
    teams: list[str | None] = list(team_ids)
    if len(teams) % 2:
        teams.append(None)
    count = len(teams)
    matches: list[dict[str, Any]] = []
    for rodada in range(1, count):
        posicao = 0
        for index in range(count // 2):
            time_a, time_b = teams[index], teams[count - 1 - index]
            if time_a is None or time_b is None:
                continue  # that team rests this round
            if index == 0 and rodada % 2 == 0:
                time_a, time_b = time_b, time_a  # alternate the fixed team's side
            posicao += 1
            matches.append(_match(rodada, posicao, time_a, time_b, "pendente"))
        teams = [teams[0], teams[-1], *teams[1:-1]]
    return matches


def create_bracket(formato: str, teams: list[dict[str, Any]], now: Any) -> dict[str, Any]:
    validate_team_count(formato, len(teams))
    team_ids = [team["id"] for team in teams]
    random.shuffle(team_ids)  # the draw: bracket position does not follow team numbering
    matches = knockout_matches(team_ids) if formato == "mata_mata" else round_robin_matches(team_ids)
    return {"formato": formato, "versao": 1, "criado_em": now, "times": teams, "partidas": matches}


# ─── Results ──────────────────────────────────────────────────────────────────
def _by_position(matches: list[dict[str, Any]]) -> dict[tuple[int, int], dict[str, Any]]:
    return {(match["rodada"], match["posicao"]): match for match in matches}


def next_match(matches: list[dict[str, Any]], match: dict[str, Any]) -> dict[str, Any] | None:
    return _by_position(matches).get((match["rodada"] + 1, math.ceil(match["posicao"] / 2)))


def propagate(matches: list[dict[str, Any]]) -> None:
    """Refill rounds 2+ from the winners of the previous round (knockout only)."""
    positions = _by_position(matches)
    rounds = max((match["rodada"] for match in matches), default=0)
    for rodada in range(2, rounds + 1):
        posicao = 1
        while (rodada, posicao) in positions:
            match = positions[(rodada, posicao)]
            feeder_a = positions.get((rodada - 1, 2 * posicao - 1))
            feeder_b = positions.get((rodada - 1, 2 * posicao))
            time_a = feeder_a.get("vencedor_id") if feeder_a else None
            time_b = feeder_b.get("vencedor_id") if feeder_b else None
            if (match["time_a_id"], match["time_b_id"]) != (time_a, time_b) and match["status"] == "finalizada":
                _reset(match)  # a result for a pairing that no longer exists
            match["time_a_id"], match["time_b_id"] = time_a, time_b
            if match["status"] != "finalizada":
                match["status"] = "pendente" if time_a and time_b else "aguardando"
            posicao += 1


def _reset(match: dict[str, Any]) -> None:
    match.update({"placar_a": None, "placar_b": None, "vencedor_id": None})
    match["status"] = "pendente" if match["time_a_id"] and match["time_b_id"] else "aguardando"


def _validate_score(value: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= MAX_SCORE:
        raise BracketError(f"O placar precisa ser um número entre 0 e {MAX_SCORE}.", 422)
    return value


def record_result(bracket: dict[str, Any], match_id: str, placar_a: int | None, placar_b: int | None, vencedor_id: str | None = None) -> dict[str, Any]:
    """Set (or clear, with both scores None) the result of a match. Mutates and returns the match."""
    matches = bracket["partidas"]
    match = next((item for item in matches if item["id"] == match_id), None)
    if match is None:
        raise BracketError("Partida não encontrada.", 404)
    if match["status"] == "bye":
        raise BracketError("Este time avançou direto; não há partida para registrar.")
    if not (match["time_a_id"] and match["time_b_id"]):
        raise BracketError("Os dois times desta partida ainda não estão definidos.")

    knockout = bracket["formato"] == "mata_mata"
    if knockout:
        following = next_match(matches, match)
        if following and following["status"] == "finalizada":
            raise BracketError("A próxima fase já tem resultado. Desfaça o resultado dela antes de alterar este.")

    if placar_a is None and placar_b is None:
        _reset(match)
    else:
        if placar_a is None or placar_b is None:
            raise BracketError("Informe o placar dos dois times.", 422)
        placar_a, placar_b = _validate_score(placar_a), _validate_score(placar_b)
        sides = {match["time_a_id"], match["time_b_id"]}
        if vencedor_id is not None and vencedor_id not in sides:
            raise BracketError("O vencedor precisa ser um dos times da partida.", 422)
        if placar_a != placar_b:
            leader = match["time_a_id"] if placar_a > placar_b else match["time_b_id"]
            if vencedor_id is not None and vencedor_id != leader:
                raise BracketError("O vencedor não confere com o placar.", 422)
            winner: str | None = leader
        elif knockout:
            if vencedor_id is None:
                raise BracketError("No mata-mata não há empate: escolha quem avança (pênaltis, desempate).", 422)
            winner = vencedor_id
        else:
            winner = None  # draw
        match.update({"placar_a": placar_a, "placar_b": placar_b, "vencedor_id": winner, "status": "finalizada"})

    if knockout:
        propagate(matches)
    return match


# ─── Read models ──────────────────────────────────────────────────────────────
def standings(bracket: dict[str, Any]) -> list[dict[str, Any]]:
    """Round-robin table. Empty for knockout brackets."""
    if bracket.get("formato") != "pontos_corridos":
        return []
    rows = {
        team["id"]: {"time_id": team["id"], "nome": team["nome"], "jogos": 0, "vitorias": 0, "empates": 0, "derrotas": 0,
                     "pontos_pro": 0, "pontos_contra": 0, "saldo": 0, "pontos": 0}
        for team in bracket.get("times", [])
    }
    for match in bracket.get("partidas", []):
        if match.get("status") != "finalizada":
            continue
        a, b = rows.get(match["time_a_id"]), rows.get(match["time_b_id"])
        if not a or not b:
            continue
        for row, scored, conceded in ((a, match["placar_a"], match["placar_b"]), (b, match["placar_b"], match["placar_a"])):
            row["jogos"] += 1
            row["pontos_pro"] += scored
            row["pontos_contra"] += conceded
        if match["vencedor_id"] is None:
            a["empates"] += 1
            b["empates"] += 1
        else:
            winner, loser = (a, b) if match["vencedor_id"] == a["time_id"] else (b, a)
            winner["vitorias"] += 1
            loser["derrotas"] += 1
    for row in rows.values():
        row["saldo"] = row["pontos_pro"] - row["pontos_contra"]
        row["pontos"] = row["vitorias"] * POINTS_WIN + row["empates"] * POINTS_DRAW
    ordered = sorted(rows.values(), key=lambda row: (-row["pontos"], -row["vitorias"], -row["saldo"], -row["pontos_pro"], row["nome"].lower()))
    for index, row in enumerate(ordered, start=1):
        row["posicao"] = index
    return ordered


def champion(bracket: dict[str, Any]) -> str | None:
    matches = bracket.get("partidas", [])
    if not matches:
        return None
    if bracket.get("formato") == "mata_mata":
        final_round = max(match["rodada"] for match in matches)
        final = next(match for match in matches if match["rodada"] == final_round)
        return final.get("vencedor_id") if final.get("status") in ("finalizada", "bye") else None
    if all(match.get("status") == "finalizada" for match in matches):
        table = standings(bracket)
        return table[0]["time_id"] if table else None
    return None


def total_rounds(bracket: dict[str, Any]) -> int:
    return max((match["rodada"] for match in bracket.get("partidas", [])), default=0)
