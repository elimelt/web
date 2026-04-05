"""Analytics repository module for visitor and click analytics."""

from datetime import UTC, datetime
from typing import Any

from psycopg.types.json import Json

from api.db.core import _get_connection


async def upsert_visitor_stats(
    visitor_ip: str,
    period_start: datetime,
    period_end: datetime,
    total_visits: int,
    total_time_seconds: float,
    avg_session_duration_seconds: float,
    is_recurring: bool,
    first_visit_at: datetime | None,
    last_visit_at: datetime | None,
    visit_frequency_per_day: float,
    location_country: str | None = None,
    location_city: str | None = None,
) -> dict[str, Any]:
    """Insert or update visitor statistics for a given IP and time period."""
    now = datetime.now(UTC)
    async with _get_connection() as conn:
        await conn.execute(
            """
            INSERT INTO visitor_stats (
                visitor_ip, computed_at, period_start, period_end,
                total_visits, total_time_seconds, avg_session_duration_seconds,
                is_recurring, first_visit_at, last_visit_at,
                visit_frequency_per_day, location_country, location_city
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (visitor_ip, period_start, period_end) DO UPDATE SET
                computed_at = EXCLUDED.computed_at,
                total_visits = EXCLUDED.total_visits,
                total_time_seconds = EXCLUDED.total_time_seconds,
                avg_session_duration_seconds = EXCLUDED.avg_session_duration_seconds,
                is_recurring = EXCLUDED.is_recurring,
                first_visit_at = EXCLUDED.first_visit_at,
                last_visit_at = EXCLUDED.last_visit_at,
                visit_frequency_per_day = EXCLUDED.visit_frequency_per_day,
                location_country = EXCLUDED.location_country,
                location_city = EXCLUDED.location_city
            """,
            (
                visitor_ip,
                now,
                period_start,
                period_end,
                total_visits,
                total_time_seconds,
                avg_session_duration_seconds,
                is_recurring,
                first_visit_at,
                last_visit_at,
                visit_frequency_per_day,
                location_country,
                location_city,
            ),
        )
        return {
            "visitor_ip": visitor_ip,
            "computed_at": now.isoformat(),
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "total_visits": total_visits,
            "total_time_seconds": total_time_seconds,
            "avg_session_duration_seconds": avg_session_duration_seconds,
            "is_recurring": is_recurring,
            "first_visit_at": first_visit_at.isoformat() if first_visit_at else None,
            "last_visit_at": last_visit_at.isoformat() if last_visit_at else None,
            "visit_frequency_per_day": visit_frequency_per_day,
            "location_country": location_country,
            "location_city": location_city,
        }


async def fetch_visitor_stats(
    visitor_ip: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    is_recurring: bool | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Fetch visitor statistics with optional filters."""
    clauses: list[str] = []
    params: list[Any] = []

    if visitor_ip:
        clauses.append("visitor_ip = %s")
        params.append(visitor_ip)
    if start_date:
        start_ts = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
        clauses.append("period_end >= %s")
        params.append(start_ts)
    if end_date:
        end_ts = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
        clauses.append("period_start <= %s")
        params.append(end_ts)
    if is_recurring is not None:
        clauses.append("is_recurring = %s")
        params.append(is_recurring)

    where = " AND ".join(clauses) if clauses else "TRUE"
    sql = f"""
        SELECT visitor_ip, computed_at, period_start, period_end,
               total_visits, total_time_seconds, avg_session_duration_seconds,
               is_recurring, first_visit_at, last_visit_at,
               visit_frequency_per_day, location_country, location_city
        FROM visitor_stats
        WHERE {where}
        ORDER BY computed_at DESC
        LIMIT %s
    """
    params.append(limit)

    async with _get_connection() as conn:
        rows = await conn.execute(sql, tuple(params))
        result: list[dict[str, Any]] = []
        async for row in rows:
            result.append(
                {
                    "visitor_ip": row[0],
                    "computed_at": row[1].astimezone(UTC).isoformat(),
                    "period_start": row[2].astimezone(UTC).isoformat(),
                    "period_end": row[3].astimezone(UTC).isoformat(),
                    "total_visits": row[4],
                    "total_time_seconds": row[5],
                    "avg_session_duration_seconds": row[6],
                    "is_recurring": row[7],
                    "first_visit_at": row[8].astimezone(UTC).isoformat() if row[8] else None,
                    "last_visit_at": row[9].astimezone(UTC).isoformat() if row[9] else None,
                    "visit_frequency_per_day": row[10],
                    "location_country": row[11],
                    "location_city": row[12],
                }
            )
        return result


async def fetch_visitor_events_for_analytics(
    start_time: datetime,
    end_time: datetime,
) -> list[dict[str, Any]]:
    """Fetch visitor join/leave events from the events table for analytics processing."""
    sql = """
        SELECT ts, type, payload
        FROM events
        WHERE topic = 'visitor_updates'
          AND type IN ('join', 'leave')
          AND ts >= %s AND ts < %s
        ORDER BY ts ASC
    """
    async with _get_connection() as conn:
        rows = await conn.execute(sql, (start_time, end_time))
        result: list[dict[str, Any]] = []
        async for row in rows:
            result.append(
                {
                    "timestamp": row[0].astimezone(UTC).isoformat(),
                    "type": row[1],
                    "payload": row[2],
                }
            )
        return result


async def get_visitor_analytics_summary(
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict[str, Any]:
    """Get aggregate summary of visitor analytics."""
    clauses: list[str] = []
    params: list[Any] = []

    if start_date:
        start_ts = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
        clauses.append("period_end >= %s")
        params.append(start_ts)
    if end_date:
        end_ts = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
        clauses.append("period_start <= %s")
        params.append(end_ts)

    where = " AND ".join(clauses) if clauses else "TRUE"
    sql = f"""
        SELECT
            COUNT(DISTINCT visitor_ip) as unique_visitors,
            SUM(total_visits) as total_visits,
            AVG(avg_session_duration_seconds) as avg_session_duration,
            SUM(total_time_seconds) as total_time_spent,
            COUNT(*) FILTER (WHERE is_recurring) as recurring_visitors,
            AVG(visit_frequency_per_day) as avg_visit_frequency
        FROM visitor_stats
        WHERE {where}
    """

    async with _get_connection() as conn:
        rows = await conn.execute(sql, tuple(params))
        row = await rows.fetchone()
        if not row:
            return {
                "unique_visitors": 0,
                "total_visits": 0,
                "avg_session_duration_seconds": 0,
                "total_time_spent_seconds": 0,
                "recurring_visitors": 0,
                "avg_visit_frequency_per_day": 0,
            }
        return {
            "unique_visitors": row[0] or 0,
            "total_visits": row[1] or 0,
            "avg_session_duration_seconds": float(row[2]) if row[2] else 0,
            "total_time_spent_seconds": float(row[3]) if row[3] else 0,
            "recurring_visitors": row[4] or 0,
            "avg_visit_frequency_per_day": float(row[5]) if row[5] else 0,
        }


async def insert_click_events(events: list[dict[str, Any]], client_ip: str) -> int:
    """Insert a batch of click events into the events table.

    Each click event is stored with topic='clicks' and type='click'.
    The client_ip is added to the payload for attribution.

    Returns the number of events inserted.
    """
    if not events:
        return 0

    inserted = 0
    async with _get_connection() as conn:
        for event in events:
            ts_ms = event.get("ts")
            if ts_ms and isinstance(ts_ms, int | float):
                ts = datetime.fromtimestamp(ts_ms / 1000, tz=UTC)
            else:
                ts = datetime.now(UTC)

            payload = {**event, "client_ip": client_ip}

            await conn.execute(
                "INSERT INTO events (topic, type, ts, payload) VALUES (%s, %s, %s, %s)",
                ("clicks", "click", ts, Json(payload)),
            )
            inserted += 1

    return inserted


async def fetch_click_events(
    start_date: str | None = None,
    end_date: str | None = None,
    page_path: str | None = None,
    client_ip: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Fetch click events with optional filters."""
    clauses: list[str] = ["topic = 'clicks'", "type = 'click'"]
    params: list[Any] = []

    if start_date:
        start_ts = datetime.fromisoformat(start_date.replace("Z", "+00:00"))
        clauses.append("ts >= %s")
        params.append(start_ts)
    if end_date:
        end_ts = datetime.fromisoformat(end_date.replace("Z", "+00:00"))
        clauses.append("ts < %s")
        params.append(end_ts)
    if page_path:
        clauses.append("payload->>'page'->>'path' = %s")
        params.append(page_path)
    if client_ip:
        clauses.append("payload->>'client_ip' = %s")
        params.append(client_ip)

    where = " AND ".join(clauses)
    sql = f"""
        SELECT ts, payload
        FROM events
        WHERE {where}
        ORDER BY ts DESC
        LIMIT %s
    """
    params.append(limit)

    async with _get_connection() as conn:
        rows = await conn.execute(sql, tuple(params))
        result: list[dict[str, Any]] = []
        async for row in rows:
            result.append(
                {
                    "timestamp": row[0].astimezone(UTC).isoformat(),
                    "event": row[1],
                }
            )
        return result
