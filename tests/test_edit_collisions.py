"""C2c — two reviewers editing the same passage. process_merge_job must flag overlapping approved
edits as conflicts DETERMINISTICALLY (both, up front), never silently mis-apply based on order."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-template"))
import ci_review_common as R  # noqa: E402


# --------------------------------------------------------------- overlapping_edit_ids (pure)
def test_overlapping_edit_ids_flags_overlapping_spans_in_the_same_file():
    spans = [("A", "f1", 0, 10), ("B", "f1", 5, 15), ("C", "f1", 20, 25)]
    assert R.overlapping_edit_ids(spans) == {"A", "B"}


def test_overlapping_edit_ids_ignores_spans_in_different_files():
    assert R.overlapping_edit_ids([("A", "f1", 0, 10), ("B", "f2", 0, 10)]) == set()


def test_overlapping_edit_ids_adjacent_spans_do_not_overlap():
    assert R.overlapping_edit_ids([("A", "f1", 0, 10), ("B", "f1", 10, 20)]) == set()


def test_overlapping_edit_ids_a_contained_span_overlaps():
    assert R.overlapping_edit_ids([("A", "f1", 0, 20), ("B", "f1", 5, 10)]) == {"A", "B"}


# --------------------------------------------------------------- process_merge_job integration
def _rev(comments):
    return {"comments": comments}


def test_merge_flags_two_approved_edits_on_the_same_passage_as_conflicts():
    files = {"main.tex": "the quick brown fox jumps"}
    review = _rev([
        {"id": "A", "status": "approved", "edit": {"find": "quick brown fox", "replacement": "lazy dog"}},
        {"id": "B", "status": "approved", "edit": {"find": "brown fox jumps", "replacement": "red hen runs"}},
    ])
    new_review, work, merged, drop = R.process_merge_job({}, review, files, "TS")
    assert work["main.tex"] == "the quick brown fox jumps"       # neither applied
    status = {c["id"]: c["status"] for c in new_review["comments"]}
    assert status == {"A": "conflict", "B": "conflict"}
    assert merged == []


def test_merge_still_applies_two_approved_edits_on_disjoint_spans():
    files = {"main.tex": "alpha beta gamma delta"}
    review = _rev([
        {"id": "A", "status": "approved", "edit": {"find": "alpha", "replacement": "A"}},
        {"id": "B", "status": "approved", "edit": {"find": "delta", "replacement": "D"}},
    ])
    new_review, work, merged, drop = R.process_merge_job({}, review, files, "TS")
    assert work["main.tex"] == "A beta gamma D"
    assert set(merged) == {"A", "B"}
