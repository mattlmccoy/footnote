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


def test_apply_direct_builds_preview_from_the_branch(workspace_repo, monkeypatch, tmp_path):
    """The preview is rendered from the review-edits branch (edited source), reusing the render
    pipeline's chapter-html.sh. Stub the renderer so we need no pandoc/TeX but still prove the
    choreography: preview/<unit>.html lands in the data repo and reflects the EDITED source."""
    data, bare = workspace_repo
    # a fake chapter-html.sh: args = <unit> <out>; emit the SOURCE_DIR's methods.tex verbatim so
    # the test can prove the preview was built from the branch source (which carries \beta).
    fake = tmp_path / "fake-chapter-html.sh"
    fake.write_text(
        '#!/usr/bin/env bash\nset -e\nprintf "<h1>%s</h1>" "$1" > "$2"\n'
        'cat "$SOURCE_DIR/methods.tex" >> "$2"\n')
    fake.chmod(0o755)
    import ci_render
    monkeypatch.setattr(ci_render, "CHAPTER_HTML", str(fake))

    monkeypatch.chdir(data)
    monkeypatch.setenv("GITHUB_REPOSITORY", "owner/data")
    monkeypatch.delenv("SOURCE_REPO", raising=False)
    ci_apply.process_project("proj/", "owner/data", token="")

    preview = data / "proj" / "preview" / "02-methods.html"
    assert preview.exists()
    body = preview.read_text()
    assert "<h1>02-methods</h1>" in body
    assert "\\beta" in body            # built from the BRANCH source (the edit), not main
    assert "\\alpha" not in body


def test_apply_edits_end_to_end_with_mocked_claude(workspace_repo, monkeypatch, tmp_path):
    """A Claude apply-edits job: the mocked Claude returns an edit spec, the tested engine applies
    it deterministically on the review branch, stages it with Claude's response, and drains the
    queue. Nothing merges — the author still approves. No live model, no pandoc."""
    data, bare = workspace_repo
    # replace the fixture's apply-direct job with a Claude apply-edits job + a freeform comment
    (data / "proj" / "reviews" / "02-methods.json").write_text(json.dumps({"comments": [
        {"id": "c1", "kind": "text", "status": "queued", "tag": "clarity",
         "anchor": {"quote": "the alpha term", "section": "Methods"},
         "body": "please rename alpha to beta",
         "claude": {"branch": None, "commit": None, "response": None,
                    "resolved_line": None, "ts": None}}]}))
    (data / "proj" / "jobs.json").write_text(json.dumps([
        {"id": "j9", "type": "apply-edits", "chapter": "02-methods",
         "comment_ids": ["c1"], "status": "queued"}]))
    _git(["add", "-A"], data)
    _git(["commit", "-m", "queue apply-edits"], data)
    _git(["push", "origin", "main"], data)

    # stub the renderer so preview needs no pandoc
    fake = tmp_path / "fake.sh"
    fake.write_text('#!/usr/bin/env bash\nset -e\ncat "$SOURCE_DIR/methods.tex" > "$2"\n')
    fake.chmod(0o755)
    import ci_render
    monkeypatch.setattr(ci_render, "CHAPTER_HTML", str(fake))

    # the mocked Claude boundary: returns a per-comment edit spec (never touches files itself)
    def fake_claude(task):
        assert task["chapter"] == "02-methods"
        assert task["comments"][0]["body"] == "please rename alpha to beta"
        return {"c1": {"id": "c1", "response": "Renamed alpha to beta as requested.",
                       "source_before": "\\alpha", "source_after": "\\beta",
                       "prose_before": "the alpha term", "prose_after": "the beta term"}}

    monkeypatch.chdir(data)
    monkeypatch.setenv("GITHUB_REPOSITORY", "owner/data")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")   # Claude "configured"
    monkeypatch.delenv("SOURCE_REPO", raising=False)
    n = ci_apply.process_project("proj/", "owner/data", token="", claude_fn=fake_claude)
    assert n == 1

    # the branch on origin carries Claude's edit (applied deterministically)
    branched = subprocess.run(
        ["git", "--git-dir", str(bare), "show", "review-edits/02-methods:proj/source/methods.tex"],
        capture_output=True, text=True, check=True).stdout
    assert branched == "x = \\beta + 1\n"
    # the comment is staged with Claude's response + reader diff; queue drained
    review = json.loads((data / "proj" / "reviews" / "02-methods.json").read_text())
    c = review["comments"][0]
    assert c["status"] == "staged"
    assert c["claude"]["response"] == "Renamed alpha to beta as requested."
    assert c["claude"]["branch"] == "review-edits/02-methods"
    assert c["staged_edit"] == {"before": "the alpha term", "after": "the beta term"}
    assert json.loads((data / "proj" / "jobs.json").read_text()) == []
    # source main is untouched — nothing merged (author-oversight invariant)
    assert (data / "proj" / "source" / "methods.tex").read_text() == "x = \\alpha + 1\n"


def test_apply_edits_left_queued_when_claude_not_configured(workspace_repo, monkeypatch):
    """With no ANTHROPIC_API_KEY the apply-edits job just waits — honest 'nothing runs until set up'."""
    data, bare = workspace_repo
    (data / "proj" / "jobs.json").write_text(json.dumps([
        {"id": "j9", "type": "apply-edits", "chapter": "02-methods",
         "comment_ids": ["c1"], "status": "queued"}]))
    _git(["add", "-A"], data); _git(["commit", "-m", "queue"], data); _git(["push", "origin", "main"], data)
    monkeypatch.chdir(data)
    monkeypatch.setenv("GITHUB_REPOSITORY", "owner/data")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("SOURCE_REPO", raising=False)
    called = []
    ci_apply.process_project("proj/", "owner/data", token="",
                             claude_fn=lambda t: called.append(t) or {})
    assert called == []                                  # Claude never invoked
    assert len(json.loads((data / "proj" / "jobs.json").read_text())) == 1   # job still queued


def test_merge_publishes_only_approved_edits(workspace_repo, monkeypatch, tmp_path):
    """An author-approved merge job: only the approved edit lands on main, the rejected one does not,
    content is rebuilt, the review branch + preview are dropped, and the queue drains. No pandoc."""
    data, bare = workspace_repo
    (data / "proj" / "source" / "methods.tex").write_text("x = \\alpha + \\keepme\n")
    (data / "proj" / "reviews" / "02-methods.json").write_text(json.dumps({"comments": [
        {"id": "c1", "status": "approved",
         "edit": {"op": "replace", "find": "\\alpha", "replacement": "\\beta"},
         "staged_edit": {"before": "a", "after": "b"}, "claude": {"branch": "review-edits/02-methods"}},
        {"id": "c2", "status": "declined",
         "edit": {"op": "replace", "find": "\\keepme", "replacement": "\\DROPPED"}}]}))
    (data / "proj" / "preview").mkdir(parents=True, exist_ok=True)
    (data / "proj" / "preview" / "02-methods.html").write_text("<old preview>")
    (data / "proj" / "jobs.json").write_text(json.dumps([
        {"id": "m1", "type": "merge", "chapter": "02-methods", "status": "queued"}]))
    _git(["add", "-A"], data)
    _git(["commit", "-m", "approve + queue merge"], data)
    _git(["push", "origin", "main"], data)
    # a review branch exists on origin; merge should delete it
    _git(["branch", "review-edits/02-methods"], data)
    _git(["push", "origin", "review-edits/02-methods"], data)

    fake = tmp_path / "fake.sh"
    fake.write_text('#!/usr/bin/env bash\nset -e\ncat "$SOURCE_DIR/methods.tex" > "$2"\n')
    fake.chmod(0o755)
    import ci_render
    monkeypatch.setattr(ci_render, "CHAPTER_HTML", str(fake))
    monkeypatch.chdir(data)
    monkeypatch.setenv("GITHUB_REPOSITORY", "owner/data")
    monkeypatch.delenv("SOURCE_REPO", raising=False)

    n = ci_apply.process_project("proj/", "owner/data", token="")
    assert n == 1

    # approved edit applied to main source; rejected edit NOT applied
    assert (data / "proj" / "source" / "methods.tex").read_text() == "x = \\beta + \\keepme\n"
    # published content rebuilt from the merged source
    content = (data / "proj" / "content" / "02-methods.html").read_text()
    assert "\\beta" in content and "\\DROPPED" not in content
    # review branch deleted from origin
    remotes = subprocess.run(["git", "ls-remote", "--heads", str(bare), "review-edits/02-methods"],
                             capture_output=True, text=True, check=True).stdout
    assert remotes.strip() == ""
    # preview dropped, queue drained, statuses updated
    assert not (data / "proj" / "preview" / "02-methods.html").exists()
    assert json.loads((data / "proj" / "jobs.json").read_text()) == []
    byid = {c["id"]: c for c in json.loads(
        (data / "proj" / "reviews" / "02-methods.json").read_text())["comments"]}
    assert byid["c1"]["status"] == "merged" and byid["c2"]["status"] == "declined"
