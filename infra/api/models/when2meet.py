from pydantic import BaseModel


class Event(BaseModel):
    id: str
    name: str
    description: str | None = None
    dates: list[str]
    time_slots: list[str]
    created_at: str
    creator_name: str | None = None


class Availability(BaseModel):
    participant_name: str
    available_slots: list[str]
    created_at: str
    updated_at: str


class EventResponse(BaseModel):
    event: Event
    availabilities: list[Availability]
    summary: dict[str, int]
