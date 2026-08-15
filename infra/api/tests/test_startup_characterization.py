"""Characterization tests for app startup (work item W0.2).

These tests pin CURRENT behavior of api/main.py and api/main_internal.py.
They do not describe desired behavior. Do not "fix" a test here without
also changing the production read site it characterizes.

Read timing notes for the env vars covered here:

- CORS_ORIGINS, CORS_ORIGINS_REGEX: read at IMPORT time of api.main
  (main.py:62-67). The values are frozen into module constants
  (cors_origins, cors_regex, allow_credentials) and into the
  CORSMiddleware kwargs. Exact unset/set values are pinned via
  importlib.reload in test_config_resolution.py. Here we pin that the
  installed middleware matches the module constants and the parsing
  semantics.
- ENABLE_CHAT_DB: read at CALL time inside lifespan startup
  (main.py:127, main_internal.py:94). Default "0" (off).
- ENABLE_ANALYTICS_SCHEDULER: read at CALL time inside the public app
  lifespan (main.py:135). Default "1", but the scheduler only starts
  when ENABLE_CHAT_DB is also "1" (AND gate).
- ENABLE_AUGMENT_AGENT: read at CALL time inside the internal app
  lifespan (main_internal.py:101). Default "1" (on).
- ENABLE_GEMINI_AGENT: read at CALL time inside the internal app
  lifespan (main_internal.py:106). Default "0" (off).
- ENABLE_CODEX_AGENT: read at CALL time inside the internal app
  lifespan (main_internal.py:112). Default "0" (off).
"""

import os
from contextlib import contextmanager

import fakeredis.aioredis as fakeredis
import pytest
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from api import main, main_internal, state
from api.config import clear_settings_cache

ELIMELT_SUBDOMAIN_REGEX = r"https?://([a-zA-Z0-9-]+\.)?elimelt\.com"

# Flags cleared before every boot so tests are independent of outer env.
_FLAG_VARS = (
    "ENABLE_CHAT_DB",
    "ENABLE_ANALYTICS_SCHEDULER",
    "ENABLE_AUGMENT_AGENT",
    "ENABLE_GEMINI_AGENT",
    "ENABLE_CODEX_AGENT",
    "NOTES_SYNC_ENABLED",
)

# The behavioral CORS tests below only make sense when api.main was
# imported with CORS_ORIGINS / CORS_ORIGINS_REGEX unset (the baseline
# test environment). Skip them if the outer env overrides CORS.
_CORS_ENV_OVERRIDDEN = bool(
    os.environ.get("CORS_ORIGINS") or os.environ.get("CORS_ORIGINS_REGEX", "").strip()
)


class _AwaitableRedis:
    """Mirror of the conftest fake redis wrapper (main awaits the client)."""

    def __init__(self, client):
        self._client = client

    def __await__(self):
        async def _coro():
            return self._client

        return _coro().__await__()


def _fake_redis_ctor(*_args, **_kwargs):
    return _AwaitableRedis(fakeredis.FakeRedis(decode_responses=True))


class _AsyncRecorder:
    """Async callable that records calls. Used to observe startup branches."""

    def __init__(self, result=None):
        self.calls = []
        self._result = result

    @property
    def called(self):
        return bool(self.calls)

    async def __call__(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return self._result


def _apply_env(monkeypatch, env):
    for var in _FLAG_VARS:
        monkeypatch.delenv(var, raising=False)
    for key, value in (env or {}).items():
        if value is None:
            monkeypatch.delenv(key, raising=False)
        else:
            monkeypatch.setenv(key, value)


@contextmanager
def _public_app(monkeypatch, env=None):
    """Boot api.main with fakeredis, recorded startup branches, given env."""
    _apply_env(monkeypatch, env)
    clear_settings_cache()
    monkeypatch.setattr(main.redis, "Redis", _fake_redis_ctor)
    main.geoip_reader = None
    recorders = {
        "db_init_pool": _AsyncRecorder(),
        "db_close_pool": _AsyncRecorder(),
        "analytics_scheduler": _AsyncRecorder(result=[]),
    }
    monkeypatch.setattr(main.db, "init_pool", recorders["db_init_pool"])
    monkeypatch.setattr(main.db, "close_pool", recorders["db_close_pool"])
    monkeypatch.setattr(main, "start_analytics_scheduler", recorders["analytics_scheduler"])
    try:
        with TestClient(main.app) as client:
            yield client, recorders
    finally:
        clear_settings_cache()


@contextmanager
def _internal_app(monkeypatch, env=None):
    """Boot api.main_internal with fakeredis and recorded startup branches."""
    _apply_env(monkeypatch, env)
    clear_settings_cache()
    monkeypatch.setattr(main_internal.redis, "Redis", _fake_redis_ctor)
    recorders = {
        "db_init_pool": _AsyncRecorder(),
        "db_close_pool": _AsyncRecorder(),
        "augment_agent": _AsyncRecorder(result=[]),
        "gemini_agent": _AsyncRecorder(result=[]),
        "codex_agent": _AsyncRecorder(result=[]),
        "notes_sync_scheduler": _AsyncRecorder(result=[]),
    }
    monkeypatch.setattr(main_internal.db, "init_pool", recorders["db_init_pool"])
    monkeypatch.setattr(main_internal.db, "close_pool", recorders["db_close_pool"])
    monkeypatch.setattr(main_internal, "start_augment_agent", recorders["augment_agent"])
    monkeypatch.setattr(main_internal, "start_gemini_agents", recorders["gemini_agent"])
    monkeypatch.setattr(main_internal, "start_codex_agents", recorders["codex_agent"])
    monkeypatch.setattr(
        main_internal, "start_notes_sync_scheduler", recorders["notes_sync_scheduler"]
    )
    try:
        with TestClient(main_internal.app) as client:
            yield client, recorders
    finally:
        clear_settings_cache()


def _cors_kwargs(app):
    for mw in app.user_middleware:
        if mw.cls is CORSMiddleware:
            return dict(mw.kwargs)
    raise AssertionError("CORSMiddleware not installed")


# ---------------------------------------------------------------------------
# Public app (api/main.py)
# ---------------------------------------------------------------------------


class TestPublicStartupState:
    def test_redis_state_set_during_lifespan_and_cleared_after(self, monkeypatch):
        with _public_app(monkeypatch) as (_client, _recorders):
            assert state.redis_client is not None
            assert state.event_bus is not None
            assert main.redis_client is state.redis_client
        # Shutdown clears the shared state module (main.py:227-229).
        assert state.redis_client is None
        assert state.event_bus is None
        assert state.geoip_reader is None

    def test_geoip_reader_stays_none_when_default_path_missing(self, monkeypatch):
        # GEOIP_DB_PATH is read at CALL time in lifespan (main.py:119).
        # Precondition: the default path does not exist on this machine.
        assert not os.path.exists("/app/GeoLite2-City.mmdb")
        with _public_app(monkeypatch, env={"GEOIP_DB_PATH": None}) as (_client, _recorders):
            assert state.geoip_reader is None


class TestPublicCors:
    def test_middleware_kwargs_match_module_constants(self):
        kwargs = _cors_kwargs(main.app)
        assert kwargs["allow_origins"] == main.cors_origins
        assert kwargs["allow_origin_regex"] == main.cors_regex
        assert kwargs["allow_credentials"] == main.allow_credentials
        assert kwargs["allow_methods"] == ["*"]
        assert kwargs["allow_headers"] == ["*"]

    def test_module_constants_follow_read_site_semantics(self):
        # Recompute expected values with the exact main.py:62-67 formula,
        # from the same process env the module was imported under.
        raw = os.getenv("CORS_ORIGINS", "http://localhost:3000")
        expected_origins = [o.strip() for o in raw.split(",") if o.strip()]
        regex_env = os.getenv("CORS_ORIGINS_REGEX", "").strip()
        expected_regex = regex_env if regex_env else ELIMELT_SUBDOMAIN_REGEX
        assert main.cors_origins == expected_origins
        assert main.cors_regex == expected_regex

    def test_allow_credentials_is_always_false(self):
        # main.py:67 checks "cors_regex is None", but cors_regex is always
        # a str (env value or the elimelt default). So allow_credentials
        # is False under every configuration today. Pin that quirk.
        assert isinstance(main.cors_regex, str)
        assert main.allow_credentials is False

    @pytest.mark.skipif(_CORS_ENV_OVERRIDDEN, reason="CORS env overridden at import time")
    def test_default_regex_allows_elimelt_subdomains(self, monkeypatch):
        with _public_app(monkeypatch) as (client, _recorders):
            resp = client.get("/health", headers={"Origin": "https://foo.elimelt.com"})
            assert resp.status_code == 200
            assert resp.headers.get("access-control-allow-origin") == "https://foo.elimelt.com"

    @pytest.mark.skipif(_CORS_ENV_OVERRIDDEN, reason="CORS env overridden at import time")
    def test_default_config_rejects_unrelated_origin(self, monkeypatch):
        with _public_app(monkeypatch) as (client, _recorders):
            resp = client.get("/health", headers={"Origin": "https://evil.example"})
            assert resp.status_code == 200
            assert "access-control-allow-origin" not in resp.headers


class TestPublicFeatureFlags:
    def test_defaults_no_db_and_no_analytics(self, monkeypatch):
        # ENABLE_CHAT_DB defaults to "0" (main.py:127), so db.init_pool is
        # not called. ENABLE_ANALYTICS_SCHEDULER defaults to "1"
        # (main.py:135) but the scheduler is AND-gated on enable_db, so it
        # does not start either.
        with _public_app(monkeypatch) as (_client, recorders):
            pass
        assert not recorders["db_init_pool"].called
        assert not recorders["db_close_pool"].called
        assert not recorders["analytics_scheduler"].called

    def test_chat_db_on_starts_db_and_analytics_by_default(self, monkeypatch):
        with _public_app(monkeypatch, env={"ENABLE_CHAT_DB": "1"}) as (_client, recorders):
            pass
        assert recorders["db_init_pool"].called
        # ENABLE_ANALYTICS_SCHEDULER unset resolves to "1", so with db on
        # the scheduler starts.
        assert recorders["analytics_scheduler"].called
        # Shutdown closes the pool when enable_db was true (main.py:212-216).
        assert recorders["db_close_pool"].called

    def test_analytics_scheduler_flag_off_disables_scheduler(self, monkeypatch):
        env = {"ENABLE_CHAT_DB": "1", "ENABLE_ANALYTICS_SCHEDULER": "0"}
        with _public_app(monkeypatch, env=env) as (_client, recorders):
            pass
        assert recorders["db_init_pool"].called
        assert not recorders["analytics_scheduler"].called

    def test_analytics_scheduler_gated_by_chat_db(self, monkeypatch):
        # Explicit ENABLE_ANALYTICS_SCHEDULER=1 still does nothing while
        # ENABLE_CHAT_DB stays at its "0" default (main.py:136 AND gate).
        with _public_app(monkeypatch, env={"ENABLE_ANALYTICS_SCHEDULER": "1"}) as (
            _client,
            recorders,
        ):
            pass
        assert not recorders["analytics_scheduler"].called
        assert not recorders["db_init_pool"].called


# ---------------------------------------------------------------------------
# Internal app (api/main_internal.py)
# ---------------------------------------------------------------------------


class TestInternalStartupState:
    def test_redis_state_set_during_lifespan_and_cleared_after(self, monkeypatch):
        with _internal_app(monkeypatch) as (_client, _recorders):
            assert state.redis_client is not None
            assert state.event_bus is not None
            assert main_internal.redis_client is state.redis_client
        assert state.redis_client is None
        assert state.event_bus is None


class TestInternalCors:
    def test_cors_is_hardcoded_wildcard_without_credentials(self):
        # main_internal.py:46-52: no env reads, wildcard origins, no regex,
        # credentials off.
        kwargs = _cors_kwargs(main_internal.app)
        assert kwargs["allow_origins"] == ["*"]
        assert kwargs["allow_credentials"] is False
        assert kwargs["allow_methods"] == ["*"]
        assert kwargs["allow_headers"] == ["*"]
        assert "allow_origin_regex" not in kwargs

    def test_any_origin_gets_wildcard_header(self, monkeypatch):
        with _internal_app(monkeypatch) as (client, _recorders):
            resp = client.get("/health", headers={"Origin": "https://anything.example"})
            assert resp.status_code == 200
            assert resp.headers.get("access-control-allow-origin") == "*"


class TestInternalFeatureFlags:
    def test_defaults(self, monkeypatch):
        # Today's defaults at the internal read sites:
        #   ENABLE_CHAT_DB       "0" -> db.init_pool not called   (line 94)
        #   ENABLE_AUGMENT_AGENT "1" -> augment agent starts      (line 101)
        #   ENABLE_GEMINI_AGENT  "0" -> gemini agents do not start (line 106)
        #   ENABLE_CODEX_AGENT   "0" -> codex agents do not start (line 112)
        #   NOTES_SYNC_ENABLED   "1" but AND-gated on enable_db   (line 118-119)
        with _internal_app(monkeypatch) as (_client, recorders):
            pass
        assert not recorders["db_init_pool"].called
        assert recorders["augment_agent"].called
        assert not recorders["gemini_agent"].called
        assert not recorders["codex_agent"].called
        assert not recorders["notes_sync_scheduler"].called

    def test_flags_inverted_from_defaults(self, monkeypatch):
        env = {
            "ENABLE_CHAT_DB": "1",
            "ENABLE_AUGMENT_AGENT": "0",
            "ENABLE_GEMINI_AGENT": "1",
            "ENABLE_CODEX_AGENT": "1",
        }
        with _internal_app(monkeypatch, env=env) as (_client, recorders):
            pass
        assert recorders["db_init_pool"].called
        assert not recorders["augment_agent"].called
        assert recorders["gemini_agent"].called
        assert recorders["codex_agent"].called
        # NOTES_SYNC_ENABLED unset resolves to "1"; with db on, the notes
        # sync scheduler starts.
        assert recorders["notes_sync_scheduler"].called
        assert recorders["db_close_pool"].called
