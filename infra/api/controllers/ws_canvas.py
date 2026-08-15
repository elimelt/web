"""
Collaborative Canvas WebSocket handler with 2P-Set CRDT.

Operations:
- add: Add a new stroke
- remove: Remove a stroke (only by author)
- sync: Request full state
- clear: Clear all strokes by this author
"""

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, field

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from api import state

router = APIRouter(tags=["canvas"])
_logger = logging.getLogger("api.controllers.ws_canvas")

HEARTBEAT_INTERVAL_SEC = int(os.getenv("WS_HEARTBEAT_INTERVAL_SEC", "25"))
PUBSUB_MAX_LIFETIME_SEC = float(os.getenv("WS_PUBSUB_MAX_LIFETIME_SEC", "3600"))
REDIS_CANVAS_KEY = "canvas:state"
REDIS_CANVAS_CHANNEL = "canvas:updates"
MAX_STROKES = 500  # Limit total strokes to prevent unbounded growth


@dataclass
class CanvasCRDT:
    """2P-Set CRDT for canvas strokes."""

    strokes: dict = field(default_factory=dict)  # id -> stroke
    removed: set = field(default_factory=set)  # removed stroke ids

    def add(self, stroke: dict) -> bool:
        """Add a stroke. Returns True if state changed."""
        if stroke["id"] in self.removed:
            return False  # Can't re-add removed stroke
        if stroke["id"] in self.strokes:
            return False  # Already exists
        self.strokes[stroke["id"]] = stroke
        return True

    def remove(self, stroke_id: str, author_id: str) -> bool:
        """Remove a stroke. Only author can remove. Returns True if state changed."""
        stroke = self.strokes.get(stroke_id)
        if not stroke:
            return False
        if stroke["author_id"] != author_id:
            return False  # Not the author
        if stroke_id in self.removed:
            return False  # Already removed
        self.removed.add(stroke_id)
        return True

    def clear_by_author(self, author_id: str) -> list[str]:
        """Clear all strokes by an author. Returns list of removed ids."""
        removed_ids = []
        for sid, stroke in self.strokes.items():
            if stroke["author_id"] == author_id and sid not in self.removed:
                self.removed.add(sid)
                removed_ids.append(sid)
        return removed_ids

    def visible_strokes(self) -> list[dict]:
        """Get all visible (non-removed) strokes, sorted by timestamp."""
        visible = [s for s in self.strokes.values() if s["id"] not in self.removed]
        return sorted(visible, key=lambda s: s["timestamp"])

    def merge(self, other_strokes: list[dict], other_removed: list[str]) -> None:
        """Merge another state into this one."""
        for stroke in other_strokes:
            if stroke["id"] not in self.strokes:
                self.strokes[stroke["id"]] = stroke
        for rid in other_removed:
            self.removed.add(rid)

    def to_dict(self) -> dict:
        return {
            "strokes": list(self.strokes.values()),
            "removed": list(self.removed),
        }

    def gc(self) -> None:
        """Garbage collect old removed strokes and limit total."""
        # Remove tombstones older than 1 hour
        for rid in list(self.removed):
            if rid not in self.strokes:
                self.removed.discard(rid)

        # If too many strokes, remove oldest non-active ones
        visible = self.visible_strokes()
        if len(visible) > MAX_STROKES:
            to_remove = visible[: len(visible) - MAX_STROKES]
            for stroke in to_remove:
                self.removed.add(stroke["id"])


# Global canvas state
_canvas = CanvasCRDT()
_connected_clients: set[WebSocket] = set()
_last_persist_time = 0


async def load_canvas_state() -> None:
    """Load canvas state from Redis on startup."""
    global _canvas
    if state.redis_client is None:
        return
    try:
        data = await state.redis_client.get(REDIS_CANVAS_KEY)
        if data:
            parsed = json.loads(data)
            _canvas.merge(parsed.get("strokes", []), parsed.get("removed", []))
            _logger.info("Loaded canvas state: %d strokes", len(_canvas.strokes))
    except Exception as e:
        _logger.error("Failed to load canvas state: %s", e)


async def persist_canvas_state() -> None:
    """Persist canvas state to Redis."""
    global _last_persist_time
    if state.redis_client is None:
        return
    now = time.time()
    if now - _last_persist_time < 5:  # Debounce: max once per 5 seconds
        return
    _last_persist_time = now
    try:
        _canvas.gc()  # Clean up before persisting
        await state.redis_client.set(REDIS_CANVAS_KEY, json.dumps(_canvas.to_dict()))
    except Exception as e:
        _logger.error("Failed to persist canvas state: %s", e)


async def broadcast_op(op: dict, exclude: WebSocket | None = None) -> None:
    """Broadcast an operation to all connected clients."""
    msg = json.dumps({"type": "op", "op": op})
    disconnected = []
    for ws in _connected_clients:
        if ws is exclude:
            continue
        try:
            await ws.send_text(msg)
        except Exception:
            disconnected.append(ws)
    for ws in disconnected:
        _connected_clients.discard(ws)


async def broadcast_cursor(cursor: dict, exclude: WebSocket | None = None) -> None:
    """Broadcast cursor position to all connected clients."""
    msg = json.dumps({"type": "cursor", "cursor": cursor})
    for ws in _connected_clients:
        if ws is exclude:
            continue
        try:
            await ws.send_text(msg)
        except Exception:
            pass


async def broadcast_drawing(stroke: dict, exclude: WebSocket | None = None) -> None:
    """Broadcast in-progress drawing to all connected clients."""
    msg = json.dumps({"type": "drawing", "stroke": stroke})
    for ws in _connected_clients:
        if ws is exclude:
            continue
        try:
            await ws.send_text(msg)
        except Exception:
            pass


async def broadcast_user_count() -> None:
    """Broadcast current user count to all clients."""
    msg = json.dumps({"type": "user_count", "count": len(_connected_clients)})
    for ws in _connected_clients:
        try:
            await ws.send_text(msg)
        except Exception:
            pass


@router.websocket("/ws/canvas")
async def websocket_canvas(websocket: WebSocket) -> None:
    await websocket.accept()

    client_ip = websocket.headers.get("x-forwarded-for", websocket.client.host)
    if "," in client_ip:
        client_ip = client_ip.split(",")[0].strip()
    client_id = f"{client_ip}:{id(websocket)}"

    _connected_clients.add(websocket)
    _logger.info("Canvas client connected: %s (total: %d)", client_id, len(_connected_clients))

    # Send initial state
    try:
        await websocket.send_text(
            json.dumps({
                "type": "sync",
                "state": {
                    "strokes": _canvas.visible_strokes(),
                    "removed": list(_canvas.removed),
                },
                "client_id": client_id,
                "user_count": len(_connected_clients),
            })
        )
        await broadcast_user_count()
    except Exception as e:
        _logger.error("Failed to send initial state: %s", e)
        _connected_clients.discard(websocket)
        return

    async def heartbeat():
        try:
            while True:
                await asyncio.sleep(HEARTBEAT_INTERVAL_SEC)
                await websocket.send_text(json.dumps({"type": "ping"}))
        except asyncio.CancelledError:
            pass
        except Exception:
            pass

    heartbeat_task = asyncio.create_task(heartbeat())

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            op_type = msg.get("type")

            if op_type == "add":
                stroke = msg.get("stroke")
                if stroke and _canvas.add(stroke):
                    await broadcast_op({"type": "add", "stroke": stroke}, exclude=websocket)
                    await persist_canvas_state()

            elif op_type == "remove":
                stroke_id = msg.get("stroke_id")
                author_id = msg.get("author_id")
                if stroke_id and author_id and _canvas.remove(stroke_id, author_id):
                    await broadcast_op(
                        {"type": "remove", "stroke_id": stroke_id, "author_id": author_id},
                        exclude=websocket,
                    )
                    await persist_canvas_state()

            elif op_type == "clear":
                author_id = msg.get("author_id")
                if author_id:
                    removed_ids = _canvas.clear_by_author(author_id)
                    for sid in removed_ids:
                        await broadcast_op(
                            {"type": "remove", "stroke_id": sid, "author_id": author_id},
                            exclude=websocket,
                        )
                    if removed_ids:
                        await persist_canvas_state()

            elif op_type == "drawing":
                # Real-time drawing progress - broadcast to other clients
                stroke = msg.get("stroke")
                if stroke:
                    await broadcast_drawing(stroke, exclude=websocket)

            elif op_type == "cursor":
                cursor = msg.get("cursor")
                if cursor:
                    cursor["author_id"] = client_id
                    await broadcast_cursor(cursor, exclude=websocket)

            elif op_type == "pong":
                pass  # Client responding to ping

    except WebSocketDisconnect:
        _logger.info("Canvas client disconnected: %s", client_id)
    except Exception as e:
        _logger.error("Canvas WebSocket error: %s", e)
    finally:
        heartbeat_task.cancel()
        _connected_clients.discard(websocket)
        await broadcast_user_count()
        try:
            await asyncio.wait_for(heartbeat_task, timeout=1.0)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            pass
