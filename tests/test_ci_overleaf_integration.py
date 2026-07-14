"""End-to-end Overleaf sync against LOCAL bare git remotes simulating git.overleaf.com/<projectId>.
No network. The bare remote stands in for the Overleaf git bridge; real-Overleaf auth is a later,
premium-gated step."""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-template"))
import ci_overleaf  # noqa: E402


def _git(args, cwd):
    subprocess.run(["git", *args], cwd=str(cwd), check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def test_read_tree_reads_text_and_flags_binary(tmp_path):
    root = tmp_path / "src"
    (root / "figures").mkdir(parents=True)
    (root / "main.tex").write_text("hello\n")
    (root / "figures" / "f.pdf").write_bytes(b"%PDF-1.4\x00\x01")
    tree, binaries = ci_overleaf.read_tree(root)
    assert tree["main.tex"] == "hello\n"
    assert "figures/f.pdf" in binaries
    assert tree["figures/f.pdf"] is not None


def test_write_tree_round_trips_and_prunes(tmp_path):
    dest = tmp_path / "out"
    ci_overleaf.write_tree(dest, {"main.tex": "one\n", "a/b.tex": "two\n"}, set())
    assert (dest / "main.tex").read_text() == "one\n"
    assert (dest / "a" / "b.tex").read_text() == "two\n"
    ci_overleaf.write_tree(dest, {"main.tex": "one\n"}, set())
    assert not (dest / "a" / "b.tex").exists()
    tree, _ = ci_overleaf.read_tree(dest)
    assert tree == {"main.tex": "one\n"}


@pytest.fixture
def synced_repo(tmp_path):
    """A consolidated data repo with one marked project `proj/`, its source at `proj/source/`,
    a last-synced base at `proj/.overleaf-base/`, and a local bare remote (the fake Overleaf)
    whose contents currently equal the base (nothing changed yet on either side)."""
    ov_bare = tmp_path / "overleaf.git"
    _git(["init", "--bare", "-b", "master", str(ov_bare)], tmp_path)
    seed = tmp_path / "seed"
    seed.mkdir()
    _git(["init", "-b", "master"], seed)
    _git(["config", "user.email", "t@t"], seed)
    _git(["config", "user.name", "t"], seed)
    (seed / "main.tex").write_text("l1\nl2\n")
    _git(["add", "-A"], seed)
    _git(["commit", "-m", "seed"], seed)
    _git(["remote", "add", "origin", str(ov_bare)], seed)
    _git(["push", "-u", "origin", "master"], seed)

    data = tmp_path / "data"
    (data / "proj" / "source").mkdir(parents=True)
    (data / "proj" / "source" / "main.tex").write_text("l1\nl2\n")
    (data / "proj" / ".overleaf-base").mkdir()
    (data / "proj" / ".overleaf-base" / "main.tex").write_text("l1\nl2\n")
    (data / "proj" / "overleaf.json").write_text(json.dumps({"projectId": "proj", "branch": "master"}))
    _git(["init", "-b", "main"], data)
    _git(["config", "user.email", "t@t"], data)
    _git(["config", "user.name", "t"], data)
    _git(["add", "-A"], data)
    _git(["commit", "-m", "init"], data)
    return data, ov_bare


def test_sync_pull_applies_overleaf_edit(synced_repo, tmp_path, monkeypatch):
    data, ov_bare = synced_repo
    work = tmp_path / "ovwork"
    _git(["clone", str(ov_bare), str(work)], tmp_path)
    _git(["config", "user.email", "o@o"], work)
    _git(["config", "user.name", "o"], work)
    (work / "main.tex").write_text("EDITED\nl2\n")
    _git(["add", "-A"], work)
    _git(["commit", "-m", "overleaf edit"], work)
    _git(["push"], work)

    monkeypatch.chdir(data)
    result = ci_overleaf.sync_project("proj/", str(ov_bare), "master")

    assert result["status"] == "merged"
    assert (data / "proj" / "source" / "main.tex").read_text() == "EDITED\nl2\n"
    assert (data / "proj" / ".overleaf-base" / "main.tex").read_text() == "EDITED\nl2\n"


def test_sync_conflict_stages_branch_and_leaves_source(synced_repo, tmp_path, monkeypatch):
    data, ov_bare = synced_repo
    work = tmp_path / "ovwork"
    _git(["clone", str(ov_bare), str(work)], tmp_path)
    _git(["config", "user.email", "o@o"], work)
    _git(["config", "user.name", "o"], work)
    (work / "main.tex").write_text("OVERLEAF\nl2\n")
    _git(["add", "-A"], work)
    _git(["commit", "-m", "ov"], work)
    _git(["push"], work)
    (data / "proj" / "source" / "main.tex").write_text("GITHUB\nl2\n")
    _git(["add", "-A"], data)
    _git(["commit", "-m", "gh edit"], data)

    monkeypatch.chdir(data)
    result = ci_overleaf.sync_project("proj/", str(ov_bare), "master")

    assert result["status"] == "conflict"
    assert result["conflicts"] == ["main.tex"]
    assert (data / "proj" / "source" / "main.tex").read_text() == "GITHUB\nl2\n"
    marker = json.loads((data / "proj" / "overleaf_conflict.json").read_text())
    assert marker["files"] == ["main.tex"]
    branches = subprocess.run(["git", "branch", "--list", "overleaf-sync/proj"],
                              cwd=str(data), capture_output=True, text=True).stdout
    assert "overleaf-sync/proj" in branches


def test_main_syncs_only_marked_projects(synced_repo, tmp_path, monkeypatch):
    data, ov_bare = synced_repo
    (data / "other" / "source").mkdir(parents=True)
    (data / "other" / "source" / "x.tex").write_text("untouched\n")
    _git(["add", "-A"], data)
    _git(["commit", "-m", "other"], data)
    origin = tmp_path / "data-origin.git"
    _git(["init", "--bare", "-b", "main", str(origin)], tmp_path)
    _git(["remote", "add", "origin", str(origin)], data)
    _git(["push", "-u", "origin", "main"], data)
    work = tmp_path / "w2"
    _git(["clone", str(ov_bare), str(work)], tmp_path)
    _git(["config", "user.email", "o@o"], work)
    _git(["config", "user.name", "o"], work)
    (work / "main.tex").write_text("PULLED\nl2\n")
    _git(["add", "-A"], work)
    _git(["commit", "-m", "e"], work)
    _git(["push"], work)

    monkeypatch.chdir(data)
    monkeypatch.setenv("OVERLEAF_REMOTE_PROJ", str(ov_bare))
    results = ci_overleaf.main()

    assert {r["prefix"]: r["status"] for r in results} == {"proj/": "merged"}
    assert (data / "proj" / "source" / "main.tex").read_text() == "PULLED\nl2\n"
    assert (data / "other" / "source" / "x.tex").read_text() == "untouched\n"


def test_github_only_edit_is_not_reverted_on_next_sync(synced_repo, tmp_path, monkeypatch):
    """REGRESSION: pull-only mode (push_back off). A GitHub-side edit to source/ (e.g. staged by the
    apply-edits pipeline) must survive a second sync — the base snapshot must NOT advance past what
    Overleaf actually holds, or the edit gets clobbered back to the old text."""
    data, ov_bare = synced_repo
    # GitHub edits source; Overleaf unchanged
    (data / "proj" / "source" / "main.tex").write_text("l1\nGH-EDIT\n")
    _git(["add", "-A"], data)
    _git(["commit", "-m", "gh edit"], data)
    monkeypatch.chdir(data)

    ci_overleaf.sync_project("proj/", str(ov_bare), "master")          # run 1 (pull-only)
    ci_overleaf.sync_project("proj/", str(ov_bare), "master")          # run 2 must not revert

    assert (data / "proj" / "source" / "main.tex").read_text() == "l1\nGH-EDIT\n"
    # base did NOT advance to the un-pushed GitHub content (still the last state Overleaf has)
    assert (data / "proj" / ".overleaf-base" / "main.tex").read_text() == "l1\nl2\n"


def test_non_utf8_text_file_is_byte_preserved(tmp_path):
    """A .bib/.tex that isn't valid UTF-8 (latin-1 accented bytes) must round-trip losslessly, not be
    corrupted by errors='replace'."""
    root = tmp_path / "src"
    root.mkdir()
    raw = b"@book{k, author={Caf\xe9}}\n"          # 0xE9 = latin-1 'é', invalid UTF-8
    (root / "refs.bib").write_bytes(raw)
    tree, binaries = ci_overleaf.read_tree(root)
    out = tmp_path / "out"
    ci_overleaf.write_tree(out, tree, binaries)
    assert (out / "refs.bib").read_bytes() == raw


def test_sync_push_back_advances_overleaf(synced_repo, tmp_path, monkeypatch):
    data, ov_bare = synced_repo
    (data / "proj" / "source" / "main.tex").write_text("l1\nGHNEW\n")
    _git(["add", "-A"], data)
    _git(["commit", "-m", "gh edit"], data)

    monkeypatch.chdir(data)
    result = ci_overleaf.sync_project("proj/", str(ov_bare), "master", push_back=True)
    assert result["status"] == "merged" and result["push"] is True

    check = tmp_path / "check"
    _git(["clone", str(ov_bare), str(check)], tmp_path)
    assert (check / "main.tex").read_text() == "l1\nGHNEW\n"
    # both sides now hold the edit -> base advanced
    assert (data / "proj" / ".overleaf-base" / "main.tex").read_text() == "l1\nGHNEW\n"


def test_sync_is_idempotent(synced_repo, tmp_path, monkeypatch):
    data, ov_bare = synced_repo
    monkeypatch.chdir(data)
    result = ci_overleaf.sync_project("proj/", str(ov_bare), "master", push_back=True)
    assert result["status"] == "noop"
    assert not (data / "proj" / "overleaf_conflict.json").exists()


def test_main_push_back(synced_repo, tmp_path, monkeypatch):
    data, ov_bare = synced_repo
    origin = tmp_path / "do.git"
    _git(["init", "--bare", "-b", "main", str(origin)], tmp_path)
    _git(["remote", "add", "origin", str(origin)], data)
    _git(["push", "-u", "origin", "main"], data)
    (data / "proj" / "source" / "main.tex").write_text("l1\nPB\n")
    _git(["add", "-A"], data)
    _git(["commit", "-m", "gh"], data)
    monkeypatch.chdir(data)
    monkeypatch.setenv("OVERLEAF_REMOTE_PROJ", str(ov_bare))
    monkeypatch.setenv("OVERLEAF_PUSH_BACK", "1")
    ci_overleaf.main()
    check = tmp_path / "c2"
    _git(["clone", str(ov_bare), str(check)], tmp_path)
    assert (check / "main.tex").read_text() == "l1\nPB\n"


def test_default_branch_autodetected_main_not_hardcoded_master(tmp_path):
    """F3: Overleaf now defaults to `main`. A marker with no branch must auto-detect the remote's real
    default (via ls-remote), not fall back to `master` (which fails on a modern Overleaf project)."""
    bare = tmp_path / "ov.git"
    _git(["init", "--bare", "-b", "main", str(bare)], tmp_path)          # remote default = main
    seed = tmp_path / "s"; seed.mkdir(); _git(["init", "-b", "main"], seed)
    _git(["config", "user.email", "a@a"], seed); _git(["config", "user.name", "a"], seed)
    (seed / "main.tex").write_text("hi\n"); _git(["add", "-A"], seed); _git(["commit", "-m", "s"], seed)
    _git(["remote", "add", "origin", str(bare)], seed); _git(["push", "-u", "origin", "main"], seed)
    assert ci_overleaf._default_branch(str(bare)) == "main"

    # a project marker WITHOUT a branch -> remote_for auto-detects main
    data = tmp_path / "d"; (data / "proj").mkdir(parents=True)
    (data / "proj" / "overleaf.json").write_text(json.dumps({"projectId": "proj"}))   # no branch key
    import os as _os; cwd = _os.getcwd(); _os.chdir(data)
    try:
        _os.environ["OVERLEAF_REMOTE_PROJ"] = str(bare)
        url, branch = ci_overleaf.remote_for("proj/")
        assert branch == "main"
    finally:
        _os.chdir(cwd); _os.environ.pop("OVERLEAF_REMOTE_PROJ", None)
