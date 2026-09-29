from __future__ import annotations

import json
import logging
from functools import lru_cache
from importlib import import_module

from fastapi import APIRouter, Depends
from app.security import require_admin
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.ai import SAFETY_SYSTEM_PROMPT, redact_pii, sanitize_untrusted, unsafe_reason
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


class ChatRequest(BaseModel):
    message: str = Field(max_length=4000)


SYSTEM_PROMPT = (
    "You are a helpful media assistant. Help users find content, creators, and answer questions.\n"
    + SAFETY_SYSTEM_PROMPT
)

CHAT_TIMEOUT_SECONDS = 60.0


def _refusal_stream(reason: str):
    yield f"data: {json.dumps({'chunk': reason, 'refused': True})}\n\n"
    yield "data: [DONE]\n\n"

@lru_cache(maxsize=1)
def _load_openai_module():
    try:
        return import_module("openai")
    except ModuleNotFoundError as exc:
        if exc.name != "openai":
            raise
        return None


def _fallback_stream(message: str):
    reply = (
        "The AI assistant is not configured. "
        "Set OPENAI_API_KEY in your environment to enable chat features."
    )
    for word in reply.split():
        yield f"data: {json.dumps({'chunk': word + ' '})}\n\n"
    yield "data: [DONE]\n\n"


@router.post("/chat", dependencies=[Depends(require_admin)])
def assistant_chat(req: ChatRequest) -> StreamingResponse:
    # Guardrails run before any model call: refuse identify/locate/minor/non-consent
    # requests and redact PII from what would be sent to a provider.
    reason = unsafe_reason(req.message)
    if reason:
        return StreamingResponse(
            _refusal_stream(reason),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )
    safe_message = sanitize_untrusted(redact_pii(req.message), limit=4000)
    if not settings.openai_api_key:
        return StreamingResponse(
            _fallback_stream(req.message),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    def event_stream():
        try:
            openai_module = _load_openai_module()
            if openai_module is None:
                raise RuntimeError(
                    "OPENAI_API_KEY is set but the openai package is not installed"
                )

            client = openai_module.OpenAI(
                api_key=settings.openai_api_key,
                base_url=settings.openai_base_url,
                timeout=CHAT_TIMEOUT_SECONDS,
            )
            with client.chat.completions.stream(
                model=settings.openai_model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": safe_message},
                ],
            ) as stream:
                for chunk in stream:
                    delta = chunk.choices[0].delta.content or ""
                    if delta:
                        yield f"data: {json.dumps({'chunk': delta})}\n\n"
        except Exception as exc:
            logger.exception("assistant chat failed")
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
