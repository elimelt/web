from datetime import UTC, datetime
from typing import Any

from psycopg.types.json import Json

from api.db.core import _get_connection


async def insert_event(topic: str, event_type: str, payload: dict, ts_iso: str) -> None:
    ts = datetime.fromisoformat(ts_iso.replace("Z", "+00:00"))
    async with _get_connection() as conn:
        await conn.execute(
            "INSERT INTO events (topic, type, ts, payload) VALUES (%s, %s, %s, %s)",
            (topic, event_type, ts, Json(payload)),
        )


async def fetch_events(
    topic: str | None,
    event_type: str | None,
    before_iso: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    before_ts = (
        datetime.fromisoformat(before_iso.replace("Z", "+00:00"))
        if before_iso
        else datetime.now(UTC)
    )
    clauses = ["ts < %s"]
    params: list[Any] = [before_ts]
    if topic:
        clauses.append("topic = %s")
        params.append(topic)
    if event_type:
        clauses.append("type = %s")
        params.append(event_type)
    where = " AND ".join(clauses)
    sql = f"SELECT topic, type, ts, payload FROM events WHERE {where} ORDER BY ts DESC LIMIT %s"
    params.append(limit)
    async with _get_connection() as conn:
        rows = await conn.execute(sql, tuple(params))
        out: list[dict[str, Any]] = []
        async for row in rows:
            topic_v, type_v, ts, payload = row
            out.append(
                {
                    "topic": topic_v,
                    "type": type_v,
                    "timestamp": ts.astimezone(UTC).isoformat(),
                    "payload": payload,
                }
            )
        return out
