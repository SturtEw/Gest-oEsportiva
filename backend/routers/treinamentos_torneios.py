"""Torneios e chaves (brackets) de competições."""


import uuid
from datetime import datetime, timezone
from typing import Any


from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator


from lib.dates import app_tz, now_utc, to_iso
from lib.db import db
from lib.portal_access import get_authorized_aluno, require_assigned_professor
from lib.realtime import publish_event
from lib.impersonation import get_current_user_with_impersonation
from lib.security import get_current_user
from models.models import User


router = APIRouter(prefix="/api/treinamentos", tags=["treinamentos-torneios"])


# ─── Pydantic models ──────────────────────────────────────────────────────────

class TrainingTeamBase(BaseModel):
    nome: str = Field(min_length=2, max_length=80)

    sigla: str = Field(min_length=2, max_length=10)

    cor: str | None = Field(default=None, pattern=r'^#[0-9A-Fa-f]{6}$')

    logo_url: str | None = None



class TrainingTeamCreate(TrainingTeamBase):
    # Kept when present: matches reference teams by id, so regenerating the ids on
    # every PATCH left each match pointing at teams that no longer existed.
    id: str | None = Field(default=None, max_length=64)



class TrainingTeamResponse(TrainingTeamBase):
    id: str



class TrainingMatchBase(BaseModel):
    fase: str

    rodada: int = Field(ge=1)

    posicao: int = Field(ge=1)

    equipe_a_id: str | None = None

    equipe_b_id: str | None = None

    placar_a: int | None = None

    placar_b: int | None = None

    status: str = 'agendado'

    data_hora: str | None = None

    local: str | None = None


    @field_validator('data_hora')

    @classmethod

    def normalize_data_hora(cls, value: str | None) -> str | None:
        """Store the match kick-off as an unambiguous aware-UTC ISO string.

        A naive string is read as school wall-clock time (APP_TZ), not as UTC — the
        browser used to reinterpret it in its own zone, shifting kick-off by hours.

        """
        if value is None or not value.strip():
            return None

        try:
            parsed = datetime.fromisoformat(value.strip().replace('Z', '+00:00'))

        except ValueError as exc:
            raise ValueError('Use uma data/hora válida (AAAA-MM-DDTHH:MM)') from exc

        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=app_tz())

        return parsed.astimezone(timezone.utc).isoformat()



class TrainingMatchCreate(TrainingMatchBase):
    id: str | None = Field(default=None, max_length=64)



class TrainingMatchResponse(TrainingMatchBase):
    id: str



class TrainingBracketBase(BaseModel):
    categoria: str

    fase: str

    nome: str

    partidas: list[TrainingMatchCreate] = []

    equipes: list[TrainingTeamCreate] = []



class TrainingBracketCreate(TrainingBracketBase):
    pass



class TrainingBracketResponse(BaseModel):
    # Its own lists of *response* models (with id). Inheriting the Create lists made
    # pydantic reject the response objects: creating or editing any tournament that
    # had teams or matches failed with a 500.
    categoria: str

    fase: str

    nome: str

    partidas: list[TrainingMatchResponse] = []

    equipes: list[TrainingTeamResponse] = []



class TrainingTournamentBase(BaseModel):
    nome: str = Field(min_length=3, max_length=120)

    ano: int = Field(ge=2020, le=2100)

    modalidade: str = Field(min_length=2, max_length=40)

    categorias: list[TrainingBracketCreate] = []



class TrainingTournamentCreate(TrainingTournamentBase):
    pass



class TrainingTournamentResponse(BaseModel):
    id: str

    nome: str = Field(min_length=3, max_length=120)

    ano: int = Field(ge=2020, le=2100)

    modalidade: str = Field(min_length=2, max_length=40)

    categorias: list[TrainingBracketResponse] = []

    atualizado_em: str


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _verify_admin_or_professor(user: User) -> None:
    if user.tipo not in ("admin", "professor"):
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores e professores")



def _teams(items: list[TrainingTeamCreate]) -> list[TrainingTeamResponse]:
    return [TrainingTeamResponse(id=item.id or str(uuid.uuid4()), **item.model_dump(exclude={"id"})) for item in items]


def _matches(items: list[TrainingMatchCreate]) -> list[TrainingMatchResponse]:
    return [TrainingMatchResponse(id=item.id or str(uuid.uuid4()), **item.model_dump(exclude={"id"})) for item in items]


def _bracket(cat: TrainingBracketCreate, categoria: str | None = None, fase: str | None = None) -> TrainingBracketResponse:
    return TrainingBracketResponse(
        categoria=categoria or cat.categoria,
        fase=fase or cat.fase,
        nome=cat.nome,
        partidas=_matches(cat.partidas),
        equipes=_teams(cat.equipes),
    )


def _phase_order_key(fase: str) -> int:
    order = {'classificatoria': 0, 'oitavas': 1, 'quartas': 2, 'semifinal': 3, 'final': 4}

    return order.get(fase, 99)


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.get("/torneios", response_model=list[TrainingTournamentResponse])

async def listar_torneios(user: User = Depends(get_current_user_with_impersonation)):
    """Lista todos os torneios (público para alunos, admin/professor veem todos)."""
    cursor = db.torneios.find({}, {"_id": 0}).sort([("ano", -1), ("nome", 1)])
    torneios = await cursor.to_list(length=100)

    return [TrainingTournamentResponse(**t) for t in torneios]



@router.post("/torneios", response_model=TrainingTournamentResponse, status_code=201)

async def criar_torneio(payload: TrainingTournamentCreate, user: User = Depends(get_current_user)):
    """Cria um novo torneio (apenas admin/professor)."""
    await _verify_admin_or_professor(user)

    torneio_id = str(uuid.uuid4())

    now = now_utc()

    categorias = [_bracket(cat) for cat in payload.categorias]

    torneio = TrainingTournamentResponse(

        id=torneio_id,

        nome=payload.nome,

        ano=payload.ano,

        modalidade=payload.modalidade,

        categorias=categorias,

        atualizado_em=now.isoformat(),

    )

    await db.torneios.insert_one(torneio.model_dump())

    return torneio



@router.get("/torneios/{torneio_id}", response_model=TrainingTournamentResponse)

async def obter_torneio(torneio_id: str, user: User = Depends(get_current_user_with_impersonation)):
    """Obtém detalhes de um torneio específico."""
    torneio = await db.torneios.find_one({"id": torneio_id}, {"_id": 0})
    if not torneio:
        raise HTTPException(status_code=404, detail="Torneio não encontrado")

    return TrainingTournamentResponse(**torneio)



@router.patch("/torneios/{torneio_id}", response_model=TrainingTournamentResponse)

async def atualizar_torneio(torneio_id: str, payload: TrainingTournamentCreate, user: User = Depends(get_current_user)):
    """Atualiza um torneio (apenas admin/professor)."""
    await _verify_admin_or_professor(user)

    existente = await db.torneios.find_one({"id": torneio_id}, {"_id": 0})

    if not existente:
        raise HTTPException(status_code=404, detail="Torneio não encontrado")

    now = now_utc()

    categorias = [_bracket(cat) for cat in payload.categorias]

    atualizado = TrainingTournamentResponse(

        id=torneio_id,

        nome=payload.nome,

        ano=payload.ano,

        modalidade=payload.modalidade,

        categorias=categorias,

        atualizado_em=now.isoformat(),

    )

    await db.torneios.replace_one({"id": torneio_id}, atualizado.model_dump())

    return atualizado



@router.delete("/torneios/{torneio_id}", status_code=204)

async def excluir_torneio(torneio_id: str, user: User = Depends(get_current_user)):
    """Exclui um torneio (apenas admin)."""
    if user.tipo != "admin":
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores")

    result = await db.torneios.delete_one({"id": torneio_id})

    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Torneio não encontrado")


# ─── Bracket management ───────────────────────────────────────────────────────

@router.post("/torneios/{torneio_id}/categorias", response_model=TrainingBracketResponse, status_code=201)

async def adicionar_categoria(torneio_id: str, payload: TrainingBracketCreate, user: User = Depends(get_current_user)):
    """Adiciona uma categoria/bracket a um torneio."""
    await _verify_admin_or_professor(user)

    torneio = await db.torneios.find_one({"id": torneio_id}, {"_id": 0})

    if not torneio:
        raise HTTPException(status_code=404, detail="Torneio não encontrado")

    nova_categoria = _bracket(payload)

    await db.torneios.update_one(

        {"id": torneio_id},

        {"$push": {"categorias": nova_categoria.model_dump()}, "$set": {"atualizado_em": to_iso(now_utc())}},

    )

    return nova_categoria



@router.patch("/torneios/{torneio_id}/categorias/{categoria}/{fase}", response_model=TrainingBracketResponse)

async def atualizar_bracket(torneio_id: str, categoria: str, fase: str, payload: TrainingBracketCreate, user: User = Depends(get_current_user)):
    """Atualiza um bracket específico (partidas e equipes)."""
    await _verify_admin_or_professor(user)

    torneio = await db.torneios.find_one({"id": torneio_id}, {"_id": 0})

    if not torneio:
        raise HTTPException(status_code=404, detail="Torneio não encontrado")

    cat_index = next((i for i, c in enumerate(torneio["categorias"]) if c["categoria"] == categoria and c["fase"] == fase), None)

    if cat_index is None:
        raise HTTPException(status_code=404, detail="Categoria/fase não encontrada")

    updated = _bracket(payload, categoria=categoria, fase=fase)

    await db.torneios.update_one(

        {"id": torneio_id},

        {"$set": {f"categorias.{cat_index}": updated.model_dump(), "atualizado_em": to_iso(now_utc())}},

    )

    return updated



@router.post("/torneios/{torneio_id}/categorias/{categoria}/{fase}/partidas", response_model=TrainingMatchResponse, status_code=201)

async def adicionar_partida(torneio_id: str, categoria: str, fase: str, payload: TrainingMatchCreate, user: User = Depends(get_current_user)):
    """Adiciona uma partida a um bracket."""
    await _verify_admin_or_professor(user)

    torneio = await db.torneios.find_one({"id": torneio_id}, {"_id": 0})

    if not torneio:
        raise HTTPException(status_code=404, detail="Torneio não encontrado")

    cat_index = next((i for i, c in enumerate(torneio["categorias"]) if c["categoria"] == categoria and c["fase"] == fase), None)

    if cat_index is None:
        raise HTTPException(status_code=404, detail="Categoria/fase não encontrada")

    partida = _matches([payload])[0]

    await db.torneios.update_one(

        {"id": torneio_id},

        {"$push": {f"categorias.{cat_index}.partidas": partida.model_dump()}, "$set": {"atualizado_em": to_iso(now_utc())}},

    )

    return partida



@router.patch("/torneios/{torneio_id}/categorias/{categoria}/{fase}/partidas/{partida_id}", response_model=TrainingMatchResponse)

async def atualizar_partida(torneio_id: str, categoria: str, fase: str, partida_id: str, payload: TrainingMatchBase, user: User = Depends(get_current_user)):
    """Atualiza uma partida (placar, status, etc.)."""
    await _verify_admin_or_professor(user)

    torneio = await db.torneios.find_one({"id": torneio_id}, {"_id": 0})

    if not torneio:
        raise HTTPException(status_code=404, detail="Torneio não encontrado")

    cat_index = next((i for i, c in enumerate(torneio["categorias"]) if c["categoria"] == categoria and c["fase"] == fase), None)

    if cat_index is None:
        raise HTTPException(status_code=404, detail="Categoria/fase não encontrada")

    part_index = next((i for i, p in enumerate(torneio["categorias"][cat_index]["partidas"]) if p["id"] == partida_id), None)

    if part_index is None:
        raise HTTPException(status_code=404, detail="Partida não encontrada")

    updated = TrainingMatchResponse(id=partida_id, **payload.model_dump())

    await db.torneios.update_one(

        {"id": torneio_id},

        {"$set": {f"categorias.{cat_index}.partidas.{part_index}": updated.model_dump(), "atualizado_em": to_iso(now_utc())}},

    )

    return updated



@router.post("/torneios/{torneio_id}/categorias/{categoria}/{fase}/equipes", response_model=TrainingTeamResponse, status_code=201)

async def adicionar_equipe(torneio_id: str, categoria: str, fase: str, payload: TrainingTeamCreate, user: User = Depends(get_current_user)):
    """Adiciona uma equipe a um bracket."""
    await _verify_admin_or_professor(user)

    torneio = await db.torneios.find_one({"id": torneio_id}, {"_id": 0})

    if not torneio:
        raise HTTPException(status_code=404, detail="Torneio não encontrado")

    cat_index = next((i for i, c in enumerate(torneio["categorias"]) if c["categoria"] == categoria and c["fase"] == fase), None)

    if cat_index is None:
        raise HTTPException(status_code=404, detail="Categoria/fase não encontrada")

    equipe = _teams([payload])[0]

    await db.torneios.update_one(

        {"id": torneio_id},

        {"$push": {f"categorias.{cat_index}.equipes": equipe.model_dump()}, "$set": {"atualizado_em": to_iso(now_utc())}},

    )

    return equipe
