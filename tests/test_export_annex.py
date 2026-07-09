"""Export annex (pure): the "Reviewer comments" markdown + the flattened comment list feeding
annotate_docx.py, so no comment is ever dropped from a DOCX/MD export. Parity with process-reviews.py.

Run: python3 -m pytest tests/test_export_annex.py
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "data-template"))

import ci_review_common as R  # noqa: E402


def test_annex_empty():
    md = R.annex_md("ch1", [])
    assert "Reviewer comments — ch1" in md and "_No comments._" in md


def test_annex_lists_comment_with_edit_and_resolution():
    comments = [{"author": "Rev A", "date": "2026-06-28T14:00:00Z", "quote": "the  thing",
                 "body": "reword this", "edit": {"op": "replace", "find": "thing", "replacement": "widget"},
                 "resolution": {"state": "addressed", "note": "done"}}]
    md = R.annex_md("ch1", comments)
    assert "**1. [Rev A, 2026-06-28]**" in md
    assert "the thing" in md            # whitespace normalized
    assert "reword this" in md
    assert "Suggested replace" in md and "widget" in md
    assert "addressed by the author" in md


def test_export_comment_list_merges_owner_and_advisor():
    review = {"comments": [{"id": "c1", "author": "owner", "body": "b1",
                            "anchor": {"quote": "q1"}, "edit": None,
                            "claude": {"ts": "2026-01-01T00:00:00Z"}}]}
    adv = {"comments": [{"id": "a1", "body": "b2", "anchor": {"quote": "q2"}}]}
    lst = R.export_comment_list(review, [("Rev A", adv)])
    assert [c["author"] for c in lst] == ["owner", "Rev A"]
    assert lst[0]["quote"] == "q1" and lst[0]["date"] == "2026-01-01T00:00:00Z"
    assert lst[1]["quote"] == "q2" and lst[1]["body"] == "b2"
