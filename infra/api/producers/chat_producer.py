import logging
import re
import secrets
from datetime import UTC, datetime

from api import db, state
from api.bus import EventBus
from api.controllers.chat_analytics import invalidate_chat_analytics_cache
from api.events import ChatMessageEvent

_logger = logging.getLogger("api.producers.chat_producer")

_REPLY_RE = re.compile(r"^\s*REPLY:\s*([A-Za-z0-9_-]{4,32})\s*\n", re.IGNORECASE)


def _gen_message_id() -> str:
    return secrets.token_hex(4)


def _parse_reply_header(text: str) -> tuple[str | None, str]:
    m = _REPLY_RE.match(text or "")
    if not m:
        return None, text
    reply_to = m.group(1)
    cleaned = text[m.end() :]
    return reply_to, cleaned


def build_chat_message(channel: str, sender: str, text: str) -> ChatMessageEvent:
    reply_to, cleaned = _parse_reply_header(text)
    mid = _gen_message_id()
    return {
        "type": "chat_message",
        "channel": channel,
        "sender": sender,
        "text": cleaned,
        "timestamp": datetime.now(UTC).isoformat(),
        "id": mid,
        "reply_to": reply_to,
    }


async def publish_chat_message(event_bus: EventBus, channel: str, event: ChatMessageEvent) -> None:
    _logger.debug(
        "[publish_chat] Publishing to Redis channel=%s sender=%s", channel, event.get("sender")
    )
    await event_bus.publish_chat(channel, event)
    _logger.debug("[publish_chat] Published to Redis, inserting to DB")
    try:
        await db.insert_chat_message(
            channel,
            event["sender"],
            event["text"],
            event["timestamp"],
            message_id=event.get("id"),
            reply_to=event.get("reply_to"),
        )
        _logger.debug("[publish_chat] Inserted message to DB")
        from api.bus import EventBus as _Bus

        await db.insert_event(_Bus.chat_channel(channel), "chat_message", event, event["timestamp"])
        _logger.debug("[publish_chat] Inserted event to DB")
    except Exception as e:
        _logger.error("[publish_chat] Error inserting to DB: %s", e)

    # Invalidate analytics cache
    if state.redis_client:
        try:
            await invalidate_chat_analytics_cache(state.redis_client, channel)
        except Exception as e:
            _logger.error("[publish_chat] Error invalidating analytics cache: %s", e)
