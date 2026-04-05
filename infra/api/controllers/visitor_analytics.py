from typing import Any

from fastapi import APIRouter, HTTPException, Query

from api import db
from api.models.analytics import (
    VisitorAnalyticsByIdResponse,
    VisitorAnalyticsResponse,
    VisitorAnalyticsSummaryResponse,
)

router = APIRouter(tags=["visitors"])


@router.get("/visitor-analytics", response_model=VisitorAnalyticsResponse)
async def get_visitor_analytics(
    visitor_ip: str | None = Query(
        None,
        description="Filter by specific visitor IP address",
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
    try:
        stats = await db.fetch_visitor_stats(
            visitor_ip=visitor_ip,
            start_date=start_date,
            end_date=end_date,
            is_recurring=recurring_only,
            limit=limit,
        )

        return {
            "visitors": stats,
            "count": len(stats),
            "filters": {
                "visitor_id": visitor_ip,
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
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {e}") from e
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch visitor analytics: {e}"
        ) from e


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
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {e}") from e
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch analytics summary: {e}"
        ) from e


@router.get("/visitor-analytics/{visitor_id}", response_model=VisitorAnalyticsByIdResponse)
async def get_visitor_analytics_by_id(
    visitor_id: str,
    start_date: str | None = Query(None, description="Filter by start date (ISO8601)"),
    end_date: str | None = Query(None, description="Filter by end date (ISO8601)"),
    limit: int = Query(100, ge=1, le=1000),
) -> dict[str, Any]:
    try:
        stats = await db.fetch_visitor_stats(
            visitor_ip=visitor_id,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
        )

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
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {e}") from e
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Failed to fetch visitor analytics: {e}"
        ) from e
