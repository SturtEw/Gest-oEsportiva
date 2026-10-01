# Backend (FastAPI) em container.
FROM python:3.12-slim

WORKDIR /app

# psycopg/pymongo nao precisam de toolchain pesada, mas o build do bcrypt/cryptography
# pode precisar. Mantemos gcc/headers numa camada descartavel.
#
# tzdata e obrigatorio: a imagem python:3.12-slim nao traz o banco de fusos do
# sistema, e sem o pacote o zoneinfo.ZoneInfo("America/Sao_Paulo") levanta
# ZoneInfoNotFoundError. lib/dates.py degrada para UTC nesse caso, o que faria
# "hoje" virar o dia seguinte apos as 21:00 sem nenhum erro visivel.
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc python3-dev tzdata \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Defesa em profundidade: mesmo se alguem remover o .dockerignore ou adicionar
# um arquivo .env novo com outro nome, ele nao vai para a imagem. Segredos
# chegam exclusivamente pelas variaveis de ambiente do Render. O `|| true`
# mantem o build valido quando nao ha nada para apagar.
RUN rm -f .env .env.* credentials.json service-account*.json *.log *.err \
    && find . -name '__pycache__' -type d -prune -exec rm -rf {} + || true

EXPOSE 8000

# O Render (e a maioria dos PaaS) injeta a porta em $PORT e exige que o processo
# escute nela; o 8000 fixo que funcionava no compose local faria o deploy subir e
# morrer no healthcheck.
#
# Forma JSON com 'sh -c' (em vez da forma shell crua): expande ${PORT} e ao mesmo
# tempo mantem o PID 1 correto, para que SIGTERM chegue ao uvicorn e o Render
# consiga desligar o container graciosamente em vez de mata-lo apos o timeout.
CMD ["sh", "-c", "exec python -m uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000}"]
