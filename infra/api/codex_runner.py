"""Helpers for invoking the Codex CLI from the internal API."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path


def get_codex_source_home() -> Path:
    """Return the read-only Codex auth/config source directory."""
    return Path(os.getenv("CODEX_SOURCE_HOME", os.getenv("CODEX_HOME", Path.home() / ".codex")))


def get_codex_binary() -> str | None:
    """Return the Codex CLI path if available."""
    return shutil.which("codex")


def codex_has_auth() -> bool:
    """Return True when Codex has enough auth material to run."""
    if os.getenv("OPENAI_API_KEY") or os.getenv("CODEX_ACCESS_TOKEN"):
        return True

    auth_path = get_codex_source_home() / "auth.json"
    return auth_path.exists()


def codex_is_ready() -> tuple[bool, str]:
    """Check whether the Codex CLI is installed and likely authenticated."""
    binary = get_codex_binary()
    if not binary:
        return False, "Codex CLI is not installed"
    if not codex_has_auth():
        return False, "Codex auth not configured"
    return True, "Codex CLI available"


def run_codex_prompt(
    prompt: str,
    *,
    model: str,
    workdir: str,
    sandbox: str = "read-only",
    approval_policy: str = "never",
    timeout_sec: int = 300,
) -> str:
    """Run `codex exec` and return the final assistant message."""
    binary = get_codex_binary()
    if not binary:
        raise RuntimeError("Codex CLI is not installed")
    if not codex_has_auth():
        raise RuntimeError("Codex auth not configured")

    if not prompt.strip():
        raise RuntimeError("Prompt cannot be empty")

    resolved_workdir = workdir if os.path.isdir(workdir) else "/tmp"
    tmp_root = Path(os.getenv("CODEX_TMPDIR", "/app/.codex-tmp"))
    tmp_root.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="codex-chat-", dir=tmp_root) as tmpdir:
        codex_home = os.path.join(tmpdir, "codex-home")
        os.makedirs(codex_home, exist_ok=True)
        source_home = get_codex_source_home()
        config_path = source_home / "config.toml"
        if config_path.exists():
            shutil.copy2(config_path, os.path.join(codex_home, "config.toml"))

        # Prefer explicit API-token env over copied ChatGPT auth. A stale auth.json can cause
        # Codex to try refreshing an expired browser token even when OPENAI_API_KEY is valid.
        if not (os.getenv("OPENAI_API_KEY") or os.getenv("CODEX_ACCESS_TOKEN")):
            auth_path = source_home / "auth.json"
            if auth_path.exists():
                shutil.copy2(auth_path, os.path.join(codex_home, "auth.json"))

        output_path = os.path.join(tmpdir, "last-message.txt")
        cmd = [
            binary,
            "--ask-for-approval",
            approval_policy,
            "exec",
            "--skip-git-repo-check",
            "--ephemeral",
            "--color",
            "never",
            "--output-last-message",
            output_path,
            "--sandbox",
            sandbox,
            "-C",
            resolved_workdir,
        ]

        if model:
            cmd.extend(["--model", model])
        cmd.append(prompt)

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            cwd=resolved_workdir,
            env={**os.environ, "CODEX_HOME": codex_home},
        )

        output_text = ""
        if os.path.exists(output_path):
            output_text = Path(output_path).read_text(encoding="utf-8").strip()

        if not output_text:
            output_text = (result.stdout or "").strip()

        if result.returncode != 0:
            error_text = (result.stderr or output_text or "Codex exec failed").strip()
            raise RuntimeError(error_text)

        if not output_text:
            raise RuntimeError("Codex returned an empty response")

        return output_text
