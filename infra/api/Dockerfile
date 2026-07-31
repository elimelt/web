# syntax=docker/dockerfile:1.7
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends wget curl ca-certificates gnupg && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc && \
    chmod a+r /etc/apt/keyrings/docker.asc && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends docker-ce-cli && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

ARG INSTALL_EMBEDDINGS=0

COPY requirements.txt requirements.embeddings.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt && \
    if [ "${INSTALL_EMBEDDINGS}" = "1" ]; then pip install -r requirements.embeddings.txt; fi

RUN wget -O GeoLite2-City.mmdb "https://github.com/P3TERX/GeoLite.mmdb/raw/download/GeoLite2-City.mmdb" || \
    echo "GeoIP database not available, will use fallback"

COPY main.py .
RUN mkdir -p /app/api
COPY __init__.py bus.py events.py state.py middleware.py redis_debug.py redis_pubsub.py notes_sync.py notes_embeddings.py config.py dependencies.py errors.py lifespan.py codex_runner.py /app/api/
COPY controllers /app/api/controllers
COPY producers /app/api/producers
COPY agents /app/api/agents
COPY batch /app/api/batch
COPY db /app/api/db
COPY models /app/api/models

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "80", "--no-access-log", "--log-level", "info"]
