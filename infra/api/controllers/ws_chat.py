import asyncio
import json
import logging
import os

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from api import state
from api.bus import EventBus
from api.producers.chat_producer import build_chat_message, publish_chat_message
from api.redis_pubsub import managed_pubsub

router = APIRouter(tags=["chat"])
_logger = logging.getLogger("api.controllers.ws_chat")

# Configuration
HEARTBEAT_INTERVAL_SEC = int(os.getenv("WS_HEARTBEAT_INTERVAL_SEC", "25"))
PUBSUB_MAX_LIFETIME_SEC = float(os.getenv("WS_PUBSUB_MAX_LIFETIME_SEC", "3600"))


@router.websocket("/ws/chat/{channel}")
async def websocket_chat(websocket: WebSocket, channel: str) -> None:
    await websocket.accept()

    client_ip = websocket.headers.get("x-forwarded-for", websocket.client.host)
    if "," in client_ip:
        client_ip = client_ip.split(",")[0].strip()
    sender = f"{client_ip}:{id(websocket)}"

    # Check if Redis is available
    if state.redis_client is None:
        _logger.warning("ws_chat.reject ip=%s reason=redis_unavailable", client_ip)
        await websocket.close(code=1011, reason="Service temporarily unavailable")
        return

    redis_channel = EventBus.chat_channel(channel)

    try:
        async with managed_pubsub(
            state.redis_client,
            redis_channel,
            client_info=f"chat:{sender}",
            max_lifetime_sec=PUBSUB_MAX_LIFETIME_SEC,
        ) as ps:
            await _handle_chat_connection(websocket, ps, channel, sender)
    except Exception as e:
        _logger.warning("ws_chat.reject ip=%s reason=redis_error error=%s", client_ip, e)
        try:
            await websocket.close(code=1011, reason="Service temporarily unavailable")
        except Exception:
            pass


async def _handle_chat_connection(
    websocket: WebSocket,
    ps,
    channel: str,
    sender: str,
) -> None:
    """Handle the chat WebSocket connection with managed pubsub."""

    async def send_updates():
        try:
            async for message in ps.listen():
                if message["type"] == "message":
                    await websocket.send_text(message["data"])
        except asyncio.CancelledError:
            pass
        except Exception:
            pass

    async def heartbeat():
        try:
            while True:
                await asyncio.sleep(HEARTBEAT_INTERVAL_SEC)
                await websocket.send_text(json.dumps({"type": "ping"}))
        except asyncio.CancelledError:
            pass
        except Exception:
            pass

    update_task = asyncio.create_task(send_updates())
    heartbeat_task = asyncio.create_task(heartbeat())

    try:
        while True:
            raw = await websocket.receive_text()
            _logger.debug("[ws_chat] Received raw message: %s", raw[:500] if raw else "<empty>")
            try:
                payload = json.loads(raw)
                text = payload.get("text")
                if not text:
                    _logger.debug("[ws_chat] No text in payload, skipping")
                    continue
            except Exception as e:
                _logger.debug("[ws_chat] Failed to parse payload: %s", e)
                continue
            _logger.info(
                "[ws_chat] Human message from %s on channel=%s: %s",
                sender,
                channel,
                text[:200] if text else "<empty>",
            )
            event = build_chat_message(channel=channel, sender=sender, text=text)
            _logger.debug("[ws_chat] Built event: %s", event)
            await publish_chat_message(state.event_bus, channel, event)
            _logger.debug("[ws_chat] Published message to channel=%s", channel)
    except WebSocketDisconnect:
        _logger.debug("[ws_chat] WebSocket disconnected for %s", sender)
    finally:
        update_task.cancel()
        heartbeat_task.cancel()
        # Wait for tasks to actually cancel
        try:
            await asyncio.wait_for(
                asyncio.gather(update_task, heartbeat_task, return_exceptions=True),
                timeout=2.0,
            )
        except asyncio.TimeoutError:
            _logger.debug("[ws_chat] Timeout waiting for tasks to cancel")
