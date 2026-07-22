"""RFC 9457 problem-details error model and FastAPI exception handlers.

Every error the v2 API emits is ``application/problem+json`` with a stable
``type`` slug clients can switch on, plus the ``request_id`` for log
correlation (the frontend renders it with a copy button).

Registered once from the composition root via ``register_error_handlers(app)``.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException

PROBLEM_JSON = "application/problem+json"
_BASE = "https://mediacodex.dev/problems"

logger = logging.getLogger("app.errors")


class ProblemDetails(BaseModel):
    """RFC 9457 body.``type`` is the machine-stable identifier."""

    type: str
    title: str
    status: int
    detail: str | None = None
    instance: str | None = None
    request_id: str | None = None
    errors: list[dict[str, Any]] | None = None


class ApiProblem(Exception):
    """Raise from services/routers; the handler renders it as problem+json.

    Keep ``slug`` stable forever — clients program against it.
    """

    def __init__(self, status_code: int, slug: str, title: str, detail: str | None = None):
        super().__init__(detail or title)
        self.status_code = status_code
        self.slug = slug
        self.title = title
        self.detail = detail

    # Convenience constructors for the common cases.
    @classmethod
    def not_found(cls, resource: str, detail: str | None = None) -> "ApiProblem":
        return cls(404, "not-found", f"{resource} not found", detail)

    @classmethod
    def unauthorized(cls, detail: str | None = None) -> "ApiProblem":
        return cls(401, "unauthorized", "Authentication required", detail)

    @classmethod
    def forbidden(cls, detail: str | None = None) -> "ApiProblem":
        return cls(403, "forbidden", "Insufficient permissions", detail)

    @classmethod
    def conflict(cls, detail: str) -> "ApiProblem":
        return cls(409, "conflict", "Conflict", detail)

    @classmethod
    def bad_request(cls, slug: str, detail: str) -> "ApiProblem":
        return cls(400, slug, "Bad request", detail)


def _problem_response(request: Request, problem: ProblemDetails) -> JSONResponse:
    problem.request_id = problem.request_id or getattr(request.state, "request_id", None)
    problem.instance = problem.instance or str(request.url.path)
    return JSONResponse(
        status_code=problem.status,
        content=problem.model_dump(exclude_none=True),
        media_type=PROBLEM_JSON,
    )


async def _api_problem_handler(request: Request, exc: ApiProblem) -> JSONResponse:
    return _problem_response(
        request,
        ProblemDetails(
            type=f"{_BASE}/{exc.slug}",
            title=exc.title,
            status=exc.status_code,
            detail=exc.detail,
        ),
    )


async def _http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    slug = {
        401: "unauthorized",
        403: "forbidden",
        404: "not-found",
        405: "method-not-allowed",
        429: "rate-limited",
    }.get(exc.status_code, "http-error")
    detail = exc.detail if isinstance(exc.detail, str) else None
    return _problem_response(
        request,
        ProblemDetails(
            type=f"{_BASE}/{slug}",
            title=detail or slug.replace("-", " ").title(),
            status=exc.status_code,
            detail=None if isinstance(exc.detail, str) else None,
        ),
    )


async def _validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    errors = [
        {"field": ".".join(str(part) for part in e.get("loc", [])), "message": e.get("msg", ""), "type": e.get("type", "")}
        for e in exc.errors()
    ]
    return _problem_response(
        request,
        ProblemDetails(
            type=f"{_BASE}/validation-error",
            title="Request validation failed",
            status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{len(errors)} validation error(s)",
            errors=errors,
        ),
    )


async def _unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled error request_id=%s", getattr(request.state, "request_id", "-"))
    return _problem_response(
        request,
        ProblemDetails(
            type=f"{_BASE}/internal",
            title="Internal server error",
            status=500,
            detail="An unexpected error occurred. Quote the request_id when reporting.",
        ),
    )


def register_error_handlers(app: FastAPI) -> None:
    """Wire problem-details handlers. Order matters: most specific first."""
    app.add_exception_handler(ApiProblem, _api_problem_handler)
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)
    app.add_exception_handler(RequestValidationError, _validation_error_handler)
    app.add_exception_handler(Exception, _unhandled_error_handler)
