import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

import fakeredis.aioredis as fakeredis
import pytest
from fastapi.testclient import TestClient

from api import main, main_internal


class _AwaitableRedis:
    def __init__(self, client):
        self._client = client

    def __await__(self):
        async def _coro():
            return self._client

        return _coro().__await__()


@pytest.fixture
def client(monkeypatch):
    def fake_redis_constructor(*_args, **_kwargs):
        fake = fakeredis.FakeRedis(decode_responses=True)
        return _AwaitableRedis(fake)

    monkeypatch.setattr(main.redis, "Redis", fake_redis_constructor)
    main.geoip_reader = None

    with TestClient(main.app) as c:
        yield c


@pytest.fixture
def internal_client(monkeypatch):
    def fake_redis_constructor(*_args, **_kwargs):
        fake = fakeredis.FakeRedis(decode_responses=True)
        return _AwaitableRedis(fake)

    monkeypatch.setattr(main_internal.redis, "Redis", fake_redis_constructor)

    with TestClient(main_internal.app) as c:
        yield c
