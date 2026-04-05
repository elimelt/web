"""Shared lifespan management for FastAPI applications.

This module provides reusable components for application startup and shutdown,
eliminating duplication between main.py and main_internal.py.
"""

import asyncio
import logging
import os
from dataclasses import dataclass, field

import geoip2.database
import redis.asyncio as redis
from redis.asyncio import BlockingConnectionPool as RedisConnectionPool

from api import db, state
from api.bus import EventBus
from api.config import get_settings
from api.redis_debug import wrap_redis_client

logger = logging.getLogger(__name__)


@dataclass
class LifespanResources:
    """Container for resources initialized during lifespan."""

    redis_client: redis.Redis | None = None
    event_bus: EventBus | None = None
    geoip_reader: geoip2.database.Reader | None = None
    stop_event: asyncio.Event | None = None
    background_tasks: list[asyncio.Task] = field(default_factory=list)
    db_enabled: bool = False


async def init_redis() -> redis.Redis:
    """Initialize Redis connection with connection pool.

    Returns:
        Configured Redis client.
    """
    settings = get_settings()

    redis_pool = RedisConnectionPool(
        host=settings.redis.host,
        port=settings.redis.port,
        password=settings.redis.password if settings.redis.password else None,
        max_connections=settings.redis.max_connections,
        timeout=settings.redis.pool_timeout_sec,
        health_check_interval=settings.redis.health_check_interval,
        socket_timeout=settings.redis.socket_timeout,
        socket_connect_timeout=settings.redis.socket_connect_timeout,
        retry_on_timeout=settings.redis.retry_on_timeout,
    )

    candidate_client = redis.Redis(connection_pool=redis_pool, decode_responses=True)
    if hasattr(candidate_client, "__await__"):
        redis_client = await candidate_client
    else:
        redis_client = candidate_client

    if settings.debug.redis:
        logging.getLogger("api.redis").setLevel(logging.DEBUG)
        redis_logger = logging.getLogger("api.redis")
        redis_client = wrap_redis_client(redis_client, redis_logger)

    return redis_client


def init_geoip() -> geoip2.database.Reader | None:
    """Initialize GeoIP reader if database file exists.

    Returns:
        GeoIP reader or None if not available.
    """
    settings = get_settings()
    geoip_db_path = settings.geoip.db_path

    if os.path.exists(geoip_db_path):
        return geoip2.database.Reader(geoip_db_path)
    return None


async def init_database() -> bool:
    """Initialize database connection pool.

    Returns:
        True if database was initialized, False otherwise.
    """
    enable_db = os.getenv("ENABLE_CHAT_DB", "0") == "1"
    if enable_db:
        try:
            await db.init_pool()
            return True
        except Exception as e:
            logger.warning("Failed to initialize database: %s", e)
    return False


async def setup_resources(
    enable_geoip: bool = True,
    enable_db: bool = True,
) -> LifespanResources:
    """Set up all shared resources.

    Args:
        enable_geoip: Whether to initialize GeoIP reader.
        enable_db: Whether to initialize database.

    Returns:
        LifespanResources containing all initialized resources.
    """
    resources = LifespanResources()

    # Initialize Redis and EventBus
    resources.redis_client = await init_redis()
    resources.event_bus = EventBus(resources.redis_client)

    # Initialize GeoIP if enabled
    if enable_geoip:
        resources.geoip_reader = init_geoip()

    # Initialize database if enabled
    if enable_db:
        resources.db_enabled = await init_database()

    # Update global state for backward compatibility
    state.redis_client = resources.redis_client
    state.event_bus = resources.event_bus
    state.geoip_reader = resources.geoip_reader

    return resources


async def cleanup_resources(resources: LifespanResources) -> None:
    """Clean up all resources on shutdown.

    Args:
        resources: The resources to clean up.
    """
    # Stop background tasks
    if resources.background_tasks and resources.stop_event:
        resources.stop_event.set()
        try:
            await asyncio.wait_for(
                asyncio.gather(*resources.background_tasks, return_exceptions=True),
                timeout=5,
            )
        except Exception:
            for t in resources.background_tasks:
                t.cancel()

    # Close database
    if resources.db_enabled:
        try:
            await db.close_pool()
        except Exception:
            pass

    # Close Redis
    if resources.redis_client:
        aclose = getattr(resources.redis_client, "aclose", None)
        if callable(aclose):
            await aclose()
        else:
            close = getattr(resources.redis_client, "close", None)
            if callable(close):
                close()

    # Close GeoIP
    if resources.geoip_reader:
        resources.geoip_reader.close()

    # Clear global state
    state.redis_client = None
    state.event_bus = None
    state.geoip_reader = None
