import os
import shutil
from typing import Any

from fastapi import APIRouter

from api.agents.tools import TOOL_DEFINITIONS
from api.codex_runner import codex_is_ready

router = APIRouter(prefix="/agents", tags=["agents"])


def _env_enabled(name: str, default: str = "0") -> bool:
    return os.getenv(name, default) == "1"


@router.get("/status")
async def agents_status() -> dict[str, Any]:
    codex_ready, codex_message = codex_is_ready()

    augment_status = "ok"
    augment_message = "Augment SDK available"
    if not os.getenv("AUGMENT_API_TOKEN"):
        augment_status = "unconfigured"
        augment_message = "AUGMENT_API_TOKEN not set"
    else:
        try:
            import auggie_sdk  # noqa: F401
        except ImportError:
            augment_status = "error"
            augment_message = "Augment SDK not installed"

    gemini_status = "ok" if os.getenv("GEMINI_API_KEY") else "unconfigured"
    gemini_message = (
        "GEMINI_API_KEY configured" if gemini_status == "ok" else "GEMINI_API_KEY not set"
    )

    sandbox_status: dict[str, Any] = {
        "enabled": _env_enabled("SANDBOX_ENABLED", "1"),
        "image": os.getenv("SANDBOX_IMAGE", "devstack-python-sandbox:latest"),
        "available": False,
        "docker_cli": shutil.which("docker") is not None,
        "timeout_sec": int(os.getenv("SANDBOX_TIMEOUT_SEC", "30")),
        "memory_limit": os.getenv("SANDBOX_MEMORY_LIMIT", "128m"),
    }
    if sandbox_status["enabled"]:
        try:
            from api.sandbox import is_sandbox_available

            sandbox_status["available"] = is_sandbox_available()
        except Exception as exc:
            sandbox_status["error"] = str(exc)

    embeddings_status: dict[str, Any] = {
        "installed": False,
        "model_available": False,
        "install_switch": "INSTALL_EMBEDDINGS=1",
    }
    try:
        import sentence_transformers  # noqa: F401

        embeddings_status["installed"] = True
        from api.notes_embeddings import is_model_available

        embeddings_status["model_available"] = is_model_available()
    except ImportError:
        embeddings_status["message"] = "Local embedding dependencies are not installed"
    except Exception as exc:
        embeddings_status["message"] = str(exc)

    return {
        "agents": {
            "codex": {
                "status": "ok" if codex_ready else "unconfigured",
                "message": codex_message,
            },
            "augment": {"status": augment_status, "message": augment_message},
            "gemini": {"status": gemini_status, "message": gemini_message},
        },
        "tools": {
            "registered": [tool.name for tool in TOOL_DEFINITIONS],
            "sandbox": sandbox_status,
            "embeddings": embeddings_status,
        },
    }
