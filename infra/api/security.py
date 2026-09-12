"""Trust boundaries and bounded, process-local WebSocket admission controls."""

import ipaddress
import os
import socket
import time
from collections import OrderedDict
from functools import lru_cache

from api.config import get_settings


@lru_cache(maxsize=8)
def _proxy_addresses(host: str, bucket: int) -> frozenset[str]:
    try:
        return frozenset(item[4][0] for item in socket.getaddrinfo(host, None))
    except OSError:
        return frozenset()


def client_ip(connection) -> str:
    peer = connection.client.host if connection.client else "unknown"
    trusted_host = os.getenv("TRUSTED_PROXY_HOST", "")
    # Never use client-controlled headers unless the socket peer is our proxy.
    if trusted_host and peer in _proxy_addresses(trusted_host, int(time.monotonic() / 30)):
        candidate = connection.headers.get("x-forwarded-for", "")
    else:
        candidate = peer
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return "unknown"


def allowed_ws_origin(websocket) -> bool:
    origin = websocket.headers.get("origin")
    # Non-browser clients remain public, but share the same quotas.
    if not origin:
        return True
    return origin in get_settings().cors.origins


class RateLimiter:
    """Fixed-window quota with bounded key retention; no attacker-sized dictionaries."""

    def __init__(self, limit: int, seconds: float, max_keys: int = 4096):
        self.limit, self.seconds, self.max_keys = limit, seconds, max_keys
        self.entries: OrderedDict[str, tuple[float, int]] = OrderedDict()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        start, count = self.entries.get(key, (now, 0))
        if now - start >= self.seconds:
            start, count = now, 0
        if key not in self.entries and len(self.entries) >= self.max_keys:
            oldest_start, _ = next(iter(self.entries.values()))
            if now - oldest_start < self.seconds:
                return False
            self.entries.popitem(last=False)
        self.entries[key] = (start, count + 1)
        return count < self.limit


class ConnectionLimits:
    def __init__(self, total: int, per_ip: int):
        self.total, self.per_ip = total, per_ip
        self.active: dict[str, int] = {}

    def acquire(self, ip: str) -> bool:
        if sum(self.active.values()) >= self.total or self.active.get(ip, 0) >= self.per_ip:
            return False
        self.active[ip] = self.active.get(ip, 0) + 1
        return True

    def release(self, ip: str) -> None:
        remaining = self.active.get(ip, 0) - 1
        if remaining > 0:
            self.active[ip] = remaining
        else:
            self.active.pop(ip, None)
