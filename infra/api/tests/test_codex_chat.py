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
    assert response.json() == {"status": "unconfigured", "message": "Codex auth not configured"}


def test_run_codex_prompt_prefers_api_key_over_stale_auth(tmp_path, monkeypatch):
    source_home = tmp_path / "source"
    source_home.mkdir()
    (source_home / "auth.json").write_text('{"stale": true}', encoding="utf-8")
    (source_home / "config.toml").write_text("model = 'test'\n", encoding="utf-8")
    tmp_root = tmp_path / "codex-tmp"

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
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
