"""Managed Redis PubSub with guaranteed cleanup and connection leak prevention.

This module provides a bulletproof context manager for Redis pubsub that:
1. Guarantees connection cleanup even on errors/timeouts
2. Tracks all active pubsub connections for monitoring
3. Provides automatic timeout-based cleanup
4. Force-releases connections that exceed max lifetime
"""

import asyncio
import logging
import time
import weakref
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

import redis.asyncio as redis

_logger = logging.getLogger("api.redis.pubsub")

# Global registry of active pubsub connections for monitoring and cleanup
_active_pubsubs: weakref.WeakSet[Any] = weakref.WeakSet()
_pubsub_metadata: dict[int, "PubSubMetadata"] = {}
_registry_lock = asyncio.Lock()


@dataclass
class PubSubMetadata:
    """Metadata for tracking pubsub connection lifecycle."""

    channel: str
    created_at: float = field(default_factory=time.time)
    last_activity: float = field(default_factory=time.time)
    client_info: str = ""

    @property
    def age_seconds(self) -> float:
        return time.time() - self.created_at

    @property
    def idle_seconds(self) -> float:
        return time.time() - self.last_activity


class ManagedPubSub:
    """Wrapper around Redis PubSub with automatic cleanup and tracking."""

    def __init__(
        self,
        pubsub: Any,
        channel: str,
        client_info: str = "",
        max_lifetime_sec: float = 3600.0,
        cleanup_timeout_sec: float = 5.0,
    ):
        self._pubsub = pubsub
        self._channel = channel
        self._client_info = client_info
        self._max_lifetime_sec = max_lifetime_sec
        self._cleanup_timeout_sec = cleanup_timeout_sec
        self._metadata = PubSubMetadata(
            channel=channel,
            client_info=client_info,
        )
        self._closed = False

    @property
    def metadata(self) -> PubSubMetadata:
        return self._metadata

    def update_activity(self) -> None:
        """Update last activity timestamp."""
        self._metadata.last_activity = time.time()

    async def listen(self) -> AsyncIterator[dict]:
        """Listen for messages with activity tracking."""
        async for message in self._pubsub.listen():
            self.update_activity()
            yield message

    async def cleanup(self) -> None:
        """Force cleanup of the pubsub connection with timeout protection."""
        if self._closed:
            return
        self._closed = True

        # Step 1: Unsubscribe with timeout
        try:
            await asyncio.wait_for(
                self._pubsub.unsubscribe(self._channel),
                timeout=self._cleanup_timeout_sec / 3,
            )
        except Exception as e:
            _logger.debug("Unsubscribe error for %s: %s", self._channel, e)

        # Step 2: Reset connection (releases back to pool)
        try:
            if hasattr(self._pubsub, "reset"):
                await asyncio.wait_for(
                    self._pubsub.reset(),
                    timeout=self._cleanup_timeout_sec / 3,
                )
        except Exception as e:
            _logger.debug("Reset error for %s: %s", self._channel, e)

        # Step 3: Close the pubsub
        try:
            if hasattr(self._pubsub, "aclose"):
                await asyncio.wait_for(
                    self._pubsub.aclose(),
                    timeout=self._cleanup_timeout_sec / 3,
                )
            elif hasattr(self._pubsub, "close"):
                await asyncio.wait_for(
                    self._pubsub.close(),
                    timeout=self._cleanup_timeout_sec / 3,
                )
        except Exception as e:
            _logger.debug("Close error for %s: %s", self._channel, e)

        # Step 4: Force disconnect the underlying connection if still held
        try:
            if hasattr(self._pubsub, "connection") and self._pubsub.connection:
                conn = self._pubsub.connection
                if hasattr(conn, "disconnect"):
                    await asyncio.wait_for(conn.disconnect(), timeout=1.0)
                self._pubsub.connection = None
        except Exception as e:
            _logger.debug("Force disconnect error for %s: %s", self._channel, e)

    def is_expired(self) -> bool:
        """Check if this pubsub has exceeded its max lifetime."""
        return self._metadata.age_seconds > self._max_lifetime_sec


@asynccontextmanager
async def managed_pubsub(
    redis_client: redis.Redis,
    channel: str,
    client_info: str = "",
    max_lifetime_sec: float = 3600.0,
    cleanup_timeout_sec: float = 5.0,
) -> AsyncIterator[ManagedPubSub]:
    """Context manager for Redis pubsub with guaranteed cleanup.

    Args:
        redis_client: Redis client instance
        channel: Channel to subscribe to
        client_info: Optional client identifier for debugging
        max_lifetime_sec: Maximum lifetime before forced cleanup (default 1 hour)
        cleanup_timeout_sec: Timeout for cleanup operations (default 5 seconds)

    Yields:
        ManagedPubSub instance

    Example:
        async with managed_pubsub(redis, "my_channel", client_info="user:123") as ps:
            async for msg in ps.listen():
                process(msg)
    """
    pubsub = redis_client.pubsub()
    managed = ManagedPubSub(
        pubsub=pubsub,
        channel=channel,
        client_info=client_info,
        max_lifetime_sec=max_lifetime_sec,
        cleanup_timeout_sec=cleanup_timeout_sec,
    )

    # Register in global tracking
    async with _registry_lock:
        _active_pubsubs.add(managed)
        _pubsub_metadata[id(managed)] = managed.metadata

    try:
        await pubsub.subscribe(channel)
        _logger.debug("Subscribed to %s (client=%s)", channel, client_info)
        yield managed
    finally:
        # Always cleanup, even on error
        _logger.debug("Cleaning up pubsub for %s (client=%s)", channel, client_info)
        await managed.cleanup()

        # Unregister from global tracking
        async with _registry_lock:
            _pubsub_metadata.pop(id(managed), None)


async def get_pubsub_stats() -> dict:
    """Get statistics about active pubsub connections.

    Returns:
        Dictionary with pubsub connection statistics
    """
    async with _registry_lock:
        active_count = len(_pubsub_metadata)
        connections = []
        for ps_id, meta in _pubsub_metadata.items():
            connections.append(
                {
                    "channel": meta.channel,
                    "client_info": meta.client_info,
                    "age_seconds": round(meta.age_seconds, 1),
                    "idle_seconds": round(meta.idle_seconds, 1),
                }
            )

    return {
        "active_pubsub_count": active_count,
        "connections": connections,
    }


async def cleanup_expired_pubsubs(max_idle_sec: float = 300.0) -> int:
    """Force cleanup of pubsub connections that have been idle too long.

    Args:
        max_idle_sec: Maximum idle time before cleanup (default 5 minutes)

    Returns:
        Number of connections cleaned up
    """
    cleaned = 0
    to_cleanup: list[ManagedPubSub] = []

    async with _registry_lock:
        for managed in list(_active_pubsubs):
            if managed.metadata.idle_seconds > max_idle_sec or managed.is_expired():
                to_cleanup.append(managed)

    for managed in to_cleanup:
        try:
            _logger.warning(
                "Force cleaning expired pubsub: channel=%s client=%s age=%.1fs idle=%.1fs",
                managed.metadata.channel,
                managed.metadata.client_info,
                managed.metadata.age_seconds,
                managed.metadata.idle_seconds,
            )
            await managed.cleanup()
            cleaned += 1
        except Exception as e:
            _logger.error("Error cleaning up pubsub: %s", e)

    return cleaned


def get_pool_stats(redis_client: redis.Redis) -> dict:
    """Get Redis connection pool statistics.

    Args:
        redis_client: Redis client instance

    Returns:
        Dictionary with pool statistics
    """
    pool = getattr(redis_client, "connection_pool", None)
    if pool is None:
        return {"error": "No connection pool found"}

    stats = {
        "max_connections": getattr(pool, "max_connections", "unknown"),
    }

    # BlockingConnectionPool specific stats
    if hasattr(pool, "_available_connections"):
        stats["available_connections"] = len(pool._available_connections)
    if hasattr(pool, "_in_use_connections"):
        stats["in_use_connections"] = len(pool._in_use_connections)

    # Calculate utilization
    max_conn = stats.get("max_connections", 0)
    in_use = stats.get("in_use_connections", 0)
    if isinstance(max_conn, int) and max_conn > 0:
        stats["utilization_percent"] = round((in_use / max_conn) * 100, 1)

    return stats

