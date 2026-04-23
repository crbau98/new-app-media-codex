"""Tests for the AI assistant endpoint."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.assistant import router as assistant_router


@pytest.fixture
def assistant_client(monkeypatch):
    app = FastAPI()
    app.include_router(assistant_router)
    with TestClient(app, raise_server_exceptions=True) as client:
        yield client


class _FakeSettings:
    openai_api_key = ""
    openai_base_url = "https://api.openai.com/v1"


class _FakeSettingsWithKey:
    openai_api_key = "sk-test"
    openai_base_url = "https://api.openai.com/v1"


class TestAssistantChatFallback:
    def test_chat_fallback_without_api_key(self, assistant_client, monkeypatch):
        monkeypatch.setattr("app.api.assistant.settings", _FakeSettings())
        resp = assistant_client.post("/api/assistant/chat", json={"message": "hello"})
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers.get("content-type", "")
        assert "configured" in resp.text
        assert "[DONE]" in resp.text


class TestAssistantChatWithMockOpenAI:
    def test_chat_streams_chunks(self, assistant_client, monkeypatch):
        monkeypatch.setattr("app.api.assistant.settings", _FakeSettingsWithKey())

        class FakeDelta:
            content = "Hello"

        class FakeChoice:
            delta = FakeDelta()

        class FakeChunk:
            choices = [FakeChoice()]

        class FakeStream:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def __iter__(self):
                return iter([FakeChunk()])

        class FakeCompletions:
            def stream(self, **kwargs):
                return FakeStream()

        class FakeClient:
            chat = type("Chat", (), {"completions": FakeCompletions()})()

        monkeypatch.setattr("openai.OpenAI", lambda **kwargs: FakeClient())

        resp = assistant_client.post("/api/assistant/chat", json={"message": "hi"})
        assert resp.status_code == 200
        assert "Hello" in resp.text
        assert "[DONE]" in resp.text

    def test_chat_handles_exception_gracefully(self, assistant_client, monkeypatch):
        monkeypatch.setattr("app.api.assistant.settings", _FakeSettingsWithKey())

        def _raise(*args, **kwargs):
            raise RuntimeError("model down")

        monkeypatch.setattr("openai.OpenAI", _raise)

        resp = assistant_client.post("/api/assistant/chat", json={"message": "hi"})
        assert resp.status_code == 200
        assert "model down" in resp.text
        assert "[DONE]" in resp.text
