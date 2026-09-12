"""Private broker: fixed Docker operations, no model credentials or host files."""

import asyncio
import hmac
import os
import time

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from api.controllers.system import _get_system_stats
from api.sandbox import execute_python, is_sandbox_available

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
_slots = asyncio.Semaphore(2)
_stats_lock = asyncio.Lock()
_stats_cache = (0.0, {})


class Execution(BaseModel):
    code: str = Field(min_length=1, max_length=20_000)


@app.get("/stats")
async def stats():
    global _stats_cache
    async with _stats_lock:
        if time.monotonic() - _stats_cache[0] > 10:
            value = await asyncio.to_thread(lambda: asyncio.run(_get_system_stats(None)))
            _stats_cache = (time.monotonic(), value)
        return _stats_cache[1]


@app.get("/health")
async def health():
    if not await asyncio.to_thread(is_sandbox_available):
        raise HTTPException(503, "Sandbox unavailable")
    return {"status": "ok"}


@app.post("/execute")
async def execute(request: Execution, x_worker_token: str = Header(default="")):
    expected = os.getenv("SANDBOX_WORKER_TOKEN", "")
    if not expected or not hmac.compare_digest(x_worker_token, expected):
        raise HTTPException(403, "Forbidden")
    try:
        await asyncio.wait_for(_slots.acquire(), timeout=0.1)
    except TimeoutError:
        raise HTTPException(429, "Sandbox busy")
    try:
        output, success = await asyncio.to_thread(execute_python, request.code, "broker")
        return {"output": output, "success": success}
    finally:
        _slots.release()
