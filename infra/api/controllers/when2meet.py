import hashlib
import logging
import re
from collections import Counter
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from api import db
from api.models.when2meet import Availability, Event, EventResponse

logger = logging.getLogger("api.when2meet")
router = APIRouter(tags=["when2meet"])


def _hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
SLOT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:00Z$")


class CreateEventRequest(BaseModel):
    name: str
    description: str | None = None
    dates: list[str]
    time_slots: list[str]
    creator_name: str | None = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 200:
            raise ValueError("name must be 1-200 characters")
        return v

    @field_validator("dates")
    @classmethod
    def validate_dates(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("dates must not be empty")
        for d in v:
            if not DATE_RE.match(d):
                raise ValueError(f"invalid date format: {d}")
        return v

    @field_validator("time_slots")
    @classmethod
    def validate_time_slots(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("time_slots must not be empty")
        for t in v:
            if not TIME_RE.match(t):
                raise ValueError(f"invalid time format: {t}")
        return v


class AvailabilityRequest(BaseModel):
    participant_name: str
    available_slots: list[str]
    password: str | None = None

    @field_validator("participant_name")
    @classmethod
    def validate_participant_name(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 100:
            raise ValueError("participant_name must be 1-100 characters")
        return v

    @field_validator("available_slots")
    @classmethod
    def validate_available_slots(cls, v: list[str]) -> list[str]:
        for s in v:
            if not SLOT_RE.match(s):
                raise ValueError(f"invalid slot format: {s}")
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str | None) -> str | None:
        if v is not None and len(v) > 200:
            raise ValueError("password must be at most 200 characters")
        return v


@router.get("/events/{event_id}", response_model=EventResponse)
async def get_event(event_id: str) -> EventResponse:
    logger.info("GET /events/%s", event_id)
    event_data = await db.w2m_get_event(event_id)
    if not event_data:
        logger.warning("Event not found: %s", event_id)
        raise HTTPException(status_code=404, detail="Event not found")
    availabilities_data = await db.w2m_get_availabilities(event_id)
    slot_counts: Counter[str] = Counter()
    for a in availabilities_data:
        for slot in a["available_slots"]:
            slot_counts[slot] += 1
    logger.info("Returning event %s with %d availabilities", event_id, len(availabilities_data))
    return EventResponse(
        event=Event(**event_data),
        availabilities=[Availability(**a) for a in availabilities_data],
        summary=dict(slot_counts),
    )


@router.post("/events", status_code=201)
async def create_event(req: CreateEventRequest) -> dict[str, Any]:
    logger.info(
        "POST /events name=%s dates=%d time_slots=%d", req.name, len(req.dates), len(req.time_slots)
    )
    try:
        event = await db.w2m_create_event(
            name=req.name,
            dates=req.dates,
            time_slots=req.time_slots,
            description=req.description,
            creator_name=req.creator_name,
        )
        logger.info("Created event id=%s", event["id"])
        return event
    except Exception as e:
        logger.exception("Failed to create event")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/events/{event_id}/availability")
async def submit_availability(event_id: str, req: AvailabilityRequest) -> dict[str, Any]:
    logger.info(
        "POST /events/%s/availability participant=%s slots=%d",
        event_id,
        req.participant_name,
        len(req.available_slots),
    )
    event = await db.w2m_get_event(event_id)
    if not event:
        logger.warning("Event not found: %s", event_id)
        raise HTTPException(status_code=404, detail="Event not found")
    valid_slots = {f"{d}T{t}:00Z" for d in event["dates"] for t in event["time_slots"]}
    for slot in req.available_slots:
        if slot not in valid_slots:
            logger.warning("Invalid slot %s for event %s", slot, event_id)
            raise HTTPException(status_code=400, detail=f"Invalid slot: {slot}")
    existing = await db.w2m_get_availability(event_id, req.participant_name)
    if existing and existing.get("password_hash"):
        if not req.password:
            raise HTTPException(status_code=403, detail="Password required")
        if _hash_password(req.password) != existing["password_hash"]:
            logger.warning("Wrong password for %s on event %s", req.participant_name, event_id)
            raise HTTPException(status_code=403, detail="Wrong password")
    password_hash = _hash_password(req.password) if req.password and not existing else None
    try:
        result = await db.w2m_upsert_availability(
            event_id, req.participant_name, req.available_slots, password_hash
        )
        logger.info("Upserted availability for %s on event %s", req.participant_name, event_id)
        return result
    except Exception as e:
        logger.exception("Failed to upsert availability")
        raise HTTPException(status_code=500, detail=str(e)) from e
