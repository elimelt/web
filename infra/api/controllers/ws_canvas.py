"""Public collaborative canvas with server-bound ownership and bounded state."""

import asyncio
import json
import logging
import math
import re
import secrets
import time
from dataclasses import dataclass, field

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from api import state
from api.security import ConnectionLimits, RateLimiter, allowed_ws_origin, client_ip

router = APIRouter(tags=["canvas"])
_logger = logging.getLogger(__name__)
REDIS_CANVAS_KEY = "canvas:state"
MAX_STROKES = 500
MAX_POINTS = 512
MAX_TOTAL_POINTS = 20_000
MAX_MESSAGE_BYTES = 65_536
_ID = re.compile(r"^[a-zA-Z0-9:._-]{1,160}$")
_COLOR = re.compile(r"^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$")
_limits = ConnectionLimits(total=128, per_ip=8)
_messages = RateLimiter(120, 1)
_global_messages = RateLimiter(2000, 1)
_writes = RateLimiter(10, 1)
_global_writes = RateLimiter(50, 1)


def _number(value, low: float, high: float) -> bool:
    return type(value) in (int, float) and low <= value <= high and math.isfinite(value)


def valid_point(point) -> bool:
    return (isinstance(point, dict) and _number(point.get("x"), 0, 1)
            and _number(point.get("y"), 0, 1))


def validate_stroke(value, owner: str | None = None) -> dict | None:
    if not isinstance(value, dict):
        return None
    sid, color, points = value.get("id"), value.get("color"), value.get("points")
    if not isinstance(sid, str) or not _ID.fullmatch(sid):
        return None
    if owner and not sid.startswith(owner + "-"):
        return None
    if not isinstance(color, str) or not _COLOR.fullmatch(color):
        return None
    if not _number(value.get("width"), 1, 32):
        return None
    if not isinstance(points, list) or not 1 <= len(points) <= MAX_POINTS:
        return None
    if not all(valid_point(point) for point in points):
        return None
    author = owner or value.get("author_id")
    timestamp = time.time() * 1000 if owner else value.get("timestamp")
    if not isinstance(author, str) or not _ID.fullmatch(author):
        return None
    if not _number(timestamp, 0, time.time() * 1000 + 60_000):
        return None
    return {"id": sid, "author_id": author, "timestamp": timestamp,
            "color": color, "width": value["width"],
            "points": [{"x": p["x"], "y": p["y"]} for p in points]}


@dataclass
class CanvasCRDT:
    strokes: dict = field(default_factory=dict)
    removed: set = field(default_factory=set)

    def add(self, stroke: dict) -> bool:
        if stroke["id"] in self.removed or stroke["id"] in self.strokes:
            return False
        self.strokes[stroke["id"]] = stroke
        return True

    def remove(self, stroke_id: str, author_id: str) -> bool:
        stroke = self.strokes.get(stroke_id)
        if not stroke or stroke["author_id"] != author_id:
            return False
        self.strokes.pop(stroke_id)
        self.removed.add(stroke_id)
        self._trim_tombstones()
        return True

    def _trim_tombstones(self):
        while len(self.removed) > MAX_STROKES:
            self.removed.pop()

    def clear_by_author(self, author_id: str) -> list[str]:
        ids = [sid for sid, stroke in self.strokes.items() if stroke["author_id"] == author_id]
        for sid in ids:
            self.remove(sid, author_id)
        return ids

    def visible_strokes(self) -> list[dict]:
        return sorted(self.strokes.values(), key=lambda stroke: stroke["timestamp"])

    def merge(self, other_strokes, other_removed) -> None:
        if not isinstance(other_strokes, list) or not isinstance(other_removed, list):
            return
        removed = {s for s in other_removed if isinstance(s, str)}
        # Legacy records are untrusted too. Validate before admitting them to state.
        for value in other_strokes:
            if isinstance(value, dict):
                points = value.get("points")
                if isinstance(points, list) and len(points) > MAX_POINTS and all(valid_point(p) for p in points):
                    # Preserve valid legacy drawings while enforcing the new per-stroke bound.
                    points = [points[i * (len(points) - 1) // (MAX_POINTS - 1)] for i in range(MAX_POINTS)]
                    value = {**value, "points": points}
            stroke = validate_stroke(value)
            if stroke and stroke["id"] not in removed:
                self.add(stroke)
                self.gc()

    def to_dict(self) -> dict:
        return {"strokes": self.visible_strokes(), "removed": []}

    def gc(self) -> list[str]:
        evicted = []
        points = sum(len(s["points"]) for s in self.strokes.values())
        for stroke in self.visible_strokes():
            if len(self.strokes) <= MAX_STROKES and points <= MAX_TOTAL_POINTS:
                break
            self.strokes.pop(stroke["id"])
            points -= len(stroke["points"])
            evicted.append(stroke["id"])
        self.removed.update(evicted)
        self._trim_tombstones()
        return evicted


_canvas = CanvasCRDT()
_connected_clients: set[WebSocket] = set()
_persist_lock = asyncio.Lock()


async def load_canvas_state() -> None:
    global _canvas
    _canvas = CanvasCRDT()
    if state.redis_client is None:
        return
    try:
        data = await state.redis_client.get(REDIS_CANVAS_KEY)
        if data:
            parsed = json.loads(data)
            if isinstance(parsed, dict):
                _canvas.merge(parsed.get("strokes", []), parsed.get("removed", []))
    except Exception:
        _logger.exception("Discarding invalid saved canvas state")


async def persist_canvas_state() -> None:
    if state.redis_client is None:
        return
    async with _persist_lock:
        try:
            await state.redis_client.set(REDIS_CANVAS_KEY, json.dumps(_canvas.to_dict()))
        except Exception:
            _logger.exception("Canvas persistence failed")


async def _broadcast(message: dict, exclude=None) -> None:
    text = json.dumps(message)

    async def send(ws):
        try:
            await asyncio.wait_for(ws.send_text(text), timeout=1)
        except Exception:
            _connected_clients.discard(ws)
            try:
                await asyncio.wait_for(ws.close(code=1013), timeout=1)
            except Exception:
                pass

    await asyncio.gather(*(send(ws) for ws in tuple(_connected_clients) if ws is not exclude))


async def broadcast_op(op: dict, exclude=None) -> None:
    await _broadcast({"type": "op", "op": op}, exclude)


async def broadcast_user_count() -> None:
    await _broadcast({"type": "user_count", "count": len(_connected_clients)})


@router.websocket("/ws/canvas")
async def websocket_canvas(websocket: WebSocket) -> None:
    ip = client_ip(websocket)
    if not allowed_ws_origin(websocket) or not _limits.acquire(ip):
        await websocket.close(code=1008)
        return
    owner = secrets.token_hex(16)
    heartbeat_task = None
    try:
        await websocket.accept()
        _connected_clients.add(websocket)
        await websocket.send_json({"type": "sync", "client_id": owner,
                                   "state": _canvas.to_dict(), "user_count": len(_connected_clients)})
        await broadcast_user_count()

        async def heartbeat():
            while True:
                await asyncio.sleep(25)
                await asyncio.wait_for(websocket.send_json({"type": "ping"}), timeout=2)

        heartbeat_task = asyncio.create_task(heartbeat())
        while True:
            raw = await websocket.receive_text()
            if len(raw.encode()) > MAX_MESSAGE_BYTES:
                await websocket.close(code=1009)
                break
            if not _messages.allow(ip) or not _global_messages.allow("all"):
                await websocket.close(code=1008)
                break
            try:
                msg = json.loads(raw)
            except (ValueError, RecursionError):
                continue
            if not isinstance(msg, dict):
                continue
            kind = msg.get("type")
            if kind in ("add", "remove", "clear") and (not _writes.allow(ip) or not _global_writes.allow("all")):
                await websocket.close(code=1008)
                break
            if kind in ("add", "drawing"):
                stroke = validate_stroke(msg.get("stroke"), owner)
                if stroke is None:
                    continue
                if kind == "drawing":
                    await _broadcast({"type": "drawing", "stroke": stroke}, websocket)
                elif _canvas.add(stroke):
                    evicted = _canvas.gc()
                    await broadcast_op({"type": "add", "stroke": stroke})
                    for sid in evicted:
                        await broadcast_op({"type": "remove", "stroke_id": sid})
                    await persist_canvas_state()
            elif kind == "remove":
                sid = msg.get("stroke_id")
                if isinstance(sid, str) and _canvas.remove(sid, owner):
                    await broadcast_op({"type": "remove", "stroke_id": sid})
                    await persist_canvas_state()
            elif kind == "clear":
                ids = _canvas.clear_by_author(owner)
                for sid in ids:
                    await broadcast_op({"type": "remove", "stroke_id": sid})
                if ids:
                    await persist_canvas_state()
            elif kind == "cursor":
                cursor = msg.get("cursor")
                if valid_point(cursor) and isinstance(cursor.get("color"), str) and _COLOR.fullmatch(cursor["color"]):
                    await _broadcast({"type": "cursor", "cursor": {
                        "x": cursor["x"], "y": cursor["y"], "color": cursor["color"], "author_id": owner,
                    }}, websocket)
    except WebSocketDisconnect:
        pass
    except Exception:
        _logger.exception("Canvas connection failed")
    finally:
        if heartbeat_task:
            heartbeat_task.cancel()
            await asyncio.gather(heartbeat_task, return_exceptions=True)
        _connected_clients.discard(websocket)
        _limits.release(ip)
        await broadcast_user_count()
