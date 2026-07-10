"""Pure core for cloud parity + the live progress stream: narrated event builder, critic-verdict
tally, revise-loop decision, verify_refs (undefined references), and the truthful-merge assertion.
All pure — the CI shell does the git/Claude I/O.

Run: python3 -m pytest tests/test_cloud_pipeline.py
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "data-template"))

import ci_review_common as R  # noqa: E402


# ---- progress_event: narration-first, machine fields secondary ----

def test_progress_event_minimal():
    e = R.progress_event("j1", 1, "read", "Reading comment 2 of 4.", ts="T")
    assert e == {"job": "j1", "seq": 1, "phase": "read", "status": "ok",
                 "say": "Reading comment 2 of 4.", "ts": "T"}


def test_progress_event_full():
    e = R.progress_event("j1", 7, "agent", "Adding \\eqref to both.", comment="c1",
                         agent="writer", status="running",
                         edit={"before": "x", "after": "x \\eqref{a}"}, ts="T")
    assert e["comment"] == "c1" and e["agent"] == "writer" and e["status"] == "running"
    assert e["edit"] == {"before": "x", "after": "x \\eqref{a}"}


def test_progress_event_omits_empty_optionals():
    e = R.progress_event("j1", 2, "stage", "Staged.", ts="T")
    assert "comment" not in e and "agent" not in e and "edit" not in e


# ---- critics_verdict: any rejection blocks (author-oversight conservative) ----

def test_critics_all_approve():
    v = R.critics_verdict([{"agent": "adversary", "approved": True, "say": "ok"},
                           {"agent": "copyedit", "approved": True, "say": "clean"}])
    assert v["approved"] is True and v["rejections"] == []


def test_critics_one_rejects_blocks():
    v = R.critics_verdict([{"agent": "adversary", "approved": True, "say": "ok"},
                           {"agent": "citations", "approved": False, "say": "ref broken"}])
    assert v["approved"] is False
    assert v["rejections"] == [{"agent": "citations", "say": "ref broken"}]


def test_critics_empty_is_approved():
    assert R.critics_verdict([])["approved"] is True   # no critics configured -> writer edit stands


# ---- revise_decision: stage | revise | conflict ----

def test_revise_stage_when_approved():
    assert R.revise_decision(True, attempt=1) == "stage"


def test_revise_loop_then_conflict():
    assert R.revise_decision(False, attempt=1, max_attempts=2) == "revise"
    assert R.revise_decision(False, attempt=2, max_attempts=2) == "conflict"


# ---- verify_refs: referenced labels that are never defined ----

def test_verify_refs_all_defined():
    tex = r"\label{eq:a}\label{fig:b} text \cref{eq:a} and \ref{fig:b}"
    assert R.verify_refs(tex) == []


def test_verify_refs_finds_undefined():
    tex = r"\label{eq:a} see \eqref{eq:a} and \cref{eq:missing}, \ref{fig:gone}"
    out = R.verify_refs(tex)
    assert sorted(out) == ["eq:missing", "fig:gone"]


def test_verify_refs_multi_key_cref():
    tex = r"\label{a}\label{b} \cref{a,b,c}"
    assert R.verify_refs(tex) == ["c"]


# ---- edit_in_source: truthful-merge assertion (the edit really landed) ----

def test_edit_in_source_true():
    src = "The loss is high as shown in \\eqref{eq:loss}."
    assert R.edit_in_source(src, {"after": "as shown in \\eqref{eq:loss}"}) is True


def test_edit_in_source_false():
    assert R.edit_in_source("nothing changed", {"after": "the new sentence"}) is False


def test_edit_in_source_whitespace_tolerant():
    assert R.edit_in_source("a   b\n c", {"after": "a b c"}) is True


# ---- the cloud writer uses the configured Writer/Editor agent's persona, not a generic call ----
import ci_apply  # noqa: E402
import ci_agents  # noqa: E402


def test_writer_directive_uses_configured_writer_persona():
    d = ci_apply.writer_directive(ci_agents.builtin_catalog(), field="RF heating", writer_id="writer")
    assert "Writer/Editor agent" in d          # spoken in the writer agent's voice
    assert "draft" in d.lower()                # the agent's persona is present
    assert "output contract" in d.lower()      # still enforces the parseable edit format


def test_writer_directive_falls_back_to_generic_when_absent():
    assert ci_apply.writer_directive({}, writer_id="nope") == ci_apply.CLAUDE_INSTRUCTIONS


def test_figure_drafter_is_a_usable_writer_persona():
    # figure comments route to the Figure Drafter doer as the writer — its persona composes the same way
    d = ci_apply.writer_directive(ci_agents.builtin_catalog(), field="RF heating", writer_id="figure-drafter")
    assert "figure" in d.lower() and "output contract" in d.lower()
    assert d != ci_apply.CLAUDE_INSTRUCTIONS


def test_responder_agent_present_for_response_jobs():
    # the Review-Response Writer (responder) doer exists in the catalog with a real prompt
    entry = ci_agents.builtin_catalog().get("responder")
    assert entry and entry.get("category") == "doer" and (entry.get("systemPrompt") or "").strip()


# ---- verify_refs must not treat LaTeX macro parameters (\cref{#1} in a \newcommand) as references ----

def test_verify_refs_ignores_macro_parameters():
    tex = r"\newcommand{\myref}[1]{\cref{#1}}\label{eq:a} see \eqref{eq:a}"
    assert R.verify_refs(tex) == []          # #1 is a macro param, not an undefined label


def test_verify_refs_still_catches_real_undefined_with_macros_present():
    tex = r"\newcommand{\myref}[1]{\cref{#1}} \cref{eq:missing}"
    assert R.verify_refs(tex) == ["eq:missing"]


# ---- em-dash guard: an edit must not INTRODUCE em-dashes (Matt's hard no-em-dash rule) ----

def test_em_dash_count_counts_latex_and_unicode():
    assert R.em_dash_count("a---b and c—d") == 2
    assert R.em_dash_count("commas, only") == 0
    assert R.em_dash_count("en--dash is fine") == 0        # -- (en-dash) is not an em-dash


# ---- over_budget: stop a job before it burns tokens without bound ----

def test_over_budget_off_by_default():
    assert R.over_budget({"cost_usd": 99, "calls": 999, "errors": 99}, cap_usd=0, cap_calls=0, cap_errors=0) == ""


def test_over_budget_cost_cap():
    assert R.over_budget({"cost_usd": 0.49, "calls": 3}, cap_usd=0.50) == ""
    assert R.over_budget({"cost_usd": 0.50, "calls": 3}, cap_usd=0.50) == "cost"


def test_over_budget_call_cap():
    assert R.over_budget({"cost_usd": 0.01, "calls": 39}, cap_calls=40) == ""
    assert R.over_budget({"cost_usd": 0.01, "calls": 40}, cap_calls=40) == "calls"


def test_over_budget_error_cap_stops_a_broken_loop():
    assert R.over_budget({"errors": 4, "calls": 0}, cap_calls=100, cap_errors=5) == ""
    assert R.over_budget({"errors": 5, "calls": 0}, cap_calls=100, cap_errors=5) == "failures"


def test_budget_caps_defaults_and_overrides():
    assert R.budget_caps({}) == {"cost_usd": 0.0, "calls": 100, "errors": 5}   # cost off, call+error backstops on
    assert R.budget_caps({"COST_CAP_USD": "2.5", "MAX_CLAUDE_CALLS": "20"}) == {"cost_usd": 2.5, "calls": 20, "errors": 5}
    assert R.budget_caps({"MAX_CLAUDE_CALLS": "garbage"})["calls"] == 100  # tolerate bad input


# ---- finding_summaries: compact per-agent finding list for the live feed ----

def test_finding_summaries_compact_list():
    findings = [
        {"tag": "rigor", "body": "The percolation claim needs a citation for the 0.03 loss factor."},
        {"tag": "clarity", "quote": "nearly transparent", "body": "Ambiguous: reflection vs absorption."},
    ]
    out = R.finding_summaries(findings)
    assert out == [
        {"tag": "rigor", "text": "The percolation claim needs a citation for the 0.03 loss factor."},
        {"tag": "clarity", "text": "Ambiguous: reflection vs absorption."},
    ]


def test_finding_summaries_caps_and_truncates():
    many = [{"body": "x" * 400} for _ in range(20)]
    out = R.finding_summaries(many, limit=5, width=120)
    assert len(out) == 5
    assert len(out[0]["text"]) <= 121 and out[0]["text"].endswith("…")


def test_finding_summaries_tolerates_junk():
    assert R.finding_summaries(None) == []
    assert R.finding_summaries([{"body": ""}, {"nope": 1}]) == []   # nothing sayable → dropped


# ---- unit_source_files: send an agent/writer only the unit under review, not the whole manuscript ----

def test_unit_source_files_scopes_to_the_unit_plus_shared_context():
    files = {
        "main.tex": "\\include{chapters/ch_intro}\\include{chapters/ch_platform}",
        "chapters/ch_intro.tex": "Intro prose. \\cite{a}",
        "chapters/ch_platform.tex": "Platform prose. \\input{sections/machine}",
        "sections/machine.tex": "Machine sub-section.",
        "preamble/macros.tex": "\\newcommand{\\Qrf}{Q}",
        "refs.bib": "@article{a,...}",
    }
    out = R.unit_source_files(files, "chapters/ch_platform.tex")
    assert "chapters/ch_platform.tex" in out          # the unit
    assert "sections/machine.tex" in out              # its \input, transitively
    assert "preamble/macros.tex" in out               # shared macros
    assert "refs.bib" in out                          # citation context
    assert "chapters/ch_intro.tex" not in out         # OTHER unit dropped (the cost saving)
    assert "main.tex" not in out                      # the include-everything root dropped


def test_unit_source_files_resolves_input_without_extension():
    files = {"chapters/c.tex": "\\input{sections/x}", "sections/x.tex": "x"}
    out = R.unit_source_files(files, "chapters/c.tex")
    assert set(out) == {"chapters/c.tex", "sections/x.tex"}


def test_unit_source_files_falls_back_to_all_when_entry_unknown():
    files = {"a.tex": "1", "b.tex": "2"}
    assert R.unit_source_files(files, None) == files          # unknown unit → everything (safe)
    assert R.unit_source_files(files, "missing.tex") == files


# ---- agent findings routed to the AI reviewer (accept/decline flow), local + cloud ----

def test_agent_findings_comments_are_submitted_reviewer_comments():
    job = {"agents": ["clarity", "rigor"]}
    outputs = {
        "clarity": [{"quote": "foo", "body": "run-on sentence", "tag": "clarity", "section": "Intro"}],
        "rigor": [{"quote": "bar", "body": "unsupported claim"}],
    }
    out = R.agent_findings_comments(job, outputs, "T", idgen=lambda i: f"a_{i}")
    assert [c["id"] for c in out] == ["a_0", "a_1"]
    assert out[0]["author"] == "clarity" and out[0]["status"] == "submitted"   # shows in FROM REVIEWERS
    assert out[0]["anchor"]["quote"] == "foo" and out[0]["tag"] == "clarity"
    assert out[0]["body"] == "run-on sentence" and out[0]["read"] is False
    assert out[1]["author"] == "rigor" and out[1]["tag"] == "other"            # default tag
