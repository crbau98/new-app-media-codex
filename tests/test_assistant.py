"""Tests for the AI assistant endpoint."""
from __future__ import annotations

import importlib
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.assistant import router as assistant_router


@pytest.fixture
def assistant_client(monkeypatch):
    import app.security as _security_module

    monkeypatch.setattr(
        _security_module,
        "settings",
        SimpleNamespace(admin_token="test-token", environment="testing"),
    )
    app = FastAPI()
    app.include_router(assistant_router)
    with TestClient(app, raise_server_exceptions=True) as client:
        client.headers.update({"X-Admin-Token": "test-token"})
        yield client


class _FakeSettings:
    openai_api_key = ""
    openai_base_url = "https://api.openai.com/v1"
    openai_model = "gpt-4.1-mini"


class _FakeSettingsWithKey:
    openai_api_key = "sk-test"
    openai_base_url = "https://api.openai.com/v1"
    openai_model = "gpt-4.1-mini"


def test_openai_package_is_importable():
    """C12 regression: openai is a declared dependency — the import must work.

    The assistant module imports it lazily, so a missing package used to fail
    silently at runtime while tests monkeypatched a fake module over the hole.
    """
    openai = pytest.importorskip("openai")
    assert hasattr(openai, "OpenAI")


def test_chat_requires_admin_token(assistant_client):
    resp = assistant_client.post(
        "/api/assistant/chat",
        json={"message": "hello"},
        headers={"X-Admin-Token": "wrong"},
    )
    assert resp.status_code == 401


def test_chat_rejects_overlong_message(assistant_client):
    resp = assistant_client.post(
        "/api/assistant/chat", json={"message": "x" * 4001}
    )
    assert resp.status_code == 422


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

        captured = {}

        def _make_client(**kwargs):
            return FakeClient()

        monkeypatch.setattr(
            "app.api.assistant._load_openai_module",
            lambda: SimpleNamespace(OpenAI=_make_client),
        )

        resp = assistant_client.post("/api/assistant/chat", json={"message": "hi"})
        assert resp.status_code == 200
        assert "Hello" in resp.text
        assert "[DONE]" in resp.text

    def test_chat_uses_configured_model(self, assistant_client, monkeypatch):
        fake_settings = _FakeSettingsWithKey()
        fake_settings.openai_model = "gpt-test-model"
        monkeypatch.setattr("app.api.assistant.settings", fake_settings)

        seen = {}

        class FakeStream:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def __iter__(self):
                return iter([])

        class FakeCompletions:
            def stream(self, **kwargs):
                seen.update(kwargs)
                return FakeStream()

        class FakeClient:
            chat = type("Chat", (), {"completions": FakeCompletions()})()

        monkeypatch.setattr(
            "app.api.assistant._load_openai_module",
            lambda: SimpleNamespace(OpenAI=lambda **kwargs: FakeClient()),
        )

        resp = assistant_client.post("/api/assistant/chat", json={"message": "hi"})
        assert resp.status_code == 200
        assert seen.get("model") == "gpt-test-model"

    def test_chat_handles_exception_gracefully(self, assistant_client, monkeypatch):
        monkeypatch.setattr("app.api.assistant.settings", _FakeSettingsWithKey())

        def _raise(*args, **kwargs):
            raise RuntimeError("model down")

        monkeypatch.setattr(
            "app.api.assistant._load_openai_module",
            lambda: SimpleNamespace(OpenAI=_raise),
        )

        resp = assistant_client.post("/api/assistant/chat", json={"message": "hi"})
        assert resp.status_code == 200
        assert "model down" in resp.text
        assert "[DONE]" in resp.text

    def test_chat_handles_missing_openai_dependency(self, assistant_client, monkeypatch):
        """If the package is absent at runtime the stream must degrade cleanly."""
        monkeypatch.setattr("app.api.assistant.settings", _FakeSettingsWithKey())
        monkeypatch.setattr("app.api.assistant._load_openai_module", lambda: None)

        resp = assistant_client.post("/api/assistant/chat", json={"message": "hi"})
        assert resp.status_code == 200
        assert "openai package is not installed" in resp.text
        assert "[DONE]" in resp.text


def test_load_openai_module_reraises_non_openai_module_errors(monkeypatch):
    from app.api import assistant as assistant_module

    assistant_module._load_openai_module.cache_clear()

    def _raise(_name: str):
        raise ModuleNotFoundError("boom", name="httpx")

    monkeypatch.setattr("app.api.assistant.import_module", _raise)
    with pytest.raises(ModuleNotFoundError, match="boom"):
        assistant_module._load_openai_module()
