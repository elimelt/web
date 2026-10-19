from fastapi import APIRouter

from api.dependencies import OptionalRedis

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(redis_client: OptionalRedis) -> dict[str, str]:
    redis_status = "disconnected"
    if redis_client:
        try:
            await redis_client.ping()
            redis_status = "healthy"
        except Exception:
            redis_status = "unhealthy"

    return {"status": "ok", "redis": redis_status}
