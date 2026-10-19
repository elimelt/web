import json
from unittest.mock import AsyncMock, patch

import fakeredis.aioredis as fakeredis
import pytest

from api import db, main
from api.producers.visitor_producer import join_visitor, leave_visitor
from api.visitor_id import public_sender, sanitize_payload, visitor_id

IPS = ["203.0.113.7", "2001:db8::42"]


class FakeBus:
    def __init__(self):
        self.events = []

    async def publish(self, event):
        self.events.append(event)


class FakeReader:
    def city(self, ip):
        class R:
            class country:
                name = "Testland"

            class city:
                name = "Testville"

            class location:
                latitude = 51.507351
                longitude = -0.127758

        return R()


def test_visitor_id_stable_and_distinct():
    a = visitor_id("203.0.113.7")
    assert a == visitor_id("203.0.113.7")
    assert a != visitor_id("203.0.113.8")
    assert len(a) == 16 and int(a, 16) >= 0


def test_visitor_id_uses_configured_secret(monkeypatch):
    from api.config import clear_settings_cache

    base = visitor_id("203.0.113.7")
    monkeypatch.setenv("VISITOR_ID_SECRET", "s3cret")
    clear_settings_cache()
    try:
        assert visitor_id("203.0.113.7") != base
        assert visitor_id("203.0.113.7") == visitor_id("203.0.113.7")
    finally:
        monkeypatch.delenv("VISITOR_ID_SECRET")
        clear_settings_cache()


@pytest.mark.parametrize("ip", IPS)
@pytest.mark.asyncio
async def test_join_and_leave_events_have_no_ip(ip):
    redis_client = fakeredis.FakeRedis(decode_responses=True)
    bus = FakeBus()
    with patch.object(db, "insert_event", AsyncMock()) as insert:
        data = await join_visitor(redis_client, bus, FakeReader(), ip, "visitor:k")
        await leave_visitor(redis_client, bus, ip, "visitor:k")

    vid = visitor_id(ip)
    join, leave = bus.events
    assert join["visitor"]["id"] == vid
    assert leave == {"type": "leave", "id": vid}
    assert data["location"]["lat"] == 51.51 and data["location"]["lon"] == -0.13
    blob = json.dumps(bus.events) + json.dumps(data)
    blob += json.dumps(await redis_client.lrange("visit_log", 0, -1))
    assert ip not in blob and '"ip"' not in blob
    # The internal DB event keeps the IP for the analytics batch job.
    assert insert.await_args_list[0].args[2]["visitor"]["ip"] == ip


def test_visitors_endpoint_has_no_ip(client):
    ip = "198.51.100.9"
    legacy = {
        "ip": ip,
        "location": {"country": "X", "city": "Y", "lat": 1.23456, "lon": 2.34567},
        "connected_at": "2025-01-01T00:00:00+00:00",
    }

    async def seed():
        await main.redis_client.set("visitor:legacy", json.dumps(legacy))
        await main.redis_client.lpush("visit_log", json.dumps({**legacy, "timestamp": "t"}))

    client.portal.call(seed)
    res = client.get("/visitors")
    assert res.status_code == 200
    assert ip not in res.text and '"ip"' not in res.text
    body = res.json()
    assert body["active_visitors"][0]["id"] == visitor_id(ip)
    assert body["recent_visits"][0]["id"] == visitor_id(ip)
    assert body["active_visitors"][0]["location"]["lat"] == 1.23


def test_events_endpoint_has_no_ip(client):
    rows = [
        {
            "topic": "visitor_updates",
            "type": "join",
            "timestamp": "2025-01-01T00:00:00+00:00",
            "payload": {"visitor": {"ip": "198.51.100.9", "location": {"lat": 1.234}}},
        },
        {
            "topic": "visitor_updates",
            "type": "leave",
            "timestamp": "2025-01-01T00:00:00+00:00",
            "payload": {"ip": "198.51.100.9"},
        },
        {
            "topic": "chat:general",
            "type": "chat_message",
            "timestamp": "2025-01-01T00:00:00+00:00",
            "payload": {"sender": "198.51.100.9:1234", "text": "hi"},
        },
    ]
    with patch.object(db, "fetch_events", AsyncMock(return_value=rows)):
        res = client.get("/events")
    assert res.status_code == 200
    assert "198.51.100.9" not in res.text and '"ip"' not in res.text
    vid = visitor_id("198.51.100.9")
    events = res.json()["events"]
    assert events[0]["payload"]["visitor"]["id"] == vid
    assert events[1]["payload"]["id"] == vid
    assert events[2]["payload"]["sender"] == vid


def test_chat_history_sender_not_ip(client):
    rows = [
        {
            "type": "chat_message",
            "channel": "general",
            "sender": "2001:db8::1:140234567890",
            "text": "hi",
            "timestamp": "t",
            "id": None,
            "reply_to": None,
        },
        {
            "type": "chat_message",
            "channel": "general",
            "sender": "agent:augment",
            "text": "yo",
            "timestamp": "t",
            "id": None,
            "reply_to": None,
        },
    ]
    with patch.object(db, "fetch_chat_history", AsyncMock(return_value=rows)):
        res = client.get("/chat/general/history")
    senders = [m["sender"] for m in res.json()["messages"]]
    assert senders == [visitor_id("2001:db8::1"), "agent:augment"]


def test_public_sender_and_sanitize_helpers():
    assert public_sender("10.0.0.1") == visitor_id("10.0.0.1")
    assert public_sender("10.0.0.1:99") == visitor_id("10.0.0.1")
    assert public_sender("agent:codex") == "agent:codex"
    out = sanitize_payload({"client_ip": "10.0.0.1", "page": {"path": "/"}})
    assert out == {"page": {"path": "/"}, "id": visitor_id("10.0.0.1")}


def test_system_error_is_generic(client, monkeypatch):
    from api.controllers import system as system_module

    def boom(*a, **k):
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr(system_module.subprocess, "run", boom)
    res = client.get("/system")
    assert "secret internal detail" not in res.text
