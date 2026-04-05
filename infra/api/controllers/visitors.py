import json

from fastapi import APIRouter

from api.dependencies import Redis
from api.models.visitors import VisitorsResponse

router = APIRouter(tags=["visitors"])


@router.get("/visitors", response_model=VisitorsResponse)
async def get_visitors(redis: Redis) -> VisitorsResponse:
    visitor_keys = await redis.keys("visitor:*")
    active_visitors = []
    if visitor_keys:
        values = await redis.mget(*visitor_keys)
        active_visitors = [json.loads(v) for v in values if v]

    visit_log = await redis.lrange("visit_log", 0, 99)
    visits = [json.loads(v) for v in visit_log]

    return VisitorsResponse(
        active_count=len(active_visitors),
        active_visitors=active_visitors,
        recent_visits=visits,
    )
