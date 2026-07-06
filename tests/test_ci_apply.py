"""Tests for the deterministic apply engine (ci_review_common pure core).

Slice 2 of the Claude round-trip backend: the apply-direct path + shared job/comment
plumbing. Everything here is pure (no git, no network) so it runs under pytest; the
git/clone I/O in ci_apply.py is thin and verified live on the adopter's Actions.
"""
import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-template"))
import ci_review_common as R  # noqa: E402


# --------------------------------------------------------------- literal_replace
def test_literal_replace_replaces_the_single_occurrence():
    assert R.literal_replace("the cat sat", "cat", "dog") == "the dog sat"


def test_literal_replace_raises_when_the_target_is_absent():
    with pytest.raises(R.EditConflict):
        R.literal_replace("the cat sat", "mouse", "dog")


def test_literal_replace_raises_when_the_target_is_ambiguous():
    # Two occurrences → we refuse rather than guess which one the reviewer meant.
    with pytest.raises(R.EditConflict):
        R.literal_replace("cat and cat", "cat", "dog")


# --------------------------------------------------------------- job plumbing
def test_remove_job_drops_only_the_named_job():
    jobs = [{"id": "j1"}, {"id": "j2"}, {"id": "j3"}]
    assert R.remove_job(jobs, "j2") == [{"id": "j1"}, {"id": "j3"}]


def test_remove_job_is_a_noop_when_absent_and_does_not_mutate_input():
    jobs = [{"id": "j1"}]
    out = R.remove_job(jobs, "nope")
    assert out == [{"id": "j1"}]
    assert jobs == [{"id": "j1"}]        # input untouched (immutability-first)


def test_comments_by_id_returns_matches_in_job_order_skipping_missing():
    review = {"comments": [{"id": "a"}, {"id": "b"}, {"id": "c"}]}
    assert R.comments_by_id(review, ["c", "a", "zzz"]) == [{"id": "c"}, {"id": "a"}]


# --------------------------------------------------------------- path helpers
def test_paths_are_project_prefixed():
    assert R.jobs_path("") == "jobs.json"
    assert R.jobs_path("proj-1/") == "proj-1/jobs.json"
    assert R.review_path("", "02-methods") == "reviews/02-methods.json"
    assert R.review_path("proj-1/", "02-methods") == "proj-1/reviews/02-methods.json"


# --------------------------------------------------------------- apply-direct edit
def _direct_comment():
    # The exact shape js/app.js stageDirectEdit writes.
    return {
        "id": "c1",
        "kind": "direct",
        "status": "queued",
        "edit": {"op": "replace", "find": "\\alpha", "replacement": "\\beta"},
        "prose_before": "the alpha term",
        "prose_after": "the beta term",
        "claude": {"branch": None, "commit": None, "response": None,
                   "resolved_line": None, "ts": None},
    }


def test_apply_comment_edit_applies_the_verbatim_source_replacement():
    src = "x = \\alpha + 1"
    assert R.apply_comment_edit(src, _direct_comment()) == "x = \\beta + 1"


def test_apply_comment_edit_propagates_conflict_when_source_absent():
    with pytest.raises(R.EditConflict):
        R.apply_comment_edit("x = 1", _direct_comment())


def test_stage_direct_edit_marks_staged_with_branch_and_prose_diff():
    out = R.stage_direct_edit(_direct_comment(), "review-edits/02-methods", "2026-07-06T00:00:00Z")
    assert out["status"] == "staged"
    assert out["claude"]["branch"] == "review-edits/02-methods"
    assert out["claude"]["ts"] == "2026-07-06T00:00:00Z"
    # the reader-facing track-changes diff comes from the prose_before/after the app captured
    assert out["staged_edit"] == {"before": "the alpha term", "after": "the beta term"}


def test_stage_direct_edit_does_not_mutate_the_input_comment():
    c = _direct_comment()
    R.stage_direct_edit(c, "review-edits/x", "t")
    assert c["status"] == "queued" and c["claude"]["branch"] is None


def test_conflict_comment_records_reason_without_staging():
    out = R.conflict_comment(_direct_comment(), "target text not found", "t")
    assert out["status"] == "conflict"
    assert out["claude"]["reason"] == "target text not found"
    assert "staged_edit" not in out


# --------------------------------------------------------------- preview output path
def test_preview_out_is_project_prefixed():
    # the reviewer loads the branch view from <prefix>preview/<unit>.html (js/app.js dpath),
    # distinct from the merged/published content/<unit>.html the render pipeline writes.
    assert R.preview_out("", "02-methods") == "preview/02-methods.html"
    assert R.preview_out("proj/", "02-methods") == "proj/preview/02-methods.html"


# --------------------------------------------------------------- project routing
def test_apply_prefixes_discovers_root_and_workspace_queues(tmp_path, monkeypatch):
    # legacy root project: jobs.json at the repo root
    (tmp_path / "jobs.json").write_text("[]")
    # workspace projects: <id>/jobs.json each
    (tmp_path / "paper-a").mkdir()
    (tmp_path / "paper-a" / "jobs.json").write_text("[]")
    (tmp_path / "paper-b").mkdir()
    (tmp_path / "paper-b" / "jobs.json").write_text("[]")
    # an unrelated folder without a queue is ignored
    (tmp_path / "content").mkdir()
    (tmp_path / "content" / "x.html").write_text("<p/>")
    monkeypatch.chdir(tmp_path)
    assert R.apply_prefixes() == ["", "paper-a/", "paper-b/"]


def test_apply_prefixes_workspace_only(tmp_path, monkeypatch):
    (tmp_path / "proj").mkdir()
    (tmp_path / "proj" / "jobs.json").write_text("[]")
    monkeypatch.chdir(tmp_path)
    assert R.apply_prefixes() == ["proj/"]


# --------------------------------------------------------------- branch + multi-file apply
def test_branch_for_unit():
    assert R.branch_for("02-methods") == "review-edits/02-methods"


def test_apply_direct_to_files_edits_the_one_file_that_matches():
    files = {"main.tex": "intro", "methods.tex": "we use \\alpha here"}
    comment = _direct_comment()
    new_files, edited = R.apply_direct_to_files(files, comment)
    assert edited == "methods.tex"
    assert new_files["methods.tex"] == "we use \\beta here"
    assert new_files["main.tex"] == "intro"          # untouched
    assert files["methods.tex"] == "we use \\alpha here"  # input not mutated


def test_apply_direct_to_files_conflict_when_match_spans_two_files():
    files = {"a.tex": "\\alpha", "b.tex": "\\alpha"}
    with pytest.raises(R.EditConflict):
        R.apply_direct_to_files(files, _direct_comment())


# --------------------------------------------------------------- process one apply-direct job
def test_process_apply_direct_job_stages_applied_and_flags_conflicts():
    review = {"comments": [
        dict(_direct_comment(), id="c1"),
        dict(_direct_comment(), id="c2",
             edit={"op": "replace", "find": "\\gamma", "replacement": "\\delta"}),
    ]}
    job = {"id": "j1", "type": "apply-direct", "chapter": "02-methods",
           "comment_ids": ["c1", "c2"]}
    files = {"methods.tex": "x = \\alpha + 1"}          # c1 matches; c2 (\gamma) does not
    new_review, new_files, branch, applied = R.process_apply_direct_job(
        job, review, files, "2026-07-06T00:00:00Z")
    assert branch == "review-edits/02-methods"
    assert applied is True                              # at least one edit landed
    assert new_files["methods.tex"] == "x = \\beta + 1"
    byid = {c["id"]: c for c in new_review["comments"]}
    assert byid["c1"]["status"] == "staged"
    assert byid["c1"]["claude"]["branch"] == "review-edits/02-methods"
    assert byid["c2"]["status"] == "conflict"           # \gamma absent → flagged, not applied


def test_process_apply_direct_job_all_conflict_reports_nothing_applied():
    review = {"comments": [dict(_direct_comment(), id="c1",
              edit={"op": "replace", "find": "\\zeta", "replacement": "\\eta"})]}
    job = {"id": "j1", "type": "apply-direct", "chapter": "ch1", "comment_ids": ["c1"]}
    _, new_files, _, applied = R.process_apply_direct_job(
        job, review, {"ch1.tex": "nothing here"}, "t")
    assert applied is False
    assert new_files == {"ch1.tex": "nothing here"}     # no file changed
