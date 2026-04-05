import asyncio
import json
import time
from unittest.mock import AsyncMock

import pytest

from api import main
from api.controllers import ws_visitors
from api.controllers.ws_visitors import _handle_analytics_batch


def test_websocket_join_broadcast_and_leave(client, monkeypatch):
    headers = {"x-forwarded-for": "203.0.113.10"}

    class DummyPubSub:
        def __init__(self, data_text: str):
            self._data_text = data_text

        async def subscribe(self, _channel: str):
            return True

        async def unsubscribe(self, _channel: str):
            return True

        async def close(self):
            return True

        async def aclose(self):
            return True

        async def listen(self):
            yield {"type": "message", "data": self._data_text}
            await asyncio.sleep(0)  # allow cancellation

    payload = {"type": "broadcast", "payload": {"hello": "world"}}
    monkeypatch.setattr(main.redis_client, "pubsub", lambda: DummyPubSub(json.dumps(payload)))

    with client.websocket_connect("/ws/visitors", headers=headers) as ws:
        visitors_resp = client.get("/visitors")
        assert visitors_resp.status_code == 200
        visitors = visitors_resp.json()
        assert visitors["active_count"] >= 1
        ips = [v["ip"] for v in visitors["active_visitors"]]
        assert "203.0.113.10" in ips

        msg = ws.receive_text()
        received = json.loads(msg)
        assert received["type"] == "broadcast"
        assert received["payload"]["hello"] == "world"

    for _ in range(10):
        visitors_resp = client.get("/visitors")
        assert visitors_resp.status_code == 200
        if visitors_resp.json()["active_count"] == 0:
            break
        time.sleep(0.05)
    assert visitors_resp.json()["active_count"] == 0


@pytest.mark.asyncio
async def test_handle_analytics_batch_with_clicks(monkeypatch):
    captured_calls = []

    async def mock_insert(events, client_ip):
        captured_calls.append({"events": events, "client_ip": client_ip})
        return len(events)

    monkeypatch.setattr(ws_visitors.db, "insert_click_events", mock_insert)

    data = {
        "type": "analytics.batch",
        "payload": {
            "topic": "clicks",
            "events": [
                {"ts": 1704067200000, "seq": 1, "element": {"tag": "button"}},
                {"ts": 1704067201000, "seq": 2, "element": {"tag": "a"}},
            ],
        },
    }

    await _handle_analytics_batch(data, "192.168.1.50")

    assert len(captured_calls) == 1
    assert captured_calls[0]["client_ip"] == "192.168.1.50"
    assert len(captured_calls[0]["events"]) == 2


@pytest.mark.asyncio
async def test_handle_analytics_batch_unknown_topic(monkeypatch):
    mock_insert = AsyncMock(return_value=0)
    monkeypatch.setattr(ws_visitors.db, "insert_click_events", mock_insert)

    data = {
        "type": "analytics.batch",
        "payload": {
            "topic": "unknown_topic",
            "events": [{"ts": 1704067200000}],
        },
    }

    await _handle_analytics_batch(data, "192.168.1.51")

    mock_insert.assert_not_called()


@pytest.mark.asyncio
async def test_handle_analytics_batch_empty_events(monkeypatch):
    mock_insert = AsyncMock(return_value=0)
    monkeypatch.setattr(ws_visitors.db, "insert_click_events", mock_insert)

    data = {
        "type": "analytics.batch",
        "payload": {
            "topic": "clicks",
            "events": [],
        },
    }

    await _handle_analytics_batch(data, "192.168.1.52")

    mock_insert.assert_not_called()


@pytest.mark.asyncio
async def test_handle_analytics_batch_database_error(monkeypatch):
    mock_insert = AsyncMock(side_effect=Exception("Database connection failed"))
    monkeypatch.setattr(ws_visitors.db, "insert_click_events", mock_insert)

    data = {
        "type": "analytics.batch",
        "payload": {
            "topic": "clicks",
            "events": [{"ts": 1704067200000, "seq": 1}],
        },
    }

    await _handle_analytics_batch(data, "192.168.1.53")

    mock_insert.assert_called_once()


def test_websocket_non_json_message_ignored(client, monkeypatch):
    headers = {"x-forwarded-for": "192.168.1.52"}

    class DummyPubSub:
        async def subscribe(self, _channel: str):
            return True

        async def unsubscribe(self, _channel: str):
            return True

        async def close(self):
            return True

        async def aclose(self):
            return True

        async def listen(self):
            while True:
                await asyncio.sleep(10)
                yield {"type": "message", "data": "{}"}

    monkeypatch.setattr(main.redis_client, "pubsub", lambda: DummyPubSub())

    mock_insert = AsyncMock(return_value=0)
    monkeypatch.setattr(ws_visitors.db, "insert_click_events", mock_insert)

    with client.websocket_connect("/ws/visitors", headers=headers) as ws:
        ws.send_text("hello world")
        ws.send_text("not valid json {{{")
        ws.send_text("pong")
        time.sleep(0.1)

    mock_insert.assert_not_called()
