"""Shared application state.

This module is the sanctioned path for non-request contexts: WebSocket
loops, agents, producers, and lifespan. HTTP request handlers must not
read these attributes directly; they use the accessors and Annotated
aliases in api.dependencies instead.
"""

import asyncio

import geoip2.database
import redis.asyncio as redis

from api.bus import EventBus

redis_client: redis.Redis | None = None
event_bus: EventBus | None = None
geoip_reader: geoip2.database.Reader | None = None

active_ws_visitors_by_ip: dict[str, int] = {}
ws_visitors_lock: asyncio.Lock = asyncio.Lock()
