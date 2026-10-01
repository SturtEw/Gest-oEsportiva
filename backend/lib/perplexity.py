"""Perplexity Sonar — modo "pesquisa na web" do Assistente IA.

Requer PERPLEXITY_API_KEY própria do usuário (https://console.perplexity.ai/ →
API keys → Generate) no backend/.env — a chave universal Emergent NÃO cobre

este provider. Endpoint centralizado aqui para migrar ao Agent API (/v1/agent)

quando o Sonar sair de linha (suporte anunciado até 27/09/2026).

"""

import json
import logging
import os
from collections.abc import AsyncIterator


import httpx


logger = logging.getLogger(__name__)


URL = "https://api.perplexity.ai/v1/sonar"


MODEL = "sonar"  # sonar (rápido) | sonar-pro (múltiplas fontes)



class PerplexityError(Exception):
    pass



def api_key() -> str | None:
    return os.environ.get("PERPLEXITY_API_KEY") or None



def _body(question: str, stream: bool = False) -> dict:
    return {

        "model": MODEL,

        "messages": [

            {

                "role": "system",

                "content": (

                    "Você é o Assistente IA do treinador de uma escola esportiva. "

                    "Responda em PT-BR, seja objetivo, diferencie fatos de recomendações "

                    "e preserve as referências [1], [2] retornadas pela pesquisa."

                ),

            },

            {"role": "user", "content": question},

        ],

        "temperature": 0.2,

        "max_tokens": 900,

        "stream": stream,

    }



async def stream(question: str) -> AsyncIterator[dict]:
    """SSE da Perplexity → eventos {type: delta|citations|done}."""
    key = api_key()
    if not key:
        raise PerplexityError("PERPLEXITY_API_KEY não configurada no backend/.env")

    headers = {"Authorization": f"Bearer {key}"}

    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream("POST", URL, headers=headers, json=_body(question, True)) as r:
            if r.status_code >= 400:
                raise PerplexityError(f"Perplexity HTTP {r.status_code}")

            async for line in r.aiter_lines():
                if not line.startswith("data:"):
                    continue

                raw = line[5:].strip()

                if raw == "[DONE]":
                    yield {"type": "done"}

                    return

                try:
                    chunk = json.loads(raw)

                except json.JSONDecodeError:
                    continue

                delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")

                if delta:
                    yield {"type": "delta", "text": delta}

                if chunk.get("citations"):
                    yield {"type": "citations", "citations": chunk["citations"]}
