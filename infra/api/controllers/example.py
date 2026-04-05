from fastapi import APIRouter

router = APIRouter(tags=["system"])


@router.get("/example")
async def example() -> dict[str, str]:
    return {
        "message": "Hello from DevStack API!",
        "timestamp": "2025-11-26T00:00:00Z",
        "status": "success",
    }
