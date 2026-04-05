import logging
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class HTTPLogMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, logger_name: str = "api.http"):
        super().__init__(app)
        self._logger = logging.getLogger(logger_name)

    async def dispatch(self, request: Request, call_next):
        start = time.time()
        path = request.url.path
        method = request.method
        client = request.client.host if request.client else "-"
        self._logger.debug("http.request start method=%s path=%s client=%s", method, path, client)
        try:
            response: Response = await call_next(request)
            dur_ms = int((time.time() - start) * 1000)
            self._logger.debug(
                "http.request end method=%s path=%s status=%s dur_ms=%s",
                method,
                path,
                response.status_code,
                dur_ms,
            )
            return response
        except Exception as e:
            dur_ms = int((time.time() - start) * 1000)
            self._logger.warning(
                "http.request error method=%s path=%s dur_ms=%s err=%r", method, path, dur_ms, e
            )
            raise
