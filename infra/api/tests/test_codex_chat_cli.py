"""Exercise the public chat restrictions against the installed Codex binary."""

import json
import shutil
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from api import codex_runner


@pytest.mark.skipif(shutil.which("codex") is None, reason="Codex CLI not installed")
def test_chat_cli_rejects_model_requested_command(tmp_path, monkeypatch):
    requests_seen = []
    sentinel = tmp_path / "command-executed"

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            requests_seen.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            if len(requests_seen) == 1:
                # An untrusted model response must not be able to dispatch a shell command,
                # even if it invents a call to a tool we did not advertise.
                item = {
                    "id": "fc_1", "type": "function_call", "call_id": "call_1",
                    "name": "exec_command",
                    "arguments": json.dumps({"cmd": f"touch {sentinel}"}),
                }
            else:
                item = {
                    "id": "msg_1", "type": "message", "role": "assistant", "status": "completed",
                    "content": [{"type": "output_text", "text": "Chat reply", "annotations": []}],
                }
            response_id = f"resp_{len(requests_seen)}"
            events = [
                {"type": "response.created", "response": {
                    "id": response_id, "status": "in_progress", "output": [],
                }},
                {"type": "response.output_item.added", "output_index": 0, "item": item},
                {"type": "response.output_item.done", "output_index": 0, "item": item},
                {"type": "response.completed", "response": {
                    "id": response_id, "status": "completed", "output": [item],
                    "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
                }},
            ]
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            self.wfile.write("".join(f"data: {json.dumps(event)}\n\n" for event in events).encode())

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    real_run = subprocess.run

    def local_provider(cmd, **kwargs):
        # Route inference to a local fixture; run the real CLI with the production restrictions.
        cmd = cmd[:-1] + [
            "-c", 'model_provider="fixture"',
            "-c", 'model_providers.fixture.name="fixture"',
            "-c", f'model_providers.fixture.base_url="http://127.0.0.1:{server.server_port}/v1"',
            "-c", 'model_providers.fixture.wire_api="responses"',
            "-c", 'model_providers.fixture.env_key="OPENAI_API_KEY"',
            cmd[-1],
        ]
        return real_run(cmd, **kwargs)

    monkeypatch.setenv("OPENAI_API_KEY", "fixture-key")
    monkeypatch.delenv("CODEX_API_KEY", raising=False)
    monkeypatch.delenv("CODEX_ACCESS_TOKEN", raising=False)
    monkeypatch.setenv("CODEX_TMPDIR", str(tmp_path))
    monkeypatch.setattr(codex_runner.subprocess, "run", local_provider)
    try:
        assert codex_runner.run_codex_prompt(
            "Hello", model=codex_runner.DEFAULT_CODEX_MODEL, workdir=str(tmp_path),
            chat_only=True, timeout_sec=30,
        ) == "Chat reply"
        assert not sentinel.exists()
        tools = {tool.get("name", tool["type"]) for tool in requests_seen[0].get("tools", [])}
        assert tools <= {"update_plan", "request_user_input", "apply_patch", "view_image"}
        outputs = [
            item["output"] for request in requests_seen[1:] for item in request["input"]
            if item.get("type") == "function_call_output"
        ]
        assert any("unsupported call: exec_command" in output for output in outputs)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
