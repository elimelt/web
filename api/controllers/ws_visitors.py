import asyncio
import json
import logging
import os

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from api import db, state
from api.producers.visitor_producer import heartbeat as hb
from api.producers.visitor_producer import join_visitor, leave_visitor
from api.redis_pubsub import managed_pubsub

router = APIRouter(tags=["visitors"])

_logger = logging.getLogger("api.ws.visitors")
if not _logger.handlers:
    _handler = logging.StreamHandler()
    _fmt = logging.Formatter("[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s")
    _handler.setFormatter(_fmt)
    _logger.addHandler(_handler)
_logger.setLevel(logging.INFO if os.getenv("WS_DEBUG", "0") == "1" else logging.WARNING)
_logger.propagate = False

# Configuration
HEARTBEAT_INTERVAL_SEC = int(os.getenv("WS_VISITOR_HEARTBEAT_SEC", "10"))
PUBSUB_MAX_LIFETIME_SEC = float(os.getenv("WS_PUBSUB_MAX_LIFETIME_SEC", "3600"))


async def _handle_analytics_batch(data: dict, client_ip: str) -> None:
    payload = data.get("payload", {})
    topic = payload.get("topic")
    events = payload.get("events", [])

    if topic != "clicks":
        _logger.warning(
            "analytics.batch unknown topic=%s ip=%s",
            topic,
            client_ip,
        )
        return

    if not events:
        return

    try:
        inserted = await db.insert_click_events(events, client_ip)
        _logger.info(
            "analytics.batch.clicks ip=%s count=%d inserted=%d",
            client_ip,
            len(events),
            inserted,
        )
    except Exception:
        _logger.exception("analytics.batch.clicks failed ip=%s", client_ip)


async def _decrement_visitor_count(client_ip: str) -> None:
    """Safely decrement the visitor count for an IP."""
    async with state.ws_visitors_lock:
        if client_ip in state.active_ws_visitors_by_ip:
            state.active_ws_visitors_by_ip[client_ip] = max(
                0, state.active_ws_visitors_by_ip[client_ip] - 1
            )
            if state.active_ws_visitors_by_ip[client_ip] == 0:
                del state.active_ws_visitors_by_ip[client_ip]


@router.websocket("/ws/visitors")
async def websocket_visitors(websocket: WebSocket) -> None:
    await websocket.accept()

    client_ip = websocket.headers.get("x-forwarded-for", websocket.client.host)
    if "," in client_ip:
        client_ip = client_ip.split(",")[0].strip()

    origin = websocket.headers.get("origin", "-")
    user_agent = websocket.headers.get("user-agent", "-")
    logger = _logger
    max_per_ip = int(os.getenv("WS_VISITORS_MAX_PER_IP", "50"))

    async with state.ws_visitors_lock:
        current = state.active_ws_visitors_by_ip.get(client_ip, 0) + 1
        state.active_ws_visitors_by_ip[client_ip] = current
        if current > max_per_ip:
            logger.info(
                "ws_visitors.reject ip=%s reason=per_ip_limit current=%s limit=%s origin=%s ua=%s",
                client_ip,
                current,
                max_per_ip,
                origin,
                user_agent,
            )
            await websocket.close(code=1008)
            state.active_ws_visitors_by_ip[client_ip] = current - 1
            return
    logger.info(
        "ws_visitors.accept ip=%s origin=%s ua=%s active_per_ip=%s",
        client_ip,
        origin,
        user_agent,
        state.active_ws_visitors_by_ip.get(client_ip),
    )

    # Check if Redis is available
    if state.redis_client is None:
        logger.warning("ws_visitors.reject ip=%s reason=redis_unavailable", client_ip)
        await _decrement_visitor_count(client_ip)
        await websocket.close(code=1011, reason="Service temporarily unavailable")
        return

    visitor_id = f"visitor:{client_ip}:{id(websocket)}"

    # Join visitor first (before pubsub)
    try:
        visitor_data = await join_visitor(
            state.redis_client, state.event_bus, state.geoip_reader, client_ip, visitor_id
        )
    except Exception as e:
        logger.warning("ws_visitors.reject ip=%s reason=join_error error=%s", client_ip, e)
        await _decrement_visitor_count(client_ip)
        await websocket.close(code=1011, reason="Service temporarily unavailable")
        return

    try:
        async with managed_pubsub(
            state.redis_client,
            "visitor_updates",
            client_info=f"visitor:{visitor_id}",
            max_lifetime_sec=PUBSUB_MAX_LIFETIME_SEC,
        ) as ps:
            await _handle_visitor_connection(
                websocket, ps, client_ip, visitor_id, visitor_data, logger
            )
    except Exception as e:
        logger.warning("ws_visitors.error ip=%s error=%s", client_ip, e)
    finally:
        # Always cleanup visitor state
        try:
            await leave_visitor(state.redis_client, state.event_bus, client_ip, visitor_id)
        except Exception as e:
            _logger.warning("Error in leave_visitor: %s", e)

        await _decrement_visitor_count(client_ip)
        logger.info("ws_visitors.close ip=%s", client_ip)


async def _handle_visitor_connection(
    websocket: WebSocket,
    ps,
    client_ip: str,
    visitor_id: str,
    visitor_data: dict,
    logger,
) -> None:
    """Handle the visitor WebSocket connection with managed pubsub."""

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
                await hb(state.redis_client, visitor_id, visitor_data)
                await websocket.send_text(json.dumps({"type": "ping"}))
        except asyncio.CancelledError:
            pass
        except Exception:
            pass

    update_task = asyncio.create_task(send_updates())
    heartbeat_task = asyncio.create_task(heartbeat())

    try:
        while True:
            data = await websocket.receive_text()
            if data == "pong":
                continue

            try:
                msg = json.loads(data)
                if isinstance(msg, dict) and msg.get("type") == "analytics.batch":
                    asyncio.create_task(_handle_analytics_batch(msg, client_ip))
            except (json.JSONDecodeError, TypeError):
                pass
    except WebSocketDisconnect:
        pass
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
            _logger.debug("Timeout waiting for visitor tasks to cancel")
