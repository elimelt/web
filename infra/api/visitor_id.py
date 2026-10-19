"""Pseudonymous visitor ids for public API output.

Raw IP addresses are kept internally (DB, Redis, geolocation, rate limiting).
Anything that leaves the API over HTTP or websockets must go through the
helpers here so only a keyed, non-reversible id is exposed.
"""

import hashlib
import hmac
import ipaddress
import logging
import secrets
from datetime import datetime
from typing import Any

from fastapi import HTTPException

from api.config import get_settings

_logger = logging.getLogger("api.visitor_id")
_fallback_key: bytes | None = None


def _key() -> bytes:
    global _fallback_key
    secret = get_settings().visitor_id.secret
    if secret:
        return secret.encode()
    if _fallback_key is None:
        _fallback_key = secrets.token_bytes(32)
        _logger.warning(
            "VISITOR_ID_SECRET is not set; using a per-process random key "
            "(visitor ids will change on restart)"
        )
    return _fallback_key


def visitor_id(ip: str) -> str:
    """Stable pseudonymous id (16 hex chars) for an IP address."""
    return hmac.new(_key(), ip.encode(), hashlib.sha256).hexdigest()[:16]


def public_location(location: dict[str, Any] | None) -> dict[str, Any]:
    """Keep city/country, round coordinates to ~1 km."""
    loc = dict(location or {})
    for k in ("lat", "lon"):
        if isinstance(loc.get(k), (int, float)):
            loc[k] = round(loc[k], 2)
    return loc


def public_visitor(visitor: dict[str, Any]) -> dict[str, Any]:
    """Public form of a visitor / visit record: ip replaced with id."""
    out = {k: v for k, v in visitor.items() if k not in ("ip", "id")}
    ip = visitor.get("ip")
    out["id"] = visitor_id(ip) if ip else visitor.get("id")
    if "location" in out:
        out["location"] = public_location(out["location"])
    return out


def public_sender(sender: str) -> str:
    """Replace an IP-based chat sender ("<ip>[:<n>]") with the visitor id."""
    if not isinstance(sender, str):
        return sender
    for candidate in (sender, sender.rsplit(":", 1)[0]):
        try:
            ipaddress.ip_address(candidate)
        except ValueError:
            continue
        return visitor_id(candidate)
    return sender


def sanitize_payload(obj: Any) -> Any:
    """Recursively strip IPs from stored event payloads for public output."""
    if isinstance(obj, list):
        return [sanitize_payload(x) for x in obj]
    if not isinstance(obj, dict):
        return obj
    out: dict[str, Any] = {}
    for k, v in obj.items():
        if k in ("ip", "client_ip", "visitor_ip"):
            continue
        if k == "visitor" and isinstance(v, dict):
            out[k] = public_visitor(v)
        elif k == "sender":
            out[k] = public_sender(v)
        elif k == "location" and isinstance(v, dict):
            out[k] = public_location(v)
        else:
            out[k] = sanitize_payload(v)
    ip = obj.get("ip") or obj.get("client_ip") or obj.get("visitor_ip")
    if isinstance(ip, str) and ip and "id" not in out:
        out["id"] = visitor_id(ip)
    return out


def check_iso_date(name: str, value: str | None) -> str | None:
    """Validate an ISO8601 query param; raise 422 when invalid."""
    if value:
        try:
            datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Invalid ISO8601 value for {name}")
    return value
