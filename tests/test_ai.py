"""Tests for app.ai.call_model — guarded parsing + single retry (C14)."""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
import requests

from app import ai


def _settings():
    return SimpleNamespace(
        openai_api_key="sk-test",
        openai_base_url="https://api.example.com/v1",
        openai_model="gpt-test",
        request_timeout_seconds=5,
    )


def _response(status: int = 200, payload: dict | None = None, text: str = ""):
    resp = requests.Response()
    resp.status_code = status
    if payload is not None:
        resp._content = json.dumps(payload).encode()
        resp.headers["Content-Type"] = "application/json"
    else:
        resp._content = text.encode()
    return resp


def _chat_payload(hypotheses):
    return {"choices": [{"message": {"content": json.dumps({"hypotheses": hypotheses})}}]}


def test_call_model_parses_valid_response(monkeypatch):
    monkeypatch.setattr(
        ai.requests,
        "post",
        lambda *a, **k: _response(200, _chat_payload([{"title": "T", "rationale": "r" * 50}])),
    )
    result = ai.call_model(_settings(), {"items": []})
    assert result[0]["title"] == "T"
    assert result[0]["novelty_score"] == 0.5


def test_call_model_rejects_non_json_body(monkeypatch):
    monkeypatch.setattr(ai.requests, "post", lambda *a, **k: _response(200, text="<html>"))
    with pytest.raises(ValueError, match="non-JSON"):
        ai.call_model(_settings(), {})


def test_call_model_rejects_missing_choices(monkeypatch):
    monkeypatch.setattr(ai.requests, "post", lambda *a, **k: _response(200, {"usage": {}}))
    with pytest.raises(ValueError, match="no choices"):
        ai.call_model(_settings(), {})


def test_call_model_rejects_invalid_content_json(monkeypatch):
    payload = {"choices": [{"message": {"content": "not json at all"}}]}
    monkeypatch.setattr(ai.requests, "post", lambda *a, **k: _response(200, payload))
    with pytest.raises(ValueError, match="not valid JSON"):
        ai.call_model(_settings(), {})


def test_call_model_retries_once_on_5xx(monkeypatch):
    calls = {"n": 0}

    def _post(*a, **k):
        calls["n"] += 1
        if calls["n"] == 1:
            return _response(500, text="boom")
        return _response(200, _chat_payload([{"title": "retry-ok", "rationale": "r" * 50}]))

    monkeypatch.setattr(ai.requests, "post", _post)
    result = ai.call_model(_settings(), {})
    assert calls["n"] == 2
    assert result[0]["title"] == "retry-ok"


def test_call_model_gives_up_after_two_transient_failures(monkeypatch):
    monkeypatch.setattr(ai.requests, "post", lambda *a, **k: _response(503, text="down"))
    with pytest.raises(RuntimeError, match="after 2 attempts"):
        ai.call_model(_settings(), {})


def test_call_model_retries_on_connection_error(monkeypatch):
    calls = {"n": 0}

    def _post(*a, **k):
        calls["n"] += 1
        if calls["n"] == 1:
            raise requests.ConnectionError("reset")
        return _response(200, _chat_payload([{"title": "net-ok", "rationale": "r" * 50}]))

    monkeypatch.setattr(ai.requests, "post", _post)
    assert ai.call_model(_settings(), {})[0]["title"] == "net-ok"


def test_call_model_no_retry_on_4xx(monkeypatch):
    calls = {"n": 0}

    def _post(*a, **k):
        calls["n"] += 1
        return _response(401, text="unauthorized")

    monkeypatch.setattr(ai.requests, "post", _post)
    with pytest.raises(requests.HTTPError):
        ai.call_model(_settings(), {})
    assert calls["n"] == 1
