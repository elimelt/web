"""Tests for the Python sandbox execution functionality.

Tests cover:
1. Unit tests for sandbox module functions
2. Tool layer integration tests
3. Docker container execution (requires Docker)
"""

import os
import time
from unittest.mock import MagicMock, patch

import pytest


class TestSandboxModuleUnit:
    """Unit tests for sandbox/__init__.py functions (no Docker required)."""

    def test_rate_limit_allows_initial_requests(self):
        """Test that rate limiter allows requests under the limit."""
        from api.sandbox import _check_rate_limit, _rate_limits

        _rate_limits.clear()
        agent_id = "test_agent_rate"

        # Should allow first 10 requests
        for i in range(10):
            assert _check_rate_limit(agent_id) is True, f"Request {i+1} should be allowed"

    def test_rate_limit_blocks_excess_requests(self):
        """Test that rate limiter blocks requests over the limit."""
        from api.sandbox import RATE_LIMIT_MAX_EXECUTIONS, _check_rate_limit, _rate_limits

        _rate_limits.clear()
        agent_id = "test_agent_excess"

        # Exhaust the limit
        for _ in range(RATE_LIMIT_MAX_EXECUTIONS):
            _check_rate_limit(agent_id)

        # Next request should be blocked
        assert _check_rate_limit(agent_id) is False

    def test_rate_limit_resets_after_window(self):
        """Test that rate limit resets after the window expires."""
        from api.sandbox import RATE_LIMIT_WINDOW, _check_rate_limit, _rate_limits

        _rate_limits.clear()
        agent_id = "test_agent_reset"

        # Add timestamps from the past (outside the window)
        old_time = time.time() - RATE_LIMIT_WINDOW - 10
        _rate_limits[agent_id] = [old_time] * 10

        # Should allow new request since old ones are expired
        assert _check_rate_limit(agent_id) is True

    def test_caching_returns_cached_result(self):
        """Test that identical code returns cached results."""
        from api.sandbox import (
            _cache_result,
            _get_cached_result,
            _result_cache,
        )

        _result_cache.clear()
        code = "print('hello')"
        result = "hello\n"

        _cache_result(code, result, True)
        cached = _get_cached_result(code)

        assert cached is not None
        assert cached[0] == result
        assert cached[1] is True

    def test_caching_expires_after_ttl(self):
        """Test that cache expires after TTL."""
        from api.sandbox import CACHE_TTL, _get_cached_result, _result_cache

        _result_cache.clear()
        code = "print('expired')"
        code_hash = __import__("hashlib").sha256(code.encode()).hexdigest()

        # Insert with old timestamp
        _result_cache[code_hash] = ("output", True, time.time() - CACHE_TTL - 10)

        cached = _get_cached_result(code)
        assert cached is None

    def test_cache_eviction_on_max_size(self):
        """Test that cache evicts old entries when full."""
        from api.sandbox import CACHE_MAX_SIZE, _cache_result, _result_cache

        _result_cache.clear()

        # Fill cache to max
        for i in range(CACHE_MAX_SIZE + 5):
            _cache_result(f"code_{i}", f"result_{i}", True)

        assert len(_result_cache) <= CACHE_MAX_SIZE

    def test_execution_log_stores_entries(self):
        """Test that execution log stores entries correctly."""
        from api.sandbox import _execution_log, _log_execution

        initial_len = len(_execution_log)
        _log_execution("test_agent", "print(1)", "1\n", True, 100)

        assert len(_execution_log) == initial_len + 1
        entry = _execution_log[-1]
        assert entry["agent_id"] == "test_agent"
        assert entry["success"] is True
        assert entry["duration_ms"] == 100

    def test_execution_log_limits_size(self):
        """Test that execution log limits its size to 1000 entries."""
        from api.sandbox import _execution_log, _log_execution

        _execution_log.clear()
        for i in range(1005):
            _log_execution(f"agent_{i}", f"code_{i}", f"result_{i}", True, i)

        assert len(_execution_log) == 1000

    def test_get_execution_log_returns_recent(self):
        """Test that get_execution_log returns recent entries."""
        from api.sandbox import _execution_log, _log_execution, get_execution_log

        _execution_log.clear()
        for i in range(10):
            _log_execution(f"agent_{i}", f"code_{i}", f"result_{i}", True, i)

        log = get_execution_log(limit=5)
        assert len(log) == 5
        assert log[-1]["agent_id"] == "agent_9"

    def test_execute_python_disabled(self):
        """Test execute_python when sandbox is disabled."""
        from api import sandbox

        with patch.object(sandbox, "SANDBOX_ENABLED", False):
            result, success = sandbox.execute_python("print(1)")
            assert success is False
            assert "disabled" in result.lower()

    def test_execute_python_empty_code(self):
        """Test execute_python with empty code."""
        from api.sandbox import execute_python

        result, success = execute_python("")
        assert success is False
        assert "no code" in result.lower()

        result2, success2 = execute_python("   ")
        assert success2 is False


class TestSandboxToolLayer:
    """Tests for the tool layer (api/agents/tools.py)."""

    @pytest.mark.asyncio
    async def test_run_python_async_empty_code(self):
        """Test run_python_async with empty code."""
        from api.agents.tools import run_python_async

        result = await run_python_async("")
        assert "ERROR" in result

    @pytest.mark.asyncio
    async def test_run_python_async_sandbox_unavailable(self):
        """Test run_python_async when sandbox is unavailable."""
        # Patch at the location where it's imported
        with patch("api.sandbox.is_sandbox_available", return_value=False):
            from api.agents.tools import run_python_async
            result = await run_python_async("print(1)")
            assert "not available" in result.lower() or "ERROR" in result
            assert "/agents/status" in result

    @pytest.mark.asyncio
    async def test_run_python_async_success_includes_status(self):
        """Test run_python_async returns status metadata with output."""
        with (
            patch("api.sandbox.is_sandbox_available", return_value=True),
            patch("api.sandbox.execute_python", return_value=("42\n", True)),
        ):
            from api.agents.tools import run_python_async

            result = await run_python_async("print(42)")
            assert result.startswith("OK python_sandbox duration_ms=")
            assert "42" in result

    def test_run_python_sync_wrapper_exists(self):
        """Test that sync wrapper function exists."""
        from api.agents.tools import run_python

        assert callable(run_python)


class TestToolDefinitions:
    """Tests for tool definitions and descriptions."""

    def test_run_python_in_tool_definitions(self):
        """Test that run_python is in TOOL_DEFINITIONS."""
        from api.agents.tools import TOOL_DEFINITIONS

        names = [t.name for t in TOOL_DEFINITIONS]
        assert "run_python" in names

    def test_run_python_in_sync_tools(self):
        """Test that run_python is in SYNC_TOOLS registry."""
        from api.agents.tools import SYNC_TOOLS, run_python

        assert run_python in SYNC_TOOLS

    def test_run_python_in_async_tool_map(self):
        """Test that tool_run_python is in ASYNC_TOOL_MAP."""
        from api.agents.tools import ASYNC_TOOL_MAP

        assert "tool_run_python" in ASYNC_TOOL_MAP

    def test_get_tools_description_includes_run_python(self):
        """Test that get_tools_description includes run_python."""
        from api.agents.tools import get_tools_description

        desc = get_tools_description(tool_names=["run_python"])
        assert "run_python" in desc
        assert "sandbox" in desc.lower() or "execute" in desc.lower()


# Mark integration tests that require Docker
docker_available = pytest.mark.skipif(
    os.system("docker ps > /dev/null 2>&1") != 0,
    reason="Docker not available",
)


def _clear_rate_limit(agent_id: str):
    """Clear rate limit for a specific agent."""
    from api.sandbox import _rate_limits
    _rate_limits.pop(agent_id, None)


@docker_available
class TestSandboxDockerIntegration:
    """Integration tests that require Docker (run with actual sandbox container)."""

    def setup_method(self):
        """Clear rate limits before each test."""
        _clear_rate_limit("integration")

    def test_simple_print(self):
        """Test simple print statement execution."""
        from api.sandbox import execute_python, is_sandbox_available

        if not is_sandbox_available():
            pytest.skip("Sandbox container not available")

        result, success = execute_python("print('Hello, World!')", agent_id="integration")
        assert success is True
        assert "Hello, World!" in result

    def test_arithmetic(self):
        """Test arithmetic operations."""
        from api.sandbox import execute_python, is_sandbox_available

        if not is_sandbox_available():
            pytest.skip("Sandbox container not available")

        result, success = execute_python("print(2 + 2)", agent_id="integration")
        assert success is True
        assert "4" in result

    def test_multiline_code(self):
        """Test multi-line code execution."""
        from api.sandbox import execute_python, is_sandbox_available

        if not is_sandbox_available():
            pytest.skip("Sandbox container not available")

        code = '''
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

print(factorial(5))
'''
        result, success = execute_python(code, agent_id="integration")
        assert success is True
        assert "120" in result

    def test_numpy_available(self):
        """Test that numpy is available in sandbox."""
        from api.sandbox import execute_python, is_sandbox_available

        if not is_sandbox_available():
            pytest.skip("Sandbox container not available")

        code = "import numpy as np; print(np.array([1,2,3]).sum())"
        result, success = execute_python(code, agent_id="integration")
        assert success is True
        assert "6" in result

    def test_pandas_available(self):
        """Test that pandas is available in sandbox."""
        from api.sandbox import execute_python, is_sandbox_available

        if not is_sandbox_available():
            pytest.skip("Sandbox container not available")

        code = "import pandas as pd; print(pd.DataFrame({'a': [1,2,3]}).shape)"
        result, success = execute_python(code, agent_id="integration")
        assert success is True
        assert "(3, 1)" in result

    def test_syntax_error(self):
        """Test that syntax errors are caught."""
        from api.sandbox import execute_python, is_sandbox_available

        if not is_sandbox_available():
            pytest.skip("Sandbox container not available")

        result, success = execute_python("print(", agent_id="integration")
        assert success is False
        assert "SyntaxError" in result or "Error" in result

    def test_runtime_error(self):
        """Test that runtime errors are caught."""
        from api.sandbox import execute_python, is_sandbox_available

        if not is_sandbox_available():
            pytest.skip("Sandbox container not available")

        result, success = execute_python("print(1/0)", agent_id="integration")
        assert success is False
        assert "ZeroDivisionError" in result

    def test_undefined_variable(self):
        """Test that undefined variable errors are caught."""
        from api.sandbox import execute_python, is_sandbox_available

        if not is_sandbox_available():
            pytest.skip("Sandbox container not available")

        result, success = execute_python("print(undefined_var)", agent_id="integration")
        assert success is False
        assert "NameError" in result


@docker_available
class TestSandboxSecurity:
    """Security tests for the sandbox (requires Docker)."""

    def setup_method(self):
        """Clear rate limits before each test."""
        _clear_rate_limit("security")

    def test_no_network_access(self):
        """Test that network access is blocked."""
        from api.sandbox import execute_python, is_sandbox_available

        if not is_sandbox_available():
            pytest.skip("Sandbox container not available")

        code = '''
import socket
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(2)
    s.connect(("8.8.8.8", 53))
    print("NETWORK_ALLOWED")
except Exception as e:
    print(f"NETWORK_BLOCKED: {type(e).__name__}")
'''
        result, success = execute_python(code, agent_id="integration")
        # Network should be blocked due to --network=none
        assert "NETWORK_BLOCKED" in result or success is False

    def test_filesystem_read_only(self):
        """Test that filesystem is read-only (except /tmp)."""
        from api.sandbox import execute_python, is_sandbox_available

        if not is_sandbox_available():
            pytest.skip("Sandbox container not available")

        code = '''
try:
    with open("/etc/test_write", "w") as f:
        f.write("test")
    print("WRITE_ALLOWED")
except Exception as e:
    print(f"WRITE_BLOCKED: {type(e).__name__}")
'''
        result, success = execute_python(code, agent_id="integration")
        assert "WRITE_BLOCKED" in result

    def test_tmp_writable(self):
        """Test that /tmp is writable."""
        from api.sandbox import execute_python, is_sandbox_available

        if not is_sandbox_available():
            pytest.skip("Sandbox container not available")

        code = '''
import tempfile
with tempfile.NamedTemporaryFile(mode='w', delete=False, dir='/tmp') as f:
    f.write("test")
    print(f"TMP_WRITABLE: {f.name}")
'''
        result, success = execute_python(code, agent_id="integration")
        assert success is True
        assert "TMP_WRITABLE" in result

    def test_no_subprocess_execution(self):
        """Test that subprocess execution fails (no binaries available)."""
        from api.sandbox import execute_python, is_sandbox_available

        if not is_sandbox_available():
            pytest.skip("Sandbox container not available")

        code = '''
import subprocess
try:
    result = subprocess.run(["ls", "/"], capture_output=True, timeout=5)
    print(f"SUBPROCESS_ALLOWED: {result.returncode}")
except Exception as e:
    print(f"SUBPROCESS_BLOCKED: {type(e).__name__}")
'''
        result, success = execute_python(code, agent_id="integration")
        # Should either fail or show blocked
        assert "SUBPROCESS_BLOCKED" in result or "Error" in result

    def test_memory_limit(self):
        """Test that memory limit is enforced."""
        from api.sandbox import execute_python, is_sandbox_available

        if not is_sandbox_available():
            pytest.skip("Sandbox container not available")

        code = '''
# Try to allocate 500MB of memory (should fail with 128m limit)
try:
    data = "x" * (500 * 1024 * 1024)
    print("MEMORY_UNLIMITED")
except MemoryError:
    print("MEMORY_LIMITED")
'''
        result, success = execute_python(code, agent_id="integration")
        # Should fail due to memory limit
        assert "MEMORY_LIMITED" in result or success is False


@docker_available
class TestSandboxPerformance:
    """Performance tests for the sandbox."""

    def setup_method(self):
        """Clear rate limits before each test."""
        _clear_rate_limit("perf")

    def test_execution_completes_quickly(self):
        """Test that simple code executes quickly."""
        from api.sandbox import execute_python, is_sandbox_available

        if not is_sandbox_available():
            pytest.skip("Sandbox container not available")

        import time
        start = time.time()
        result, success = execute_python("print('fast')", agent_id="integration")
        elapsed = time.time() - start

        assert success is True
        # Should complete in under 5 seconds (including container startup)
        assert elapsed < 5.0

    def test_caching_improves_performance(self):
        """Test that cached results are faster."""
        from api.sandbox import execute_python, is_sandbox_available, _result_cache

        if not is_sandbox_available():
            pytest.skip("Sandbox container not available")

        _result_cache.clear()
        code = "print('cache_test')"

        import time

        # First execution
        start1 = time.time()
        result1, success1 = execute_python(code, agent_id="integration")
        elapsed1 = time.time() - start1

        # Second execution (should be cached)
        start2 = time.time()
        result2, success2 = execute_python(code, agent_id="integration")
        elapsed2 = time.time() - start2

        assert success1 is True
        assert success2 is True
        assert result1 == result2
        # Cached should be much faster
        assert elapsed2 < elapsed1 / 2
