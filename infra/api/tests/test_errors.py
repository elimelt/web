"""Tests for standardized error handling (TDD - Issue #7)."""

from fastapi import FastAPI
from fastapi.testclient import TestClient


class TestAPIErrors:
    """Test custom API error classes."""

    def test_not_found_error_defaults(self):
        """Test NotFoundError has correct defaults."""
        from api.errors import NotFoundError

        error = NotFoundError()
        assert error.status_code == 404
        assert error.error == "not_found"
        assert error.detail == "Resource not found"

    def test_not_found_error_with_context(self):
        """Test NotFoundError with custom context."""
        from api.errors import NotFoundError

        error = NotFoundError(
            detail="User not found",
            resource_type="user",
            resource_id="123",
        )
        assert error.detail == "User not found"
        assert error.context == {"resource_type": "user", "resource_id": "123"}

    def test_bad_request_error(self):
        """Test BadRequestError."""
        from api.errors import BadRequestError

        error = BadRequestError(detail="Invalid date format")
        assert error.status_code == 400
        assert error.error == "bad_request"
        assert error.detail == "Invalid date format"

    def test_service_unavailable_error(self):
        """Test ServiceUnavailableError."""
        from api.errors import ServiceUnavailableError

        error = ServiceUnavailableError(detail="Redis not connected")
        assert error.status_code == 503
        assert error.error == "service_unavailable"
        assert error.detail == "Redis not connected"

    def test_database_error(self):
        """Test DatabaseError."""
        from api.errors import DatabaseError

        error = DatabaseError(detail="Connection timeout")
        assert error.status_code == 500
        assert error.error == "database_error"


class TestErrorResponse:
    """Test error response model."""

    def test_error_response_model(self):
        """Test ErrorResponse model serialization."""
        from api.errors import ErrorResponse

        response = ErrorResponse(
            error="not_found",
            detail="User not found",
            error_code="USER_NOT_FOUND",
            context={"user_id": "123"},
        )

        data = response.model_dump()
        assert data["error"] == "not_found"
        assert data["detail"] == "User not found"
        assert data["error_code"] == "USER_NOT_FOUND"
        assert data["context"] == {"user_id": "123"}

    def test_error_response_minimal(self):
        """Test ErrorResponse with minimal fields."""
        from api.errors import ErrorResponse

        response = ErrorResponse(error="internal_error")
        data = response.model_dump(exclude_none=True)

        assert data == {"error": "internal_error"}

    def test_api_error_to_response(self):
        """Test converting APIError to ErrorResponse."""
        from api.errors import NotFoundError

        error = NotFoundError(detail="Not found", resource_id="abc")
        response = error.to_response()

        assert response.error == "not_found"
        assert response.detail == "Not found"
        assert response.context == {"resource_id": "abc"}


class TestExceptionHandlers:
    """Test exception handlers integration."""

    def test_api_error_handler_integration(self):
        """Test that APIError is handled correctly."""
        from api.errors import NotFoundError, register_exception_handlers

        app = FastAPI()
        register_exception_handlers(app)

        @app.get("/test-not-found")
        async def test_endpoint():
            raise NotFoundError(detail="Test resource not found")

        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/test-not-found")

        assert response.status_code == 404
        body = response.json()
        assert body["error"] == "not_found"
        assert body["detail"] == "Test resource not found"

    def test_service_unavailable_handler(self):
        """Test ServiceUnavailableError handling."""
        from api.errors import ServiceUnavailableError, register_exception_handlers

        app = FastAPI()
        register_exception_handlers(app)

        @app.get("/test-unavailable")
        async def test_endpoint():
            raise ServiceUnavailableError(detail="Database offline")

        client = TestClient(app, raise_server_exceptions=False)
        response = client.get("/test-unavailable")

        assert response.status_code == 503
        body = response.json()
        assert body["error"] == "service_unavailable"


class TestStatusToErrorType:
    """Test status code to error type mapping."""

    def test_common_status_codes(self):
        """Test mapping of common status codes."""
        from api.errors import _status_to_error_type

        assert _status_to_error_type(400) == "bad_request"
        assert _status_to_error_type(401) == "unauthorized"
        assert _status_to_error_type(403) == "forbidden"
        assert _status_to_error_type(404) == "not_found"
        assert _status_to_error_type(500) == "internal_error"
        assert _status_to_error_type(503) == "service_unavailable"

    def test_unknown_status_code(self):
        """Test that unknown status codes return generic error."""
        from api.errors import _status_to_error_type

        assert _status_to_error_type(418) == "error"  # I'm a teapot
