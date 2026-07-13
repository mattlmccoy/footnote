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
