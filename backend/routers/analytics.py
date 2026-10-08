"""Analytics de frequência — agregações exclusivas para o painel do professor.

Rotas separadas (/api/analytics/...) para não tocar nas rotas funcionais:
todas as consultas rodam via aggregation pipeline no MongoDB, calculando no
banco (contagem por dia, hora de pico, tempo médio de permanência).

Autorização: professor só vê dados das suas turmas (igual aos demais módulos).
"""

from datetime import date, datetime, time, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from lib.db import db
from lib.guards import format_duration, require_teacher
from lib.security import get_current_user
from models.models import User
from lib.dates import now_utc

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

MAX_DAYS = 90


# Alias local para manter os call-sites enxutos; a regra vive em lib/guards.py.
_require_teacher = require_teacher


async def _owned_turma_ids(user: User, turma_id: str | None) -> list[str]:
    """IDs das turmas do professor; se `turma_id` vier, valida a posse dele."""
    query: dict[str, Any] = {"professor_id": user.id}
    if turma_id:
        query["id"] = turma_id
    turmas = await db.turmas.find(query, {"_id": 0, "id": 1}).to_list(length=200)
    ids = [t["id"] for t in turmas]
    if turma_id and turma_id not in ids:
        raise HTTPException(status_code=403, detail="A turma não está vinculada a este professor")
    if not ids:
        raise HTTPException(status_code=404, detail="Nenhuma turma atribuída a você")
    return ids


def _range(days: int) -> dict[str, Any]:
    """Janela [start_of_range, now) para os pipelines."""
    start = now_utc() - timedelta(days=days)
    return {"$gte": start}


# ─── A) Resumo por subgrupo/turma ────────────────────────────────────────────
@router.get("/resumo")
async def analytics_resumo(turma_id: str | None = None, subgrupo_id: str | None = None, user: User = Depends(get_current_user)):
    """Cards de resumo: alunos hoje, tempo médio de permanência (7d) e total de sessões."""
    _require_teacher(user)
    turma_ids = await _owned_turma_ids(user, turma_id)
    match: dict[str, Any] = {"turma_id": {"$in": turma_ids}}
    if subgrupo_id:
        match["subgrupo_id"] = subgrupo_id

    today_start = now_utc().replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = now_utc() - timedelta(days=7)

    pipeline = [
        {"$match": match},
        {
            "$group": {
                "_id": None,
                # "Passou pelo grupo hoje": entradas desde a meia-noite (UTC).
                "alunos_hoje": {"$addToSet": {"$cond": [{"$gte": ["$entrada", today_start]}, "$aluno_id", "$$REMOVE"]}},
                "sessoes_hoje": {"$sum": {"$cond": [{"$gte": ["$entrada", today_start]}, 1, 0]}},
                "sessoes_7d": {"$sum": {"$cond": [{"$gte": ["$entrada", week_start]}, 1, 0]}},
                # Tempo médio só de sessões concluídas (com saída registrada).
                "duracoes_7d": {"$push": {"$cond": [
                    {"$and": [{"$gte": ["$entrada", week_start]}, {"$ne": ["$saida", None]}, {"$gt": ["$tempo_permanencia_segundos", None]}]},
                    "$tempo_permanencia_segundos", "$$REMOVE",
                ]}},
                "total_sessoes": {"$sum": 1},
            },
        },
        {
            "$project": {
                "_id": 0,
                "alunos_hoje": {"$size": "$alunos_hoje"},
                "sessoes_hoje": 1,
                "sessoes_7d": 1,
                "total_sessoes": 1,
                "tempo_medio_segundos": {"$cond": [
                    {"$gt": [{"$size": "$duracoes_7d"}, 0]},
                    {"$round": [{"$avg": "$duracoes_7d"}, 0]},
                    None,
                ]},
            },
        },
    ]
    result = await (await db.sessoes_presenca.aggregate(pipeline)).to_list(length=1)
    base = result[0] if result else {"alunos_hoje": 0, "sessoes_hoje": 0, "sessoes_7d": 0, "total_sessoes": 0, "tempo_medio_segundos": None}
    base["tempo_medio"] = format_duration(base["tempo_medio_segundos"])
    return base


# ─── A) Movimentação diária (dias do mês) ────────────────────────────────────
@router.get("/diario")
async def analytics_daily(turma_id: str | None = None, subgrupo_id: str | None = None, dias: int = Query(default=30, ge=7, le=MAX_DAYS), user: User = Depends(get_current_user)):
    """Séries diária: alunos únicos e sessões por dia (gráfico de barras/linha)."""
    _require_teacher(user)
    turma_ids = await _owned_turma_ids(user, turma_id)
    match: dict[str, Any] = {"turma_id": {"$in": turma_ids}, "entrada": _range(dias)}
    if subgrupo_id:
        match["subgrupo_id"] = subgrupo_id

    pipeline = [
        {"$match": match},
        {"$addFields": {"_day": {"$dateTrunc": {"date": "$entrada", "unit": "day"}}}},
        {
            "$group": {
                "_id": "$_day",
                "alunos": {"$addToSet": "$aluno_id"},
                "sessoes": {"$sum": 1},
            },
        },
        {"$project": {"_id": 0, "data": {"$dateToString": {"format": "%Y-%m-%d", "date": "$_id"}}, "alunos": {"$size": "$alunos"}, "sessoes": 1}},
        {"$sort": {"data": 1}},
    ]
    by_day = {item["data"]: item for item in await (await db.sessoes_presenca.aggregate(pipeline)).to_list(length=MAX_DAYS)}

    # Preenche os dias vazios (gráfico contínuo, sem buracos).
    series = []
    today = now_utc().date()
    for offset in range(dias - 1, -1, -1):
        day = (today - timedelta(days=offset)).isoformat()
        entry = by_day.get(day)
        series.append({"data": day, "alunos": entry["alunos"] if entry else 0, "sessoes": entry["sessoes"] if entry else 0})
    return {"dias": dias, "series": series}


# ─── A) Horários de pico (agregação por hora do dia) ─────────────────────────
@router.get("/horarios-pico")
async def analytics_peak_hours(turma_id: str | None = None, subgrupo_id: str | None = None, dias: int = Query(default=30, ge=7, le=MAX_DAYS), user: User = Depends(get_current_user)):
    """Heatmap/bar de movimentação: entradas e saídas agregadas por hora (0–23)."""
    _require_teacher(user)
    turma_ids = await _owned_turma_ids(user, turma_id)
    match: dict[str, Any] = {"turma_id": {"$in": turma_ids}, "entrada": _range(dias)}
    if subgrupo_id:
        match["subgrupo_id"] = subgrupo_id

    # Entradas por hora do dia.
    entradas_pipeline = [
        {"$match": match},
        {"$group": {"_id": {"$hour": "$entrada"}, "total": {"$sum": 1}}},
    ]
    entradas = {item["_id"]: item["total"] for item in await (await db.sessoes_presenca.aggregate(entradas_pipeline)).to_list(length=24)}

    # Saídas por hora (mesma janela, campo saida preenchido).
    saidas_pipeline = [
        {"$match": {**match, "saida": {"$ne": None}}},
        {"$group": {"_id": {"$hour": "$saida"}, "total": {"$sum": 1}}},
    ]
    saidas = {item["_id"]: item["total"] for item in await (await db.sessoes_presenca.aggregate(saidas_pipeline)).to_list(length=24)}

    horas = [
        {"hora": h, "label": f"{h:02d}h", "entradas": entradas.get(h, 0), "saidas": saidas.get(h, 0)}
        for h in range(24)
    ]
    pico = max(horas, key=lambda item: item["entradas"], default=None)
    return {"dias": dias, "horas": horas, "pico": pico}


# ─── B) Visão individual (por aluno) ─────────────────────────────────────────
@router.get("/aluno/{aluno_id}/detalhado")
async def analytics_student_detail(aluno_id: str, mes: str | None = None, user: User = Depends(get_current_user)):
    """Tabela detalhada do aluno: cada sessão do mês (entrada/saída/duração).

    `mes` no formato YYYY-MM; padrão = mês atual.
    """
    _require_teacher(user)
    student = await db.alunos.find_one({"id": aluno_id}, {"_id": 0, "id": 1, "nome": 1, "turma_id": 1})
    if not student:
        raise HTTPException(status_code=404, detail="Aluno não encontrado")
    turma = await db.turmas.find_one({"id": student.get("turma_id"), "professor_id": user.id}, {"_id": 0, "id": 1})
    if not turma:
        raise HTTPException(status_code=403, detail="O aluno não pertence às suas turmas")

    if mes:
        try:
            year, month = (int(part) for part in mes.split("-"))
            start = date(year, month, 1)
        except (ValueError, TypeError) as exc:
            raise HTTPException(status_code=422, detail="Formato de mês inválido (use YYYY-MM)") from exc
    else:
        today = now_utc().date()
        start = date(today.year, today.month, 1)
    end = date(start.year + (start.month == 12), (start.month % 12) + 1, 1)

    match = {"aluno_id": aluno_id, "entrada": {"$gte": _naive_utc(start), "$lt": _naive_utc(end)}}
    pipeline = [
        {"$match": match},
        {"$sort": {"entrada": 1}},
        {"$project": {"_id": 0, "subgrupo_id": 1, "entrada": 1, "saida": 1, "tempo_permanencia_segundos": 1, "auto_encerrada": 1}},
    ]
    # Nome do subgrupo em um segundo lookup para a tabela.
    pipeline.append({
        "$lookup": {
            "from": "subgrupos",
            "localField": "subgrupo_id",
            "foreignField": "id",
            "as": "subgrupo",
            "pipeline": [{"$project": {"_id": 0, "nome": 1}}],
        },
    })
    pipeline.append({"$set": {"subgrupo_nome": {"$first": "$subgrupo.nome"}}})
    pipeline.append({"$unset": ["subgrupo"]})

    sessoes = await (await db.sessoes_presenca.aggregate(pipeline)).to_list(length=400)
    total_dias = len({item["entrada"].date().isoformat() for item in sessoes})
    return {
        "aluno": {"id": student["id"], "nome": student.get("nome") or "Aluno"},
        "mes": start.isoformat()[:7],
        "total_sessoes": len(sessoes),
        "total_dias": total_dias,
        "sessoes": sessoes,
    }


def _naive_utc(day: date):
    """Meia-noite UTC de `day`, no mesmo tzinfo usado por now_utc()."""
    return datetime.combine(day, time.min, tzinfo=now_utc().tzinfo)


@router.get("/aluno/{aluno_id}/resumo")
async def analytics_student_summary(aluno_id: str, user: User = Depends(get_current_user)):
    """Frequência mensal: dias participados no mês atual vs. mês anterior."""
    _require_teacher(user)
    student = await db.alunos.find_one({"id": aluno_id}, {"_id": 0, "id": 1, "nome": 1, "turma_id": 1})
    if not student:
        raise HTTPException(status_code=404, detail="Aluno não encontrado")
    turma = await db.turmas.find_one({"id": student.get("turma_id"), "professor_id": user.id}, {"_id": 0, "id": 1})
    if not turma:
        raise HTTPException(status_code=403, detail="O aluno não pertence às suas turmas")

    today = now_utc().date()
    start_this = date(today.year, today.month, 1)
    start_prev = date(start_this.year - (start_this.month == 1), (start_this.month - 1) or 12, 1)

    pipeline = [
        {"$match": {"aluno_id": aluno_id, "entrada": {"$gte": _naive_utc(start_prev)}}},
        {"$addFields": {"_day": {"$dateTrunc": {"date": "$entrada", "unit": "day"}}}},
        {"$group": {"_id": "$_day", "in_month": {"$first": {"$month": "$_day"}}}},
        {"$group": {"_id": "$in_month", "dias": {"$sum": 1}}},
    ]
    counts = {item["_id"]: item["dias"] for item in await (await db.sessoes_presenca.aggregate(pipeline)).to_list(length=12)}
    mes_atual = counts.get(start_this.month, 0)
    mes_anterior = counts.get(start_prev.month, 0)
    # Dias corridos no mês atual até hoje (denominador da frequência).
    dias_corridos = (today - start_this).days + 1
    frequencia = round(100 * mes_atual / dias_corridos) if dias_corridos else 0
    return {
        "aluno": {"id": student["id"], "nome": student.get("nome") or "Aluno"},
        "mes_atual": {"mes": start_this.isoformat()[:7], "dias_participados": mes_atual, "dias_corridos": dias_corridos, "frequencia_pct": frequencia},
        "mes_anterior": {"mes": start_prev.isoformat()[:7], "dias_participados": mes_anterior},
    }
