import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from psycopg.errors import UndefinedFunction

from api import db
from api.models.analytics import (
    VisitorAnalyticsByIdResponse,
    VisitorAnalyticsResponse,
    VisitorAnalyticsSummaryResponse,
)

from api.visitor_id import check_iso_date, hmac_key, visitor_id

router = APIRouter(tags=["visitors"])
logger = logging.getLogger("api.controllers.visitor_analytics")

# Fallback only (pgcrypto missing): scan this many recent rows, filter in Python.
ID_FILTER_SCAN_LIMIT = 10000


def _public_rows(rows: list[dict[str, Any]], vid: str | None) -> list[dict[str, Any]]:
    out = []
    for row in rows:
        row = dict(row)
        row["id"] = visitor_id(row.pop("visitor_ip"))
        if vid is None or row["id"] == vid:
            out.append(row)
    return out


async def _fetch_public_stats(
    vid: str | None,
    start_date: str | None,
    end_date: str | None,
    limit: int,
    is_recurring: bool | None = None,
) -> list[dict[str, Any]]:
    """Fetch visitor stats with the IP replaced by the pseudonymous id."""
    common = {"start_date": start_date, "end_date": end_date, "is_recurring": is_recurring}
    if vid is None:
        return _public_rows(await db.fetch_visitor_stats(limit=limit, **common), None)
    try:
        rows = await db.fetch_visitor_stats(
            limit=limit, visitor_id=vid, visitor_key=hmac_key(), **common
        )
        # Re-check in Python as defense in depth; the SQL already filtered.
        return _public_rows(rows, vid)[:limit]
    except UndefinedFunction:
        logger.warning("pgcrypto unavailable; scanning visitor stats in Python", exc_info=True)
    rows = await db.fetch_visitor_stats(limit=ID_FILTER_SCAN_LIMIT, **common)
    return _public_rows(rows, vid)[:limit]


@router.get("/visitor-analytics", response_model=VisitorAnalyticsResponse)
async def get_visitor_analytics(
    visitor_id_filter: str | None = Query(
        None,
        description="Filter by pseudonymous visitor id",
        alias="visitor_id",
    ),
    start_date: str | None = Query(
        None,
        description="Filter by start date (ISO8601 format, e.g., 2025-01-01T00:00:00Z)",
    ),
    end_date: str | None = Query(
        None,
        description="Filter by end date (ISO8601 format, e.g., 2025-01-31T23:59:59Z)",
    ),
    recurring_only: bool | None = Query(
        None,
        description="Filter to show only recurring visitors (true) or non-recurring (false)",
        alias="segment",
    ),
    limit: int = Query(
        100,
        ge=1,
        le=1000,
        description="Maximum number of records to return",
    ),
) -> dict[str, Any]:
    check_iso_date("start_date", start_date)
    check_iso_date("end_date", end_date)
    try:
        stats = await _fetch_public_stats(
            visitor_id_filter, start_date, end_date, limit, recurring_only
        )

        return {
            "visitors": stats,
            "count": len(stats),
            "filters": {
                "visitor_id": visitor_id_filter,
                "start_date": start_date,
                "end_date": end_date,
                "segment": (
                    "recurring"
                    if recurring_only is True
                    else ("non-recurring" if recurring_only is False else None)
                ),
                "limit": limit,
            },
        }
    except Exception as e:
        logger.exception("Failed to fetch visitor analytics")
        raise HTTPException(status_code=500, detail="Failed to fetch visitor analytics") from e


@router.get("/visitor-analytics/summary", response_model=VisitorAnalyticsSummaryResponse)
async def get_visitor_analytics_summary(
    start_date: str | None = Query(
        None,
        description="Filter by start date (ISO8601 format)",
    ),
    end_date: str | None = Query(
        None,
        description="Filter by end date (ISO8601 format)",
    ),
) -> dict[str, Any]:
    check_iso_date("start_date", start_date)
    check_iso_date("end_date", end_date)
    try:
        summary = await db.get_visitor_analytics_summary(
            start_date=start_date,
            end_date=end_date,
        )

        return {
            "summary": summary,
            "filters": {
                "start_date": start_date,
                "end_date": end_date,
            },
        }
    except Exception as e:
        logger.exception("Failed to fetch analytics summary")
        raise HTTPException(status_code=500, detail="Failed to fetch analytics summary") from e


@router.get("/visitor-analytics/{visitor_id}", response_model=VisitorAnalyticsByIdResponse)
async def get_visitor_analytics_by_id(
    visitor_id: str,
    start_date: str | None = Query(None, description="Filter by start date (ISO8601)"),
    end_date: str | None = Query(None, description="Filter by end date (ISO8601)"),
    limit: int = Query(100, ge=1, le=1000),
) -> dict[str, Any]:
    check_iso_date("start_date", start_date)
    check_iso_date("end_date", end_date)
    try:
        stats = await _fetch_public_stats(visitor_id, start_date, end_date, limit)

        if not stats:
            return {
                "visitor_id": visitor_id,
                "records": [],
                "count": 0,
                "message": "No analytics data found for this visitor",
            }

        return {
            "visitor_id": visitor_id,
            "records": stats,
            "count": len(stats),
        }
    except Exception as e:
        logger.exception("Failed to fetch visitor analytics")
        raise HTTPException(status_code=500, detail="Failed to fetch visitor analytics") from e
