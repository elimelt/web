#!/usr/bin/env python3
"""
Sandbox runner for executing Python code in a secure Docker container.

Security is provided by Docker's isolation features:
- --network none: No network access
- --read-only: Read-only filesystem (except /tmp)
- --memory/--memory-swap: Memory limits
- --cpu-period/--cpu-quota: CPU limits
- --pids-limit: Process limits
- --cap-drop ALL: Drop all capabilities
- --security-opt no-new-privileges: Prevent privilege escalation
- --tmpfs /tmp:size=10M: Limited writable space

This runner adds additional restrictions:
- Resource limits via setrlimit
- Execution timeout via SIGALRM
- Output truncation

Note: We don't block imports because many scientific libraries (numpy, pandas,
scipy, matplotlib) internally use os, subprocess, ctypes, etc. Docker's
isolation provides the real security - subprocess.run() will fail because
there are no binaries to run, network calls will fail because --network=none,
file writes will fail because --read-only, etc.
"""

import io
import resource
import signal
import sys
import traceback


def timeout_handler(signum, frame):
    raise TimeoutError("Execution timed out")


def setup_resource_limits():
    resource.setrlimit(resource.RLIMIT_CPU, (25, 30))
    resource.setrlimit(resource.RLIMIT_FSIZE, (10 * 1024 * 1024, 10 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_NPROC, (32, 32))


def execute_code(code: str, timeout: int = 25) -> tuple[str, str, bool]:
    """Execute code with resource limits and timeout."""
    setup_resource_limits()
    signal.signal(signal.SIGALRM, timeout_handler)
    signal.alarm(timeout)

    stdout_capture = io.StringIO()
    stderr_capture = io.StringIO()
    old_stdout, old_stderr = sys.stdout, sys.stderr
    success = False

    try:
        sys.stdout = stdout_capture
        sys.stderr = stderr_capture

        exec(compile(code, "<sandbox>", "exec"), {"__name__": "__main__"})
        success = True

    except TimeoutError as e:
        print(f"Error: {e}", file=stderr_capture)
    except Exception:
        traceback.print_exc(file=stderr_capture)
    finally:
        signal.alarm(0)
        sys.stdout = old_stdout
        sys.stderr = old_stderr

    return stdout_capture.getvalue(), stderr_capture.getvalue(), success


def main():
    code = sys.stdin.read()
    if not code.strip():
        print("Error: No code provided", file=sys.stderr)
        sys.exit(1)

    stdout, stderr, success = execute_code(code)

    max_output = 50000
    if len(stdout) > max_output:
        stdout = (
            stdout[:max_output]
            + f"\n... [output truncated, {len(stdout) - max_output} bytes omitted]"
        )
    if len(stderr) > max_output:
        stderr = (
            stderr[:max_output]
            + f"\n... [output truncated, {len(stderr) - max_output} bytes omitted]"
        )

    sys.stdout.write(stdout)
    sys.stderr.write(stderr)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
