"""Generic local processor parity: the `list` command's structured changelist (pure). Mirrors
dissertation-tracker process-reviews.py cmd_list, genericized — the CLI colors/prints; this
decides WHAT to show. Only queued (not-done) jobs; per type (apply-edits / apply-direct /
run-agents / merge / export) with the right per-comment detail.

Run: python3 -m pytest tests/test_changelist.py
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "data-template"))

import ci_review_common as R  # noqa: E402


def _reviews():
    return {
        "ch1": {"comments": [
            {"id": "c1", "tag": "clarity", "status": "queued",
             "anchor": {"section": "Intro", "quote": "the thing"},
             "edit": {"op": "replace", "find": "the thing", "replacement": "the widget"}},
            {"id": "c2", "tag": "question", "status": "queued",
             "anchor": {"section": "Intro", "quote": "why"}, "body": "why this?"},
        ]},
    }


def test_only_queued_jobs_appear():
    jobs = [
        {"id": "j1", "type": "apply-edits", "chapter": "ch1", "comment_ids": ["c1"]},
        {"id": "jd", "type": "apply-edits", "chapter": "ch1", "status": "done"},
    ]
    rows = R.changelist(jobs, _reviews(), lambda u: True)
    assert [r["id"] for r in rows] == ["j1"]


def test_apply_edits_row_carries_comments_and_source_flag():
    jobs = [{"id": "j1", "type": "apply-edits", "chapter": "ch1", "comment_ids": ["c1", "c2"]}]
    rows = R.changelist(jobs, _reviews(), lambda u: u == "ch1")
    r = rows[0]
    assert r["unit"] == "ch1" and r["type"] == "apply-edits" and r["source_ok"] is True
    assert [c["id"] for c in r["comments"]] == ["c1", "c2"]
    assert r["comments"][0]["edit"]["op"] == "replace"
    assert r["comments"][1]["ask"] == "why this?"


def test_missing_source_flagged():
    jobs = [{"id": "j1", "type": "apply-edits", "chapter": "ch9", "comment_ids": []}]
    rows = R.changelist(jobs, {}, lambda u: False)
    assert rows[0]["source_ok"] is False


def test_run_agents_and_merge_and_export_rows():
    jobs = [
        {"id": "ja", "type": "run-agents", "chapter": "ch1", "agents": ["writer", "adversary"]},
        {"id": "jm", "type": "merge", "chapter": "ch1"},
        {"id": "je", "type": "export", "chapter": "__all__", "formats": ["docx", "pdf"]},
    ]
    rows = R.changelist(jobs, _reviews(), lambda u: True)
    by = {r["id"]: r for r in rows}
    assert by["ja"]["agents"] == ["writer", "adversary"]
    assert by["jm"]["type"] == "merge"
    assert by["je"]["formats"] == ["docx", "pdf"] and by["je"]["unit"] == "__all__"


def test_unknown_job_types_are_skipped():
    jobs = [{"id": "jx", "type": "banana", "chapter": "ch1"},
            {"id": "j1", "type": "apply-direct", "chapter": "ch1", "comment_ids": ["c1"]}]
    rows = R.changelist(jobs, _reviews(), lambda u: True)
    assert [r["id"] for r in rows] == ["j1"]
