from datetime import UTC, datetime
from typing import Any

from psycopg import errors as pg_errors

from api.db.core import _get_connection


async def insert_chat_message(
    channel: str,
    sender: str,
    text: str,
    ts_iso: str,
    message_id: str | None = None,
    reply_to: str | None = None,
) -> None:
    ts = datetime.fromisoformat(ts_iso.replace("Z", "+00:00"))
    async with _get_connection() as conn:
        try:
            await conn.execute(
                "INSERT INTO chat_messages (channel, sender, text, ts, message_id, reply_to) VALUES (%s, %s, %s, %s, %s, %s)",
                (channel, sender, text, ts, message_id, reply_to),
            )
        except pg_errors.UndefinedColumn:
            await _ensure_schema()
            await conn.execute(
                "INSERT INTO chat_messages (channel, sender, text, ts) VALUES (%s, %s, %s, %s)",
                (channel, sender, text, ts),
            )


async def fetch_chat_history(
    channel: str, before_iso: str | None, limit: int
) -> list[dict[str, Any]]:
    before_ts = (
        datetime.fromisoformat(before_iso.replace("Z", "+00:00"))
        if before_iso
        else datetime.now(UTC)
    )
    async with _get_connection() as conn:
        try:
            rows = await conn.execute(
                "SELECT channel, sender, text, ts, message_id, reply_to FROM chat_messages WHERE channel=%s AND ts < %s AND deleted_at IS NULL ORDER BY ts DESC LIMIT %s",
                (channel, before_ts, limit),
            )
            result = []
            async for row in rows:
                channel_v, sender, text, ts, mid, reply_to = row
                result.append(
                    {
                        "type": "chat_message",
                        "channel": channel_v,
                        "sender": sender,
                        "text": text,
                        "timestamp": ts.astimezone(UTC).isoformat(),
                        "id": mid,
                        "reply_to": reply_to,
                    }
                )
            return result
        except pg_errors.UndefinedColumn:
            await _ensure_schema()
            rows = await conn.execute(
                "SELECT channel, sender, text, ts FROM chat_messages WHERE channel=%s AND ts < %s AND deleted_at IS NULL ORDER BY ts DESC LIMIT %s",
                (channel, before_ts, limit),
            )
        result = []
        async for row in rows:
            channel_v, sender, text, ts = row
            result.append(
                {
                    "type": "chat_message",
                    "channel": channel_v,
                    "sender": sender,
                    "text": text,
                    "timestamp": ts.astimezone(UTC).isoformat(),
                }
            )
        return result


async def fetch_chat_analytics(channel: str) -> dict[str, int]:
    """Fetch message count and unique sender count for a channel."""
    async with _get_connection() as conn:
        rows = await conn.execute(
            """
            SELECT COUNT(*) AS messages, COUNT(DISTINCT sender) AS senders
            FROM chat_messages
            WHERE channel = %s AND deleted_at IS NULL
            """,
            (channel,),
        )
        async for row in rows:
            return {"messages": row[0], "senders": row[1]}
        return {"messages": 0, "senders": 0}


async def soft_delete_chat_history(
    channel: str | None = None, before_iso: str | None = None
) -> int:
    conditions: list[str] = ["deleted_at IS NULL"]
    params: list[Any] = []
    if channel:
        conditions.append("channel = %s")
        params.append(channel)
    if before_iso:
        before_ts = datetime.fromisoformat(before_iso.replace("Z", "+00:00"))
        conditions.append("ts < %s")
        params.append(before_ts)
    where = " AND ".join(conditions) if conditions else "TRUE"
    sql = f"UPDATE chat_messages SET deleted_at = %s WHERE {where} RETURNING id"
    now_ts = datetime.now(UTC)
    async with _get_connection() as conn:
        rows = await conn.execute(sql, tuple([now_ts] + params))
        count = 0
        async for _ in rows:
            count += 1
        return count
