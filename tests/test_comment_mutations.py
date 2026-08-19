"""Pure comment mutations for the local processor's respond/note/decide commands (parity with
process-reviews.py). answer_comment already exists; note_comment/decide_comment added here. All
pure (input not mutated).

Run: python3 -m pytest tests/test_comment_mutations.py
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "data-template"))

import ci_review_common as R  # noqa: E402


def test_note_keeps_status_and_records_response():
    c = {"id": "c1", "status": "staged", "claude": {"branch": "review-edits/ch1"}}
    out = R.note_comment(c, "T", "here's how I made the edit")
    assert out["status"] == "staged"                       # unchanged
    assert out["claude"]["response"] == "here's how I made the edit"
    assert out["claude"]["ts"] == "T"
    assert out["claude"]["branch"] == "review-edits/ch1"   # preserved
    assert "staged_edit" not in out
    assert c["claude"] == {"branch": "review-edits/ch1"}   # input not mutated


def test_note_with_before_after_adds_staged_edit():
    out = R.note_comment({"id": "c1", "status": "open"}, "T", "explain", before="old", after="new")
    assert out["staged_edit"] == {"before": "old", "after": "new"}
    assert out["status"] == "open"


def test_decide_records_decision():
    out = R.decide_comment({"id": "c1", "status": "staged"}, "T", "approve")
    assert out["decision"] == "approve" and out["decision_ts"] == "T"
    assert "decision_note" not in out


def test_decide_with_note():
    out = R.decide_comment({"id": "c1"}, "T", "revise", note="tighten the wording")
    assert out["decision"] == "revise" and out["decision_note"] == "tighten the wording"


def test_decide_revise_unqueues_an_approved_comment():
    out = R.decide_comment({"id": "c1", "status": "approved",
                            "staged_edit": {"before": "old", "after": "new"}},
                           "T", "revise", note="review the newer branch")
    assert out["status"] == "queued"
    assert out["decision"] == "revise"
    assert "staged_edit" not in out


def test_new_branch_commit_restages_stale_approval():
    review = {"comments": [{"id": "c1", "status": "approved",
                             "claude": {"branch": "review-edits/ch1", "commit": "old"},
                             "staged_edit": {"before": "old", "after": "new"}}]}
    out, changed = R.restage_stale_approvals(review, "review-edits/ch1", "new", "T")
    c = out["comments"][0]
    assert changed == 1
    assert c["status"] == "staged"
    assert c["claude"]["commit"] == "new"
    assert "staged_edit" not in c
    assert review["comments"][0]["status"] == "approved"


def test_matching_branch_commit_keeps_approval():
    review = {"comments": [{"id": "c1", "status": "approved",
                             "claude": {"branch": "review-edits/ch1", "commit": "same"}}]}
    out, changed = R.restage_stale_approvals(review, "review-edits/ch1", "same", "T")
    assert changed == 0
    assert out["comments"][0]["status"] == "approved"


def test_decide_does_not_mutate_input():
    c = {"id": "c1", "status": "staged"}
    R.decide_comment(c, "T", "reject")
    assert "decision" not in c


def test_resolve_advisor_comment():
    out = R.resolve_advisor_comment({"id": "a1", "body": "fix this"}, "T", "addressed",
                                    "reworded per your note", before="x", after="y")
    assert out["resolution"] == {"state": "addressed", "note": "reworded per your note",
                                 "ts": "T", "before": "x", "after": "y"}


def test_resolve_advisor_comment_no_diff():
    out = R.resolve_advisor_comment({"id": "a1"}, "T", "declined", "out of scope")
    assert out["resolution"] == {"state": "declined", "note": "out of scope", "ts": "T"}
