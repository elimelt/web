import asyncio
import json
import os
import queue
import threading
from collections.abc import AsyncGenerator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter(tags=["augment"])

_ALL_TOOLS = [
    "launch-process",
    "kill-process",
    "read-process",
    "write-process",
    "list-processes",
    "str-replace-editor",
    "view",
    "codebase-retrieval",
    "web-search",
    "web-fetch",
    "github-api",
    "save-file",
    "remove-files",
]


class ChatRequest(BaseModel):
    message: str
    model: str = "sonnet4.5"


def parse_augment_token() -> tuple[str, str | None]:
    raw_token = os.getenv("AUGMENT_API_TOKEN")
    if not raw_token:
        raise HTTPException(status_code=500, detail="AUGMENT_API_TOKEN not configured")

    try:
        token_obj = json.loads(raw_token)
        access_token = token_obj.get("accessToken", raw_token)
        api_url = token_obj.get("tenantURL")
        return access_token, api_url
    except json.JSONDecodeError:
        return raw_token, None


def get_augment_client(model: str = "sonnet4.5", listener=None):
    from auggie_sdk import Auggie

    access_token, api_url = parse_augment_token()

    return Auggie(
        model=model,
        api_key=access_token,
        api_url=api_url,
        timeout=300,
        workspace_root="/tmp",
        removed_tools=_ALL_TOOLS,
        listener=listener,
    )


@router.get("/augment/health")
async def augment_health() -> dict[str, str]:
    api_token = os.getenv("AUGMENT_API_TOKEN")
    if not api_token:
        return {"status": "unconfigured", "message": "AUGMENT_API_TOKEN not set"}

    try:
        from auggie_sdk import Auggie  # noqa: F401

        return {"status": "ok", "message": "Augment SDK available"}
    except ImportError:
        return {"status": "error", "message": "Augment SDK not installed"}


@router.post("/augment/chat")
async def chat_streaming(request: ChatRequest) -> StreamingResponse:
    from auggie_sdk import AgentListener

    chunk_queue: queue.Queue[str | None] = queue.Queue()

    class SSEListener(AgentListener):
        def on_agent_message(self, text: str) -> None:
            chunk_queue.put(text)

        def on_tool_call(
            self,
            tool_call_id: str,
            title: str,
            kind: str | None = None,
            status: str | None = None,
        ) -> None:
            pass

    def run_augment():
        try:
            listener = SSEListener()
            client = get_augment_client(model=request.model, listener=listener)
            client.run(request.message)
        except Exception as e:
            chunk_queue.put(f"\n\n[Error: {e}]")
        finally:
            chunk_queue.put(None)

    async def generate_sse() -> AsyncGenerator[str, None]:
        thread = threading.Thread(target=run_augment, daemon=True)
        thread.start()

        while True:
            try:
                chunk = await asyncio.to_thread(chunk_queue.get, timeout=60)
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
