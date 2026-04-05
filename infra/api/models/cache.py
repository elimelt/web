from pydantic import BaseModel


class CacheResponse(BaseModel):
    key: str
    value: str | None = None
    found: bool
