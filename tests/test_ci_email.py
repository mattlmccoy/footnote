"""Phase 2 — the per-user CI emails must be document-agnostic: the noun for the whole
document comes from the DOC_NOUN Actions variable (default "document"), never a hardcoded
"dissertation". Run: python3 -m pytest tests/test_ci_email.py
"""
import os
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "data-template"))

import ci_notify_common as C  # noqa: E402
import ci_invite  # noqa: E402


def _clear():
    os.environ.pop("DOC_NOUN", None)


def test_doc_noun_defaults_to_document():
    _clear()
    assert C.doc_noun() == "document"


def test_doc_noun_reads_env():
    os.environ["DOC_NOUN"] = "journal paper"
    try:
        assert C.doc_noun() == "journal paper"
    finally:
        _clear()


def test_invite_subject_uses_doc_noun_not_dissertation():
    os.environ["DOC_NOUN"] = "paper"
    try:
        _to, subject, eml = ci_invite.build_message(
            {"id": "a1", "name": "Dr. Lee", "email": "lee@example.com"},
            "noreply@example.com", None, "KEY123", "Alex Kim", "https://x.github.io/repo/")
        assert "paper" in subject
        assert "dissertation" not in subject.lower()
        # body (text + html) must not leak the hardcoded noun either
        assert "dissertation" not in eml.lower()
        assert "paper" in eml
    finally:
        _clear()


def test_invite_subject_default_noun_is_document():
    _clear()
    _to, subject, _eml = ci_invite.build_message(
        {"id": "a1", "name": "Dr. Lee", "email": "lee@example.com"},
        "noreply@example.com", None, "KEY123", "Alex Kim", "https://x.github.io/repo/")
    assert "document" in subject
    assert "dissertation" not in subject.lower()


# ---- workspace consolidation: one data repo holds many projects as <id>/ subfolders. The CI must be
# ---- project-aware (loop over subfolders) while still handling a legacy root-level project. ----
import json as _json
import pathlib as _pl
import pytest as _pytest


@_pytest.fixture
def _ws(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    return tmp_path


def _w(path, obj):
    p = _pl.Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(_json.dumps(obj), encoding="utf-8")


def test_project_prefixes_legacy_root(_ws):
    _w("advisors.json", {"advisors": []})
    assert C.project_prefixes() == [""]


def test_project_prefixes_discovers_workspace_subfolders(_ws):
    _w("metro/advisors.json", {"advisors": []})
    _w("optics/advisors.json", {"advisors": []})
    assert C.project_prefixes() == ["metro/", "optics/"]


def test_project_prefixes_empty_when_none(_ws):
    assert C.project_prefixes() == []


def test_doc_noun_reads_projects_json_per_project(_ws):
    _clear()
    _w("projects.json", [{"id": "metro", "name": "M", "dataRepo": "x/ws", "doc": {"noun": "paper"}}])
    assert C.doc_noun("metro/") == "paper"
    assert C.doc_noun("") == "document"           # no prefix → env default


def test_portal_url_appends_p_for_workspace_project():
    url = ci_invite.portal_url("https://x/", {"id": "CJS", "name": "C"}, "metro/")
    assert "&p=metro" in url
    url0 = ci_invite.portal_url("https://x/", {"id": "CJS", "name": "C"}, "")
    assert "&p=" not in url0


def test_build_message_workspace_uses_project_noun_and_p_link(_ws):
    _clear()
    _w("projects.json", [{"id": "metro", "name": "M", "dataRepo": "x/ws", "doc": {"noun": "paper"}}])
    _to, subject, eml = ci_invite.build_message(
        {"id": "CJS", "name": "Dr Lee", "email": "lee@x.com"},
        "noreply@x.com", None, "KEY", "Alex", "https://x/", "metro/")
    assert "paper" in subject and "dissertation" not in subject.lower()
    assert "&p=metro" in eml


def test_invite_main_processes_each_workspace_project(_ws, monkeypatch):
    _clear()
    sent = []
    monkeypatch.setattr(ci_invite, "send", lambda frm, to, eml: sent.append(to))
    for k in ("SMTP_USER", "SMTP_PASS"):
        monkeypatch.setenv(k, "x")
    _w("projects.json", [{"id": "metro", "name": "M", "dataRepo": "x/ws", "doc": {"noun": "paper"}},
                         {"id": "optics", "name": "O", "dataRepo": "x/ws", "doc": {"noun": "letter"}}])
    _w("metro/advisors.json", {"advisors": [{"id": "A", "name": "A", "email": "a@x.com"}]})
    _w("optics/advisors.json", {"advisors": [{"id": "B", "name": "B", "email": "b@x.com"}]})
    ci_invite.main()
    assert set(sent) == {"a@x.com", "b@x.com"}
    # each project's advisors.json marked invited independently
    assert _json.loads(_pl.Path("metro/advisors.json").read_text())["advisors"][0]["invited"] is True
    assert _json.loads(_pl.Path("optics/advisors.json").read_text())["advisors"][0]["invited"] is True
