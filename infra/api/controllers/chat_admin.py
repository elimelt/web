import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api import db
from api.models.chat import SoftDeleteResponse

router = APIRouter(tags=["admin"])


class SoftDeleteRequest(BaseModel):
    channel: str | None = None
    before: str | None = None


@router.post("/admin/chat/soft_delete", response_model=SoftDeleteResponse)
async def soft_delete_chat(req: SoftDeleteRequest) -> SoftDeleteResponse:
    if os.getenv("ENABLE_ADMIN", "0") != "1":
        raise HTTPException(status_code=403, detail="admin disabled")
    try:
        deleted = await db.soft_delete_chat_history(req.channel, req.before)
        return SoftDeleteResponse(deleted=deleted, channel=req.channel, before=req.before)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
