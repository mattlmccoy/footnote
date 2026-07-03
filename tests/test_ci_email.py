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
