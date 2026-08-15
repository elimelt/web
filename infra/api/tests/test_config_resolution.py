"""Characterization tests for env var config resolution (work item W0.2).

These tests pin the CURRENT effective value of each env var in the
migration list, under (a) unset env and (b) a representative set value.
The expected values are unchanged from the original os.getenv read
sites. Since W4.1 the read sites resolve these vars through the cached
get_settings() accessor, so the test mechanics clear the settings cache
wherever env is patched. Read timing (import vs call) is unchanged.

Read timing per var:

- CORS_ORIGINS        IMPORT time  api/main.py:62-63 (module constants)
- CORS_ORIGINS_REGEX  IMPORT time  api/main.py:64-66 (module constants)
- GEOIP_DB_PATH       CALL time    api/main.py:119 (inside lifespan startup)
- ENABLE_CHAT_DB      CALL time    api/main.py:127, api/main_internal.py:94
- SANDBOX_IMAGE       IMPORT time  api/sandbox/__init__.py:11 (constant)
                      CALL time    api/controllers/agents_status.py:40
- SANDBOX_TIMEOUT_SEC IMPORT time  api/sandbox/__init__.py:12 (constant)
                      CALL time    api/controllers/agents_status.py:43
- NOTES_SYNC_SECRET   IMPORT time  api/controllers/notes.py:21 and
                                   api/controllers/notes_search.py:15
- GITHUB_TOKEN        CALL time    api/controllers/notes.py:148,171,188 and
                                   api/batch/notes_sync_scheduler.py:11
- ENABLE_ANALYTICS_SCHEDULER  CALL time  api/main.py:135
- ENABLE_AUGMENT_AGENT        CALL time  api/main_internal.py:101
- ENABLE_GEMINI_AGENT         CALL time  api/main_internal.py:106
- ENABLE_CODEX_AGENT          CALL time  api/main_internal.py:112

IMPORT-time vars are pinned by reloading the owning module inside a
context manager that sets env first and restores env plus module state
afterward, so tests stay hermetic and order independent. CALL-time vars
are pinned with monkeypatch around the call (app startup or a direct
handler call).

The lru_cache is cleared around every test, reload, and boot here so no
stale Settings instance leaks between tests.
"""

import importlib
import os
from contextlib import contextmanager

import fakeredis.aioredis as fakeredis
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import api.batch.notes_sync_scheduler as notes_sync_scheduler
import api.controllers.agents_status as agents_status_module
import api.controllers.notes as notes
import api.controllers.notes_search as notes_search
import api.sandbox as sandbox
from api import main, main_internal, state
from api.config import clear_settings_cache

ELIMELT_SUBDOMAIN_REGEX = r"https?://([a-zA-Z0-9-]+\.)?elimelt\.com"

_FLAG_VARS = (
    "ENABLE_CHAT_DB",
    "ENABLE_ANALYTICS_SCHEDULER",
    "ENABLE_AUGMENT_AGENT",
    "ENABLE_GEMINI_AGENT",
    "ENABLE_CODEX_AGENT",
    "NOTES_SYNC_ENABLED",
)


@pytest.fixture(autouse=True)
def _fresh_settings_cache():
    """Isolate the lru_cached Settings singleton per test.

    Read sites now go through get_settings(), so a cache entry built under
    one test's env must not leak into another test.
    """
    clear_settings_cache()
    yield
    clear_settings_cache()


# ---------------------------------------------------------------------------
# Helpers (mirrors of the conftest fixture pattern, plus a reload harness)
# ---------------------------------------------------------------------------


class _AwaitableRedis:
    def __init__(self, client):
        self._client = client

    def __await__(self):
        async def _coro():
            return self._client

        return _coro().__await__()


def _fake_redis_ctor(*_args, **_kwargs):
    return _AwaitableRedis(fakeredis.FakeRedis(decode_responses=True))


class _AsyncRecorder:
    def __init__(self, result=None):
        self.calls = []
        self._result = result

    @property
    def called(self):
        return bool(self.calls)

    async def __call__(self, *args, **kwargs):
        self.calls.append((args, kwargs))
        return self._result


@contextmanager
def _reloaded(module, env):
    """Reload `module` with `env` applied, then restore env and reload back.

    `env` maps var name to a string value, or to None to unset the var.
    The final reload runs under the restored env, so the module returns to
    the exact state other tests observe. This keeps import-time tests
    hermetic and order independent.
    """
    saved = {key: os.environ.get(key) for key in env}
    try:
        for key, value in env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        clear_settings_cache()
        importlib.reload(module)
        yield module
    finally:
        for key, value in saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        # Clear BEFORE the restoring reload: the reload re-runs module-level
        # get_settings() reads, which must not see the test-env cache entry.
        clear_settings_cache()
        importlib.reload(module)
        clear_settings_cache()


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


# ---------------------------------------------------------------------------
# CORS_ORIGINS / CORS_ORIGINS_REGEX (import time, api/main.py:62-67)
# ---------------------------------------------------------------------------


class TestCorsOrigins:
    def test_unset_defaults_to_localhost_3000(self):
        with _reloaded(main, {"CORS_ORIGINS": None, "CORS_ORIGINS_REGEX": None}):
            assert main.cors_origins == ["http://localhost:3000"]
            assert main.cors_regex == ELIMELT_SUBDOMAIN_REGEX
            assert main.allow_credentials is False

    def test_set_splits_on_comma_strips_and_drops_empties(self):
        env = {
            "CORS_ORIGINS": "https://a.example, https://b.example ,,",
            "CORS_ORIGINS_REGEX": None,
        }
        with _reloaded(main, env):
            assert main.cors_origins == ["https://a.example", "https://b.example"]
            assert main.cors_regex == ELIMELT_SUBDOMAIN_REGEX

    def test_wildcard_still_disables_credentials(self):
        # allow_credentials = cors_origins != ["*"] and cors_regex is None.
        # cors_regex is always a str, so credentials are False in every
        # configuration today, wildcard or not.
        with _reloaded(main, {"CORS_ORIGINS": "*", "CORS_ORIGINS_REGEX": None}):
            assert main.cors_origins == ["*"]
            assert main.allow_credentials is False


class TestCorsOriginsRegex:
    def test_unset_falls_back_to_elimelt_subdomain_regex(self):
        with _reloaded(main, {"CORS_ORIGINS_REGEX": None}):
            assert main.cors_regex == ELIMELT_SUBDOMAIN_REGEX

    def test_set_value_is_stripped_and_used(self):
        with _reloaded(main, {"CORS_ORIGINS_REGEX": r"  https://x\.example  "}):
            assert main.cors_regex == r"https://x\.example"
            assert main.allow_credentials is False

    def test_whitespace_only_value_falls_back_to_default(self):
        with _reloaded(main, {"CORS_ORIGINS_REGEX": "   "}):
            assert main.cors_regex == ELIMELT_SUBDOMAIN_REGEX


# ---------------------------------------------------------------------------
# GEOIP_DB_PATH (call time, api/main.py:119, inside lifespan startup)
# ---------------------------------------------------------------------------


class TestGeoipDbPath:
    def test_unset_reads_default_path_at_startup(self, monkeypatch):
        real_exists = os.path.exists
        checked = []

        def recording_exists(path):
            checked.append(path)
            return real_exists(path)

        monkeypatch.setattr(main.os.path, "exists", recording_exists)
        with _public_app(monkeypatch, env={"GEOIP_DB_PATH": None}) as (_client, _recorders):
            assert "/app/GeoLite2-City.mmdb" in checked
            # Default path does not exist here, so no reader is created.
            assert state.geoip_reader is None

    def test_set_missing_path_leaves_reader_none(self, monkeypatch):
        env = {"GEOIP_DB_PATH": "/tmp/definitely-missing-geoip.mmdb"}
        with _public_app(monkeypatch, env=env) as (_client, _recorders):
            assert state.geoip_reader is None

    def test_set_existing_path_opens_reader_at_that_path(self, monkeypatch, tmp_path):
        db_file = tmp_path / "geo.mmdb"
        db_file.write_bytes(b"stub")

        class FakeReader:
            def __init__(self, path):
                self.path = path
                self.closed = False

            def close(self):
                self.closed = True

        monkeypatch.setattr(main.geoip2.database, "Reader", FakeReader)
        with _public_app(monkeypatch, env={"GEOIP_DB_PATH": str(db_file)}) as (
            _client,
            _recorders,
        ):
            assert isinstance(state.geoip_reader, FakeReader)
            assert state.geoip_reader.path == str(db_file)
        # Shutdown closes the reader and clears shared state.
        assert state.geoip_reader is None


# ---------------------------------------------------------------------------
# ENABLE_CHAT_DB (call time, api/main.py:127 and api/main_internal.py:94)
# ---------------------------------------------------------------------------


class TestEnableChatDb:
    def test_unset_defaults_off_public(self, monkeypatch):
        with _public_app(monkeypatch) as (_client, recorders):
            pass
        assert not recorders["db_init_pool"].called

    def test_set_1_enables_db_public(self, monkeypatch):
        with _public_app(monkeypatch, env={"ENABLE_CHAT_DB": "1"}) as (_client, recorders):
            pass
        assert recorders["db_init_pool"].called

    def test_unset_defaults_off_internal(self, monkeypatch):
        with _internal_app(monkeypatch) as (_client, recorders):
            pass
        assert not recorders["db_init_pool"].called

    def test_set_1_enables_db_internal(self, monkeypatch):
        with _internal_app(monkeypatch, env={"ENABLE_CHAT_DB": "1"}) as (_client, recorders):
            pass
        assert recorders["db_init_pool"].called

    def test_truthy_strings_other_than_1_stay_off(self, monkeypatch):
        # Every flag read site in this list compares os.getenv(...) == "1"
        # exactly. "true", "yes" etc. resolve to OFF today. Pin with one
        # representative value.
        with _public_app(monkeypatch, env={"ENABLE_CHAT_DB": "true"}) as (_client, recorders):
            pass
        assert not recorders["db_init_pool"].called


# ---------------------------------------------------------------------------
# SANDBOX_IMAGE / SANDBOX_TIMEOUT_SEC
# (import time in api/sandbox/__init__.py:11-12,
#  call time in api/controllers/agents_status.py:40,43)
# ---------------------------------------------------------------------------


class TestSandboxImportTimeConstants:
    def test_unset_defaults(self):
        env = {"SANDBOX_IMAGE": None, "SANDBOX_TIMEOUT_SEC": None}
        with _reloaded(sandbox, env):
            assert sandbox.SANDBOX_IMAGE == "devstack-python-sandbox:latest"
            assert sandbox.SANDBOX_TIMEOUT == 30

    def test_set_values(self):
        env = {"SANDBOX_IMAGE": "custom-sandbox:9", "SANDBOX_TIMEOUT_SEC": "77"}
        with _reloaded(sandbox, env):
            assert sandbox.SANDBOX_IMAGE == "custom-sandbox:9"
            # int() coercion happens at import time.
            assert sandbox.SANDBOX_TIMEOUT == 77


class TestSandboxCallTimeReadsInAgentsStatus:
    async def test_unset_defaults(self, monkeypatch):
        monkeypatch.setattr("api.sandbox.is_sandbox_available", lambda: True)
        monkeypatch.delenv("SANDBOX_IMAGE", raising=False)
        monkeypatch.delenv("SANDBOX_TIMEOUT_SEC", raising=False)
        monkeypatch.delenv("SANDBOX_ENABLED", raising=False)
        body = await agents_status_module.agents_status()
        info = body["tools"]["sandbox"]
        assert info["enabled"] is True  # SANDBOX_ENABLED defaults to "1"
        assert info["image"] == "devstack-python-sandbox:latest"
        assert info["timeout_sec"] == 30

    async def test_set_values_read_fresh_at_call_time(self, monkeypatch):
        monkeypatch.setattr("api.sandbox.is_sandbox_available", lambda: True)
        monkeypatch.setenv("SANDBOX_IMAGE", "custom-sandbox:9")
        monkeypatch.setenv("SANDBOX_TIMEOUT_SEC", "45")
        monkeypatch.delenv("SANDBOX_ENABLED", raising=False)
        body = await agents_status_module.agents_status()
        info = body["tools"]["sandbox"]
        assert info["image"] == "custom-sandbox:9"
        assert info["timeout_sec"] == 45
        # The api.sandbox module constants were frozen at import time and
        # do NOT see the new env values. Two read timings coexist today.
        assert sandbox.SANDBOX_IMAGE == "devstack-python-sandbox:latest"
        assert sandbox.SANDBOX_TIMEOUT == 30


# ---------------------------------------------------------------------------
# NOTES_SYNC_SECRET (import time, notes.py:21 and notes_search.py:15)
# ---------------------------------------------------------------------------


class TestNotesSyncSecret:
    def test_unset_defaults_to_empty_string(self):
        env = {"NOTES_SYNC_SECRET": None}
        with _reloaded(notes, env):
            assert notes.NOTES_SYNC_SECRET == ""
        with _reloaded(notes_search, env):
            assert notes_search.NOTES_SYNC_SECRET == ""

    def test_set_value_frozen_into_both_module_constants(self):
        env = {"NOTES_SYNC_SECRET": "s3cr3t"}
        with _reloaded(notes, env):
            assert notes.NOTES_SYNC_SECRET == "s3cr3t"
        with _reloaded(notes_search, env):
            assert notes_search.NOTES_SYNC_SECRET == "s3cr3t"

    def test_empty_secret_makes_sync_endpoints_503(self):
        with _reloaded(notes, {"NOTES_SYNC_SECRET": None}):
            with pytest.raises(HTTPException) as exc:
                notes._validate_sync_secret("anything")
            assert exc.value.status_code == 503

    def test_set_secret_wrong_header_is_401_right_header_passes(self):
        with _reloaded(notes, {"NOTES_SYNC_SECRET": "s3cr3t"}):
            with pytest.raises(HTTPException) as exc:
                notes._validate_sync_secret("wrong")
            assert exc.value.status_code == 401
            assert notes._validate_sync_secret("s3cr3t") is None


# ---------------------------------------------------------------------------
# GITHUB_TOKEN (call time, notes.py:148,171,188 and notes_sync_scheduler.py:11)
# ---------------------------------------------------------------------------


class TestGithubToken:
    async def test_scheduler_run_sync_job_unset_passes_none(self, monkeypatch):
        recorder = _AsyncRecorder(result={"job_status": "completed"})
        monkeypatch.setattr(notes_sync_scheduler, "sync_notes_with_job", recorder)
        monkeypatch.delenv("GITHUB_TOKEN", raising=False)
        await notes_sync_scheduler.run_sync_job(force=False)
        assert recorder.calls == [((), {"token": None, "force": False})]

    async def test_scheduler_run_sync_job_set_passes_value(self, monkeypatch):
        recorder = _AsyncRecorder(result={"job_status": "completed"})
        monkeypatch.setattr(notes_sync_scheduler, "sync_notes_with_job", recorder)
        monkeypatch.setenv("GITHUB_TOKEN", "ghp_test123")
        await notes_sync_scheduler.run_sync_job(force=True)
        assert recorder.calls == [((), {"token": "ghp_test123", "force": True})]

    async def test_trigger_sync_reads_token_at_call_time(self, monkeypatch):
        # notes.py:148. NOTES_SYNC_SECRET module constant is patched at the
        # attribute level (its import-time read is pinned above).
        monkeypatch.setattr(notes, "NOTES_SYNC_SECRET", "s")
        recorder = _AsyncRecorder(result={"job_status": "completed"})
        monkeypatch.setattr(notes, "sync_notes_with_job", recorder)

        monkeypatch.delenv("GITHUB_TOKEN", raising=False)
        await notes.trigger_sync(force=False, x_sync_secret="s")
        assert recorder.calls[-1] == ((), {"token": None, "force": False})

        monkeypatch.setenv("GITHUB_TOKEN", "ghp_test123")
        clear_settings_cache()  # read goes through cached get_settings() now
        await notes.trigger_sync(force=True, x_sync_secret="s")
        assert recorder.calls[-1] == ((), {"token": "ghp_test123", "force": True})

    async def test_resume_sync_job_reads_token_at_call_time(self, monkeypatch):
        # notes.py:171.
        monkeypatch.setattr(notes, "NOTES_SYNC_SECRET", "s")
        recorder = _AsyncRecorder(result={"job_status": "running"})
        monkeypatch.setattr(notes, "sync_notes_with_job", recorder)
        monkeypatch.setattr(notes.db, "sync_job_get", _AsyncRecorder(result={"status": "paused"}))

        monkeypatch.delenv("GITHUB_TOKEN", raising=False)
        await notes.resume_sync_job(7, x_sync_secret="s")
        assert recorder.calls[-1] == ((), {"token": None, "resume_job_id": 7})

        monkeypatch.setenv("GITHUB_TOKEN", "ghp_test123")
        clear_settings_cache()  # read goes through cached get_settings() now
        await notes.resume_sync_job(7, x_sync_secret="s")
        assert recorder.calls[-1] == ((), {"token": "ghp_test123", "resume_job_id": 7})

    async def test_retry_failed_items_reads_token_at_call_time(self, monkeypatch):
        # notes.py:188.
        monkeypatch.setattr(notes, "NOTES_SYNC_SECRET", "s")
        recorder = _AsyncRecorder(result={"retried": 0})
        monkeypatch.setattr(notes, "retry_failed_items", recorder)
        monkeypatch.setattr(notes.db, "sync_job_get", _AsyncRecorder(result={"status": "failed"}))

        monkeypatch.delenv("GITHUB_TOKEN", raising=False)
        await notes.retry_failed_job_items(7, x_sync_secret="s")
        assert recorder.calls[-1] == ((7,), {"token": None})

        monkeypatch.setenv("GITHUB_TOKEN", "ghp_test123")
        clear_settings_cache()  # read goes through cached get_settings() now
        await notes.retry_failed_job_items(7, x_sync_secret="s")
        assert recorder.calls[-1] == ((7,), {"token": "ghp_test123"})


# ---------------------------------------------------------------------------
# ENABLE_ANALYTICS_SCHEDULER (call time, api/main.py:135)
# ---------------------------------------------------------------------------


class TestEnableAnalyticsScheduler:
    def test_unset_defaults_on_when_db_enabled(self, monkeypatch):
        with _public_app(monkeypatch, env={"ENABLE_CHAT_DB": "1"}) as (_client, recorders):
            pass
        assert recorders["analytics_scheduler"].called

    def test_set_0_disables(self, monkeypatch):
        env = {"ENABLE_CHAT_DB": "1", "ENABLE_ANALYTICS_SCHEDULER": "0"}
        with _public_app(monkeypatch, env=env) as (_client, recorders):
            pass
        assert not recorders["analytics_scheduler"].called


# ---------------------------------------------------------------------------
# ENABLE_AUGMENT_AGENT / ENABLE_GEMINI_AGENT / ENABLE_CODEX_AGENT
# (call time, api/main_internal.py:101,106,112)
# ---------------------------------------------------------------------------


class TestInternalAgentFlags:
    @pytest.mark.parametrize(
        ("var", "recorder_key", "default_on"),
        [
            ("ENABLE_AUGMENT_AGENT", "augment_agent", True),
            ("ENABLE_GEMINI_AGENT", "gemini_agent", False),
            ("ENABLE_CODEX_AGENT", "codex_agent", False),
        ],
    )
    def test_unset_uses_read_site_default(self, monkeypatch, var, recorder_key, default_on):
        with _internal_app(monkeypatch, env={var: None}) as (_client, recorders):
            pass
        assert recorders[recorder_key].called is default_on

    @pytest.mark.parametrize(
        ("var", "recorder_key", "default_on"),
        [
            ("ENABLE_AUGMENT_AGENT", "augment_agent", True),
            ("ENABLE_GEMINI_AGENT", "gemini_agent", False),
            ("ENABLE_CODEX_AGENT", "codex_agent", False),
        ],
    )
    def test_set_opposite_flips_branch(self, monkeypatch, var, recorder_key, default_on):
        value = "0" if default_on else "1"
        with _internal_app(monkeypatch, env={var: value}) as (_client, recorders):
            pass
        assert recorders[recorder_key].called is (not default_on)
