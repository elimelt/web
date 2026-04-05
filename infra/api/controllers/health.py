from fastapi import APIRouter

from api import state
from api.db.core import get_pool_stats
from api.redis_pubsub import get_pool_stats as get_redis_pool_stats
from api.redis_pubsub import get_pubsub_stats

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    redis_status = "disconnected"
    if state.redis_client:
        try:
            await state.redis_client.ping()
            redis_status = "healthy"
        except Exception:
            redis_status = "unhealthy"

    return {"status": "ok", "redis": redis_status}


@router.get("/health/pools")
async def health_pools() -> dict:
    """Get connection pool status for Redis and PostgreSQL."""
    # Redis pool stats with detailed info
    redis_stats = {"status": "not_initialized"}
    if state.redis_client:
        redis_stats = get_redis_pool_stats(state.redis_client)
        pubsub_stats = await get_pubsub_stats()
        redis_stats["pubsub"] = pubsub_stats

    # PostgreSQL pool stats
    postgres_stats = get_pool_stats()

    return {"redis": redis_stats, "postgres": postgres_stats}


@router.get("/health/redis")
async def health_redis_detailed() -> dict:
    """Get detailed Redis connection pool and pubsub statistics.

    This endpoint provides comprehensive information about:
    - Connection pool utilization
    - Active pubsub connections with age and idle time
    - Warnings if pool is getting full
    """
    if not state.redis_client:
        return {"status": "not_initialized", "error": "Redis client not available"}

    pool_stats = get_redis_pool_stats(state.redis_client)
    pubsub_stats = await get_pubsub_stats()

    # Add health assessment
    utilization = pool_stats.get("utilization_percent", 0)
    if utilization > 90:
        health_status = "critical"
    elif utilization > 80:
        health_status = "warning"
    elif utilization > 50:
        health_status = "elevated"
    else:
        health_status = "healthy"

    # Check for stale pubsub connections
    stale_connections = []
    for conn in pubsub_stats.get("connections", []):
        if conn.get("idle_seconds", 0) > 300:  # 5 minutes
            stale_connections.append(conn)

    return {
        "status": health_status,
        "pool": pool_stats,
        "pubsub": pubsub_stats,
        "stale_pubsub_count": len(stale_connections),
        "stale_connections": stale_connections if stale_connections else None,
    }
