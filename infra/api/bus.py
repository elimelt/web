import json
from typing import Final

import redis.asyncio as redis

from api.events import ChatMessageEvent, VisitorEvent

CHANNEL_VISITOR_UPDATES: Final[str] = "visitor_updates"
CHANNEL_CHAT_PREFIX: Final[str] = "chat:"


class EventBus:
    def __init__(self, redis_client: redis.Redis):
        self.redis_client = redis_client

    async def publish(self, event: VisitorEvent) -> None:
        await self.redis_client.publish(CHANNEL_VISITOR_UPDATES, json.dumps(event))

    @staticmethod
    def chat_channel(channel: str) -> str:
        return f"{CHANNEL_CHAT_PREFIX}{channel}"

    async def publish_chat(self, channel: str, event: ChatMessageEvent) -> None:
        await self.redis_client.publish(self.chat_channel(channel), json.dumps(event))
