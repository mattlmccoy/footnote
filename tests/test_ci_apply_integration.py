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
    # these integration tests exercise the CLOUD apply engine, so opt the project into cloud mode
    # (the hard gate defaults to local = cloud inert).
    (data / "proj" / "mode.json").write_text(json.dumps({"processingMode": "cloud"}))
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
        'cat "$SOURCE_DIR/methods.tex" >> "$2"\n'
        # pad to a realistic content size so the degenerate-build guard (min 200 bytes) accepts it
        'printf "<p>rendered body padding for a realistic size.</p>%.0s" {1..12} >> "$2"\n')
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
    fake.write_text('#!/usr/bin/env bash\nset -e\ncat "$SOURCE_DIR/methods.tex" > "$2"\n'
                    # pad past the degenerate-build guard's 200-byte floor with realistic filler
                    'printf "<p>rendered body padding for a realistic size.</p>%.0s" {1..12} >> "$2"\n')
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
    fake.write_text('#!/usr/bin/env bash\nset -e\ncat "$SOURCE_DIR/methods.tex" > "$2"\n'
                    # pad past the degenerate-build guard's 200-byte floor with realistic filler
                    'printf "<p>rendered body padding for a realistic size.</p>%.0s" {1..12} >> "$2"\n')
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


def test_run_agents_appends_critique_comments(workspace_repo, monkeypatch):
    """A run-agents job: each configured agent's read-only critique is appended to the review as
    author-tagged comments; the queue drains. Mocked agents — no live model, no source change."""
    data, bare = workspace_repo
    (data / "proj" / "reviews" / "02-methods.json").write_text(json.dumps({"comments": []}))
    (data / "proj" / "jobs.json").write_text(json.dumps([
        {"id": "g1", "type": "run-agents", "chapter": "02-methods",
         "agents": ["adversary"], "status": "queued"}]))
    _git(["add", "-A"], data); _git(["commit", "-m", "queue agents"], data)
    _git(["push", "origin", "main"], data)

    def fake_agent(agent_id, task):
        assert agent_id == "adversary" and task["chapter"] == "02-methods"
        return [{"quote": "\\alpha", "body": "state the assumption behind alpha", "tag": "rigor"}]

    monkeypatch.chdir(data)
    monkeypatch.setenv("GITHUB_REPOSITORY", "owner/data")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.delenv("SOURCE_REPO", raising=False)
    n = ci_apply.process_project("proj/", "owner/data", token="", agent_fn=fake_agent)
    assert n == 1

    comments = json.loads((data / "proj" / "reviews" / "02-methods.json").read_text())["comments"]
    assert len(comments) == 1
    assert comments[0]["author"] == "adversary"
    assert comments[0]["body"] == "state the assumption behind alpha"
    assert comments[0]["anchor"]["quote"] == "\\alpha" and comments[0]["status"] == "open"
    assert json.loads((data / "proj" / "jobs.json").read_text()) == []
    # agents never touch source
    assert (data / "proj" / "source" / "methods.tex").read_text() == "x = \\alpha + 1\n"


def test_apply_edits_agent_gate_rejects_and_emits_progress(workspace_repo, monkeypatch, tmp_path):
    """The cloud pipeline runs a critic over the writer's proposed edit: a critic that objects blocks
    staging (per-comment CONFLICT, not a silent stub), and every step is narrated into
    progress/<job>.jsonl for the live view."""
    data, bare = workspace_repo
    (data / "proj" / "reviews" / "02-methods.json").write_text(json.dumps({"comments": [
        {"id": "c1", "kind": "text", "status": "queued", "tag": "clarity",
         "anchor": {"quote": "the alpha term", "section": "Methods"}, "body": "rename alpha to beta"}]}))
    (data / "proj" / "jobs.json").write_text(json.dumps([
        {"id": "j9", "type": "apply-edits", "chapter": "02-methods", "comment_ids": ["c1"], "status": "queued"}]))
    _git(["add", "-A"], data); _git(["commit", "-m", "queue"], data); _git(["push", "origin", "main"], data)

    def fake_claude(task):
        return {"c1": {"id": "c1", "response": "Renamed alpha to beta.",
                       "source_before": "\\alpha", "source_after": "\\beta",
                       "prose_before": "the alpha term", "prose_after": "the beta term"}}

    def fake_agent(agent_id, task):
        return [{"body": "This rename changes the established symbol; reject."}]

    monkeypatch.chdir(data)
    monkeypatch.setenv("GITHUB_REPOSITORY", "owner/data")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("REVIEW_AGENTS", "clarity")
    monkeypatch.delenv("SOURCE_REPO", raising=False)
    ci_apply.process_project("proj/", "owner/data", token="", claude_fn=fake_claude, agent_fn=fake_agent)

    c = json.loads((data / "proj" / "reviews" / "02-methods.json").read_text())["comments"][0]
    assert c["status"] == "conflict"
    r = subprocess.run(["git", "--git-dir", str(bare), "branch", "--list", "review-edits/02-methods"],
                       capture_output=True, text=True)
    assert "review-edits/02-methods" not in r.stdout
    prog = (data / "proj" / "progress" / "j9.jsonl").read_text()
    events = [json.loads(l) for l in prog.splitlines() if l.strip()]
    phases = [e["phase"] for e in events]
    assert "agent" in phases and "verify" in phases and "done" in phases
    assert any(e.get("agent") == "writer" for e in events)
    assert any(e.get("agent") == "clarity" and e["status"] == "conflict" for e in events)
    assert any("flagged" in e["say"].lower() or "objected" in e["say"].lower() for e in events)


def test_apply_edits_revise_loop_recovers(workspace_repo, monkeypatch, tmp_path):
    """Writer↔critic iteration: the first edit is rejected by a critic, the writer revises with the
    feedback, the revision is approved and STAGED — matching the local agent loop."""
    data, bare = workspace_repo
    (data / "proj" / "reviews" / "02-methods.json").write_text(json.dumps({"comments": [
        {"id": "c1", "kind": "text", "status": "queued", "tag": "clarity",
         "anchor": {"quote": "the alpha term", "section": "Methods"}, "body": "rename alpha"}]}))
    (data / "proj" / "jobs.json").write_text(json.dumps([
        {"id": "j9", "type": "apply-edits", "chapter": "02-methods", "comment_ids": ["c1"], "status": "queued"}]))
    _git(["add", "-A"], data); _git(["commit", "-m", "queue"], data); _git(["push", "origin", "main"], data)

    fake = tmp_path / "fake.sh"
    fake.write_text('#!/usr/bin/env bash\nset -e\ncat "$SOURCE_DIR/methods.tex" > "$2"\n'
                    'printf "<p>rendered padding to a realistic size.</p>%.0s" {1..12} >> "$2"\n')
    fake.chmod(0o755)
    import ci_render
    monkeypatch.setattr(ci_render, "CHAPTER_HTML", str(fake))

    calls = {"n": 0}
    def fake_claude(task):
        calls["n"] += 1
        after = "\\gamma" if calls["n"] == 1 else "\\beta"   # bad first, good on revise
        return {"c1": {"id": "c1", "response": f"changed to {after}", "source_before": "\\alpha",
                       "source_after": after, "prose_before": "the alpha term", "prose_after": f"the {after} term"}}
    def fake_agent(agent_id, task):
        return [] if task["proposed_edit"].get("source_after") == "\\beta" else [{"body": "wrong symbol; use beta"}]

    monkeypatch.chdir(data)
    monkeypatch.setenv("GITHUB_REPOSITORY", "owner/data")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.setenv("REVIEW_AGENTS", "clarity")
    monkeypatch.delenv("SOURCE_REPO", raising=False)
    ci_apply.process_project("proj/", "owner/data", token="", claude_fn=fake_claude, agent_fn=fake_agent)

    assert calls["n"] == 2   # writer called twice (initial + one revision)
    c = json.loads((data / "proj" / "reviews" / "02-methods.json").read_text())["comments"][0]
    assert c["status"] == "staged"
    branched = subprocess.run(["git", "--git-dir", str(bare), "show",
                               "review-edits/02-methods:proj/source/methods.tex"],
                              capture_output=True, text=True, check=True).stdout
    assert "\\beta" in branched and "\\gamma" not in branched
    prog = [json.loads(l) for l in (data / "proj" / "progress" / "j9.jsonl").read_text().splitlines() if l.strip()]
    assert any("revis" in e["say"].lower() for e in prog)   # narrated the revision


# ---- external-source push is best-effort: a read-only SOURCE_TOKEN must not crash the job,
#      and the portal artifacts (preview via after_commit, review writeback) must still land ----

def test_commit_branch_external_push_failure_is_survivable(tmp_path, monkeypatch):
    repo = tmp_path / "clone"
    repo.mkdir()
    _git(["init", "-b", "main"], repo)
    _git(["config", "user.name", "t"], repo)
    _git(["config", "user.email", "t@t"], repo)
    (repo / "methods.tex").write_text("x = 1\n")
    _git(["add", "-A"], repo)
    _git(["commit", "-m", "init"], repo)

    # simulate a read-only external token: the remote push raises like a 403 from git
    def _boom(*a, **k):
        raise subprocess.CalledProcessError(128, ["git", "push"])
    monkeypatch.setattr(ci_apply, "_push_remote", _boom)

    ran = {"after": False}
    result = ci_apply.commit_branch(
        repo, "review-edits/02-methods", {"methods.tex": "x = 2\n"}, "main",
        "stage edit", token="ro-token", remote_repo="owner/source", push=True,
        after_commit=lambda: ran.__setitem__("after", True))

    assert ran["after"] is True                       # preview still built from the local branch commit
    assert result is False                             # signals the source-branch push did not land
    # the local branch commit exists even though the remote push failed
    log = subprocess.run(["git", "log", "--oneline", "review-edits/02-methods"],
                         cwd=str(repo), capture_output=True, text=True).stdout
    assert "stage edit" in log
    # left back on base for the review/jobs writeback
    head = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"],
                          cwd=str(repo), capture_output=True, text=True).stdout.strip()
    assert head == "main"


def test_process_project_survives_a_failed_source_clone(workspace_repo, monkeypatch):
    """A 403/unreachable external source must not crash the apply run — the job stays QUEUED so it
    processes once the source token is granted access."""
    data, _ = workspace_repo
    monkeypatch.chdir(data)
    # point proj/ at an external source it can't reach, and make the clone 403 like a scope-less token
    (data / "proj" / "source.json").write_text(json.dumps({"sourceRepo": "owner/no-access"}))
    (data / "proj" / "jobs.json").write_text(json.dumps(
        [{"id": "j1", "type": "apply-edits", "chapter": "02-methods",
          "comment_ids": ["c1"], "status": "queued"}]))
    monkeypatch.setenv("CLAUDE_CODE_OAUTH_TOKEN", "x")   # get past the have-claude short-circuit

    def _boom(*a, **k):
        raise subprocess.CalledProcessError(128, ["git", "clone"])
    monkeypatch.setattr(ci_apply.ci_render, "_clone", _boom)

    n = ci_apply.process_project("proj/", "owner/data", "ro-token")   # must not raise
    assert n == 0
    jobs = json.load(open(data / "proj" / "jobs.json"))
    assert [j for j in jobs if j["id"] == "j1" and j["status"] == "queued"]   # still queued


def test_apply_edits_prose_edit_not_blocked_by_preexisting_undefined_ref(workspace_repo, monkeypatch, tmp_path):
    """A prose edit that introduces NO new references must STAGE even when the chapter already
    contains an undefined reference (e.g. a \\cref to a label defined in another source file the
    single-file scan can't see). Only refs the EDIT newly breaks should block — otherwise every
    prose edit to a cross-referencing chapter is a false-positive conflict (the ch_background case)."""
    data, bare = workspace_repo
    # pre-existing dangling ref: label lives 'elsewhere', so verify_refs on this file alone flags it
    (data / "proj" / "source" / "methods.tex").write_text("x = \\alpha + 1\nSee \\cref{eq:elsewhere}.\n")
    (data / "proj" / "reviews" / "02-methods.json").write_text(json.dumps({"comments": [
        {"id": "c1", "kind": "text", "status": "queued", "tag": "clarity",
         "anchor": {"quote": "the alpha term", "section": "Methods"}, "body": "rename alpha to beta"}]}))
    (data / "proj" / "jobs.json").write_text(json.dumps([
        {"id": "j9", "type": "apply-edits", "chapter": "02-methods", "comment_ids": ["c1"], "status": "queued"}]))
    fake = tmp_path / "fake.sh"
    fake.write_text('#!/usr/bin/env bash\nset -e\ncat "$SOURCE_DIR/methods.tex" > "$2"\n'
                    'printf "<p>rendered body padding for a realistic size.</p>%.0s" {1..12} >> "$2"\n')
    fake.chmod(0o755)
    import ci_render
    monkeypatch.setattr(ci_render, "CHAPTER_HTML", str(fake))
    _git(["add", "-A"], data); _git(["commit", "-m", "queue"], data); _git(["push", "origin", "main"], data)

    def fake_claude(task):
        return {"c1": {"id": "c1", "response": "Renamed.",
                       "source_before": "\\alpha", "source_after": "\\beta",
                       "prose_before": "the alpha term", "prose_after": "the beta term"}}

    monkeypatch.chdir(data)
    monkeypatch.setenv("GITHUB_REPOSITORY", "owner/data")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    monkeypatch.delenv("REVIEW_AGENTS", raising=False)
    monkeypatch.delenv("SOURCE_REPO", raising=False)
    ci_apply.process_project("proj/", "owner/data", token="", claude_fn=fake_claude)

    c = json.loads((data / "proj" / "reviews" / "02-methods.json").read_text())["comments"][0]
    assert c["status"] == "staged"    # the pre-existing eq:elsewhere must NOT block this ref-free edit
    events = [json.loads(l) for l in (data / "proj" / "progress" / "j9.jsonl").read_text().splitlines() if l.strip()]
    assert any(e.get("agent") == "verify_refs" and e["status"] == "ok" for e in events)


def test_ensure_git_identity_configures_a_global_identity(tmp_path, monkeypatch):
    """The headless Claude CLI does incidental git ops in the repo cwd; on a runner with no git identity
    those abort with 'empty ident name' and the writer returns nothing. ensure_git_identity() writes a
    global user.name/user.email so any git op (incl. our own commits) has a valid identity — no reliance
    on fragile hostname auto-derivation (which the runner rejects)."""
    home = tmp_path / "home"; home.mkdir()
    gitconfig = home / ".gitconfig"
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(gitconfig))
    assert not gitconfig.exists()

    ci_apply.ensure_git_identity()

    name = subprocess.run(["git", "config", "--global", "user.name"], capture_output=True, text=True).stdout.strip()
    email = subprocess.run(["git", "config", "--global", "user.email"], capture_output=True, text=True).stdout.strip()
    assert name and email          # a usable identity now exists

    repo = tmp_path / "r"; repo.mkdir()
    _git(["init", "-b", "main"], repo)
    (repo / "f.txt").write_text("hi")
    _git(["add", "-A"], repo)
    assert subprocess.run(["git", "commit", "-m", "x"], cwd=str(repo),
                          capture_output=True, text=True).returncode == 0


def test_ensure_git_identity_preserves_an_existing_identity(tmp_path, monkeypatch):
    """Idempotent + non-destructive: if the operator already set a git identity, keep it."""
    home = tmp_path / "home"; home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(home / ".gitconfig"))
    subprocess.run(["git", "config", "--global", "user.name", "Real Person"], check=True)
    subprocess.run(["git", "config", "--global", "user.email", "real@example.com"], check=True)

    ci_apply.ensure_git_identity()

    assert subprocess.run(["git", "config", "--global", "user.name"],
                          capture_output=True, text=True).stdout.strip() == "Real Person"
