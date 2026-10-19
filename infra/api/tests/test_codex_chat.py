import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from api import codex_runner


def test_codex_health_reports_cli_ready(internal_client, monkeypatch):
    monkeypatch.setattr(codex_runner, "get_codex_binary", lambda: "/usr/bin/codex")
    monkeypatch.setattr(codex_runner, "codex_has_auth", lambda: True)

    response = internal_client.get("/codex/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "message": "Codex CLI available"}


def test_codex_health_reports_missing_auth(internal_client, monkeypatch):
    monkeypatch.setattr(codex_runner, "get_codex_binary", lambda: "/usr/bin/codex")
    monkeypatch.setattr(codex_runner, "codex_has_auth", lambda: False)

    response = internal_client.get("/codex/health")

    assert response.status_code == 200
    assert response.json() == {"status": "unconfigured", "message": "Codex unavailable: auth not configured"}


def test_run_codex_prompt_prefers_api_key_over_stale_auth(tmp_path, monkeypatch):
    source_home = tmp_path / "source"
    source_home.mkdir()
    (source_home / "auth.json").write_text('{"stale": true}', encoding="utf-8")
    (source_home / "config.toml").write_text("model = 'test'\n", encoding="utf-8")
    tmp_root = tmp_path / "codex-tmp"

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.delenv("CODEX_API_KEY", raising=False)
    monkeypatch.setenv("CODEX_SOURCE_HOME", str(source_home))
    monkeypatch.setenv("CODEX_TMPDIR", str(tmp_root))
    monkeypatch.setattr(codex_runner, "get_codex_binary", lambda: "/usr/bin/codex")

    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["env"] = kwargs["env"]
        output_path = cmd[cmd.index("--output-last-message") + 1]
        codex_home = kwargs["env"]["CODEX_HOME"]
        captured["codex_home"] = codex_home
        captured["auth_exists"] = (tmp_path / codex_home.removeprefix(str(tmp_path) + "/") / "auth.json").exists()
        captured["config_exists"] = (
            tmp_path / codex_home.removeprefix(str(tmp_path) + "/") / "config.toml"
        ).exists()
        with open(output_path, "w", encoding="utf-8") as f:
            f.write("ok")

        class Result:
            returncode = 0
            stdout = ""
            stderr = ""

        return Result()

    monkeypatch.setattr(codex_runner.subprocess, "run", fake_run)

    assert codex_runner.run_codex_prompt("hello", model="gpt-test", workdir=str(tmp_path)) == "ok"
    assert captured["codex_home"].startswith(str(tmp_root))
    assert captured["auth_exists"] is False
    assert captured["config_exists"] is True
    assert captured["env"]["CODEX_API_KEY"] == "test-key"


def test_public_chat_does_not_inherit_workspace_config_or_secrets(tmp_path, monkeypatch):
    source = tmp_path / "source"
    source.mkdir()
    (source / "auth.json").write_text('{"tokens": {"access_token": "test-token"}}')
    (source / "config.toml").write_text('[features]\nshell_tool = true\n')
    monkeypatch.setenv("CODEX_SOURCE_HOME", str(source))
    monkeypatch.setenv("CODEX_TMPDIR", str(tmp_path / "runs"))
    monkeypatch.setenv("POSTGRES_PASSWORD", "private-db-password")
    monkeypatch.setenv("GITHUB_TOKEN", "private-github-token")
    monkeypatch.setenv("BASH_ENV", "/private/startup.sh")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("CODEX_API_KEY", raising=False)
    monkeypatch.delenv("CODEX_ACCESS_TOKEN", raising=False)
    monkeypatch.setattr(codex_runner, "get_codex_binary", lambda: "/usr/bin/codex")
    prompt = "--dangerously-bypass-approvals-and-sandbox"
    homes = []

    def fake_run(cmd, **kwargs):
        home = Path(kwargs["env"]["CODEX_HOME"])
        homes.append(home)
        assert kwargs["env"] == {
            "PATH": codex_runner.os.environ["PATH"],
            "HOME": str(home),
            "CODEX_HOME": str(home),
            "TMPDIR": str(home.parent),
        }
        assert (home / "auth.json").is_file()
        assert not (home / "config.toml").exists()
        workspace = Path(kwargs["cwd"])
        assert workspace.parent == home.parent
        assert list(workspace.iterdir()) == []
        assert cmd[cmd.index("--sandbox") + 1] == "read-only"
        assert cmd[cmd.index("--ask-for-approval") + 1] == "never"
        assert "--ignore-user-config" in cmd
        assert 'web_search="disabled"' in cmd
        disabled = {cmd[i + 1] for i, arg in enumerate(cmd) if arg == "--disable"}
        assert {"shell_tool", "hooks", "apps", "plugins", "multi_agent", "code_mode_host"} <= disabled
        assert cmd[-1] == "-"
        assert prompt not in cmd
        assert kwargs["input"] == prompt
        Path(cmd[cmd.index("--output-last-message") + 1]).write_text("Hello")
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(codex_runner.subprocess, "run", fake_run)
    assert codex_runner.run_codex_prompt(
        prompt, model="gpt-5.5", workdir=str(source), sandbox="danger-full-access",
        approval_policy="on-request", chat_only=True,
    ) == "Hello"
    assert not homes[0].parent.exists()


def test_public_agent_always_uses_chat_only_mode(monkeypatch):
    from api.agents.codex_agent import CodexAgent, _create_agent_config

    monkeypatch.setenv("CODEX_SANDBOX_MODE", "danger-full-access")
    monkeypatch.setenv("CODEX_WORKDIR", "/private")
    calls = []
    def run(prompt, **kwargs):
        calls.append(kwargs)
        return "Hello"
    monkeypatch.setattr("api.agents.codex_agent.run_codex_prompt", run)
    agent = CodexAgent(_create_agent_config(0, None))
    assert asyncio.run(agent._call_api("Hi")) == "Hello"
    assert calls[0]["chat_only"] is True
    assert calls[0]["workdir"] != "/private"
    assert "**Workspace:**" not in agent._build_prompt("general", [])
    assert "Chat replies only" in agent._build_prompt("general", [])


@pytest.mark.parametrize("count, expected", [("2", 2), ("99", 5)])
def test_public_agents_start_with_auth_and_stop_cleanly(monkeypatch, count, expected):
    from api.agents import codex_agent

    monkeypatch.setattr(codex_agent, "codex_is_ready", lambda: (True, "Ready"))
    monkeypatch.setenv("CODEX_AGENT_COUNT", count)
    run = AsyncMock()
    monkeypatch.setattr(codex_agent.CodexAgent, "run", run)

    async def check():
        stop = asyncio.Event()
        tasks = await codex_agent.start_codex_agents(stop)
        assert len(tasks) == expected
        await asyncio.gather(*tasks)
        assert run.await_count == expected
        run.assert_awaited_with(stop)
    asyncio.run(check())
