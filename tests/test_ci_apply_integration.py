"""Local end-to-end test of ci_apply's apply-direct path against REAL git (no network).

Exercises the full I/O shell — resolve source, create the review-edits branch, apply the
verbatim edit, push to a local bare remote, stage the review, drain the queue — for a
workspace (in-repo) project. The external-clone path is verified live on Actions.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-template"))
import ci_apply  # noqa: E402


def _git(args, cwd):
    subprocess.run(["git", *args], cwd=str(cwd), check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _direct_comment():
    return {
        "id": "c1", "kind": "direct", "status": "queued",
        "edit": {"op": "replace", "find": "\\alpha", "replacement": "\\beta"},
        "prose_before": "the alpha term", "prose_after": "the beta term",
        "claude": {"branch": None, "commit": None, "response": None,
                   "resolved_line": None, "ts": None},
    }


@pytest.fixture
def workspace_repo(tmp_path):
    """A data repo (with a local bare origin) holding one workspace project `proj/` whose
    source is in-repo under `proj/source/`, a queued apply-direct job, and its review."""
    bare = tmp_path / "origin.git"
    _git(["init", "--bare", "-b", "main", str(bare)], tmp_path)
    data = tmp_path / "data"
    data.mkdir()
    _git(["init", "-b", "main"], data)
    _git(["config", "user.name", "t"], data)
    _git(["config", "user.email", "t@t"], data)

    (data / "proj" / "source").mkdir(parents=True)
    (data / "proj" / "source" / "methods.tex").write_text("x = \\alpha + 1\n")
    (data / "proj" / "chapters.json").write_text(json.dumps(
        [{"id": "02-methods", "sourceFile": "methods.tex"}]))
    (data / "proj" / "reviews").mkdir()
    (data / "proj" / "reviews" / "02-methods.json").write_text(json.dumps(
        {"comments": [_direct_comment()]}))
    (data / "proj" / "jobs.json").write_text(json.dumps(
        [{"id": "j1", "type": "apply-direct", "chapter": "02-methods",
          "comment_ids": ["c1"], "status": "queued"}]))
    _git(["add", "-A"], data)
    _git(["commit", "-m", "init"], data)
    _git(["remote", "add", "origin", str(bare)], data)
    _git(["push", "-u", "origin", "main"], data)
    return data, bare


def test_apply_direct_end_to_end(workspace_repo, monkeypatch):
    data, bare = workspace_repo
    monkeypatch.chdir(data)
    monkeypatch.setenv("GITHUB_REPOSITORY", "owner/data")
    monkeypatch.delenv("SOURCE_REPO", raising=False)

    n = ci_apply.process_project("proj/", "owner/data", token="")
    assert n == 1

    # the review branch on origin carries the applied edit at the right path
    branched = subprocess.run(
        ["git", "--git-dir", str(bare), "show", "review-edits/02-methods:proj/source/methods.tex"],
        capture_output=True, text=True, check=True).stdout
    assert branched == "x = \\beta + 1\n"

    # the queue drained and the comment is staged with branch + reader diff
    jobs = json.loads((data / "proj" / "jobs.json").read_text())
    assert jobs == []
    review = json.loads((data / "proj" / "reviews" / "02-methods.json").read_text())
    c = review["comments"][0]
    assert c["status"] == "staged"
    assert c["claude"]["branch"] == "review-edits/02-methods"
    assert c["staged_edit"] == {"before": "the alpha term", "after": "the beta term"}

    # the data repo working tree is left on main (writeback happens there), source main unchanged
    head = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"],
                          cwd=data, capture_output=True, text=True, check=True).stdout.strip()
    assert head == "main"
    assert (data / "proj" / "source" / "methods.tex").read_text() == "x = \\alpha + 1\n"
