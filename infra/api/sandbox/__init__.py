import hashlib
import logging
import os
import subprocess
import time
from datetime import UTC, datetime
from typing import Any

_logger = logging.getLogger("api.sandbox")

SANDBOX_IMAGE = os.getenv("SANDBOX_IMAGE", "devstack-python-sandbox:latest")
SANDBOX_TIMEOUT = int(os.getenv("SANDBOX_TIMEOUT_SEC", "30"))
SANDBOX_MEMORY_LIMIT = os.getenv("SANDBOX_MEMORY_LIMIT", "128m")
SANDBOX_CPU_LIMIT = float(os.getenv("SANDBOX_CPU_LIMIT", "0.5"))
SANDBOX_ENABLED = os.getenv("SANDBOX_ENABLED", "1") == "1"

_execution_log: list[dict[str, Any]] = []
_rate_limits: dict[str, list[float]] = {}
RATE_LIMIT_WINDOW = 60
RATE_LIMIT_MAX_EXECUTIONS = 10


def _check_rate_limit(agent_id: str) -> bool:
    now = time.time()
    if agent_id not in _rate_limits:
        _rate_limits[agent_id] = []

    _rate_limits[agent_id] = [t for t in _rate_limits[agent_id] if now - t < RATE_LIMIT_WINDOW]

    if len(_rate_limits[agent_id]) >= RATE_LIMIT_MAX_EXECUTIONS:
        return False

    _rate_limits[agent_id].append(now)
    return True


def _log_execution(agent_id: str, code: str, result: str, success: bool, duration_ms: int) -> None:
    entry = {
        "timestamp": datetime.now(UTC).isoformat(),
        "agent_id": agent_id,
        "code_hash": hashlib.sha256(code.encode()).hexdigest()[:16],
        "code_preview": code[:200] + "..." if len(code) > 200 else code,
        "success": success,
        "duration_ms": duration_ms,
        "result_length": len(result),
    }
    _execution_log.append(entry)
    if len(_execution_log) > 1000:
        _execution_log.pop(0)

    _logger.info(
        "Sandbox execution: agent=%s success=%s duration=%dms code_hash=%s",
        agent_id,
        success,
        duration_ms,
        entry["code_hash"],
    )


_result_cache: dict[str, tuple[str, bool, float]] = {}
CACHE_TTL = 300
CACHE_MAX_SIZE = 100


def _get_cached_result(code: str) -> tuple[str, bool] | None:
    code_hash = hashlib.sha256(code.encode()).hexdigest()
    if code_hash in _result_cache:
        result, success, timestamp = _result_cache[code_hash]
        if time.time() - timestamp < CACHE_TTL:
            _logger.debug("Cache hit for code hash %s", code_hash[:16])
            return result, success
        del _result_cache[code_hash]
    return None


def _cache_result(code: str, result: str, success: bool) -> None:
    if len(_result_cache) >= CACHE_MAX_SIZE:
        oldest_key = min(_result_cache, key=lambda k: _result_cache[k][2])
        del _result_cache[oldest_key]

    code_hash = hashlib.sha256(code.encode()).hexdigest()
    _result_cache[code_hash] = (result, success, time.time())


def execute_python(code: str, agent_id: str = "unknown") -> tuple[str, bool]:
    if not SANDBOX_ENABLED:
        return "ERROR: Python sandbox is disabled", False

    if not code or not code.strip():
        return "ERROR: No code provided", False

    if not _check_rate_limit(agent_id):
        return (
            f"ERROR: Rate limit exceeded. Max {RATE_LIMIT_MAX_EXECUTIONS} executions per {RATE_LIMIT_WINDOW}s",
            False,
        )

    cached = _get_cached_result(code)
    if cached:
        _log_execution(agent_id, code, cached[0], cached[1], 0)
        return cached

    start_time = time.time()

    # Build docker run command with security options
    cpu_quota = int(100000 * SANDBOX_CPU_LIMIT)
    docker_cmd = [
        "docker",
        "run",
        "--rm",
        "-i",
        "--network",
        "none",
        "--memory",
        SANDBOX_MEMORY_LIMIT,
        "--memory-swap",
        SANDBOX_MEMORY_LIMIT,
        "--cpu-period",
        "100000",
        "--cpu-quota",
        str(cpu_quota),
        "--pids-limit",
        "64",
        "--read-only",
        "--tmpfs",
        "/tmp:size=10M,mode=1777",
        "--security-opt",
        "no-new-privileges:true",
        "--cap-drop",
        "ALL",
        "--user",
        "1000:1000",
        SANDBOX_IMAGE,
    ]

    try:
        proc = subprocess.run(
            docker_cmd,
            input=code.encode("utf-8"),
            capture_output=True,
            timeout=SANDBOX_TIMEOUT + 5, check=False,  # Extra buffer for container startup
        )

        output = proc.stdout.decode("utf-8", errors="replace")
        stderr = proc.stderr.decode("utf-8", errors="replace")
        combined = output + stderr if stderr else output

        duration_ms = int((time.time() - start_time) * 1000)
        success = proc.returncode == 0

        # Truncate output if too long
        max_output = 50000
        if len(combined) > max_output:
            combined = (
                combined[:max_output]
                + f"\n... [output truncated, {len(combined) - max_output} bytes omitted]"
            )

        _cache_result(code, combined, success)
        _log_execution(agent_id, code, combined, success, duration_ms)

        return combined, success

    except subprocess.TimeoutExpired:
        duration_ms = int((time.time() - start_time) * 1000)
        error_msg = f"ERROR: Execution timed out after {SANDBOX_TIMEOUT}s"
        _log_execution(agent_id, code, error_msg, False, duration_ms)
        return error_msg, False

    except FileNotFoundError:
        duration_ms = int((time.time() - start_time) * 1000)
        error_msg = "ERROR: Docker CLI not found"
        _log_execution(agent_id, code, error_msg, False, duration_ms)
        return error_msg, False

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        _logger.exception("Sandbox execution failed")
        error_msg = f"ERROR: {e}"
        _log_execution(agent_id, code, error_msg, False, duration_ms)
        return error_msg, False


def get_execution_log(limit: int = 50) -> list[dict[str, Any]]:
    return _execution_log[-limit:]


def is_sandbox_available() -> bool:
    if not SANDBOX_ENABLED:
        return False
    try:
        # Check if docker CLI is available and image exists
        result = subprocess.run(
            ["docker", "image", "inspect", SANDBOX_IMAGE],
            capture_output=True,
            timeout=10, check=False,
        )
        return result.returncode == 0
    except Exception:
        return False
