from typing import Literal, TypedDict


class Location(TypedDict, total=False):
    country: str
    city: str
    lat: float | None
    lon: float | None


class Visitor(TypedDict):
    ip: str
    location: Location
    connected_at: str


class JoinEvent(TypedDict):
    type: Literal["join"]
    visitor: Visitor


class LeaveEvent(TypedDict):
    type: Literal["leave"]
    ip: str


class PingEvent(TypedDict):
    type: Literal["ping"]


VisitorEvent = JoinEvent | LeaveEvent | PingEvent


class ChatMessageEvent(TypedDict):
    type: Literal["chat_message"]
    channel: str
    sender: str
    text: str
    timestamp: str
    id: str | None
    reply_to: str | None
