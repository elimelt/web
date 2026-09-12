import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, WebSocketDisconnect
from fastapi.testclient import TestClient

from api import security, safe_fetch
from api.controllers import ws_canvas as canvas


def test_forwarded_ip_requires_known_proxy(monkeypatch):
    request = SimpleNamespace(client=SimpleNamespace(host="198.51.100.3"), headers={"x-forwarded-for": "<img>"})
    monkeypatch.delenv("TRUSTED_PROXY_HOST", raising=False)
    assert security.client_ip(request) == "198.51.100.3"
    monkeypatch.setenv("TRUSTED_PROXY_HOST", "caddy")
    monkeypatch.setattr(security, "_proxy_addresses", lambda *_: {"198.51.100.3"})
    assert security.client_ip(request) == "unknown"
    request.headers["x-forwarded-for"] = "203.0.113.9"
    assert security.client_ip(request) == "203.0.113.9"
    request.headers["x-forwarded-for"] = "203.0.113.9, 1.2.3.4"
    assert security.client_ip(request) == "unknown"


def test_limiter_bounds_identities_without_evicting_active_quotas():
    limiter = security.RateLimiter(1, 60, max_keys=2)
    assert limiter.allow("a")
    assert not limiter.allow("a")
    assert limiter.allow("b")
    assert not limiter.allow("c")
    assert len(limiter.entries) == 2


def stroke(owner, suffix="1"):
    return {"id": owner + "-" + suffix, "author_id": "forged-owner", "timestamp": 1,
            "color": "#fff", "width": 4, "points": [{"x": 0.1, "y": 0.2}]}


@pytest.fixture
def canvas_client(monkeypatch):
    monkeypatch.setattr(canvas, "_canvas", canvas.CanvasCRDT())
    monkeypatch.setattr(canvas, "_connected_clients", set())
    monkeypatch.setattr(canvas, "_limits", security.ConnectionLimits(128, 8))
    for name in ("_messages", "_global_messages", "_writes", "_global_writes"):
        monkeypatch.setattr(canvas, name, security.RateLimiter(100, 1))
    monkeypatch.setattr(canvas, "persist_canvas_state", AsyncMock())
    app = FastAPI()
    app.include_router(canvas.router)
    with TestClient(app) as client:
        yield client


def receive(ws, kind):
    for _ in range(10):
        message = ws.receive_json()
        if message["type"] == kind:
            return message
    raise AssertionError("Expected message not received")


def test_canvas_server_owns_identity_and_rejects_forged_deletes(canvas_client):
    with canvas_client.websocket_connect('/ws/canvas') as victim:
        victim_id = receive(victim, 'sync')['client_id']
        with canvas_client.websocket_connect('/ws/canvas') as attacker:
            attacker_id = receive(attacker, 'sync')['client_id']
            victim.send_json({'type': 'add', 'stroke': stroke(victim_id)})
            event = receive(victim, 'op')
            assert event['op']['stroke']['author_id'] == victim_id
            receive(attacker, 'op')
            attacker.send_json({'type': 'remove', 'stroke_id': victim_id + '-1', 'author_id': victim_id})
            attacker.send_json({'type': 'clear', 'author_id': victim_id})
            attacker.send_json({'type': 'add', 'stroke': stroke(attacker_id)})
            receive(attacker, 'op')
            assert victim_id + '-1' in canvas._canvas.strokes
            victim.send_json({'type': 'remove', 'stroke_id': victim_id + '-1', 'author_id': 'wrong'})
            while receive(victim, 'op')['op']['type'] != 'remove':
                pass
            assert victim_id + '-1' not in canvas._canvas.strokes


def test_canvas_malformed_inputs_do_not_poison_state(canvas_client):
    with canvas_client.websocket_connect('/ws/canvas') as ws:
        owner = receive(ws, 'sync')['client_id']
        for value in [None, [], {'id':'bad'}, {**stroke(owner), 'points': None},
                      {**stroke(owner), 'width': float('inf')},
                      {**stroke(owner), 'points': [{'x': -1, 'y': 0}]},
                      {**stroke(owner), 'points': [{'x':0, 'y':0}] * 513}]:
            ws.send_json({'type':'add', 'stroke':value})
        ws.send_json({'type':'add', 'stroke':stroke(owner)})
        receive(ws, 'op')
        assert len(canvas._canvas.visible_strokes()) == 1


def test_canvas_retention_is_bounded_and_load_discards_bad_records():
    model = canvas.CanvasCRDT()
    for i in range(520):
        model.add(canvas.validate_stroke(stroke('owner',str(i)), 'owner'))
        model.gc()
    assert len(model.strokes) <= canvas.MAX_STROKES
    assert len(model.removed) <= canvas.MAX_STROKES
    model.merge([{'id':'poison'}, {**stroke('legacy'), 'author_id':'legacy'}], [])
    assert all('timestamp' in s and 'points' in s for s in model.visible_strokes())


def test_untrusted_browser_origin_rejected(canvas_client):
    with pytest.raises(WebSocketDisconnect):
        with canvas_client.websocket_connect('/ws/canvas', headers={'origin':'https://evil.example'}):
            pass
    assert not canvas._limits.active


@pytest.mark.parametrize('address', ['127.0.0.1','10.0.0.1','169.254.169.254','::1','::ffff:127.0.0.1'])
def test_fetch_blocks_private_addresses(monkeypatch, address):
    monkeypatch.setattr(safe_fetch.socket, 'getaddrinfo', lambda *_a, **_kw: [(0,0,0,'',(address,80))])
    with pytest.raises(ValueError):
        safe_fetch.public_addresses('example.com',80)


def test_fetch_pins_dns_and_blocks_redirect_to_internal(monkeypatch):
    destinations=[]
    monkeypatch.setattr(safe_fetch, 'public_addresses', lambda host, port: ['93.184.216.34'] if host=='public.example' else (_ for _ in ()).throw(ValueError('private')))
    class Pool:
        def __init__(self, address, port, **kwargs): destinations.append(address)
        def urlopen(self, method, path, **kwargs):
            assert kwargs['redirect'] is False
            assert kwargs['headers']['Host']=='public.example'
            return SimpleNamespace(status=302,headers={'Location':'http://127.0.0.1/health'},close=lambda:None)
        def close(self): pass
    monkeypatch.setattr(safe_fetch.urllib3,'HTTPConnectionPool',Pool)
    with pytest.raises(ValueError, match='private'):
        safe_fetch.fetch_public_url('http://public.example/')
    assert destinations==['93.184.216.34']


def test_public_codex_agent_cannot_start():
    from api.agents.codex_agent import start_codex_agents
    assert asyncio.run(start_codex_agents(asyncio.Event())) == []


@pytest.mark.parametrize("token", ["", "incorrect"])
def test_worker_rejects_execution_without_private_token(monkeypatch, token):
    from api import main_worker
    monkeypatch.setenv("SANDBOX_WORKER_TOKEN", "private-test-token")
    def forbidden(*args):
        pytest.fail("Unauthorized execution reached Docker")
    monkeypatch.setattr(main_worker, "execute_python", forbidden)
    with TestClient(main_worker.app) as client:
        response = client.post("/execute", json={"code": "print(1)"}, headers={"X-Worker-Token": token})
    assert response.status_code == 403


def test_worker_accepts_only_bounded_code(monkeypatch):
    from api import main_worker
    monkeypatch.setenv("SANDBOX_WORKER_TOKEN", "private-test-token")
    calls = []
    def execute(code, agent):
        calls.append((code, agent))
        return "2", True
    monkeypatch.setattr(main_worker, "execute_python", execute)
    with TestClient(main_worker.app) as client:
        headers = {"X-Worker-Token": "private-test-token"}
        response = client.post("/execute", json={"code": "print(1+1)", "image": "attacker", "privileged": True}, headers=headers)
        assert response.json() == {"output": "2", "success": True}
        assert client.post("/execute", json={"code": "x" * 20001}, headers=headers).status_code == 422
    assert calls == [("print(1+1)", "broker")]


def test_fetch_bounds_body_and_keeps_tls_hostname(monkeypatch):
    monkeypatch.setattr(safe_fetch, "public_addresses", lambda *_: ["93.184.216.34"])
    class Response:
        status = 200
        headers = {}
        def read1(self, size, **kwargs): return b"x" * size
        def close(self): pass
    class Pool:
        def __init__(self, address, port, **kwargs):
            assert address == "93.184.216.34"
            assert kwargs["server_hostname"] == "example.com"
            assert kwargs["assert_hostname"] == "example.com"
            assert kwargs["cert_reqs"] == "CERT_REQUIRED"
        def urlopen(self, *args, **kwargs): return Response()
        def close(self): pass
    monkeypatch.setattr(safe_fetch.urllib3, "HTTPSConnectionPool", Pool)
    assert safe_fetch.fetch_public_url("https://example.com", 50) == "status=200\n" + "x" * 50


def test_legacy_long_stroke_preserves_endpoints():
    model = canvas.CanvasCRDT()
    value = stroke("legacy")
    value["author_id"] = "legacy"
    value["points"] = [{"x": i / 999, "y": 0.5} for i in range(1000)]
    model.merge([value], [])
    points = model.visible_strokes()[0]["points"]
    assert len(points) == canvas.MAX_POINTS
    assert points[0] == value["points"][0]
    assert points[-1] == value["points"][-1]
