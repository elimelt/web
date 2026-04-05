"""Standardized error handling for the API.

This module provides:
1. Custom exception classes for domain-specific errors
2. Exception handlers for FastAPI
3. Standard error response models

Usage:
    from api.errors import NotFoundError, ServiceUnavailableError

    # In controllers:
    if not resource:
        raise NotFoundError(detail="Resource not found", resource_type="user", resource_id="123")

    # Register handlers in main.py:
    from api.errors import register_exception_handlers
    register_exception_handlers(app)
"""

import logging
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class ErrorResponse(BaseModel):
    """Standard error response model."""

    error: str
    detail: str | None = None
    error_code: str | None = None
    context: dict[str, Any] | None = None


class APIError(Exception):
    """Base class for API errors."""

    status_code: int = 500
    error: str = "internal_error"
    detail: str = "An unexpected error occurred"

    def __init__(
        self,
        detail: str | None = None,
        error_code: str | None = None,
        **context: Any,
    ) -> None:
        self.detail = detail or self.__class__.detail
        self.error_code = error_code
        self.context = context if context else None
        super().__init__(self.detail)

    def to_response(self) -> ErrorResponse:
        """Convert exception to error response model."""
        return ErrorResponse(
            error=self.error,
            detail=self.detail,
            error_code=self.error_code,
            context=self.context,
        )


class NotFoundError(APIError):
    """Resource not found error (404)."""

    status_code = 404
    error = "not_found"
    detail = "Resource not found"


class BadRequestError(APIError):
    """Bad request error (400)."""

    status_code = 400
    error = "bad_request"
    detail = "Invalid request"


class UnauthorizedError(APIError):
    """Unauthorized error (401)."""

    status_code = 401
    error = "unauthorized"
    detail = "Authentication required"


class ForbiddenError(APIError):
    """Forbidden error (403)."""

    status_code = 403
    error = "forbidden"
    detail = "Access denied"


class ServiceUnavailableError(APIError):
    """Service unavailable error (503)."""

    status_code = 503
    error = "service_unavailable"
    detail = "Service temporarily unavailable"


class DatabaseError(APIError):
    """Database error (500)."""

    status_code = 500
    error = "database_error"
    detail = "Database operation failed"


class ExternalServiceError(APIError):
    """External service error (502)."""

    status_code = 502
    error = "external_service_error"
    detail = "External service request failed"


async def api_error_handler(request: Request, exc: APIError) -> JSONResponse:
    """Handle custom API errors."""
    logger.warning(
        "API error: %s (status=%d, path=%s)",
        exc.detail,
        exc.status_code,
        request.url.path,
    )
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.to_response().model_dump(exclude_none=True),
    )


async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Handle FastAPI HTTPExceptions with standard format."""
    return JSONResponse(
        status_code=exc.status_code,
        content=ErrorResponse(
            error=_status_to_error_type(exc.status_code),
            detail=str(exc.detail),
        ).model_dump(exclude_none=True),
    )


async def general_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Handle uncaught exceptions."""
    logger.exception("Unhandled exception: %s (path=%s)", exc, request.url.path)
    return JSONResponse(
        status_code=500,
        content=ErrorResponse(
            error="internal_error",
            detail="An unexpected error occurred",
        ).model_dump(exclude_none=True),
    )


def _status_to_error_type(status_code: int) -> str:
    """Map HTTP status code to error type string."""
    mapping = {
        400: "bad_request",
        401: "unauthorized",
        403: "forbidden",
        404: "not_found",
        409: "conflict",
        422: "validation_error",
        429: "rate_limited",
        500: "internal_error",
        502: "bad_gateway",
        503: "service_unavailable",
        504: "gateway_timeout",
    }
    return mapping.get(status_code, "error")


def register_exception_handlers(app: FastAPI) -> None:
    """Register all exception handlers with the FastAPI app."""
    app.add_exception_handler(APIError, api_error_handler)
    # Note: We don't override HTTPException handler to maintain backward compatibility
    # app.add_exception_handler(HTTPException, http_exception_handler)
    # app.add_exception_handler(Exception, general_exception_handler)
