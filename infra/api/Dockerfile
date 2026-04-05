FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y wget docker.io curl && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    npm install -g @augmentcode/auggie

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN wget -O GeoLite2-City.mmdb "https://github.com/P3TERX/GeoLite.mmdb/raw/download/GeoLite2-City.mmdb" || \
    echo "GeoIP database not available, will use fallback"

COPY main.py .
RUN mkdir -p /app/api
COPY __init__.py bus.py events.py state.py middleware.py redis_debug.py redis_pubsub.py notes_sync.py notes_embeddings.py config.py dependencies.py errors.py lifespan.py /app/api/
COPY controllers /app/api/controllers
COPY producers /app/api/producers
COPY agents /app/api/agents
COPY batch /app/api/batch
COPY db /app/api/db
COPY models /app/api/models

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "80", "--no-access-log", "--log-level", "info"]

