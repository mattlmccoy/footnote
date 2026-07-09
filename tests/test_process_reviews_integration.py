"""Local end-to-end for the generic process_reviews.py round-trip against REAL git (no network):
start -> (human edits the branch) -> stage -> merge. Proves the trusted local route works generically
with a separate SOURCE repo + DATA repo (the dissertation model), reusing the degenerate-safe build.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-template"))
import process_reviews as PR  # noqa: E402
import ci_render  # noqa: E402


def _git(args, cwd):
    subprocess.run(["git", *args], cwd=str(cwd), check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _init_repo_with_remote(work, bare):
    subprocess.run(["git", "init", "--bare", str(bare)], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    _git(["init"], work)
    _git(["config", "user.email", "t@t"], work)
    _git(["config", "user.name", "t"], work)
    _git(["symbolic-ref", "HEAD", "refs/heads/main"], work)


@pytest.fixture
def repos(tmp_path):
    # SOURCE repo (the LaTeX) + bare remote
    source = tmp_path / "source"; source.mkdir()
    src_bare = tmp_path / "source.git"
    _init_repo_with_remote(source, src_bare)
    (source / "ch1.tex").write_text("\\section{Intro}\nThe \\alpha term matters.\n")
    (source / "main.tex").write_text("\\title{My Paper}\n\\input{ch1}\n")
    _git(["add", "-A"], source); _git(["commit", "-m", "init source"], source)
    _git(["remote", "add", "origin", str(src_bare)], source)
    _git(["push", "-u", "origin", "main"], source)

    # DATA repo (comments/jobs/content) + bare remote
    data = tmp_path / "data"; data.mkdir()
    data_bare = tmp_path / "data.git"
    _init_repo_with_remote(data, data_bare)
    (data / "chapters.json").write_text(json.dumps([{"id": "ch1", "sourceFile": "ch1.tex"}]))
    (data / "reviews").mkdir()
    (data / "reviews" / "ch1.json").write_text(json.dumps({"comments": [
        {"id": "c1", "tag": "clarity", "status": "queued",
         "anchor": {"section": "Intro", "quote": "the alpha term"},
         "edit": {"op": "replace", "find": "\\alpha", "replacement": "\\beta"}}]}))
    (data / "jobs.json").write_text(json.dumps([
        {"id": "j1", "type": "apply-edits", "chapter": "ch1", "comment_ids": ["c1"]}]))
    _git(["add", "-A"], data); _git(["commit", "-m", "init data"], data)
    _git(["remote", "add", "origin", str(data_bare)], data)
    _git(["push", "-u", "origin", "main"], data)
    return source, data


def _args(source, data, **kw):
    ns = type("A", (), {})()
    ns.source, ns.data, ns.prefix = str(source), str(data), ""
    for k, v in kw.items():
        setattr(ns, k, v)
    return ns


def test_full_local_round_trip(repos, tmp_path, monkeypatch):
    source, data = repos
    # stub renderer: realistic content that echoes the merged source (so we can assert \beta landed)
    fake = tmp_path / "fake.sh"
    fake.write_text('#!/usr/bin/env bash\nset -e\nprintf "<h1>Intro</h1>" > "$2"\n'
                    'cat "$SOURCE_DIR/ch1.tex" >> "$2"\n'
                    'printf "<p>rendered body padding for a realistic size.</p>%.0s" {1..12} >> "$2"\n')
    fake.chmod(0o755)
    monkeypatch.setattr(ci_render, "CHAPTER_HTML", str(fake))

    # start j1 -> review-edits/ch1 branch in the source repo
    PR.cmd_start(_args(source, data, job_id="j1"))
    assert subprocess.run(["git", "rev-parse", "--verify", "review-edits/ch1"],
                          cwd=source, capture_output=True).returncode == 0

    # the human/agent makes the edit on the branch + pushes (verbatim replace)
    (source / "ch1.tex").write_text("\\section{Intro}\nThe \\beta term matters.\n")
    _git(["add", "-A"], source); _git(["commit", "-m", "edit ch1"], source)
    _git(["push", "-u", "origin", "review-edits/ch1"], source)

    # stage j1 -> comment staged, job done, data pushed
    PR.main(["--source", str(source), "--data", str(data), "stage", "j1"])
    review = json.loads((data / "reviews" / "ch1.json").read_text())
    assert review["comments"][0]["status"] == "staged"
    assert review["comments"][0]["claude"]["branch"] == "review-edits/ch1"
    assert json.loads((data / "jobs.json").read_text())[0]["status"] == "done"

    # merge ch1 -> branch merged to source main, content rebuilt (with \beta), comment merged, branch gone
    PR.main(["--source", str(source), "--data", str(data), "merge", "ch1"])
    content = (data / "content" / "ch1.html").read_text()
    assert "\\beta" in content and "\\alpha" not in content       # merged source republished
    assert len(content) > 200                                      # not a degenerate stub
    assert json.loads((data / "reviews" / "ch1.json").read_text())["comments"][0]["status"] == "merged"
    assert subprocess.run(["git", "rev-parse", "--verify", "review-edits/ch1"],
                          cwd=source, capture_output=True).returncode != 0   # branch dropped
    # source main actually carries the edit
    assert "\\beta" in (source / "ch1.tex").read_text()


def test_respond_note_decide_cli(repos):
    source, data = repos
    base = ["--source", str(source), "--data", str(data)]
    PR.main(base + ["respond", "ch1", "c1", "resolved: renamed the term"])
    c = json.loads((data / "reviews" / "ch1.json").read_text())["comments"][0]
    assert c["status"] == "answered" and c["claude"]["response"] == "resolved: renamed the term"

    PR.main(base + ["note", "ch1", "c1", "did it verbatim", "--before", "alpha", "--after", "beta"])
    c = json.loads((data / "reviews" / "ch1.json").read_text())["comments"][0]
    assert c["status"] == "answered"                       # note keeps status
    assert c["staged_edit"] == {"before": "alpha", "after": "beta"}

    PR.main(base + ["decide", "ch1", "c1", "approve", "looks good"])
    c = json.loads((data / "reviews" / "ch1.json").read_text())["comments"][0]
    assert c["decision"] == "approve" and c["decision_note"] == "looks good"


def test_apply_direct_cli(repos):
    source, data = repos
    # queue an apply-direct job for c1 (its edit replaces \alpha -> \beta, literally, no AI)
    (data / "jobs.json").write_text(json.dumps([
        {"id": "jd", "type": "apply-direct", "chapter": "ch1", "comment_ids": ["c1"]}]))
    _git(["commit", "-am", "queue apply-direct"], data); _git(["push", "origin", "main"], data)

    PR.main(["--source", str(source), "--data", str(data), "apply-direct", "jd"])

    # branch created + source literally edited on it
    _git(["checkout", "review-edits/ch1"], source)
    assert "\\beta" in (source / "ch1.tex").read_text()
    c = json.loads((data / "reviews" / "ch1.json").read_text())["comments"][0]
    assert c["status"] == "staged" and c["claude"]["branch"] == "review-edits/ch1"
    assert json.loads((data / "jobs.json").read_text())[0]["status"] == "done"


def test_refresh_source_cli(repos):
    source, data = repos
    PR.main(["--source", str(source), "--data", str(data), "refresh-source"])
    assert "\\title{My Paper}" in (data / "source" / "main.tex").read_text()
