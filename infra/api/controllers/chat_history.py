from fastapi import APIRouter, Query

from api import db
from api.models.chat import ChatHistoryResponse, ChatMessage

router = APIRouter(tags=["chat"])


@router.get("/chat/{channel}/history", response_model=ChatHistoryResponse)
async def chat_history(
    channel: str,
    before: str | None = Query(None, description="ISO8601 timestamp; default now"),
    limit: int = Query(50, ge=1, le=200),
) -> ChatHistoryResponse:
    raw_messages = await db.fetch_chat_history(channel, before, limit)
    messages = [ChatMessage(**msg) for msg in raw_messages]
    next_before = raw_messages[-1]["timestamp"] if raw_messages else before
    return ChatHistoryResponse(messages=messages, next_before=next_before)
