import logging
import os

import redis.asyncio as redis

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
)
import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator

from api import db, state
from api.agents.augment_agent import start_augment_agent
from api.agents.codex_agent import start_codex_agents
from api.agents.gemini_agent import start_agents as start_gemini_agents
from api.batch.notes_sync_scheduler import start_notes_sync_scheduler
from api.bus import EventBus
from api.config import get_settings
from api.controllers.agents_status import router as agents_status_router
from api.controllers.analytics_clicks import router as analytics_clicks_router
from api.controllers.augment_chat import router as augment_chat_router
from api.controllers.cache import router as cache_router
from api.controllers.chat_admin import router as chat_admin_router
from api.controllers.codex_chat import router as codex_chat_router
from api.controllers.health import router as health_router
from api.controllers.notes import router as notes_router
from api.controllers.notes_search import router as notes_search_router
from api.controllers.when2meet import router as when2meet_router
from api.errors import register_exception_handlers
from api.lifespan import LifespanResources, cleanup_resources, init_database, init_redis

app = FastAPI(
    title="DevStack Internal API",
    version="1.0.0",
    root_path="/api",
)
register_exception_handlers(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

redis_client = None
event_bus: EventBus | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    global redis_client, event_bus
    stop_event: asyncio.Event | None = None
    augment_agent_tasks: list[asyncio.Task] = []
    codex_agent_tasks: list[asyncio.Task] = []
    gemini_agent_tasks: list[asyncio.Task] = []
    sync_tasks: list[asyncio.Task] = []

    redis_client = await init_redis()
    event_bus = EventBus(redis_client)

    state.redis_client = redis_client
    state.event_bus = event_bus

    features = get_settings().features
    enable_db = features.chat_db == "1"
    await init_database()

    enable_augment_agent = features.augment_agent == "1"
    if enable_augment_agent:
        stop_event = asyncio.Event()
        augment_agent_tasks = await start_augment_agent(stop_event)

    enable_gemini_agent = features.gemini_agent == "1"
    if enable_gemini_agent:
        if stop_event is None:
            stop_event = asyncio.Event()
        gemini_agent_tasks = await start_gemini_agents(stop_event)

    enable_codex_agent = features.codex_agent == "1"
    if enable_codex_agent:
        if stop_event is None:
            stop_event = asyncio.Event()
        codex_agent_tasks = await start_codex_agents(stop_event)

    enable_sync = os.getenv("NOTES_SYNC_ENABLED", "1") == "1"
    if enable_sync and enable_db:
        if stop_event is None:
            stop_event = asyncio.Event()
        sync_tasks = await start_notes_sync_scheduler(stop_event)

    try:
        yield
    finally:
        all_tasks = augment_agent_tasks + gemini_agent_tasks + codex_agent_tasks + sync_tasks
        await cleanup_resources(
            LifespanResources(
                redis_client=redis_client,
                event_bus=event_bus,
                stop_event=stop_event,
                background_tasks=all_tasks,
                db_enabled=enable_db,
            )
        )


app.router.lifespan_context = lifespan

app.include_router(health_router)
app.include_router(agents_status_router)
app.include_router(augment_chat_router)
app.include_router(codex_chat_router)
app.include_router(chat_admin_router)

app.include_router(cache_router)
app.include_router(analytics_clicks_router)
app.include_router(notes_router)
app.include_router(notes_search_router)
app.include_router(when2meet_router, prefix="/w2m")

Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
