import json
import logging

from fastapi import APIRouter

from api import db
from api.dependencies import Redis
from api.models.chat import ChatAnalyticsResponse

router = APIRouter(tags=["chat"])
_logger = logging.getLogger("api.controllers.chat_analytics")

CACHE_KEY_PREFIX = "chat_analytics:"


def _cache_key(channel: str) -> str:
    return f"{CACHE_KEY_PREFIX}{channel}"


@router.get("/chat/{channel}/analytics", response_model=ChatAnalyticsResponse)
async def chat_analytics(channel: str, redis: Redis) -> ChatAnalyticsResponse:
    """Get analytics (message count, unique senders) for a chat channel.

    Results are cached in Redis and invalidated when a new message is sent.
    """
    cache_key = _cache_key(channel)

    # Try to get from cache
    cached = await redis.get(cache_key)
    if cached:
        _logger.debug("Cache hit for channel=%s", channel)
        data = json.loads(cached)
        return ChatAnalyticsResponse(**data)

    _logger.debug("Cache miss for channel=%s, fetching from DB", channel)
    # Fetch from database
    analytics = await db.fetch_chat_analytics(channel)

    # Store in cache (no TTL - only invalidated on message send)
    await redis.set(cache_key, json.dumps(analytics))

    return ChatAnalyticsResponse(**analytics)


async def invalidate_chat_analytics_cache(redis, channel: str) -> None:
    """Invalidate the chat analytics cache for a channel."""
    cache_key = _cache_key(channel)
    await redis.delete(cache_key)
    _logger.debug("Invalidated cache for channel=%s", channel)
