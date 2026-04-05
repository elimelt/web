from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from api.dependencies import Redis
from api.models.cache import CacheResponse

router = APIRouter(tags=["cache"])


class CacheValue(BaseModel):
    value: str
    ttl: int | None = 3600


@router.get("/cache/{key}", response_model=CacheResponse)
async def get_cache(key: str, redis: Redis) -> CacheResponse:
    value = await redis.get(key)
    if value is None:
        return {"key": key, "value": None, "found": False}

    return {"key": key, "value": value, "found": True}


@router.post("/cache/{key}")
async def set_cache(key: str, data: CacheValue, redis: Redis) -> dict[str, Any]:
    await redis.setex(key, data.ttl, data.value)
    return {"key": key, "value": data.value, "ttl": data.ttl, "success": True}
