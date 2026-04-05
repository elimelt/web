"""Dependency injection for FastAPI endpoints.

This module provides FastAPI dependencies for accessing shared resources
like Redis, EventBus, and GeoIP reader. It replaces direct access to
global state with proper dependency injection.

Usage in controllers:
    from api.dependencies import get_redis, get_event_bus

    @router.get("/example")
    async def example(redis: Redis = Depends(get_redis)):
        value = await redis.get("key")
        return {"value": value}
"""

from typing import Annotated

import geoip2.database
import redis.asyncio as redis
from fastapi import Depends

from api import state
from api.bus import EventBus
from api.errors import ServiceUnavailableError


def get_redis() -> redis.Redis:
    """Get the Redis client.

    Raises:
        ServiceUnavailableError: If Redis is not connected.

    Returns:
        The Redis client instance.
    """
    if state.redis_client is None:
        raise ServiceUnavailableError(detail="Redis not connected")
    return state.redis_client


def get_optional_redis() -> redis.Redis | None:
    """Get the Redis client if available, or None.

    Returns:
        The Redis client instance or None if not connected.
    """
    return state.redis_client


def get_event_bus() -> EventBus:
    """Get the EventBus instance.

    Raises:
        ServiceUnavailableError: If EventBus is not initialized.

    Returns:
        The EventBus instance.
    """
    if state.event_bus is None:
        raise ServiceUnavailableError(detail="Event bus not initialized")
    return state.event_bus


def get_optional_event_bus() -> EventBus | None:
    """Get the EventBus if available, or None.

    Returns:
        The EventBus instance or None if not initialized.
    """
    return state.event_bus


def get_geoip_reader() -> geoip2.database.Reader | None:
    """Get the GeoIP reader if available.

    Returns:
        The GeoIP reader instance or None if not available.
    """
    return state.geoip_reader


Redis = Annotated[redis.Redis, Depends(get_redis)]
OptionalRedis = Annotated[redis.Redis | None, Depends(get_optional_redis)]
Bus = Annotated[EventBus, Depends(get_event_bus)]
OptionalBus = Annotated[EventBus | None, Depends(get_optional_event_bus)]
GeoIP = Annotated[geoip2.database.Reader | None, Depends(get_geoip_reader)]
