import json
import secrets
import string
from datetime import UTC, datetime
from typing import Any

from psycopg import errors as pg_errors

from api.db.core import _get_connection


def _generate_event_id(length: int = 10) -> str:
    chars = string.ascii_lowercase + string.digits
    return "".join(secrets.choice(chars) for _ in range(length))


async def w2m_create_event(
    name: str,
    dates: list[str],
    time_slots: list[str],
    description: str | None = None,
    creator_name: str | None = None,
) -> dict[str, Any]:
    now = datetime.now(UTC)
    async with _get_connection() as conn:
        for _ in range(10):
            event_id = _generate_event_id()
            try:
                await conn.execute(
                    """INSERT INTO w2m_events (id, name, description, dates, time_slots, created_at, creator_name)
                       VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                    (
                        event_id,
                        name,
                        description,
                        json.dumps(dates),
                        json.dumps(time_slots),
                        now,
                        creator_name,
                    ),
                )
                return {
                    "id": event_id,
                    "name": name,
                    "description": description,
                    "dates": dates,
                    "time_slots": time_slots,
                    "created_at": now.isoformat(),
                    "creator_name": creator_name,
                }
            except pg_errors.UniqueViolation:
                continue
        raise RuntimeError("Failed to generate unique event ID")


async def w2m_get_event(event_id: str) -> dict[str, Any] | None:
    async with _get_connection() as conn:
        rows = await conn.execute(
            "SELECT id, name, description, dates, time_slots, created_at, creator_name FROM w2m_events WHERE id = %s",
            (event_id,),
        )
        row = await rows.fetchone()
        if not row:
            return None
        return {
            "id": row[0],
            "name": row[1],
            "description": row[2],
            "dates": row[3],
            "time_slots": row[4],
            "created_at": row[5].astimezone(UTC).isoformat(),
            "creator_name": row[6],
        }


async def w2m_get_availabilities(event_id: str) -> list[dict[str, Any]]:
    async with _get_connection() as conn:
        rows = await conn.execute(
            "SELECT participant_name, available_slots, created_at, updated_at FROM w2m_availabilities WHERE event_id = %s",
            (event_id,),
        )
        result = []
        async for row in rows:
            result.append(
                {
                    "participant_name": row[0],
                    "available_slots": row[1],
                    "created_at": row[2].astimezone(UTC).isoformat(),
                    "updated_at": row[3].astimezone(UTC).isoformat(),
                }
            )
        return result


async def w2m_get_availability(event_id: str, participant_name: str) -> dict[str, Any] | None:
    async with _get_connection() as conn:
        row = await (
            await conn.execute(
                "SELECT available_slots, password_hash, created_at, updated_at FROM w2m_availabilities WHERE event_id = %s AND participant_name = %s",
                (event_id, participant_name),
            )
        ).fetchone()
        if not row:
            return None
        return {
            "available_slots": row[0],
            "password_hash": row[1],
            "created_at": row[2].astimezone(UTC).isoformat(),
            "updated_at": row[3].astimezone(UTC).isoformat(),
        }


async def w2m_upsert_availability(
    event_id: str,
    participant_name: str,
    available_slots: list[str],
    password_hash: str | None = None,
) -> dict[str, Any]:
    now = datetime.now(UTC)
    async with _get_connection() as conn:
        if password_hash is not None:
            await conn.execute(
                """INSERT INTO w2m_availabilities (event_id, participant_name, available_slots, password_hash, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s)
                   ON CONFLICT (event_id, participant_name) DO UPDATE SET available_slots = EXCLUDED.available_slots, updated_at = EXCLUDED.updated_at""",
                (event_id, participant_name, json.dumps(available_slots), password_hash, now, now),
            )
        else:
            await conn.execute(
                """INSERT INTO w2m_availabilities (event_id, participant_name, available_slots, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (event_id, participant_name) DO UPDATE SET available_slots = EXCLUDED.available_slots, updated_at = EXCLUDED.updated_at""",
                (event_id, participant_name, json.dumps(available_slots), now, now),
            )
        return {
            "event_id": event_id,
            "participant_name": participant_name,
            "available_slots": available_slots,
            "updated_at": now.isoformat(),
        }
