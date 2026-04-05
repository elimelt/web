from pydantic import BaseModel


class ChatMessage(BaseModel):
    type: str
    channel: str
    sender: str
    text: str
    timestamp: str
    id: str | None = None
    reply_to: str | None = None


class ChatHistoryResponse(BaseModel):
    messages: list[ChatMessage]
    next_before: str | None


class SoftDeleteResponse(BaseModel):
    deleted: int
    channel: str | None
    before: str | None


class ChatAnalyticsResponse(BaseModel):
    messages: int
    senders: int
