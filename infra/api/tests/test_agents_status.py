from api import codex_runner


def test_agents_status_reports_tool_readiness(internal_client, monkeypatch):
    monkeypatch.setattr(codex_runner, "get_codex_binary", lambda: "/usr/bin/codex")
    monkeypatch.setattr(codex_runner, "codex_has_auth", lambda: True)
    monkeypatch.setenv("AUGMENT_API_TOKEN", "test-token")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr("api.sandbox.is_sandbox_available", lambda: True)

    response = internal_client.get("/agents/status")

    assert response.status_code == 200
    body = response.json()
    assert body["agents"]["codex"]["status"] == "ok"
    assert body["agents"]["gemini"]["status"] == "unconfigured"
    assert "run_python" in body["tools"]["registered"]
    assert body["tools"]["sandbox"]["available"] is True
    assert body["tools"]["embeddings"]["install_switch"] == "INSTALL_EMBEDDINGS=1"
