"""Pydantic response models for the visitors API."""

from pydantic import BaseModel


class Location(BaseModel):
    """Geographic location information for a visitor."""

    country: str
    city: str
    lat: float | None = None
    lon: float | None = None


class Visitor(BaseModel):
    """Active visitor information."""

    ip: str
    location: Location
    connected_at: str


class VisitRecord(BaseModel):
    """Record of a recent visit from the visit log."""

    ip: str
    location: Location
    timestamp: str


class VisitorsResponse(BaseModel):
    """Response model for the /visitors endpoint."""

    active_count: int
    active_visitors: list[Visitor]
    recent_visits: list[VisitRecord]
