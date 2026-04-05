import asyncio

import geoip2.database
import redis.asyncio as redis

from api.bus import EventBus

redis_client: redis.Redis | None = None
event_bus: EventBus | None = None
geoip_reader: geoip2.database.Reader | None = None

active_ws_visitors_by_ip: dict[str, int] = {}
ws_visitors_lock: asyncio.Lock = asyncio.Lock()
