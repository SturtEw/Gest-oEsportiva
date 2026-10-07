"""Individual training (1-on-1): templates and schedule expansion.

A plan belongs to one professor and one aluno. The plan stores a recurrence
rule; the concrete workout sessions (one per date) are pre-generated when the
plan is created or edited, so the student sees a fixed calendar and each
session carries its own completion status (is_completed / completed_at).

Recurrence rules:
  - {"type": "daily"}                              -> every day from start
  - {"type": "weekly", "weekdays": [1,3,5]}        -> ISO weekday numbers (1=Mon)
  - {"type": "custom", "dates": ["2026-03-02",...]}-> explicit closed calendar
"""

from datetime import date, timedelta
from typing import Any

MAX_SESSIONS = 366  # roughly a year of daily sessions; keeps the calendar bounded


def _expand_daily(start: date, end: date) -> list[date]:
    if end < start:
        return []
    span = (end - start).days + 1
    if span > MAX_SESSIONS:
        raise ValueError("O periodo nao pode exceder 366 dias")
    return [start + timedelta(days=offset) for offset in range(span)]


def _expand_weekly(start: date, end: date, weekdays: list[int]) -> list[date]:
    valid = sorted({int(d) for d in weekdays if 1 <= int(d) <= 7})
    if not valid:
        raise ValueError("Selecione ao menos um dia da semana")
    dates: list[date] = []
    current = start
    while current <= end:
        if current.isoweekday() in valid:
            dates.append(current)
        current += timedelta(days=1)
    if len(dates) > MAX_SESSIONS:
        raise ValueError("O periodo nao pode gerar mais de 366 sessoes")
    return dates


def _expand_custom(dates: list[str]) -> list[date]:
    parsed: list[date] = []
    for raw in dates:
        try:
            parsed.append(date.fromisoformat(raw))
        except ValueError as exc:
            raise ValueError(f"Data invalida: {raw}") from exc
    if not parsed:
        raise ValueError("Selecione ao menos uma data")
    if len(parsed) > MAX_SESSIONS:
        raise ValueError("O cronograma nao pode exceder 366 sessoes")
    return sorted(set(parsed))


def expand_sessions(rule: dict[str, Any], start: date, end: date) -> list[date]:
    """Turn a recurrence rule into the concrete list of session dates."""
    kind = rule.get("type")
    if kind == "daily":
        return _expand_daily(start, end)
    if kind == "weekly":
        return _expand_weekly(start, end, rule.get("weekdays", []))
    if kind == "custom":
        return _expand_custom(rule.get("dates", []))
    raise ValueError("Regra de frequencia invalida")


# ---------------------------------------------------------------------------
# Predefined templates (six required quick-starts). Each is a list of exercises
# with the fields the plan editor exposes: series, reps, carga, descanso.
# ---------------------------------------------------------------------------
TEMPLATES: dict[str, dict[str, Any]] = {
    "musculacao": {
        "nome": "Musculacao",
        "descricao": "Circuito basico de musculacao em maquinas e pesos livres.",
        "exercicios": [
            {"nome": "Agachamento livre", "series": 3, "repeticoes": "12", "carga": None, "descanso_s": 60},
            {"nome": "Supino reto com barra", "series": 3, "repeticoes": "10", "carga": None, "descanso_s": 60},
            {"nome": "Remada curvada", "series": 3, "repeticoes": "10", "carga": None, "descanso_s": 60},
            {"nome": "Elevacao lateral", "series": 3, "repeticoes": "12", "carga": None, "descanso_s": 45},
            {"nome": "Prancha isometrica", "series": 3, "repeticoes": "40s", "carga": None, "descanso_s": 30},
        ],
    },
    "atletismo": {
        "nome": "Atletismo",
        "descricao": "Velocidade, tecnica de corrida e pliometria para pista.",
        "exercicios": [
            {"nome": "Skipping alto", "series": 4, "repeticoes": "20m", "carga": None, "descanso_s": 45},
            {"nome": "Aceleracao progressiva", "series": 4, "repeticoes": "30m", "carga": None, "descanso_s": 60},
            {"nome": "Salto vertical", "series": 3, "repeticoes": "8", "carga": None, "descanso_s": 60},
            {"nome": "Corrida continua", "series": 1, "repeticoes": "15min", "carga": None, "descanso_s": 0},
        ],
    },
    "hipertrofia": {
        "nome": "Hipertrofia",
        "descricao": "Volume moderado com foco em falha mecanica controlada.",
        "exercicios": [
            {"nome": "Supino inclinado", "series": 4, "repeticoes": "8-10", "carga": None, "descanso_s": 90},
            {"nome": "Puxada frontal", "series": 4, "repeticoes": "8-10", "carga": None, "descanso_s": 90},
            {"nome": "Desenvolvimento halteres", "series": 3, "repeticoes": "10", "carga": None, "descanso_s": 75},
            {"nome": "Rosca direta", "series": 3, "repeticoes": "10-12", "carga": None, "descanso_s": 60},
            {"nome": "Triceps corda", "series": 3, "repeticoes": "10-12", "carga": None, "descanso_s": 60},
        ],
    },
    "forca_maxima": {
        "nome": "Forca Maxima",
        "descricao": "Baixas repeticoes com cargas altas e descanso completo.",
        "exercicios": [
            {"nome": "Agachamento com barra", "series": 5, "repeticoes": "3", "carga": None, "descanso_s": 180},
            {"nome": "Levantamento terra", "series": 5, "repeticoes": "3", "carga": None, "descanso_s": 180},
            {"nome": "Supino com barra", "series": 5, "repeticoes": "3", "carga": None, "descanso_s": 150},
            {"nome": "Barra fixa lastreada", "series": 4, "repeticoes": "3", "carga": None, "descanso_s": 150},
        ],
    },
    "resistencia_muscular": {
        "nome": "Resistencia Muscular",
        "descricao": "Alta repeticao com pouco descanso entre as series.",
        "exercicios": [
            {"nome": "Flexao de braco", "series": 4, "repeticoes": "15-20", "carga": None, "descanso_s": 30},
            {"nome": "Agachamento livre", "series": 4, "repeticoes": "20", "carga": None, "descanso_s": 30},
            {"nome": "Prancha isometrica", "series": 3, "repeticoes": "60s", "carga": None, "descanso_s": 30},
            {"nome": "Burpee", "series": 3, "repeticoes": "12", "carga": None, "descanso_s": 45},
        ],
    },
    "hiit": {
        "nome": "HIIT",
        "descricao": "Intervals de alta intensidade com recuperacao curta.",
        "exercicios": [
            {"nome": "Aquecimento progressivo", "series": 1, "repeticoes": "5min", "carga": None, "descanso_s": 0},
            {"nome": "Sprint 30s / walk 30s", "series": 8, "repeticoes": "30s", "carga": None, "descanso_s": 30},
            {"nome": "Mountain climbers", "series": 4, "repeticoes": "40s", "carga": None, "descanso_s": 20},
            {"nome": "Polichinelo", "series": 4, "repeticoes": "40s", "carga": None, "descanso_s": 20},
            {"nome": "Volta a calma", "series": 1, "repeticoes": "3min", "carga": None, "descanso_s": 0},
        ],
    },
}


def build_sessions(rule: dict[str, Any], start: str, end: str) -> list[dict[str, Any]]:
    """Expanded, sorted session documents ready for insertion."""
    sessions = []
    for session_date in expand_sessions(rule, date.fromisoformat(start), date.fromisoformat(end)):
        sessions.append({
            "id": None,  # caller assigns ids
            "data": session_date.isoformat(),
            "is_completed": False,
            "completed_at": None,
        })
    return sessions
