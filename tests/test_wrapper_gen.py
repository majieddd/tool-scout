"""End-to-end wrapper generation test — mocked LLM, mocked sandbox."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

from tool_scout.installer import wrapper as wrapper_mod


def _tool() -> MagicMock:
    t = MagicMock()
    t.id = "fixture001"
    t.name = "fake-tool"
    t.url = "https://example.com/fake"
    t.description = "A fake tool to wrap"
    t.readme_excerpt = "Run: fake-tool --help"
    return t


def test_wrapper_gen_published_when_clean_and_smoke_ok(tmp_path: Path, monkeypatch):
    """LLM returns known-good wrapper; static_scan passes; smoke passes; publish OK."""
    monkeypatch.setattr("tool_scout.installer.wrapper.PUBLISH_DIR", tmp_path / "wrappers")
    monkeypatch.setattr("tool_scout.installer.audit.AUDIT_LOG", tmp_path / "audit.log")
    monkeypatch.setattr("tool_scout.installer.audit.BACKUPS_DIR", tmp_path / "backups")
    monkeypatch.setattr("tool_scout.installer.wrapper.record_install", lambda *a, **kw: 1)

    fixture = Path(__file__).parent / "fixtures" / "known_good_wrapper.py"
    good_code = fixture.read_text(encoding="utf-8")

    fake_cli = MagicMock()
    def fake_ask_file(prompt, out_path, *, model=None):
        Path(out_path).write_text(good_code, encoding="utf-8")
        return 0.5
    fake_cli.ask_file = fake_ask_file

    monkeypatch.setattr("tool_scout.installer.wrapper.run_smoke_test", lambda p: (True, "SMOKE_OK"))

    res = wrapper_mod.generate_and_install(
        _tool(), workspace_root=tmp_path / "ws", client=fake_cli, skip_sandbox=False
    )
    assert res["ok"]
    assert res["reason"] == "published"
    assert (tmp_path / "wrappers" / "fixture001" / "server.py").exists()


def test_wrapper_gen_blocked_by_static_scan(tmp_path: Path, monkeypatch):
    """LLM returns known-bad; static_scan rejects → no sandbox call, no publish."""
    monkeypatch.setattr("tool_scout.installer.wrapper.PUBLISH_DIR", tmp_path / "wrappers")
    monkeypatch.setattr("tool_scout.installer.audit.AUDIT_LOG", tmp_path / "audit.log")
    monkeypatch.setattr("tool_scout.installer.audit.BACKUPS_DIR", tmp_path / "backups")

    fixture = Path(__file__).parent / "fixtures" / "known_bad_wrapper.py"
    bad_code = fixture.read_text(encoding="utf-8")

    fake_cli = MagicMock()
    fake_cli.ask_file = lambda prompt, out_path, *, model=None: (
        Path(out_path).write_text(bad_code, encoding="utf-8") or 0.5
    )

    smoke_called = MagicMock()
    monkeypatch.setattr("tool_scout.installer.wrapper.run_smoke_test", smoke_called)

    res = wrapper_mod.generate_and_install(
        _tool(), workspace_root=tmp_path / "ws", client=fake_cli, skip_sandbox=False
    )
    assert not res["ok"]
    assert res["reason"] == "static_scan_blocked"
    assert res["scan_hits"]
    smoke_called.assert_not_called()
    assert not (tmp_path / "wrappers" / "fixture001" / "server.py").exists()


def test_wrapper_gen_failed_smoke_no_publish(tmp_path: Path, monkeypatch):
    """LLM clean but smoke test fails → no publish."""
    monkeypatch.setattr("tool_scout.installer.wrapper.PUBLISH_DIR", tmp_path / "wrappers")
    monkeypatch.setattr("tool_scout.installer.audit.AUDIT_LOG", tmp_path / "audit.log")
    monkeypatch.setattr("tool_scout.installer.audit.BACKUPS_DIR", tmp_path / "backups")

    fixture = Path(__file__).parent / "fixtures" / "borderline_wrapper.py"
    code = fixture.read_text(encoding="utf-8")

    fake_cli = MagicMock()
    fake_cli.ask_file = lambda prompt, out_path, *, model=None: (
        Path(out_path).write_text(code, encoding="utf-8") or 0.5
    )

    monkeypatch.setattr("tool_scout.installer.wrapper.run_smoke_test", lambda p: (False, "no SMOKE_OK in output"))

    res = wrapper_mod.generate_and_install(
        _tool(), workspace_root=tmp_path / "ws", client=fake_cli, skip_sandbox=False
    )
    assert not res["ok"]
    assert res["reason"] == "smoke_failed"
    assert not (tmp_path / "wrappers" / "fixture001" / "server.py").exists()
