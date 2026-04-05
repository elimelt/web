from typing import Any

from fastapi import APIRouter, Query

from api import db

router = APIRouter(tags=["events"])


@router.get("/events")
async def events_history(
    topic: str | None = Query(
        None, description="Event topic (e.g., visitor_updates, chat:general)"
    ),
    event_type: str | None = Query(
        None, description="Event type (e.g., join, leave, chat_message)", alias="type"
    ),
    before: str | None = Query(None, description="ISO8601 timestamp; default now"),
    limit: int = Query(100, ge=1, le=500),
) -> dict[str, Any]:
    events = await db.fetch_events(topic, event_type, before, limit)
    next_before = events[-1]["timestamp"] if events else before
    return {"events": events, "next_before": next_before}
