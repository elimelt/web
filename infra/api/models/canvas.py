from pydantic import BaseModel


class Point(BaseModel):
    x: float
    y: float


class Stroke(BaseModel):
    id: str  # {client_id}-{clock}
    author_id: str
    points: list[Point]
    color: str
    width: float
    timestamp: int  # Lamport timestamp for ordering


class CanvasOp(BaseModel):
    type: str  # "add" | "remove" | "sync" | "clear"
    stroke: Stroke | None = None
    stroke_id: str | None = None
    author_id: str | None = None


class CanvasState(BaseModel):
    strokes: list[Stroke]
    removed: list[str]


class CanvasSyncMessage(BaseModel):
    type: str  # "sync" | "op" | "cursor" | "ping"
    state: CanvasState | None = None
    op: CanvasOp | None = None
    cursor: dict | None = None  # {x, y, author_id}
    user_count: int | None = None
