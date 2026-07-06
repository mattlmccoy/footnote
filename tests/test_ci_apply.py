"""Tests for the deterministic apply engine (ci_review_common pure core).

Slice 2 of the Claude round-trip backend: the apply-direct path + shared job/comment
plumbing. Everything here is pure (no git, no network) so it runs under pytest; the
git/clone I/O in ci_apply.py is thin and verified live on the adopter's Actions.
"""
import json
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


# ================================================================ apply-edits (Claude)
def _comment(cid="c1", body="please reword this", quote="the alpha term"):
    return {"id": cid, "kind": "text", "status": "queued", "tag": "clarity",
            "anchor": {"quote": quote, "section": "Methods"}, "body": body,
            "claude": {"branch": None, "commit": None, "response": None,
                       "resolved_line": None, "ts": None}}


def test_build_apply_task_packages_chapter_and_comments_for_claude():
    review = {"comments": [_comment("c1", "reword", "alpha"),
                           dict(_comment("c2", "cite here", "beta"),
                                revise_note="be more specific")]}
    job = {"chapter": "02-methods", "comment_ids": ["c1", "c2"]}
    task = R.build_apply_task(job, review, {"methods.tex": "x = alpha + beta"})
    assert task["chapter"] == "02-methods"
    assert task["source"] == {"methods.tex": "x = alpha + beta"}
    ids = [c["id"] for c in task["comments"]]
    assert ids == ["c1", "c2"]
    c2 = next(c for c in task["comments"] if c["id"] == "c2")
    assert c2["quote"] == "beta" and c2["body"] == "cite here"
    assert c2["revise_note"] == "be more specific"   # revision context forwarded to Claude


def test_build_apply_task_forwards_the_job_revision_note():
    # "Request changes" puts revise_note on the JOB (not the comment); Claude must see it to redo.
    review = {"comments": [_comment("c1", "reword")]}
    job = {"chapter": "ch1", "comment_ids": ["c1"], "revision": True,
           "revise_note": "make it shorter"}
    task = R.build_apply_task(job, review, {"m.tex": "x"})
    assert task["revision"] is True
    assert task["revise_note"] == "make it shorter"


def test_process_apply_edits_job_stages_claude_edits_deterministically():
    review = {"comments": [_comment("c1", quote="the alpha term")]}
    job = {"id": "j1", "type": "apply-edits", "chapter": "02-methods", "comment_ids": ["c1"]}
    edits = {"c1": {"id": "c1", "response": "Reworded for clarity.",
                    "source_before": "\\alpha", "source_after": "\\beta",
                    "prose_before": "the alpha term", "prose_after": "the beta term"}}
    new_review, new_files, branch, applied = R.process_apply_edits_job(
        job, review, {"methods.tex": "x = \\alpha + 1"}, edits, "2026-07-06T00:00:00Z")
    assert applied is True and branch == "review-edits/02-methods"
    assert new_files["methods.tex"] == "x = \\beta + 1"     # Claude's spec applied by literal_replace
    c = new_review["comments"][0]
    assert c["status"] == "staged"
    assert c["claude"]["response"] == "Reworded for clarity."
    assert c["claude"]["branch"] == "review-edits/02-methods"
    assert c["staged_edit"] == {"before": "the alpha term", "after": "the beta term"}
    # the SOURCE diff is persisted on the comment (mirrors apply-direct's `edit`), so merge can
    # reapply only the approved comments' edits from main — the partial-approval mechanism.
    assert c["source_edit"] == {"op": "replace", "find": "\\alpha", "replacement": "\\beta"}


def test_process_apply_edits_job_answers_when_claude_makes_no_edit():
    # Claude replies to a question without changing source → 'answered', response recorded, no branch edit.
    review = {"comments": [_comment("c1", body="what does this mean?")]}
    job = {"id": "j1", "type": "apply-edits", "chapter": "ch1", "comment_ids": ["c1"]}
    edits = {"c1": {"id": "c1", "response": "It denotes the absorption coefficient."}}
    new_review, new_files, _, applied = R.process_apply_edits_job(
        job, review, {"ch1.tex": "text"}, edits, "t")
    assert applied is False
    assert new_files == {"ch1.tex": "text"}
    c = new_review["comments"][0]
    assert c["status"] == "answered"
    assert c["claude"]["response"] == "It denotes the absorption coefficient."


def test_process_apply_edits_job_flags_conflict_when_claude_target_absent():
    review = {"comments": [_comment("c1")]}
    job = {"id": "j1", "type": "apply-edits", "chapter": "ch1", "comment_ids": ["c1"]}
    edits = {"c1": {"id": "c1", "response": "fixed",
                    "source_before": "NOT PRESENT", "source_after": "x"}}
    new_review, _, _, applied = R.process_apply_edits_job(
        job, review, {"ch1.tex": "text"}, edits, "t")
    assert applied is False
    assert new_review["comments"][0]["status"] == "conflict"


# ================================================================ approve -> merge
def test_comment_source_edit_reads_direct_edit_or_claude_source_edit():
    direct = {"edit": {"op": "replace", "find": "a", "replacement": "b"}}
    claude = {"source_edit": {"op": "replace", "find": "c", "replacement": "d"}}
    assert R.comment_source_edit(direct) == {"find": "a", "replacement": "b"}
    assert R.comment_source_edit(claude) == {"find": "c", "replacement": "d"}
    assert R.comment_source_edit({"body": "just a note"}) is None


def _approved(cid, find, repl, source_edit=False):
    key = "source_edit" if source_edit else "edit"
    return {"id": cid, "status": "approved",
            key: {"op": "replace", "find": find, "replacement": repl},
            "claude": {"branch": "review-edits/x"}}


def test_process_merge_applies_only_approved_edits_and_marks_them_merged():
    review = {"comments": [
        _approved("c1", "\\alpha", "\\beta"),                       # approved (apply-direct)
        _approved("c2", "\\gamma", "\\delta", source_edit=True),    # approved (claude)
        {"id": "c3", "status": "declined",                          # REJECTED — must NOT be applied
         "edit": {"op": "replace", "find": "\\keepme", "replacement": "\\DROPPED"}},
    ]}
    job = {"id": "m1", "type": "merge", "chapter": "02-methods"}
    files = {"methods.tex": "\\alpha \\gamma \\keepme"}
    new_review, new_files, merged = R.process_merge_job(job, review, files, "t")
    assert new_files["methods.tex"] == "\\beta \\delta \\keepme"    # rejected edit NOT applied
    assert set(merged) == {"c1", "c2"}
    byid = {c["id"]: c for c in new_review["comments"]}
    assert byid["c1"]["status"] == "merged" and byid["c2"]["status"] == "merged"
    assert byid["c3"]["status"] == "declined"                       # untouched


def test_process_merge_flags_conflict_when_approved_target_missing():
    review = {"comments": [_approved("c1", "\\notthere", "\\x")]}
    job = {"id": "m1", "type": "merge", "chapter": "ch1"}
    new_review, new_files, merged = R.process_merge_job(job, review, {"ch1.tex": "empty"}, "t")
    assert merged == []
    assert new_files == {"ch1.tex": "empty"}
    assert new_review["comments"][0]["status"] == "conflict"


# --------------------------------------------------------------- Claude boundary (pure parts)
def test_claude_prompt_includes_comments_and_demands_json_only():
    import ci_apply as A
    task = {"chapter": "02-methods", "source": {"m.tex": "x"},
            "comments": [{"id": "c1", "quote": "alpha", "body": "reword"}]}
    p = A.claude_prompt(task)
    assert "02-methods" in p and "c1" in p and "reword" in p
    assert "JSON" in p                       # instructs a machine-readable answer
    # oversight: the prompt tells Claude to return specs, not to touch files / merge
    assert "source_before" in p and "source_after" in p


def test_parse_claude_edits_from_cli_envelope_with_fenced_json():
    import ci_apply as A
    # the claude CLI --output-format json wraps the assistant text in a "result" field; the model
    # commonly fences the JSON. We must recover the per-comment edit map keyed by id.
    inner = '```json\n[{"id":"c1","response":"ok","source_before":"a","source_after":"b"}]\n```'
    envelope = json.dumps({"type": "result", "result": inner})
    edits = A.parse_claude_edits(envelope)
    assert edits["c1"]["source_after"] == "b" and edits["c1"]["response"] == "ok"


def test_parse_claude_edits_accepts_a_bare_json_object_map():
    import ci_apply as A
    raw = '{"c1": {"id": "c1", "response": "done"}}'
    assert A.parse_claude_edits(raw)["c1"]["response"] == "done"


def test_parse_claude_edits_returns_empty_on_garbage():
    import ci_apply as A
    assert A.parse_claude_edits("not json at all") == {}
