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
import ci_apply as A  # noqa: E402


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


def test_author_source_keeps_tex_and_bib_drops_vendored_files():
    files = {
        "main.tex": "\\documentclass{elsarticle}\\begin{document}...",
        "chapters/intro.tex": "intro text",
        "references.bib": "@article{...}",
        "elsarticle.cls": "% 35KB of class internals",   # vendored — Claude never edits it
        "elsarticle-num.bst": "% bibliography style",
        "extra.sty": "% package",
        "notes.txt": "scratch",
    }
    out = R.author_source(files)
    assert set(out) == {"main.tex", "chapters/intro.tex", "references.bib"}
    assert "elsarticle.cls" not in out and "elsarticle-num.bst" not in out


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
    new_review, new_files, merged, drop_branch = R.process_merge_job(job, review, files, "t")
    assert new_files["methods.tex"] == "\\beta \\delta \\keepme"    # rejected edit NOT applied
    assert set(merged) == {"c1", "c2"}
    byid = {c["id"]: c for c in new_review["comments"]}
    assert byid["c1"]["status"] == "merged" and byid["c2"]["status"] == "merged"
    assert byid["c3"]["status"] == "declined"                       # untouched
    assert drop_branch is True     # nothing left staged/approved → branch is safe to delete


def test_process_merge_flags_conflict_when_approved_target_missing():
    review = {"comments": [_approved("c1", "\\notthere", "\\x")]}
    job = {"id": "m1", "type": "merge", "chapter": "ch1"}
    new_review, new_files, merged, drop_branch = R.process_merge_job(job, review, {"ch1.tex": "empty"}, "t")
    assert merged == []
    assert new_files == {"ch1.tex": "empty"}
    assert new_review["comments"][0]["status"] == "conflict"


def test_process_merge_pure_rejection_drops_the_branch_without_publishing():
    # All comments declined (a pure reject, nothing approved) — the reject bug's cleanup path.
    review = {"comments": [
        {"id": "c1", "status": "declined",
         "edit": {"op": "replace", "find": "\\a", "replacement": "\\b"}}]}
    job = {"id": "m1", "type": "merge", "chapter": "ch1"}
    new_review, new_files, merged, drop_branch = R.process_merge_job(job, review, {"ch1.tex": "\\a"}, "t")
    assert merged == [] and new_files == {"ch1.tex": "\\a"}   # nothing published (main untouched)
    assert drop_branch is True                                # but the orphaned branch IS cleaned up


def test_process_merge_keeps_branch_when_undecided_edits_remain():
    review = {"comments": [
        _approved("c1", "\\alpha", "\\beta"),
        {"id": "c2", "status": "staged",                      # still undecided → branch must survive
         "edit": {"op": "replace", "find": "\\g", "replacement": "\\d"}}]}
    job = {"id": "m1", "type": "merge", "chapter": "ch1"}
    _, _, merged, drop_branch = R.process_merge_job(job, review, {"ch1.tex": "\\alpha \\g"}, "t")
    assert set(merged) == {"c1"} and drop_branch is False


def test_process_merge_keeps_branch_when_a_revise_rerun_is_queued():
    # A 'queued' comment (a revise re-run) will re-stage onto the branch — don't delete it out from
    # under the pending apply-edits job.
    review = {"comments": [
        _approved("c1", "\\alpha", "\\beta"),
        {"id": "c2", "status": "queued"}]}         # re-queued for revision
    job = {"id": "m1", "type": "merge", "chapter": "ch1"}
    _, _, merged, drop_branch = R.process_merge_job(job, review, {"ch1.tex": "\\alpha"}, "t")
    assert set(merged) == {"c1"} and drop_branch is False


# ================================================================ run-agents (read-only critique)
def test_agent_directive_names_agent_and_demands_json_context_carries_the_unit():
    import ci_apply as A
    # directive (the -p arg): names the agent, demands JSON, read-only, points at piped stdin
    d = A.AGENT_INSTRUCTIONS.format(agent="adversary")
    assert "adversary" in d and "JSON" in d and "quote" in d and "body" in d
    assert ("do not edit" in d.lower() or "read-only" in d.lower()) and "stdin" in d.lower()
    # context (the piped stdin): carries the unit source, NOT the instructions
    c = A.agent_context({"chapter": "ch1", "source": {"m.tex": "claim without evidence"}})
    assert "ch1" in c and "claim without evidence" in c


def test_process_run_agents_appends_authored_critique_comments():
    review = {"comments": [{"id": "existing", "author": None, "status": "open"}]}
    job = {"id": "g1", "type": "run-agents", "chapter": "ch1", "agents": ["adversary", "clarity"]}
    outputs = {
        "adversary": [{"quote": "claim", "body": "no evidence given", "tag": "rigor"}],
        "clarity": [{"quote": "jargon", "body": "define this term", "tag": "clarity"}],
    }
    new_review = R.process_run_agents_job(job, review, outputs, "2026-07-06T00:00:00Z",
                                          idgen=lambda i: f"ag{i}")
    assert len(new_review["comments"]) == 3        # existing + 2 agent comments
    added = new_review["comments"][1:]
    assert added[0]["author"] == "adversary" and added[0]["anchor"]["quote"] == "claim"
    assert added[0]["body"] == "no evidence given" and added[0]["tag"] == "rigor"
    assert added[0]["status"] == "open" and added[0]["created_ts"] == "2026-07-06T00:00:00Z"
    assert added[1]["author"] == "clarity"
    assert added[0]["id"] != added[1]["id"]        # unique ids


def test_parse_agent_findings_returns_a_list_not_an_id_map():
    import ci_apply as A
    # findings have NO id — must stay a list (parse_claude_edits would have collapsed them on id)
    inner = '```json\n[{"quote":"a","body":"x"},{"quote":"b","body":"y"}]\n```'
    envelope = json.dumps({"type": "result", "result": inner})
    findings = A.parse_agent_findings(envelope)
    assert isinstance(findings, list) and len(findings) == 2
    assert findings[0]["quote"] == "a" and findings[1]["quote"] == "b"


def test_parse_agent_findings_empty_on_garbage():
    import ci_apply as A
    assert A.parse_agent_findings("not json") == []


# --------------------------------------------------------------- Claude credentials
def test_claude_configured_recognizes_subscription_or_api_key():
    import ci_apply as A
    # Recommended path: a Claude Code subscription OAuth token (from `claude setup-token`).
    assert A.claude_configured({"CLAUDE_CODE_OAUTH_TOKEN": "sk-ant-oat01-..."}) is True
    # Alternative: a raw Anthropic API key.
    assert A.claude_configured({"ANTHROPIC_API_KEY": "sk-ant-..."}) is True
    # Neither set → not configured (the job waits).
    assert A.claude_configured({}) is False
    # Empty strings don't count as configured.
    assert A.claude_configured({"CLAUDE_CODE_OAUTH_TOKEN": "", "ANTHROPIC_API_KEY": ""}) is False


def test_process_run_agents_tolerates_an_agent_with_no_findings():
    review = {"comments": []}
    job = {"type": "run-agents", "chapter": "ch1", "agents": ["a", "b"]}
    new_review = R.process_run_agents_job(job, review, {"a": [], "b": None}, "t",
                                          idgen=lambda i: f"ag{i}")
    assert new_review["comments"] == []


# --------------------------------------------------------------- run_agent_cli uses the catalog (B1)
def test_run_agent_cli_sends_a_catalog_agents_real_system_prompt(monkeypatch):
    import ci_agents as C
    captured = {}
    monkeypatch.setattr(A, "_run_claude", lambda directive, ctx, model, label: (captured.update(d=directive) or "[]"))
    A.run_agent_cli("rigor", {"chapter": "ch1", "source": {}}, catalog=C.builtin_catalog())
    d = captured["d"]
    assert "survive scrutiny" in d.lower() or "overclaim" in d.lower()   # the real rigor prompt, not "{agent}"
    assert "Return ONLY a JSON array" in d and "READ-ONLY" in d.upper()


def test_run_agent_cli_falls_back_to_legacy_for_an_unknown_name(monkeypatch):
    import ci_agents as C
    captured = {}
    monkeypatch.setattr(A, "_run_claude", lambda directive, ctx, model, label: (captured.update(d=directive) or "[]"))
    A.run_agent_cli("my-old-agent", {"chapter": "ch1", "source": {}}, catalog=C.builtin_catalog())
    assert captured["d"] == A.AGENT_INSTRUCTIONS.format(agent="my-old-agent")


def test_run_agent_cli_caps_findings_per_agent(monkeypatch):
    import ci_agents as C
    flood = json.dumps([{"quote": str(i), "body": "b", "tag": "x"} for i in range(30)])
    monkeypatch.setattr(A, "_run_claude", lambda *a, **k: flood)
    out = A.run_agent_cli("rigor", {"chapter": "ch1", "source": {}}, catalog=C.builtin_catalog())
    assert len(out) == C.DEFAULT_MAX_FINDINGS


def test_run_agent_cli_fills_the_domain_field(monkeypatch):
    import ci_agents as C
    captured = {}
    monkeypatch.setattr(A, "_run_claude", lambda directive, ctx, model, label: (captured.update(d=directive) or "[]"))
    A.run_agent_cli("domain", {"chapter": "ch1", "source": {}}, catalog=C.builtin_catalog(),
                    field="materials engineering")
    assert "materials engineering" in captured["d"] and "{field}" not in captured["d"]


# --------------------------------------------------------------- Claude boundary (pure parts)
def test_claude_directive_demands_json_specs_context_carries_task():
    import ci_apply as A
    task = {"chapter": "02-methods", "source": {"m.tex": "x"},
            "comments": [{"id": "c1", "quote": "alpha", "body": "reword"}]}
    # directive (the -p arg): demands machine-readable specs, oversight (specs not file edits), stdin note
    d = A.CLAUDE_INSTRUCTIONS
    assert "JSON" in d and "source_before" in d and "source_after" in d
    assert "do not" in d.lower() and ("merge" in d.lower()) and "stdin" in d.lower()
    # context (the piped stdin): carries the unit id + comments + source, NOT the instructions
    c = A.claude_context(task)
    assert "02-methods" in c and "c1" in c and "reword" in c and "JSON" not in c


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


# ------------------------------------------- apply_instructions: outline structure vs unit copy-edit
def test_apply_instructions_uses_a_structure_prompt_for_outline():
    p = A.apply_instructions("__outline__")
    assert "structure" in p.lower()
    assert ("\\chapter" in p) or ("\\section" in p)
    assert "source_before" in p and "source_after" in p   # same machine-readable output contract

def test_apply_instructions_uses_the_copyeditor_prompt_for_a_normal_unit():
    assert A.apply_instructions("ch_introduction") == A.CLAUDE_INSTRUCTIONS


# --------------------------------------------------------------- whitespace-tolerant source anchoring
# LaTeX prose is hard-wrapped at ~80 cols; Claude returns source_before with single spaces. The anchor
# must treat any run of whitespace (incl. newlines) as equivalent, or NO wrapped passage can be edited.

def test_flexible_replace_matches_across_a_hard_wrap():
    src = "insulators and nearly transparent to RF, which\nis what allows selective heating."
    find = "nearly transparent to RF, which is what allows selective heating."
    assert R.flexible_replace(src, find, "REPLACED") == "insulators and REPLACED"


def test_flexible_replace_exact_still_works():
    assert R.flexible_replace("the cat sat", "cat", "dog") == "the dog sat"


def test_flexible_replace_raises_when_absent():
    with pytest.raises(R.EditConflict):
        R.flexible_replace("hello world", "goodbye", "x")


def test_flexible_replace_raises_when_ambiguous():
    with pytest.raises(R.EditConflict):
        R.flexible_replace("cat\ncat", "cat", "dog")


def test_flexible_count_counts_wrapped_occurrences():
    assert R.flexible_count("a nearly transparent b, which\nis c", "which is c") == 1
    assert R.flexible_count("no match here", "which is c") == 0


def test_process_apply_edits_job_anchors_a_hard_wrapped_passage():
    # the ch_background reproduction: source_before is single-spaced, the .tex wraps it across 3 lines
    src = ("Most thermoplastics are electrical insulators and nearly transparent to RF, which\n"
           "is what allows selective heating: only the regions made lossy by a dopant absorb\n"
           "energy.\n")
    review = {"comments": [_comment("c1", quote="nearly transparent")]}
    job = {"id": "j1", "type": "apply-edits", "chapter": "ch_bg", "comment_ids": ["c1"]}
    before = ("Most thermoplastics are electrical insulators and nearly transparent to RF, "
              "which is what allows selective heating: only the regions made lossy by a dopant "
              "absorb energy.")
    after = ("Most thermoplastics are electrical insulators and functionally transparent to RF, "
             "which is what allows selective heating.")
    edits = {"c1": {"id": "c1", "response": "Reworded.",
                    "source_before": before, "source_after": after,
                    "prose_before": "nearly transparent", "prose_after": "functionally transparent"}}
    new_review, new_files, _, applied = R.process_apply_edits_job(
        job, review, {"chapters/ch_fundamentals.tex": src}, edits, "t")
    assert applied is True
    assert new_files["chapters/ch_fundamentals.tex"] == after + "\n"   # wrapped span replaced by after
    assert new_review["comments"][0]["status"] == "staged"


def test_build_apply_task_forwards_the_comment_thread():
    """A comment answered as a question can get a follow-up in its thread (owner: 'now put this in the
    text'). The writer must SEE that back-and-forth to act on it — otherwise a re-send re-answers the
    original question and ignores the follow-up (the c_mrele6go_0 case)."""
    thread = [{"author": "you", "text": "Great answer — now explain it in the text.",
               "ts": "2026-07-10T00:00:00Z"}]
    review = {"comments": [dict(_comment("c1", "explain this"), thread=thread,
                                claude={"response": "It is the melt fraction..."})]}
    job = {"chapter": "ch_modeling", "comment_ids": ["c1"]}
    task = R.build_apply_task(job, review, {"m.tex": "x"})
    c1 = task["comments"][0]
    assert c1["thread"] == thread                       # the follow-up conversation is forwarded
    assert c1["prior_response"] == "It is the melt fraction..."   # and Claude's earlier answer
