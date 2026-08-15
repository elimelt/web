import logging
import os

import geoip2.database
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
from api.batch.visitor_analytics import start_analytics_scheduler
from api.bus import EventBus
from api.config import get_settings
from api.lifespan import (
    LifespanResources,
    cleanup_resources,
    init_database,
    init_geoip,
    init_redis,
)
from api.redis_pubsub import cleanup_expired_pubsubs, get_pool_stats, get_pubsub_stats
from api.controllers.analytics_clicks import router as analytics_clicks_router
from api.controllers.chat_analytics import router as chat_analytics_router
from api.controllers.chat_history import router as chat_history_router
from api.controllers.events_history import router as events_history_router
from api.controllers.health import router as health_router
from api.controllers.notes import router as notes_router
from api.controllers.notes_search import router as notes_search_router
from api.controllers.system import router as system_router
from api.controllers.visitor_analytics import router as visitor_analytics_router
from api.controllers.visitors import router as visitors_router
from api.controllers.when2meet import router as when2meet_router
from api.controllers.ws_chat import router as ws_chat_router
from api.controllers.ws_visitors import router as ws_visitors_router
from api.controllers.ws_canvas import router as ws_canvas_router, load_canvas_state
from api.errors import register_exception_handlers
from api.middleware import HTTPLogMiddleware

app = FastAPI(
    title="Public API",
    version="1.0.0",
    root_path=os.getenv("API_ROOT_PATH", ""),
    swagger_ui_parameters={
        "requestSnippetsEnabled": True,
        "requestSnippets": {
            "generators": {
                "curl_bash": {"title": "cURL (bash)", "syntax": "bash"},
                "curl_powershell": {"title": "cURL (PowerShell)", "syntax": "powershell"},
                "curl_cmd": {"title": "cURL (CMD)", "syntax": "bash"},
            },
            "defaultExpanded": True,
            "languages": None,
        },
    },
)
register_exception_handlers(app)

_cors_settings = get_settings().cors
cors_origins = _cors_settings.origins
cors_regex = _cors_settings.origins_regex
allow_credentials = cors_origins != ["*"] and cors_regex is None

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=cors_regex,
    allow_credentials=allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

if os.getenv("REQUEST_DEBUG", "0") == "1":
    logging.getLogger("api.http").setLevel(logging.DEBUG)
    app.add_middleware(HTTPLogMiddleware)

if os.getenv("WS_DEBUG", "0") == "1":
    logging.getLogger("api.ws.visitors").setLevel(logging.INFO)
    logging.getLogger("api.ws.chat").setLevel(logging.INFO)

redis_client = None
event_bus: EventBus | None = None
geoip_reader = None


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    global redis_client, geoip_reader, event_bus
    stop_event: asyncio.Event | None = None

    redis_client = await init_redis()
    event_bus = EventBus(redis_client)

    # Preserve historical semantics: the module global is only assigned
    # when a reader was created (a missing file leaves the prior value).
    new_geoip_reader = init_geoip()
    if new_geoip_reader is not None:
        geoip_reader = new_geoip_reader

    state.redis_client = redis_client
    state.event_bus = event_bus
    state.geoip_reader = geoip_reader

    enable_db = get_settings().features.chat_db == "1"
    await init_database()

    analytics_tasks: list[asyncio.Task] = []
    enable_analytics = get_settings().features.analytics_scheduler == "1"
    if enable_analytics and enable_db:
        if stop_event is None:
            stop_event = asyncio.Event()
        analytics_tasks = await start_analytics_scheduler(stop_event)

    # Start Redis connection pool monitor and cleanup task
    cleanup_stop_event = asyncio.Event()
    cleanup_interval = int(os.getenv("REDIS_CLEANUP_INTERVAL_SEC", "60"))
    max_idle_sec = float(os.getenv("REDIS_PUBSUB_MAX_IDLE_SEC", "300"))

    async def redis_pool_monitor():
        """Periodic task to monitor and cleanup Redis connections."""
        _logger = logging.getLogger("api.redis.monitor")
        while not cleanup_stop_event.is_set():
            try:
                await asyncio.sleep(cleanup_interval)
                if cleanup_stop_event.is_set():
                    break

                # Log pool stats
                if redis_client:
                    pool_stats = get_pool_stats(redis_client)
                    pubsub_stats = await get_pubsub_stats()
                    utilization = pool_stats.get("utilization_percent", 0)

                    # Log warning if pool is getting full
                    if utilization > 80:
                        _logger.warning(
                            "Redis pool high utilization: %s%% - pool=%s pubsub=%s",
                            utilization,
                            pool_stats,
                            pubsub_stats,
                        )
                    elif utilization > 50:
                        _logger.info(
                            "Redis pool stats: utilization=%s%% in_use=%s pubsub_count=%s",
                            utilization,
                            pool_stats.get("in_use_connections", "?"),
                            pubsub_stats.get("active_pubsub_count", 0),
                        )

                # Cleanup expired pubsubs
                cleaned = await cleanup_expired_pubsubs(max_idle_sec=max_idle_sec)
                if cleaned > 0:
                    _logger.info("Cleaned up %d expired pubsub connections", cleaned)

            except asyncio.CancelledError:
                break
            except Exception as e:
                _logger.error("Error in redis pool monitor: %s", e)

    cleanup_task = asyncio.create_task(redis_pool_monitor())

    # Load canvas state from Redis
    await load_canvas_state()

    try:
        yield
    finally:
        # Stop cleanup task
        cleanup_stop_event.set()
        cleanup_task.cancel()
        try:
            await asyncio.wait_for(cleanup_task, timeout=2)
        except (asyncio.CancelledError, asyncio.TimeoutError):
            pass

        await cleanup_resources(
            LifespanResources(
                redis_client=redis_client,
                event_bus=event_bus,
                geoip_reader=geoip_reader,
                stop_event=stop_event,
                background_tasks=analytics_tasks,
                db_enabled=enable_db,
            )
        )


app.router.lifespan_context = lifespan

app.include_router(health_router)
app.include_router(visitors_router)
app.include_router(system_router)
app.include_router(ws_visitors_router)
app.include_router(ws_chat_router)
app.include_router(chat_analytics_router)
app.include_router(chat_history_router)
app.include_router(events_history_router)
app.include_router(visitor_analytics_router)
app.include_router(analytics_clicks_router)
app.include_router(when2meet_router, prefix="/w2m")
app.include_router(notes_router)
app.include_router(notes_search_router)
app.include_router(ws_canvas_router)

Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
