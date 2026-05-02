"""Local LLM client (replaces docs/01_SPEC.md §8 ClaudeClient with Ollama HTTP).

Talks to a running Ollama daemon (default http://localhost:11434) using its
/api/generate endpoint. Default model is gemma3:4b; override via LLM_MODEL.

Public surface mirrors the spec's ClaudeClient so downstream code (classifier,
wrapper-gen) doesn't care which backend is in use:

    cli = LlmClient()
    body, duration = cli.ask_json(prompt)        # JSON-mode generation
    duration = cli.ask_file(prompt, out_path)    # raw-text generation, saved to disk

Errors raise RuntimeError with scrubbed messages.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import httpx

DEFAULT_HOST = "http://localhost:11434"
DEFAULT_MODEL = "gemma3:4b"
DEFAULT_TIMEOUT_S = 300


def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        # Drop opening fence (with optional language tag) and closing fence.
        first_nl = text.find("\n")
        if first_nl != -1:
            text = text[first_nl + 1 :]
        if text.endswith("```"):
            text = text[: -3]
    return text.strip()


class LlmError(RuntimeError):
    """Raised when the local LLM backend fails."""


class LlmClient:
    def __init__(
        self,
        host: str | None = None,
        model: str | None = None,
        timeout_s: int | None = None,
    ) -> None:
        self.host = (host or os.environ.get("OLLAMA_HOST") or DEFAULT_HOST).rstrip("/")
        self.model = model or os.environ.get("LLM_MODEL") or DEFAULT_MODEL
        self.timeout_s = int(timeout_s or os.environ.get("LLM_TIMEOUT_S") or DEFAULT_TIMEOUT_S)

    # ---- low-level -----------------------------------------------------
    def generate(
        self,
        prompt: str,
        *,
        format_json: bool = False,
        options: dict[str, Any] | None = None,
        model: str | None = None,
    ) -> tuple[str, float]:
        """Single-turn generation. Returns (text, duration_seconds).

        Set format_json=True for structured-output mode (Ollama constrains the
        response to valid JSON). Otherwise raw text.
        """
        payload: dict[str, Any] = {
            "model": model or self.model,
            "prompt": prompt,
            "stream": False,
        }
        if format_json:
            payload["format"] = "json"
        if options:
            payload["options"] = options
        url = f"{self.host}/api/generate"
        t0 = time.monotonic()
        try:
            with httpx.Client(timeout=self.timeout_s) as cli:
                resp = cli.post(url, json=payload)
        except httpx.HTTPError as e:
            raise LlmError(f"LLM HTTP failed: {type(e).__name__}: {e}") from e
        duration = time.monotonic() - t0
        if resp.status_code != 200:
            raise LlmError(f"LLM returned {resp.status_code}: {resp.text[:200]}")
        try:
            body = resp.json()
        except json.JSONDecodeError as e:
            raise LlmError(f"LLM returned non-JSON envelope: {e}") from e
        text = body.get("response", "")
        if not isinstance(text, str):
            raise LlmError(f"LLM 'response' field is not str: {type(text).__name__}")
        return text, duration

    # ---- high-level ----------------------------------------------------
    def ask_json(
        self,
        prompt: str,
        *,
        max_retries: int = 2,
        model: str | None = None,
    ) -> tuple[Any, float]:
        """Generate + parse JSON. Retries on parse failure with format hint."""
        last_err: Exception | None = None
        for attempt in range(max_retries + 1):
            text, duration = self.generate(prompt, format_json=True, model=model)
            cleaned = _strip_fences(text)
            try:
                return json.loads(cleaned), duration
            except json.JSONDecodeError as e:
                last_err = e
                if attempt == max_retries:
                    raise LlmError(
                        f"LLM produced invalid JSON after {max_retries + 1} attempts: {e}\n--- output (first 400 chars) ---\n{cleaned[:400]}"
                    ) from e
        # unreachable, but mypy
        raise LlmError(f"unreachable: {last_err!r}")

    def ask_file(
        self,
        prompt: str,
        output_path: Path,
        *,
        model: str | None = None,
    ) -> float:
        """Generate raw text, strip fences, write to disk. Returns duration."""
        text, duration = self.generate(prompt, format_json=False, model=model)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(_strip_fences(text).rstrip() + "\n", encoding="utf-8")
        return duration

    # ---- diagnostics ---------------------------------------------------
    def ping(self) -> bool:
        """Returns True iff Ollama is reachable at self.host."""
        try:
            with httpx.Client(timeout=5) as cli:
                resp = cli.get(f"{self.host}/api/tags")
            return resp.status_code == 200
        except httpx.HTTPError:
            return False

    def model_available(self, model: str | None = None) -> bool:
        """Returns True iff `model` (or self.model) appears in /api/tags."""
        target = model or self.model
        try:
            with httpx.Client(timeout=5) as cli:
                resp = cli.get(f"{self.host}/api/tags")
            if resp.status_code != 200:
                return False
            tags = resp.json().get("models", [])
            return any(t.get("name") == target or t.get("model") == target for t in tags)
        except (httpx.HTTPError, json.JSONDecodeError):
            return False
