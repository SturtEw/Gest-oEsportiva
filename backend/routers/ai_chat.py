"""Canal de dúvidas com IA — chat privado 1-para-1 (aluno ou professor).

Histórico isolado por usuário na coleção `mensagens_ia`: toda leitura e escrita
filtra por `user_id` (o id do usuário autenticado, nunca um id vindo do corpo),
então ninguém acessa a conversa de outra pessoa.

Provedor: Google Gemini (GEMINI_API_KEY no ambiente do Render). Se a chave não
estiver configurada, o serviço degrada para um modo local que ainda responde o
essencial sobre a plataforma — o chat nunca quebra por falta de credencial.

  GET    /api/ia/historico        últimas mensagens do próprio usuário
  POST   /api/ia/chat             envia uma mensagem e recebe a resposta da IA
  DELETE /api/ia/historico        limpa a própria conversa
"""

import logging
import os
import uuid
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from lib.dates import now_utc
from lib.db import db
from lib.security import get_current_user
from models.models import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ia", tags=["ai assistant"])

HISTORY_LIMIT = 100
MAX_MESSAGE_CHARS = 2000
# Quantas mensagens anteriores enviamos como contexto ao modelo (janela curta:
# mantém o custo/latência baixos e evita estourar o limite de tokens).
CONTEXT_TURNS = 12

# Modelos tentados em ordem (lista real desta conta, verificada via /models).
# Se um estiver sobrecarregado (503) ou indisponível (404), o próximo assume —
# o aluno não percebe a troca. `gemini-flash-latest` primeiro porque é o alias
# estável que acompanha a geração atual sem quebra de nome.
# Configurável por env: GEMINI_MODEL define o PRIMEIRO da lista.
DEFAULT_MODELS = (
    "gemini-flash-latest",
    "gemini-3.8-flash",
    "gemini-flash-lite-latest",
)


def _gemini_models() -> tuple[str, ...]:
    """Lista de modelos: o configurado por env primeiro, sem repetir os padrões."""
    preferido = (os.getenv("GEMINI_MODEL") or "").strip()
    if preferido:
        return (preferido, *(m for m in DEFAULT_MODELS if m != preferido))
    return DEFAULT_MODELS


def _gemini_model() -> str:
    """Modelo primário (usado no diagnóstico)."""
    return _gemini_models()[0]


def _gemini_url(modelo: str) -> str:
    return f"https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent"

SYSTEM_PROMPT = (
    "Você é o assistente virtual do sistema de gestão esportiva. "
    "Responda apenas dúvidas sobre treinos, informações acadêmicas e como usar a plataforma. "
    "Não responda sobre política ou assuntos fora do esporte. "
    "Seja sempre educado e encorajador."
)

# Assuntos fora do escopo: o prompt acima orienta o modelo, mas um pedido pode
# tentar contorná-lo. Este filtro é a segunda camada — barra temas claramente
# fora do escopo (política, religião, violência, conteúdo adulto) antes de
# chamar o provedor, gastando menos tokens e evitando desvios previsíveis.
FORA_DE_ESCOPO = (
    "política", "politica", "eleição", "eleicao", "candidato", "presidente",
    "governo", "partido", "voto", "religião", "religiao", "igreja", "deus",
    "arma", "arma de fogo", "violência", "violencia", "pornografia", "sexo",
    "aposta", "apostas", "bet",
)

RESPOSTA_FORA_DE_ESCOPO = (
    "Sou o assistente do sistema de gestão esportiva e só consigo ajudar com "
    "treinos, informações acadêmicas e o uso da plataforma. "
    "Posso te ajudar com algo relacionado aos seus treinos ou à sua turma? 💪"
)


def _fora_de_escopo(texto: str) -> bool:
    alvo = texto.lower()
    return any(termo in alvo for termo in FORA_DE_ESCOPO)


class ChatInput(BaseModel):
    mensagem: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)


def _api_key() -> str | None:
    """Lida em tempo de execução: o dotenv carrega no startup do server."""
    value = (os.getenv("GEMINI_API_KEY") or "").strip()
    return value or None


def _wire(document: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": document["id"],
        "papel": document["papel"],  # 'user' | 'assistant'
        "texto": document["texto"],
        "criado_em": document["criado_em"],
        "fonte": document.get("fonte", "gemini"),  # 'gemini' | 'local'
    }


async def _history(user: User) -> list[dict[str, Any]]:
    cursor = (
        db.mensagens_ia.find({"user_id": user.id}, {"_id": 0})
        .sort("criado_em", 1)
        .limit(HISTORY_LIMIT)
    )
    return [_wire(item) async for item in cursor]


async def _ask_gemini(history: list[dict[str, Any]], pergunta: str) -> str:
    """Chama o Gemini com o histórico recente como contexto."""
    key = _api_key()
    if not key:
        raise LookupError("GEMINI_API_KEY ausente")

    # O Gemini usa 'user'/'model' e exige que a conversa comece com 'user'.
    contents = [
        {
            "role": "model" if item["papel"] == "assistant" else "user",
            "parts": [{"text": item["texto"]}],
        }
        for item in history[-CONTEXT_TURNS:]
    ]
    if not contents or contents[0]["role"] != "user":
        contents.insert(0, {"role": "user", "parts": [{"text": "Olá! Vou tirar algumas dúvidas."}]})
    contents.append({"role": "user", "parts": [{"text": pergunta}]})

    payload = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": contents,
        "generationConfig": {"temperature": 0.6, "maxOutputTokens": 800},
    }

    async with httpx.AsyncClient(timeout=30) as client:
        resp = None
        ultimo_erro = ""
        for modelo in _gemini_models():
            resp = await client.post(
                _gemini_url(modelo),
                headers={"x-goog-api-key": key},
                json=payload,
            )
            if resp.status_code < 400:
                break
            ultimo_erro = resp.text[:300]
            logger.warning(
                '{"event": "ia_gemini_retry", "status": %d, "model": "%s"}',
                resp.status_code, modelo,
            )
            # 404 (modelo descontinuado) e 503 (sobrecarga) valem tentar o próximo;
            # 401/403 (chave inválida) não — falha na hora, sem gastar chamadas.
            if resp.status_code in (401, 403):
                break

    if resp is None or resp.status_code >= 400:
        status = resp.status_code if resp is not None else 0
        logger.error('{"event": "ia_gemini_failed", "status": %d, "body": "%s"}', status, ultimo_erro)
        raise RuntimeError(f"Gemini respondeu HTTP {status}: {ultimo_erro[:120]}")

    data = resp.json()
    candidates = data.get("candidates") or []
    parts = (candidates[0].get("content", {}).get("parts") if candidates else None) or []
    text = "".join(part.get("text", "") for part in parts).strip()
    if not text:
        raise RuntimeError("Gemini retornou uma resposta vazia")
    return text


def _local_answer(pergunta: str) -> str:
    """Resposta de contingência quando não há chave/provedor disponível."""
    topicos = {
        "presen": "Para registrar presença, abra a aba **Aulas e presença**, encontre o subgrupo da aula e toque em *Entrar na Aula*. O tempo de permanência é contado pelo servidor; ao sair, toque em *Sair da Aula*.",
        "treino": "Seus treinos individuais ficam em **Meu treino**, onde você vê os exercícios (séries, repetições, carga e descanso) e marca cada sessão como concluída.",
        "fórum": "O fórum fica no botão flutuante de chat, no canto da tela. Nele você conversa com a sua turma em tempo real.",
        "turma": "Você pode participar de mais de uma turma. Abra **Minhas turmas** para pedir entrada em outra ou sair de uma turma.",
        "nota": "Suas avaliações aparecem na aba **Avaliações**, e as presenças em **Presenças**.",
    }
    alvo = pergunta.lower()
    for chave, resposta in topicos.items():
        if chave in alvo:
            return resposta
    return (
        "Ainda estou sem conexão com o serviço de IA (a chave do provedor não está "
        "configurada no servidor). Posso adiantar que, pela plataforma, você encontra: "
        "presenças em *Aulas e presença*, treinos em *Meu treino*, avaliações em "
        "*Avaliações* e o chat da turma no botão flutuante. Tente novamente em instantes "
        "para uma resposta completa."
    )


@router.get("/historico")
async def history(revision: int = Query(default=0, ge=0), user: User = Depends(get_current_user)) -> dict[str, Any]:
    """Histórico do PRÓPRIO usuário (filtro por user_id)."""
    return {"mensagens": await _history(user), "ia_disponivel": _api_key() is not None}


@router.get("/diagnostico")
async def diagnostics(user: User = Depends(get_current_user)) -> dict[str, Any]:
    """Diz, sem expor a chave, se o provedor está configurado e respondendo.

    Faz uma chamada real e curta ao modelo: um erro de configuração passa a
    aparecer aqui em vez de só se manifestar na pergunta do aluno.
    """
    key = _api_key()
    if not key:
        return {"configurado": False, "modelo": _gemini_model(), "erro": "GEMINI_API_KEY ausente no ambiente"}
    try:
        await _ask_gemini([], "Responda apenas: OK")
        return {"configurado": True, "modelo": _gemini_model(), "chave_valida": True, "erro": None}
    except Exception as exc:
        return {"configurado": True, "modelo": _gemini_model(), "chave_valida": False, "erro": str(exc)[:300]}


@router.post("/chat", status_code=201)
async def chat(payload: ChatInput, user: User = Depends(get_current_user)) -> dict[str, Any]:
    texto = payload.mensagem.strip()
    if not texto:
        raise HTTPException(status_code=422, detail="Escreva sua dúvida para o assistente.")

    historico = await _history(user)
    agora = now_utc()

    pergunta_doc = {
        "id": str(uuid.uuid4()),
        "user_id": user.id,
        "papel": "user",
        "texto": texto,
        "criado_em": agora,
        "fonte": "user",
    }
    await db.mensagens_ia.insert_one(dict(pergunta_doc))

    fonte = "gemini"
    try:
        if _fora_de_escopo(texto):
            # Barreira 2 (o prompt é a barreira 1): nem chama o provedor.
            fonte = "escopo"
            resposta = RESPOSTA_FORA_DE_ESCOPO
        else:
            resposta = await _ask_gemini(historico, texto)
    except LookupError:
        # Sem chave: contingência local (o chat continua utilizável).
        fonte = "local"
        resposta = _local_answer(texto)
    except Exception as exc:
        logger.warning('{"event": "ia_fallback", "error": "%s"}', str(exc)[:200])
        fonte = "local"
        resposta = _local_answer(texto)

    resposta_doc = {
        "id": str(uuid.uuid4()),
        "user_id": user.id,
        "papel": "assistant",
        "texto": resposta,
        "criado_em": now_utc(),
        "fonte": fonte,
    }
    await db.mensagens_ia.insert_one(dict(resposta_doc))

    return {
        "pergunta": _wire(pergunta_doc),
        "resposta": _wire(resposta_doc),
        # "escopo" é uma recusa intencional (não indica provedor indisponível).
        "ia_disponivel": fonte in ("gemini", "escopo"),
    }


@router.delete("/historico", status_code=200)
async def clear_history(user: User = Depends(get_current_user)) -> dict[str, Any]:
    """Limpa a conversa do PRÓPRIO usuário."""
    result = await db.mensagens_ia.delete_many({"user_id": user.id})
    return {"removidas": result.deleted_count}
