import asyncio
import os
import queue
import threading
from collections.abc import AsyncGenerator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api.codex_runner import codex_is_ready, run_codex_prompt

router = APIRouter(tags=["codex"])


class ChatRequest(BaseModel):
    message: str
    model: str = "gpt-5.5"


@router.get("/codex/health")
async def codex_health() -> dict[str, str]:
    ready, message = codex_is_ready()
    return {"status": "ok" if ready else "unconfigured", "message": message}


@router.post("/codex/chat")
async def chat_streaming(request: ChatRequest) -> StreamingResponse:
    chunk_queue: queue.Queue[str | None] = queue.Queue()
    default_workdir = os.getenv("CODEX_WORKDIR", "/app")
    sandbox = os.getenv("CODEX_SANDBOX_MODE", "read-only")
    approval_policy = os.getenv("CODEX_APPROVAL_POLICY", "never")
    timeout_sec = int(os.getenv("CODEX_TIMEOUT_SEC", "300"))
    queue_timeout_sec = max(60, timeout_sec + 30)

    def run_codex() -> None:
        try:
            response = run_codex_prompt(
                request.message,
                model=request.model,
                workdir=default_workdir,
                sandbox=sandbox,
                approval_policy=approval_policy,
                timeout_sec=timeout_sec,
            )
            chunk_queue.put(response)
        except Exception as exc:
            chunk_queue.put(f"\n\n[Error: {exc}]")
        finally:
            chunk_queue.put(None)

    async def generate_sse() -> AsyncGenerator[str, None]:
        thread = threading.Thread(target=run_codex, daemon=True)
        thread.start()

        while True:
            try:
                chunk = await asyncio.to_thread(chunk_queue.get, timeout=queue_timeout_sec)
                if chunk is None:
                    yield "event: done\ndata: {}\n\n"
                    break
                escaped = chunk.replace("\n", "\ndata: ")
                yield f"data: {escaped}\n\n"
            except Exception:
                break

    return StreamingResponse(
        generate_sse(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
