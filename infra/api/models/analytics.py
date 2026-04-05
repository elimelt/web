"""Pydantic response models for analytics endpoints."""

from typing import Any

from pydantic import BaseModel

# Click Analytics Models


class ClickEvent(BaseModel):
    """A single click event."""

    timestamp: str
    event: dict[str, Any]


class ClickFilters(BaseModel):
    """Filters applied to click events query."""

    start_date: str | None = None
    end_date: str | None = None
    page_path: str | None = None
    limit: int


class ClickEventsResponse(BaseModel):
    """Response model for GET /analytics/clicks."""

    events: list[ClickEvent]
    count: int
    filters: ClickFilters | None = None
    error: str | None = None


# Visitor Analytics Models


class VisitorStats(BaseModel):
    """Statistics for a single visitor."""

    visitor_ip: str
    computed_at: str
    period_start: str
    period_end: str
    total_visits: int
    total_time_seconds: float
    avg_session_duration_seconds: float
    is_recurring: bool
    first_visit_at: str | None = None
    last_visit_at: str | None = None
    visit_frequency_per_day: float | None = None
    location_country: str | None = None
    location_city: str | None = None


class VisitorFilters(BaseModel):
    """Filters applied to visitor analytics query."""

    visitor_id: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    segment: str | None = None
    limit: int


class VisitorAnalyticsResponse(BaseModel):
    """Response model for GET /visitor-analytics."""

    visitors: list[VisitorStats]
    count: int
    filters: VisitorFilters


class SummaryFilters(BaseModel):
    """Filters applied to analytics summary query."""

    start_date: str | None = None
    end_date: str | None = None


class VisitorSummary(BaseModel):
    """Aggregate summary of visitor analytics."""

    unique_visitors: int
    total_visits: int
    avg_session_duration_seconds: float
    total_time_spent_seconds: float
    recurring_visitors: int
    avg_visit_frequency_per_day: float


class VisitorAnalyticsSummaryResponse(BaseModel):
    """Response model for GET /visitor-analytics/summary."""

    summary: VisitorSummary
    filters: SummaryFilters


class VisitorByIdFilters(BaseModel):
    """Filters for visitor by ID query (minimal version)."""

    start_date: str | None = None
    end_date: str | None = None
    limit: int


class VisitorAnalyticsByIdResponse(BaseModel):
    """Response model for GET /visitor-analytics/{visitor_id}."""

    visitor_id: str
    records: list[VisitorStats]
    count: int
    message: str | None = None
