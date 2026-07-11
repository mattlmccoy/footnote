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


def test_invite_does_not_make_the_reviewer_paste_a_key():
    _clear()
    _to, _subj, eml = ci_invite.build_message(
        {"id": "a1", "name": "Ada", "email": "ada@example.com"},
        "noreply@example.com", None, "KEY123", "Alex Kim", "https://x.github.io/repo/")
    # the magic link still carries the key, so one click signs them in
    assert "k=KEY123" in eml
    # but the email no longer shows an "access key" box or tells them to paste anything
    low = eml.lower()
    assert "access key" not in low
    assert "paste" not in low


def test_invite_is_a_dash_free_welcome():
    _clear()
    _to, _subj, eml = ci_invite.build_message(
        {"id": "a1", "name": "Ada", "email": "ada@example.com"},
        "noreply@example.com", None, "KEY123", "Alex Kim", "https://x.github.io/repo/")
    assert "welcome" in eml.lower()
    for dash in ("—", "–", "&mdash;", "&ndash;"):   # no em/en dashes (house style)
        assert dash not in eml, f"dash {dash!r} leaked into the invite email"


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


def test_chapter_labels_reads_prefixed_chapters(_ws):
    _w("metro/chapters.json", [{"id": "intro", "n": 1, "title": "Introduction"}])
    labels = C.chapter_labels("metro/")
    assert labels["intro"]["n"] == 1
    assert C.chapter_labels("") == {}          # no root chapters.json


def test_portal_advisor_url_appends_p_for_workspace():
    assert "&p=metro" in C.portal_advisor_url("https://x/", "CJS", "C", "metro/")
    assert "&p=" not in C.portal_advisor_url("https://x/", "CJS", "C", "")


def test_resolved_by_advisor_reads_prefixed_tree(_ws):
    _w("metro/advisor/CJS/intro.json", {"comments": [{"id": "c1", "resolution": "done"}]})
    out = C.resolved_by_advisor("metro/")
    assert out.get("CJS") == {"c1"}
    assert C.resolved_by_advisor("") == {}     # nothing at root


def test_notify_author_bootstraps_each_workspace_project(_ws):
    import ci_notify_author as NA
    for pid in ("metro", "optics"):
        _w(f"{pid}/advisors.json", {"advisors": []})
        _w(f"{pid}/notify_config.json", {"author_email": "me@x.com"})
    NA.main()   # first run = bootstrap per project (no email)
    assert _pl.Path("metro/notify_state.json").read_text()   # state written under <id>/
    assert _pl.Path("optics/notify_state.json").read_text()


def test_notify_advisors_skips_unconfigured_per_project(_ws):
    import ci_notify_advisors as NAd
    _w("metro/advisors.json", {"advisors": [], "email_configured": True})
    _w("metro/notify_state.json", {"bootstrapped": True, "last_author_digest_ts": "2020-01-01T00:00:00+00:00"})
    _w("metro/release.json", {})
    NAd.main()   # configured + no releases → no crash, 0 sent (per-project state honored)
    assert _pl.Path("metro/notify_state.json").exists()


# ---- user-controllable notification settings: author digest frequency + reviewer per-event toggles ----
import datetime as _dt


def _t(hours_ago=0, days_ago=0):
    return (_dt.datetime(2026, 7, 5, 12, 0, tzinfo=_dt.timezone.utc)
            - _dt.timedelta(hours=hours_ago, days=days_ago)).isoformat()

_NOW = _dt.datetime(2026, 7, 5, 12, 0, tzinfo=_dt.timezone.utc)


def test_digest_due_off_never_sends():
    assert C.digest_due("off", None, _NOW) is False
    assert C.digest_due("off", _t(days_ago=30), _NOW) is False


def test_digest_due_daily():
    assert C.digest_due("daily", None, _NOW) is True          # never sent → send
    assert C.digest_due("daily", _t(hours_ago=2), _NOW) is False
    assert C.digest_due("daily", _t(hours_ago=21), _NOW) is True


def test_digest_due_weekly():
    assert C.digest_due("weekly", _t(days_ago=3), _NOW) is False
    assert C.digest_due("weekly", _t(days_ago=8), _NOW) is True


def test_digest_due_defaults_to_daily():
    assert C.digest_due(None, _t(hours_ago=21), _NOW) is True
    assert C.digest_due("", _t(hours_ago=2), _NOW) is False


def test_reviewer_wants_event_defaults_on_and_honors_off():
    assert C.reviewer_wants({}, "released") is True
    assert C.reviewer_wants({"email": {"released": False}}, "released") is False
    assert C.reviewer_wants({"email": {"released": False}}, "responses") is True   # only that event off
    assert C.reviewer_wants({"email": {"released": False, "responses": False}}, "responses") is False


def test_notify_author_off_skips_even_with_state(_ws, monkeypatch):
    import ci_notify_author as NA
    sent = []
    monkeypatch.setattr(C, "send", lambda *a, **k: sent.append(1))
    _w("metro/advisors.json", {"advisors": []})
    _w("metro/notify_config.json", {"author_email": "me@x.com", "frequency": "off"})
    _w("metro/notify_state.json", {"bootstrapped": True, "last_author_digest_ts": _t(days_ago=30)})
    NA.main()
    assert sent == []           # frequency off → zero digests


def test_notify_advisors_honors_reviewer_released_off(_ws, monkeypatch):
    import ci_notify_advisors as NAd
    sent = []
    monkeypatch.setattr(C, "send", lambda *a, **k: sent.append(1))
    _w("metro/advisors.json", {"email_configured": True,
        "advisors": [{"id": "A", "name": "A", "email": "a@x.com"}]})
    _w("metro/release.json", {"A": {"released": ["intro"]}})
    _w("metro/notify_state.json", {"bootstrapped": True, "notified_released": {}, "notified_resolved": {}, "last_resolved_email_ts": {}})
    _w("metro/chapters.json", [{"id": "intro", "n": 1, "title": "Intro"}])
    _w("metro/advisor/A/prefs.json", {"email": {"released": False}})   # reviewer opted out
    NAd.main()
    assert sent == []           # reviewer turned chapter-released emails off


def test_portal_url_embeds_key_as_magic_link():
    # the invite email's link carries the access key so the reviewer just clicks — no paste
    url = ci_invite.portal_url("https://x/", {"id": "CJS", "name": "C"}, "metro/", key="ghp_abc")
    assert "&k=ghp_abc" in url
    assert "&p=metro" in url
    # no key passed → no k param leaks
    assert "&k=" not in ci_invite.portal_url("https://x/", {"id": "CJS"}, "")


# --- Feature B: deliverability hygiene headers on build_eml ---

def _headers(eml):
    """Header block (before the first blank line) as a name->value dict."""
    head = eml.split("\r\n\r\n", 1)[0]
    out = {}
    for ln in head.split("\r\n"):
        if ": " in ln:
            k, v = ln.split(": ", 1)
            out[k] = v
    return out


def test_build_eml_reply_to_defaults_to_from_address():
    os.environ.pop("REPLY_TO", None)
    eml = C.build_eml("noreply@example.com", "Footnote", "adv@gt.edu", "Hi", "text", "<p>html</p>")
    assert _headers(eml).get("Reply-To") == "noreply@example.com"


def test_build_eml_reply_to_env_overrides():
    os.environ["REPLY_TO"] = "matt@example.com"
    try:
        eml = C.build_eml("noreply@example.com", "Footnote", "adv@gt.edu", "Hi", "t", "<p>h</p>")
        assert _headers(eml).get("Reply-To") == "matt@example.com"
    finally:
        os.environ.pop("REPLY_TO", None)


def test_build_eml_sets_list_unsubscribe_mailto_no_oneclick():
    os.environ.pop("REPLY_TO", None)
    eml = C.build_eml("noreply@example.com", "Footnote", "adv@gt.edu", "Hi", "t", "<p>h</p>")
    h = _headers(eml)
    assert h.get("List-Unsubscribe") == "<mailto:noreply@example.com?subject=unsubscribe>"
    # one-click needs a hosted POST endpoint the serverless model can't provide — must be absent
    assert "List-Unsubscribe-Post" not in h
