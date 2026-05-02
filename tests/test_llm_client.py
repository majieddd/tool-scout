"""Unit tests for LlmClient (mocked HTTP — does not require Ollama running)."""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from tool_scout.llm_client import LlmClient, LlmError, _strip_fences


def test_strip_fences_plain():
    assert _strip_fences("hello") == "hello"


def test_strip_fences_with_lang_tag():
    text = "```python\nprint('hi')\n```"
    assert _strip_fences(text) == "print('hi')"


def test_strip_fences_with_json_tag():
    text = '```json\n{"a": 1}\n```'
    assert _strip_fences(text) == '{"a": 1}'


def test_strip_fences_no_closing():
    text = "```\nfoo\nbar"
    assert _strip_fences(text) == "foo\nbar"


def _mock_response(payload: dict, status: int = 200):
    r = MagicMock()
    r.status_code = status
    r.json.return_value = payload
    r.text = json.dumps(payload)
    return r


def test_generate_returns_text_and_duration():
    cli = LlmClient(host="http://x", model="m")
    with patch("tool_scout.llm_client.httpx.Client") as mock_client_cls:
        mock_ctx = mock_client_cls.return_value.__enter__.return_value
        mock_ctx.post.return_value = _mock_response({"response": "hello world", "done": True})
        text, dur = cli.generate("test")
    assert text == "hello world"
    assert dur >= 0


def test_generate_raises_on_http_error():
    cli = LlmClient(host="http://x", model="m")
    with patch("tool_scout.llm_client.httpx.Client") as mock_client_cls:
        mock_ctx = mock_client_cls.return_value.__enter__.return_value
        mock_ctx.post.return_value = _mock_response({"error": "boom"}, status=500)
        with pytest.raises(LlmError):
            cli.generate("test")


def test_ask_json_parses_clean_payload():
    cli = LlmClient(host="http://x", model="m")
    with patch("tool_scout.llm_client.httpx.Client") as mock_client_cls:
        mock_ctx = mock_client_cls.return_value.__enter__.return_value
        mock_ctx.post.return_value = _mock_response({"response": '{"category":"mcp_server","confidence":0.9}', "done": True})
        body, _ = cli.ask_json("classify this")
    assert body == {"category": "mcp_server", "confidence": 0.9}


def test_ask_json_strips_fences():
    cli = LlmClient(host="http://x", model="m")
    with patch("tool_scout.llm_client.httpx.Client") as mock_client_cls:
        mock_ctx = mock_client_cls.return_value.__enter__.return_value
        mock_ctx.post.return_value = _mock_response({"response": '```json\n{"x":1}\n```', "done": True})
        body, _ = cli.ask_json("x")
    assert body == {"x": 1}


def test_ask_file_writes_to_disk(tmp_path: Path):
    cli = LlmClient(host="http://x", model="m")
    out = tmp_path / "server.py"
    with patch("tool_scout.llm_client.httpx.Client") as mock_client_cls:
        mock_ctx = mock_client_cls.return_value.__enter__.return_value
        mock_ctx.post.return_value = _mock_response({"response": "```python\nprint('hi')\n```", "done": True})
        dur = cli.ask_file("write hello", out)
    assert out.read_text(encoding="utf-8").strip() == "print('hi')"
    assert dur >= 0


def test_ping_returns_false_on_error():
    cli = LlmClient(host="http://x", model="m")
    with patch("tool_scout.llm_client.httpx.Client") as mock_client_cls:
        mock_ctx = mock_client_cls.return_value.__enter__.return_value
        import httpx
        mock_ctx.get.side_effect = httpx.ConnectError("nope")
        assert cli.ping() is False


def test_model_available_true_when_in_tags():
    cli = LlmClient(host="http://x", model="gemma3:4b")
    with patch("tool_scout.llm_client.httpx.Client") as mock_client_cls:
        mock_ctx = mock_client_cls.return_value.__enter__.return_value
        mock_ctx.get.return_value = _mock_response({"models": [{"name": "gemma3:4b"}, {"name": "qwen3-coder:30b"}]})
        assert cli.model_available() is True


def test_model_available_false_when_missing():
    cli = LlmClient(host="http://x", model="gemma3:4b")
    with patch("tool_scout.llm_client.httpx.Client") as mock_client_cls:
        mock_ctx = mock_client_cls.return_value.__enter__.return_value
        mock_ctx.get.return_value = _mock_response({"models": [{"name": "llama3:8b"}]})
        assert cli.model_available() is False
