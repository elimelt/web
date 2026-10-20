# syntax=docker/dockerfile:1.7
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends wget ca-certificates && \
    apt-get install -y --only-upgrade ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

ARG INSTALL_EMBEDDINGS=0

COPY requirements.txt requirements.embeddings.txt ./
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt && \
    if [ "${INSTALL_EMBEDDINGS}" = "1" ]; then pip install -r requirements.embeddings.txt; fi

RUN wget -O GeoLite2-City.mmdb "https://github.com/P3TERX/GeoLite.mmdb/raw/download/GeoLite2-City.mmdb" || \
    echo "GeoIP database not available, will use fallback"

COPY main.py .
# Copy the whole package so new top-level modules are never left out of the image.
# Excludes (tests, caches, requirements, Dockerfiles) live in .dockerignore.
COPY . /app/api/

USER 10001:10001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "80", "--no-proxy-headers", "--ws-max-size", "131072", "--ws-max-queue", "8", "--no-access-log", "--log-level", "info"]
