"""Core database connection pool management."""

import logging
from contextlib import asynccontextmanager

import psycopg
from psycopg_pool import AsyncConnectionPool

from api.config import get_settings

_logger = logging.getLogger(__name__)

# Global connection pool
_pool: AsyncConnectionPool | None = None


def _get_dsn() -> str:
    """Get DSN from settings."""
    return get_settings().postgres.get_dsn()


async def _check_connection(conn: psycopg.AsyncConnection) -> bool:
    """Check if a connection is healthy. Used by pool to detect stale connections."""
    try:
        await conn.execute("SELECT 1")
        return True
    except Exception as e:
        _logger.warning(f"Connection health check failed, will be recycled: {e}")
        return False


async def init_pool() -> None:
    global _pool
    if _pool is not None:
        return
    settings = get_settings().postgres
    dsn = settings.get_dsn()
    _pool = AsyncConnectionPool(
        dsn,
        min_size=settings.pool_min_size,
        max_size=settings.pool_max_size,
        timeout=settings.pool_timeout,
        max_lifetime=settings.pool_max_lifetime,
        max_idle=settings.pool_max_idle,
        reconnect_timeout=settings.pool_reconnect_timeout,
        check=AsyncConnectionPool.check_connection,
        open=False,
    )
    await _pool.open()
    _logger.info(
        f"Database connection pool initialized "
        f"(min={settings.pool_min_size}, max={settings.pool_max_size}, "
        f"timeout={settings.pool_timeout}s, max_lifetime={settings.pool_max_lifetime}s, "
        f"max_idle={settings.pool_max_idle}s, reconnect_timeout={settings.pool_reconnect_timeout}s)"
    )
    # Import here to avoid circular imports
    from api.db.schema import _ensure_schema

    await _ensure_schema()


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        _logger.info("Database connection pool closed")


@asynccontextmanager
async def _get_connection(autocommit: bool = True):
    global _pool
    if _pool is not None:
        async with _pool.connection() as conn:
            if autocommit:
                await conn.set_autocommit(True)
            yield conn
    else:
        dsn = _get_dsn()
        async with await psycopg.AsyncConnection.connect(dsn, autocommit=autocommit) as conn:
            yield conn


def get_pool() -> AsyncConnectionPool | None:
    """Get the connection pool instance."""
    global _pool
    return _pool


def get_pool_stats() -> dict[str, object]:
    """Get current pool statistics for monitoring."""
    global _pool
    if _pool is None:
        return {"status": "not_initialized"}
    stats = _pool.get_stats()
    return {
        "status": "active",
        "size": stats["pool_size"],
        "available": stats["pool_available"],
        "waiting": stats["requests_waiting"],
        "min_size": stats["pool_min"],
        "max_size": stats["pool_max"],
    }


__all__ = [
    "_get_connection",
    "_get_dsn",
    "_pool",
    "close_pool",
    "get_pool",
    "get_pool_stats",
    "init_pool",
]
