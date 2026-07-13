# Overleaf Tier-2 Consolidated Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync N Overleaf projects (each its own git-bridge remote) into N subfolders of one consolidated Footnote data repo, bidirectionally, with GitHub canonical on conflict.

**Architecture:** A pure Python core (`overleaf_sync.py`) does marker discovery + a line-based three-way merge with no git/network. A thin shell (`ci_overleaf.py`) clones the Overleaf remote, reads the three trees (last-synced base, Overleaf-now, GitHub-now), calls the core, writes `<id>/source/`, refreshes `<id>/.overleaf-base/`, commits, pushes back, or lands conflicts on `overleaf-sync/<id>`. A workflow (`overleaf-sync.yml`) drives it. Owner UI (pure `js/overleaf.js` + wiring) sets the marker, seals the token, triggers a pull, and surfaces conflicts. Verified against **local bare remotes** simulating `git.overleaf.com` (real-Overleaf verification deferred to a premium step).

**Tech Stack:** Python 3 + stdlib (`subprocess`, `difflib`, `glob`, `json`), `pytest`; vanilla ES modules + `node:test`; GitHub Actions YAML.

**Spec:** `docs/superpowers/footnote/specs/2026-07-13-overleaf-tier2-consolidated-sync.md`

**Baselines (must stay green):** `python3 -m pytest -q tests/` = 280 passed; `npm test` = 524 passed. Run from the worktree root `/Users/mattmccoy/code/put_github_repos_here/footnote-overleaf`.

**Branch:** `feat/overleaf-tier2` (already created off `origin/main` dd381c8). The cache-bust bot rewrites `?v=<sha>` on JS import lines; resolve those on rebase keeping the newer sha + your new symbols.

---

## File Structure

**New — CI (Python, `data-template/`):**
- `overleaf_sync.py` — pure core: discovery, secret-name, `merge_file`, `three_way_lines`, `plan_sync`. No git, no network, no filesystem.
- `ci_overleaf.py` — thin shell: git/clone/tree-IO, calls the core, commits/pushes/lands conflicts. The only place git + network live.
- `workflows/overleaf-sync.yml` — `workflow_dispatch` (+ optional `schedule`) loop over marked projects.

**New — tests:**
- `tests/test_overleaf_sync.py` — pure unit tests (fast, no git).
- `tests/test_ci_overleaf_integration.py` — end-to-end against local bare remotes (real git).
- `tests/overleaf.test.mjs` — pure JS helpers.

**New — front end (JS, `js/`), owner-only:**
- `js/overleaf.js` — pure helpers: `overleafMarker`, `secretName`, `bridgeUrlHint`, `syncStatusLabel`, `conflictSummary`.

**Modified:**
- `js/seed.js` — add `OVERLEAF_FILES` + `ensureOverleafPipeline` + the two new source entries in `SEED_FILES`.
- `js/hub.js` (or the owner settings surface) — marker + token + "Pull from Overleaf" + conflict banner wiring (M3, browser-gated).

**Unchanged:** `render.yml` (already triggers on `*/source/**`), `advisor.js` (AI-clean), the deterministic comment→stage→approve→merge path.

---

## Milestone M1 — Pull + render (Overleaf → GitHub)

Lands the "edit in Overleaf, review in Footnote" loop: discover marked projects, pull each Overleaf remote, three-way merge (GitHub canonical), write `<id>/source/`, refresh base, commit → `render.yml` rebuilds the reading view. Conflicts land on `overleaf-sync/<id>`.

### Task M1.1: Pure core — module skeleton + marker discovery

**Files:**
- Create: `data-template/overleaf_sync.py`
- Test: `tests/test_overleaf_sync.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_overleaf_sync.py
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-template"))
import overleaf_sync as O  # noqa: E402


def test_marked_prefixes_maps_marker_paths_to_prefixes():
    # Given the marker files discovered in a repo, return each project's prefix.
    paths = ["b/overleaf.json", "a/overleaf.json", "overleaf.json"]
    assert O.marked_prefixes(paths) == ["", "a/", "b/"]


def test_marked_prefixes_empty_when_no_markers():
    assert O.marked_prefixes([]) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_overleaf_sync.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'overleaf_sync'`.

- [ ] **Step 3: Write minimal implementation**

```python
# data-template/overleaf_sync.py
"""Pure core for Overleaf Tier-2 sync: marker discovery, secret-name derivation, and a
line-based three-way merge. NO git, network, or filesystem — every function is a pure
data transform so the whole reconcile logic is unit-testable without a real Overleaf.
The thin shell (ci_overleaf.py) supplies the trees and performs the git/IO."""


def marked_prefixes(marker_paths):
    """Map discovered ``overleaf.json`` marker paths to project prefixes.
    ``"a/overleaf.json"`` -> ``"a/"``; a root ``"overleaf.json"`` -> ``""`` (legacy single project).
    Sorted, deduped. Only marked projects sync — unmarked (uploaded/github-mode) are never touched."""
    out = set()
    for p in marker_paths or []:
        if p == "overleaf.json":
            out.add("")
        elif p.endswith("/overleaf.json"):
            out.add(p[: -len("overleaf.json")])
    return sorted(out)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_overleaf_sync.py -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add data-template/overleaf_sync.py tests/test_overleaf_sync.py
git commit -m "feat(overleaf): pure marker-prefix discovery for consolidated sync"
```

### Task M1.2: Pure core — secret-name derivation

**Files:**
- Modify: `data-template/overleaf_sync.py`
- Test: `tests/test_overleaf_sync.py`

- [ ] **Step 1: Write the failing test**

```python
def test_secret_name_sanitizes_project_id():
    assert O.secret_name("metrology-paper") == "OVERLEAF_TOKEN_METROLOGY_PAPER"
    assert O.secret_name("proj.1") == "OVERLEAF_TOKEN_PROJ_1"
    assert O.secret_name("") == "OVERLEAF_TOKEN"


def test_secret_name_collapses_runs_and_trims():
    assert O.secret_name("a--b") == "OVERLEAF_TOKEN_A_B"
    assert O.secret_name("-x-") == "OVERLEAF_TOKEN_X"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_overleaf_sync.py -k secret_name -q`
Expected: FAIL — `AttributeError: module 'overleaf_sync' has no attribute 'secret_name'`.

- [ ] **Step 3: Write minimal implementation** (append to `overleaf_sync.py`)

```python
import re


def secret_name(project_id):
    """The per-project Actions secret name holding that Overleaf project's git-bridge token.
    GitHub secret names allow ``[A-Z0-9_]`` — upper-case the id, map every other run to a single
    ``_``, trim leading/trailing ``_``. Empty id -> the shared ``OVERLEAF_TOKEN`` fallback name."""
    slug = re.sub(r"[^A-Za-z0-9]+", "_", (project_id or "")).strip("_").upper()
    return f"OVERLEAF_TOKEN_{slug}" if slug else "OVERLEAF_TOKEN"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_overleaf_sync.py -k secret_name -q`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add data-template/overleaf_sync.py tests/test_overleaf_sync.py
git commit -m "feat(overleaf): per-project secret-name derivation"
```

### Task M1.3: Pure core — line-based three-way merge (clean cases)

**Files:**
- Modify: `data-template/overleaf_sync.py`
- Test: `tests/test_overleaf_sync.py`

- [ ] **Step 1: Write the failing test**

```python
def test_three_way_lines_fast_paths():
    assert O.three_way_lines("x\n", "x\n", "x\n") == ("x\n", False)          # a==b==base
    assert O.three_way_lines("x\n", "y\n", "x\n") == ("y\n", False)          # only a (overleaf) changed
    assert O.three_way_lines("x\n", "x\n", "z\n") == ("z\n", False)          # only b (github) changed


def test_three_way_lines_merges_disjoint_hunks():
    base = "l1\nl2\nl3\nl4\n"
    a = "A1\nl2\nl3\nl4\n"   # overleaf changed line 1
    b = "l1\nl2\nl3\nB4\n"   # github changed line 4
    assert O.three_way_lines(base, a, b) == ("A1\nl2\nl3\nB4\n", False)


def test_three_way_lines_conflict_on_overlap():
    base = "l1\nl2\nl3\n"
    a = "l1\nAA\nl3\n"       # overleaf changed line 2
    b = "l1\nBB\nl3\n"       # github changed the SAME line 2 differently
    text, conflict = O.three_way_lines(base, a, b)
    assert conflict is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_overleaf_sync.py -k three_way -q`
Expected: FAIL — `AttributeError: ... 'three_way_lines'`.

- [ ] **Step 3: Write minimal implementation** (append to `overleaf_sync.py`)

```python
import difflib


def _regions(base_lines, other_lines):
    """Changed base-line regions turning base into other: list of (i1, i2, replacement_lines)
    for every non-equal opcode. (i1, i2) is a half-open base-line range; a pure insertion has
    i1 == i2."""
    sm = difflib.SequenceMatcher(a=base_lines, b=other_lines, autojunk=False)
    regs = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag != "equal":
            regs.append((i1, i2, other_lines[j1:j2]))
    return regs


def three_way_lines(base, a, b):
    """diff3-style line merge with ``base`` as the common ancestor. ``a`` = Overleaf side,
    ``b`` = GitHub side. Returns ``(merged_text, conflict)``. Disjoint hunks merge; hunks whose
    base ranges overlap are a conflict (merged_text is '' when conflict is True — the shell never
    writes it). Non-overlapping insertions at the same base index both apply, deterministically
    ordered by base position."""
    if a == b:
        return a, False
    if a == base:
        return b, False
    if b == base:
        return a, False
    base_l = base.splitlines(keepends=True)
    ra = _regions(base_l, a.splitlines(keepends=True))
    rb = _regions(base_l, b.splitlines(keepends=True))
    for (ai1, ai2, _ra) in ra:
        for (bi1, bi2, _rb) in rb:
            if ai1 < bi2 and bi1 < ai2:      # overlapping base ranges (zero-width never overlaps)
                return "", True
    changes = sorted(ra + rb, key=lambda r: (r[0], r[1]))
    out, pos = [], 0
    for (i1, i2, rep) in changes:
        out.extend(base_l[pos:i1])
        out.extend(rep)
        pos = i2
    out.extend(base_l[pos:])
    return "".join(out), False
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_overleaf_sync.py -k three_way -q`
Expected: PASS (2 passed). If the overlap/insertion edge case fails, adjust `three_way_lines` until green — the tests are the contract.

- [ ] **Step 5: Commit**

```bash
git add data-template/overleaf_sync.py tests/test_overleaf_sync.py
git commit -m "feat(overleaf): line-based three-way merge (disjoint merge, overlap conflict)"
```

### Task M1.4: Pure core — `merge_file` (text vs binary, add/delete)

**Files:**
- Modify: `data-template/overleaf_sync.py`
- Test: `tests/test_overleaf_sync.py`

- [ ] **Step 1: Write the failing test**

```python
def test_merge_file_add_delete_and_binary():
    # only-one-side-changed fast paths (None = absent on that side)
    assert O.merge_file("x\n", "x\n", None, True) == {"content": None, "conflict": False}   # github deleted
    assert O.merge_file(None, "new\n", None, True) == {"content": "new\n", "conflict": False}  # overleaf added
    # modify-vs-delete = conflict
    assert O.merge_file("x\n", None, "y\n", True)["conflict"] is True
    # binary both-changed = conflict; binary one-side-changed = take it
    assert O.merge_file("A", "B", "A", False) == {"content": "B", "conflict": False}
    assert O.merge_file("A", "B", "C", False)["conflict"] is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_overleaf_sync.py -k merge_file -q`
Expected: FAIL — `AttributeError: ... 'merge_file'`.

- [ ] **Step 3: Write minimal implementation** (append to `overleaf_sync.py`)

```python
def merge_file(base, a, b, is_text):
    """Reconcile one path. ``base`` = last-synced ancestor, ``a`` = Overleaf-now, ``b`` = GitHub-now;
    ``None`` means the path is absent on that side. Returns ``{"content", "conflict"}`` where
    ``content is None`` means "deleted" (conflict False) or "unresolved" (conflict True). Text paths
    line-merge; binaries (and any add/delete-vs-modify) are whole-file: take the single changed side,
    conflict when both changed differently."""
    if a == b:
        return {"content": a, "conflict": False}
    if a == base:
        return {"content": b, "conflict": False}      # only GitHub changed (incl. delete when b is None)
    if b == base:
        return {"content": a, "conflict": False}      # only Overleaf changed
    if not is_text or a is None or b is None:
        return {"content": None, "conflict": True}    # binary both-changed, or modify-vs-delete
    text, conflict = three_way_lines(base, a, b)
    return {"content": (None if conflict else text), "conflict": conflict}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_overleaf_sync.py -k merge_file -q`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add data-template/overleaf_sync.py tests/test_overleaf_sync.py
git commit -m "feat(overleaf): merge_file — text line-merge, binary whole-file, add/delete"
```

### Task M1.5: Pure core — `plan_sync` (whole-tree reconcile)

**Files:**
- Modify: `data-template/overleaf_sync.py`
- Test: `tests/test_overleaf_sync.py`

- [ ] **Step 1: Write the failing test**

```python
def test_plan_sync_merges_pulls_and_pushes():
    base = {"main.tex": "l1\nl2\n"}
    overleaf = {"main.tex": "L1\nl2\n"}          # overleaf edited line 1
    github = {"main.tex": "l1\nl2\n"}            # github unchanged
    plan = O.plan_sync(base, overleaf, github)
    assert plan["merged"] == {"main.tex": "L1\nl2\n"}
    assert plan["conflicts"] == []
    assert plan["pull_needed"] is True           # github must move to merged
    assert plan["push_needed"] is False          # overleaf already == merged


def test_plan_sync_reports_conflicts_and_deletes():
    base = {"a.tex": "x\n", "b.tex": "keep\n"}
    overleaf = {"a.tex": "AA\n"}                 # overleaf edited a, deleted b
    github = {"a.tex": "BB\n", "b.tex": "keep\n"}  # github edited a differently, kept b
    plan = O.plan_sync(base, overleaf, github)
    assert "a.tex" in plan["conflicts"]          # both edited a differently
    assert "b.tex" not in plan["merged"]         # overleaf deleted b, github untouched -> delete


def test_plan_sync_noop_when_all_equal():
    tree = {"main.tex": "same\n"}
    plan = O.plan_sync(dict(tree), dict(tree), dict(tree))
    assert plan["pull_needed"] is False and plan["push_needed"] is False and plan["conflicts"] == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_overleaf_sync.py -k plan_sync -q`
Expected: FAIL — `AttributeError: ... 'plan_sync'`.

- [ ] **Step 3: Write minimal implementation** (append to `overleaf_sync.py`)

```python
def plan_sync(base, overleaf, github, text_paths=None):
    """Reconcile whole trees (dict path -> content). ``text_paths`` (a set) marks which paths
    line-merge; ``None`` = treat all as text. Returns ``{"merged", "conflicts", "pull_needed",
    "push_needed"}``. ``merged`` is the reconciled tree (GitHub gets it on pull, Overleaf on push);
    a path absent from ``merged`` with no conflict is a deletion. ``pull_needed`` / ``push_needed``
    are True only when the merged tree differs from that side — the base snapshot makes a no-op
    no-op (prevents ping-pong)."""
    paths = set(base) | set(overleaf) | set(github)
    merged, conflicts = {}, []
    for p in sorted(paths):
        is_text = True if text_paths is None else (p in text_paths)
        r = merge_file(base.get(p), overleaf.get(p), github.get(p), is_text)
        if r["conflict"]:
            conflicts.append(p)
        elif r["content"] is not None:
            merged[p] = r["content"]
    pull_needed = any(merged.get(p) != github.get(p) for p in set(merged) | set(github))
    push_needed = any(merged.get(p) != overleaf.get(p) for p in set(merged) | set(overleaf))
    return {"merged": merged, "conflicts": conflicts,
            "pull_needed": pull_needed, "push_needed": push_needed}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_overleaf_sync.py -q`
Expected: PASS (all overleaf_sync tests green).

- [ ] **Step 5: Commit**

```bash
git add data-template/overleaf_sync.py tests/test_overleaf_sync.py
git commit -m "feat(overleaf): plan_sync — whole-tree reconcile with conflict/delete/noop"
```

### Task M1.6: Shell — tree IO + discovery helpers

**Files:**
- Create: `data-template/ci_overleaf.py`
- Test: `tests/test_ci_overleaf_integration.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_ci_overleaf_integration.py
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
    assert tree["figures/f.pdf"] is not None      # binary content captured (as latin-1 round-trip)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_ci_overleaf_integration.py -k read_tree -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'ci_overleaf'`.

- [ ] **Step 3: Write minimal implementation**

```python
# data-template/ci_overleaf.py
"""Thin I/O shell for Overleaf Tier-2 sync. Clones the Overleaf git-bridge remote (or a local bare
remote in tests), reads the three trees, calls the pure core (overleaf_sync), then writes
<id>/source/, refreshes <id>/.overleaf-base/, commits, pushes back, or lands conflicts on
overleaf-sync/<id>. The ONLY place git + network live (mirrors ci_apply.py's boundary style)."""
import glob
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(__file__))
import ci_notify_common as C   # noqa: E402  (load_json/save_json)
import overleaf_sync as O      # noqa: E402

TEXT_EXT = (".tex", ".bib", ".cls", ".sty", ".bst", ".txt", ".md", ".json",
            ".yml", ".yaml", ".csv", ".clo", ".ltx", ".tikz")


def _is_text(path):
    return path.lower().endswith(TEXT_EXT)


def read_tree(root):
    """Read a source tree under ``root`` into ``(tree, binaries)``. ``tree`` maps repo-relative
    POSIX paths to content; text files decode utf-8, binaries are captured via latin-1 (a lossless
    byte<->str round-trip so the pure core can treat everything as strings). ``binaries`` is the set
    of non-text paths. Skips any ``.git`` dir. Missing root -> empty."""
    tree, binaries = {}, set()
    root = str(root)
    if not os.path.isdir(root):
        return tree, binaries
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != ".git"]
        for fn in filenames:
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, root).replace(os.sep, "/")
            if _is_text(rel):
                with open(full, "r", encoding="utf-8", errors="replace") as f:
                    tree[rel] = f.read()
            else:
                with open(full, "rb") as f:
                    tree[rel] = f.read().decode("latin-1")
                binaries.add(rel)
    return tree, binaries


def discover():
    """Marked project prefixes in the current data repo (glob ``*/overleaf.json`` + root)."""
    paths = []
    if os.path.exists("overleaf.json"):
        paths.append("overleaf.json")
    paths.extend(sorted(glob.glob("*/overleaf.json")))
    return O.marked_prefixes(paths)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_ci_overleaf_integration.py -k read_tree -q`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add data-template/ci_overleaf.py tests/test_ci_overleaf_integration.py
git commit -m "feat(overleaf): shell tree-IO (text/binary) + marker discovery"
```

### Task M1.7: Shell — `write_tree` + base snapshot round-trip

**Files:**
- Modify: `data-template/ci_overleaf.py`
- Test: `tests/test_ci_overleaf_integration.py`

- [ ] **Step 1: Write the failing test**

```python
def test_write_tree_round_trips_and_prunes(tmp_path):
    dest = tmp_path / "out"
    ci_overleaf.write_tree(dest, {"main.tex": "one\n", "a/b.tex": "two\n"}, set())
    assert (dest / "main.tex").read_text() == "one\n"
    assert (dest / "a" / "b.tex").read_text() == "two\n"
    # writing a smaller tree prunes files no longer present
    ci_overleaf.write_tree(dest, {"main.tex": "one\n"}, set())
    assert not (dest / "a" / "b.tex").exists()
    tree, _ = ci_overleaf.read_tree(dest)
    assert tree == {"main.tex": "one\n"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_ci_overleaf_integration.py -k write_tree -q`
Expected: FAIL — `AttributeError: module 'ci_overleaf' has no attribute 'write_tree'`.

- [ ] **Step 3: Write minimal implementation** (append to `ci_overleaf.py`)

```python
import shutil


def write_tree(root, tree, binaries):
    """Materialize ``tree`` (path -> content) under ``root``, creating dirs, decoding binaries back
    from latin-1, and PRUNING any existing file/dir not in ``tree`` (so deletions propagate). Never
    touches a ``.git`` dir under root."""
    root = str(root)
    os.makedirs(root, exist_ok=True)
    keep = set(tree)
    for dirpath, dirnames, filenames in os.walk(root, topdown=False):
        for fn in filenames:
            rel = os.path.relpath(os.path.join(dirpath, fn), root).replace(os.sep, "/")
            if rel.split("/")[0] == ".git":
                continue
            if rel not in keep:
                os.remove(os.path.join(dirpath, fn))
        if dirpath != root and not os.listdir(dirpath):
            os.rmdir(dirpath)
    for rel, content in tree.items():
        full = os.path.join(root, rel)
        os.makedirs(os.path.dirname(full) or root, exist_ok=True)
        if rel in binaries:
            with open(full, "wb") as f:
                f.write(content.encode("latin-1"))
        else:
            with open(full, "w", encoding="utf-8") as f:
                f.write(content)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_ci_overleaf_integration.py -k write_tree -q`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add data-template/ci_overleaf.py tests/test_ci_overleaf_integration.py
git commit -m "feat(overleaf): write_tree with prune (deletions propagate)"
```

### Task M1.8: Shell — `sync_project` pull path (clean merge → commit)

**Files:**
- Modify: `data-template/ci_overleaf.py`
- Test: `tests/test_ci_overleaf_integration.py`

- [ ] **Step 1: Write the failing test** (bare-remote harness)

```python
@pytest.fixture
def synced_repo(tmp_path):
    """A consolidated data repo with one marked project `proj/`, its source at `proj/source/`,
    a last-synced base at `proj/.overleaf-base/`, and a local bare remote (the fake Overleaf)
    whose contents currently equal the base (i.e. nothing changed yet on either side)."""
    ov_bare = tmp_path / "overleaf.git"
    _git(["init", "--bare", "-b", "master", str(ov_bare)], tmp_path)
    # seed the Overleaf remote with the base tree
    seed = tmp_path / "seed"
    seed.mkdir()
    _git(["init", "-b", "master"], seed)
    _git(["config", "user.email", "t@t"], seed); _git(["config", "user.name", "t"], seed)
    (seed / "main.tex").write_text("l1\nl2\n")
    _git(["add", "-A"], seed); _git(["commit", "-m", "seed"], seed)
    _git(["remote", "add", "origin", str(ov_bare)], seed); _git(["push", "-u", "origin", "master"], seed)

    data = tmp_path / "data"
    (data / "proj" / "source").mkdir(parents=True)
    (data / "proj" / "source" / "main.tex").write_text("l1\nl2\n")
    (data / "proj" / ".overleaf-base").mkdir()
    (data / "proj" / ".overleaf-base" / "main.tex").write_text("l1\nl2\n")
    (data / "proj" / "overleaf.json").write_text(json.dumps({"projectId": "proj", "branch": "master"}))
    _git(["init", "-b", "main"], data)
    _git(["config", "user.email", "t@t"], data); _git(["config", "user.name", "t"], data)
    _git(["add", "-A"], data); _git(["commit", "-m", "init"], data)
    return data, ov_bare


def test_sync_pull_applies_overleaf_edit(synced_repo, tmp_path, monkeypatch):
    data, ov_bare = synced_repo
    # Overleaf side edits main.tex line 1
    work = tmp_path / "ovwork"
    _git(["clone", str(ov_bare), str(work)], tmp_path)
    _git(["config", "user.email", "o@o"], work); _git(["config", "user.name", "o"], work)
    (work / "main.tex").write_text("EDITED\nl2\n")
    _git(["add", "-A"], work); _git(["commit", "-m", "overleaf edit"], work); _git(["push"], work)

    monkeypatch.chdir(data)
    result = ci_overleaf.sync_project("proj/", str(ov_bare), "master")

    assert result["status"] == "merged"
    assert (data / "proj" / "source" / "main.tex").read_text() == "EDITED\nl2\n"          # pulled
    assert (data / "proj" / ".overleaf-base" / "main.tex").read_text() == "EDITED\nl2\n"  # base refreshed
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_ci_overleaf_integration.py -k sync_pull -q`
Expected: FAIL — `AttributeError: module 'ci_overleaf' has no attribute 'sync_project'`.

- [ ] **Step 3: Write minimal implementation** (append to `ci_overleaf.py`)

```python
import tempfile


def _clone_overleaf(remote_url, branch):
    """Clone the Overleaf remote (bare local path in tests, git.overleaf.com in prod) to a temp
    dir and return its path. Shallow clone of the one branch."""
    dest = tempfile.mkdtemp(prefix="overleaf-")
    subprocess.run(["git", "clone", "--depth", "1", "--branch", branch, remote_url, dest],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return dest


def sync_project(prefix, remote_url, branch, push_back=False):
    """Reconcile one marked project's <prefix>source/ against its Overleaf remote. Reads the three
    trees (<prefix>.overleaf-base = ancestor, the clone = Overleaf-now, <prefix>source = GitHub-now),
    calls the pure core, and on a clean merge writes source/, refreshes the base, and (push_back)
    pushes the merged tree to Overleaf. On conflict, does NOT touch source/ — see land_conflict
    (Task M1.9). Returns {"status": merged|noop|conflict, ...}. Assumes cwd = the data repo root."""
    src = os.path.join(prefix, "source")
    base_dir = os.path.join(prefix, ".overleaf-base")
    clone = _clone_overleaf(remote_url, branch)
    try:
        base_tree, base_bin = read_tree(base_dir)
        gh_tree, gh_bin = read_tree(src)
        ov_tree, ov_bin = read_tree(clone)
        text_paths = {p for p in set(base_tree) | set(ov_tree) | set(gh_tree)
                      if _is_text(p)}
        plan = O.plan_sync(base_tree, ov_tree, gh_tree, text_paths=text_paths)
        if plan["conflicts"]:
            return land_conflict(prefix, plan, ov_tree, ov_bin, remote_url, branch)
        if not plan["pull_needed"] and not plan["push_needed"]:
            return {"status": "noop", "prefix": prefix}
        binaries = (base_bin | gh_bin | ov_bin) & set(plan["merged"])
        write_tree(src, plan["merged"], binaries)
        write_tree(base_dir, plan["merged"], binaries)
        if push_back and plan["push_needed"]:
            _push_overleaf(clone, plan["merged"], binaries, branch)
        return {"status": "merged", "prefix": prefix,
                "pull": plan["pull_needed"], "push": plan["push_needed"]}
    finally:
        shutil.rmtree(clone, ignore_errors=True)
```

Add temporary stubs so the module imports (the real bodies land in M1.9 and M2.1):

```python
def land_conflict(prefix, plan, ov_tree, ov_bin, remote_url, branch):
    raise NotImplementedError  # implemented in Task M1.9


def _push_overleaf(clone, merged, binaries, branch):
    raise NotImplementedError  # implemented in Task M2.1
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_ci_overleaf_integration.py -k sync_pull -q`
Expected: PASS (1 passed) — the clean-merge pull path never hits the stubs.

- [ ] **Step 5: Commit**

```bash
git add data-template/ci_overleaf.py tests/test_ci_overleaf_integration.py
git commit -m "feat(overleaf): sync_project pull path — clean three-way merge + base refresh"
```

### Task M1.9: Shell — conflict lands on `overleaf-sync/<id>` (never clobbers source)

**Files:**
- Modify: `data-template/ci_overleaf.py`
- Test: `tests/test_ci_overleaf_integration.py`

- [ ] **Step 1: Write the failing test**

```python
def test_sync_conflict_stages_branch_and_leaves_source(synced_repo, tmp_path, monkeypatch):
    data, ov_bare = synced_repo
    # BOTH sides edit main.tex line 1 differently -> conflict
    work = tmp_path / "ovwork"
    _git(["clone", str(ov_bare), str(work)], tmp_path)
    _git(["config", "user.email", "o@o"], work); _git(["config", "user.name", "o"], work)
    (work / "main.tex").write_text("OVERLEAF\nl2\n")
    _git(["add", "-A"], work); _git(["commit", "-m", "ov"], work); _git(["push"], work)
    (data / "proj" / "source" / "main.tex").write_text("GITHUB\nl2\n")
    _git(["add", "-A"], data); _git(["commit", "-m", "gh edit"], data)

    monkeypatch.chdir(data)
    result = ci_overleaf.sync_project("proj/", str(ov_bare), "master")

    assert result["status"] == "conflict"
    assert result["conflicts"] == ["main.tex"]
    # source on main is UNTOUCHED (GitHub canonical, no clobber)
    assert (data / "proj" / "source" / "main.tex").read_text() == "GITHUB\nl2\n"
    # a conflict marker records the files
    marker = json.loads((data / "proj" / "overleaf_conflict.json").read_text())
    assert marker["files"] == ["main.tex"]
    # the overleaf-sync/<id> branch exists carrying the Overleaf side
    branches = subprocess.run(["git", "branch", "--list", "overleaf-sync/proj"],
                              cwd=str(data), capture_output=True, text=True).stdout
    assert "overleaf-sync/proj" in branches
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_ci_overleaf_integration.py -k sync_conflict -q`
Expected: FAIL — `NotImplementedError` from the `land_conflict` stub.

- [ ] **Step 3: Write minimal implementation** (replace the `land_conflict` stub in `ci_overleaf.py`)

```python
def land_conflict(prefix, plan, ov_tree, ov_bin, remote_url, branch):
    """A real conflict: never overwrite <prefix>source/ (GitHub canonical). Write a
    <prefix>overleaf_conflict.json marker (files + ts), commit it on the current branch, then create
    an overleaf-sync/<id> branch holding the Overleaf tree for the author to resolve. Leaves the
    working branch checked out. Returns status=conflict."""
    pid = prefix.rstrip("/")
    C.save_json(os.path.join(prefix, "overleaf_conflict.json"),
                {"files": plan["conflicts"], "ts": os.environ.get("SYNC_TS", "")})
    subprocess.run(["git", "add", os.path.join(prefix, "overleaf_conflict.json")], check=True)
    subprocess.run(["git", "commit", "-m", f"overleaf: conflict on {pid} [skip ci]"],
                   check=True, stdout=subprocess.DEVNULL)
    cur = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"],
                         capture_output=True, text=True, check=True).stdout.strip()
    ovbranch = f"overleaf-sync/{pid}"
    subprocess.run(["git", "checkout", "-B", ovbranch], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    src = os.path.join(prefix, "source")
    write_tree(src, ov_tree, set(ov_bin) & set(ov_tree))
    subprocess.run(["git", "add", "-A"], check=True)
    subprocess.run(["git", "commit", "-m", f"overleaf: incoming Overleaf changes for {pid} [skip ci]"],
                   check=True, stdout=subprocess.DEVNULL)
    subprocess.run(["git", "checkout", cur], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return {"status": "conflict", "prefix": prefix, "conflicts": plan["conflicts"], "branch": ovbranch}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_ci_overleaf_integration.py -k sync_conflict -q`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add data-template/ci_overleaf.py tests/test_ci_overleaf_integration.py
git commit -m "feat(overleaf): conflicts land on overleaf-sync/<id>, source untouched"
```

### Task M1.10: Shell — `main()` entry (loop marked projects, commit, push origin)

**Files:**
- Modify: `data-template/ci_overleaf.py`
- Test: `tests/test_ci_overleaf_integration.py`

- [ ] **Step 1: Write the failing test** — only marked projects sync; commit lands on origin

```python
def test_main_syncs_only_marked_projects(synced_repo, tmp_path, monkeypatch):
    data, ov_bare = synced_repo
    # add an UNMARKED second project — must be left untouched
    (data / "other" / "source").mkdir(parents=True)
    (data / "other" / "source" / "x.tex").write_text("untouched\n")
    _git(["add", "-A"], data); _git(["commit", "-m", "other"], data)
    # give the data repo a bare origin so main() can push
    origin = tmp_path / "data-origin.git"
    _git(["init", "--bare", "-b", "main", str(origin)], tmp_path)
    _git(["remote", "add", "origin", str(origin)], data)
    _git(["push", "-u", "origin", "main"], data)
    # Overleaf edit to pull
    work = tmp_path / " w2"
    _git(["clone", str(ov_bare), str(work)], tmp_path)
    _git(["config", "user.email", "o@o"], work); _git(["config", "user.name", "o"], work)
    (work / "main.tex").write_text("PULLED\nl2\n")
    _git(["add", "-A"], work); _git(["commit", "-m", "e"], work); _git(["push"], work)

    monkeypatch.chdir(data)
    monkeypatch.setenv("OVERLEAF_REMOTE_PROJ", str(ov_bare))   # test hook: remote override per project
    results = ci_overleaf.main()

    assert {r["prefix"]: r["status"] for r in results} == {"proj/": "merged"}
    assert (data / "proj" / "source" / "main.tex").read_text() == "PULLED\nl2\n"
    assert (data / "other" / "source" / "x.tex").read_text() == "untouched\n"   # never touched
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_ci_overleaf_integration.py -k main_syncs -q`
Expected: FAIL — `AttributeError: module 'ci_overleaf' has no attribute 'main'`.

- [ ] **Step 3: Write minimal implementation** (append to `ci_overleaf.py`)

```python
def remote_for(prefix):
    """The git remote URL + branch for a project. Prod: build the Overleaf git-bridge URL from the
    marker's projectId + the per-project token secret (OVERLEAF_TOKEN_<ID>, else the shared
    OVERLEAF_TOKEN). Tests: an OVERLEAF_REMOTE_<ID> env var points at a local bare remote (bypasses
    auth). Returns (None, None) when no remote/token is configured — the caller skips, never crashes.
    <ID> = secret_name's sanitized upper-case id (e.g. project 'proj' -> OVERLEAF_REMOTE_PROJ)."""
    pid = prefix.rstrip("/")
    marker = C.load_json(os.path.join(prefix, "overleaf.json"), {})
    project_id = (marker.get("projectId") or "").strip()
    branch = (marker.get("branch") or "master").strip() or "master"
    ov_id = O.secret_name(pid).replace("OVERLEAF_TOKEN_", "").replace("OVERLEAF_TOKEN", "")
    override = os.environ.get(f"OVERLEAF_REMOTE_{ov_id}") if ov_id else None
    if override:
        return override, branch
    token = os.environ.get(O.secret_name(pid)) or os.environ.get("OVERLEAF_TOKEN")
    if not project_id or not token:
        return None, None
    return f"https://git:{token}@git.overleaf.com/{project_id}", branch


def _commit_push():
    """Commit any working-tree changes on the current branch and push origin (best-effort rebase
    retry). content/ is rebuilt by render.yml on the source push, so this commit uses [skip ci] on
    nothing here — the source change SHOULD trigger render, so we do NOT add [skip ci]."""
    subprocess.run(["git", "add", "-A"], check=True)
    if subprocess.run(["git", "diff", "--cached", "--quiet"]).returncode == 0:
        return
    subprocess.run(["git", "commit", "-m", "overleaf: sync source from Overleaf"], check=True,
                   stdout=subprocess.DEVNULL)
    branch = os.environ.get("GITHUB_REF_NAME", "main")
    for _ in range(3):
        if subprocess.run(["git", "push", "origin", "HEAD"]).returncode == 0:
            return
        if subprocess.run(["git", "pull", "--rebase", "origin", branch]).returncode != 0:
            subprocess.run(["git", "rebase", "--abort"])
            break


def main():
    """Sync every marked project in the current data repo. Returns a list of per-project results.
    Skips projects with no configured remote/token. Commits + pushes source changes (fires render)."""
    push_back = os.environ.get("OVERLEAF_PUSH_BACK", "") == "1"
    only = (os.environ.get("PROJECT", "") or "").strip()
    results = []
    for prefix in discover():
        if only and prefix.rstrip("/") != only:
            continue
        url, branch = remote_for(prefix)
        if not url:
            results.append({"status": "skipped", "prefix": prefix, "reason": "no-remote"})
            continue
        results.append(sync_project(prefix, url, branch, push_back=push_back))
    if any(r["status"] in ("merged", "conflict") for r in results):
        _commit_push()
    return results


if __name__ == "__main__":
    for r in main():
        print(r)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_ci_overleaf_integration.py -q`
Expected: PASS (all ci_overleaf integration tests green).

- [ ] **Step 5: Commit**

```bash
git add data-template/ci_overleaf.py tests/test_ci_overleaf_integration.py
git commit -m "feat(overleaf): main() loops marked projects, commits+pushes source (fires render)"
```

### Task M1.11: Workflow — `overleaf-sync.yml` (dispatch + loop)

**Files:**
- Create: `data-template/workflows/overleaf-sync.yml`
- Test: manual YAML lint (not unit-testable — stated gate).

- [ ] **Step 1: Write the workflow**

```yaml
# data-template/workflows/overleaf-sync.yml
name: overleaf-sync
# Tier-2: reconcile each marked project's <id>/source/ with its Overleaf git-bridge project.
# Overleaf has no outbound webhook, so inbound is dispatch/cron. On a source change this commits to
# <id>/source/**, which triggers render.yml to rebuild the reading view — no render change needed.
on:
  workflow_dispatch:
    inputs:
      project:
        description: 'Project id to sync (blank = all marked projects)'
        required: false
        default: ''
      push_back:
        description: 'Also push approved GitHub edits back to Overleaf (1 = yes)'
        required: false
        default: ''
  # Opt-in poll: uncomment to enable (Overleaf has no webhook). Off by default.
  # schedule:
  #   - cron: '*/15 * * * *'
permissions:
  contents: write
concurrency:
  group: overleaf-sync
  cancel-in-progress: false
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-python@v5
        with:
          python-version: '3.x'
      - name: Sync Overleaf projects
        env:
          PROJECT: ${{ github.event.inputs.project }}
          OVERLEAF_PUSH_BACK: ${{ github.event.inputs.push_back }}
          OVERLEAF_TOKEN: ${{ secrets.OVERLEAF_TOKEN }}
          GITHUB_REF_NAME: ${{ github.ref_name }}
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          python3 ci_overleaf.py
```

- [ ] **Step 2: Verify YAML parses**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('data-template/workflows/overleaf-sync.yml')); print('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add data-template/workflows/overleaf-sync.yml
git commit -m "feat(overleaf): overleaf-sync.yml — dispatch/cron loop over marked projects"
```

> **Note on per-project tokens:** GitHub Actions cannot enumerate `secrets.*` dynamically, so a
> per-project `OVERLEAF_TOKEN_<ID>` can't be auto-injected by a single generic step. v1 passes the
> shared `OVERLEAF_TOKEN` (covers the common "one Overleaf account token reaches all my projects"
> case). Per-project-token injection (a generated matrix step per marked project) is a documented
> follow-up — noted here so it isn't silently dropped.

### Task M1.12: Full suite green + push M1

- [ ] **Step 1:** Run `python3 -m pytest -q tests/` → expected: 280 + new overleaf tests, all pass.
- [ ] **Step 2:** Run `npm test` → expected: 524 pass (unchanged; no JS yet).
- [ ] **Step 3:** Rebase onto latest origin/main, resolving only `?v=` cache-bust churn:
  ```bash
  git fetch origin && git rebase origin/main
  ```
- [ ] **Step 4:** Push the branch (do NOT open a PR / merge — Matt merges):
  ```bash
  git push -u origin feat/overleaf-tier2
  ```

---

## Milestone M2 — Push-back (GitHub → Overleaf)

Completes bidirectional: approved GitHub-side edits push to the Overleaf remote, loop-safe via the base snapshot.

### Task M2.1: Shell — `_push_overleaf` (push merged tree to the bridge)

**Files:**
- Modify: `data-template/ci_overleaf.py`
- Test: `tests/test_ci_overleaf_integration.py`

- [ ] **Step 1: Write the failing test**

```python
def test_sync_push_back_advances_overleaf(synced_repo, tmp_path, monkeypatch):
    data, ov_bare = synced_repo
    # GitHub side edits main.tex; Overleaf unchanged -> push_back should advance the bare remote
    (data / "proj" / "source" / "main.tex").write_text("l1\nGHNEW\n")
    _git(["add", "-A"], data); _git(["commit", "-m", "gh edit"], data)

    monkeypatch.chdir(data)
    result = ci_overleaf.sync_project("proj/", str(ov_bare), "master", push_back=True)
    assert result["status"] == "merged" and result["push"] is True

    # verify the bare remote now has the GitHub edit
    check = tmp_path / "check"
    _git(["clone", str(ov_bare), str(check)], tmp_path)
    assert (check / "main.tex").read_text() == "l1\nGHNEW\n"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_ci_overleaf_integration.py -k push_back -q`
Expected: FAIL — `NotImplementedError` from the `_push_overleaf` stub.

- [ ] **Step 3: Write minimal implementation** (replace the `_push_overleaf` stub)

```python
def _push_overleaf(clone, merged, binaries, branch):
    """Write the merged tree into the Overleaf clone, commit, and push to the bridge. Best-effort:
    a push rejection (someone edited Overleaf meanwhile) leaves GitHub canonical and is reported —
    the next pull will reconcile. Assumes the clone is a working (non-bare) checkout of `branch`."""
    write_tree(clone, merged, binaries)
    subprocess.run(["git", "-C", clone, "add", "-A"], check=True)
    if subprocess.run(["git", "-C", clone, "diff", "--cached", "--quiet"]).returncode == 0:
        return True
    subprocess.run(["git", "-C", clone, "-c", "user.email=bot@footnote", "-c", "user.name=footnote",
                    "commit", "-m", "footnote: apply approved edits"], check=True,
                   stdout=subprocess.DEVNULL)
    return subprocess.run(["git", "-C", clone, "push", "origin", f"HEAD:{branch}"]).returncode == 0
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_ci_overleaf_integration.py -k push_back -q`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add data-template/ci_overleaf.py tests/test_ci_overleaf_integration.py
git commit -m "feat(overleaf): push-back — push approved GitHub edits to the Overleaf remote"
```

### Task M2.2: Idempotence — re-run is a no-op

**Files:**
- Test: `tests/test_ci_overleaf_integration.py`

- [ ] **Step 1: Write the failing test**

```python
def test_sync_is_idempotent(synced_repo, tmp_path, monkeypatch):
    data, ov_bare = synced_repo
    monkeypatch.chdir(data)
    # nothing changed on either side (base == source == overleaf) -> noop, no branch, no marker
    result = ci_overleaf.sync_project("proj/", str(ov_bare), "master", push_back=True)
    assert result["status"] == "noop"
    assert not (data / "proj" / "overleaf_conflict.json").exists()
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `python3 -m pytest tests/test_ci_overleaf_integration.py -k idempotent -q`
Expected: PASS (the `noop` path from M1.8 already returns before writing). If it FAILS, fix `sync_project` so an all-equal reconcile returns `noop` before any write/commit.

- [ ] **Step 3: Commit**

```bash
git add tests/test_ci_overleaf_integration.py
git commit -m "test(overleaf): sync is idempotent (base prevents ping-pong)"
```

### Task M2.3: Push-back wired through `main()` + suite green + push

- [ ] **Step 1:** Confirm `main()` reads `OVERLEAF_PUSH_BACK=1` (done in M1.10) and add a test asserting a GitHub-only edit with `OVERLEAF_PUSH_BACK=1` advances the bare remote via `main()`:

```python
def test_main_push_back(synced_repo, tmp_path, monkeypatch):
    data, ov_bare = synced_repo
    origin = tmp_path / "do.git"; _git(["init", "--bare", "-b", "main", str(origin)], tmp_path)
    _git(["remote", "add", "origin", str(origin)], data); _git(["push", "-u", "origin", "main"], data)
    (data / "proj" / "source" / "main.tex").write_text("l1\nPB\n")
    _git(["add", "-A"], data); _git(["commit", "-m", "gh"], data)
    monkeypatch.chdir(data)
    monkeypatch.setenv("OVERLEAF_REMOTE_PROJ", str(ov_bare))
    monkeypatch.setenv("OVERLEAF_PUSH_BACK", "1")
    ci_overleaf.main()
    check = tmp_path / "c2"; _git(["clone", str(ov_bare), str(check)], tmp_path)
    assert (check / "main.tex").read_text() == "l1\nPB\n"
```

- [ ] **Step 2:** Run `python3 -m pytest -q tests/` → all green.
- [ ] **Step 3:** Rebase onto origin/main (`?v=` churn only), push:
  ```bash
  git fetch origin && git rebase origin/main && git push
  ```

---

## Milestone M3 — Owner UI + seeding + cron

Owner-side wiring so a real user can set the marker, seal the token, pull on demand, and resolve conflicts. `advisor.js` stays untouched (AI-clean).

### Task M3.1: Pure JS helpers — `js/overleaf.js`

**Files:**
- Create: `js/overleaf.js`
- Test: `tests/overleaf.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/overleaf.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overleafMarker, secretName, bridgeUrlHint, syncStatusLabel, conflictSummary } from '../js/overleaf.js';

test('overleafMarker builds the committed marker', () => {
  assert.deepEqual(overleafMarker('  proj-1 ', ''), { projectId: 'proj-1', branch: 'master' });
  assert.deepEqual(overleafMarker('p', 'main'), { projectId: 'p', branch: 'main' });
});

test('secretName mirrors the Python derivation', () => {
  assert.equal(secretName('metrology-paper'), 'OVERLEAF_TOKEN_METROLOGY_PAPER');
  assert.equal(secretName('proj.1'), 'OVERLEAF_TOKEN_PROJ_1');
  assert.equal(secretName(''), 'OVERLEAF_TOKEN');
});

test('bridgeUrlHint shows the git-bridge URL without the token', () => {
  assert.equal(bridgeUrlHint('abc123'), 'https://git.overleaf.com/abc123');
});

test('syncStatusLabel + conflictSummary render human states', () => {
  assert.equal(syncStatusLabel('merged'), 'Synced with Overleaf');
  assert.equal(syncStatusLabel('conflict'), 'Needs resolution');
  assert.equal(conflictSummary({ files: ['a.tex', 'b.tex'] }), '2 files need resolution: a.tex, b.tex');
  assert.equal(conflictSummary(null), '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/overleaf.test.mjs`
Expected: FAIL — `Cannot find module '../js/overleaf.js'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// js/overleaf.js
// Pure, assistant-free helpers for Overleaf Tier-2 sync (owner UI only; advisor.js never imports this).
// Mirrors the Python core (overleaf_sync.py) so display and CI agree on names.

export function overleafMarker(projectId, branch) {
  return { projectId: String(projectId || '').trim(), branch: (String(branch || '').trim() || 'master') };
}

export function secretName(projectId) {
  const slug = String(projectId || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
  return slug ? `OVERLEAF_TOKEN_${slug}` : 'OVERLEAF_TOKEN';
}

export function bridgeUrlHint(projectId) {
  return `https://git.overleaf.com/${String(projectId || '').trim()}`;
}

export function syncStatusLabel(status) {
  return {
    merged: 'Synced with Overleaf',
    noop: 'Up to date',
    conflict: 'Needs resolution',
    skipped: 'Not connected',
  }[status] || 'Not connected';
}

export function conflictSummary(marker) {
  const files = (marker && marker.files) || [];
  if (!files.length) return '';
  return `${files.length} file${files.length === 1 ? '' : 's'} need resolution: ${files.join(', ')}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/overleaf.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add js/overleaf.js tests/overleaf.test.mjs
git commit -m "feat(overleaf): pure owner-side JS helpers (marker/secret/status/conflict)"
```

### Task M3.2: Seed — `OVERLEAF_FILES` + `ensureOverleafPipeline`

**Files:**
- Modify: `js/seed.js`
- Test: `tests/seed.test.mjs` (or the existing seed test file — confirm its name with `ls tests/ | grep seed`)

- [ ] **Step 1: Write the failing test** (append to the seed test file)

```javascript
import { OVERLEAF_FILES, SEED_FILES } from '../js/seed.js';

test('OVERLEAF_FILES is the overleaf subset of SEED_FILES', () => {
  const dests = OVERLEAF_FILES.map(f => f.dest);
  assert.ok(dests.includes('ci_overleaf.py'));
  assert.ok(dests.includes('overleaf_sync.py'));
  assert.ok(dests.includes('.github/workflows/overleaf-sync.yml'));
  // every OVERLEAF_FILES entry is also in SEED_FILES (single source of truth)
  for (const d of dests) assert.ok(SEED_FILES.some(s => s.dest === d), `${d} in SEED_FILES`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/seed.test.mjs`
Expected: FAIL — `OVERLEAF_FILES` undefined (and the SEED_FILES entries missing).

- [ ] **Step 3: Add the entries + helper** — in `js/seed.js`, add these three to the `SEED_FILES` array (matching the existing `{ src, dest }` shape used by render/apply entries), then add the subset + ensure helper next to `RENDER_FILES`/`ensureRenderPipeline`:

```javascript
// (inside SEED_FILES array — CI code + workflow, repo-level, never prefixed)
  { src: 'data-template/overleaf_sync.py', dest: 'overleaf_sync.py' },
  { src: 'data-template/ci_overleaf.py', dest: 'ci_overleaf.py' },
  { src: 'data-template/workflows/overleaf-sync.yml', dest: '.github/workflows/overleaf-sync.yml' },
```

```javascript
// The Overleaf-sync subset of SEED_FILES — the pipeline that must exist for Tier-2 live sync.
export const OVERLEAF_FILES = SEED_FILES.filter(({ dest }) =>
  dest === 'overleaf_sync.py' || dest === 'ci_overleaf.py' || dest === '.github/workflows/overleaf-sync.yml');

// Self-heal the Overleaf pipeline (idempotent; mirrors ensureRenderPipeline). Throws 'workflow-scope'
// on a 403 writing .github/workflows/ so the cause is actionable, not silent.
export function ensureOverleafPipeline(dataRepo, token, fetchImpl, base) {
  return ensureFiles(OVERLEAF_FILES, dataRepo, token, fetchImpl, base, 'overleaf pipeline');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/seed.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/seed.js tests/seed.test.mjs
git commit -m "feat(overleaf): seed OVERLEAF_FILES + ensureOverleafPipeline self-heal"
```

### Task M3.3: Owner UI wiring (marker + token + Pull + conflict banner)

**Files:**
- Modify: `js/hub.js` (project settings / manage surface — locate the existing per-project settings sheet with `grep -an "editProjectSheet\|projectSheet\|manage" js/hub.js`)

This task is **DOM/UI, not unit-testable** — verified by a **browser gate** (stated, not skipped). All logic it needs is already unit-tested in `js/overleaf.js` (M3.1) and `js/ghsecrets.js` (existing seal/dispatch helpers).

- [ ] **Step 1:** Add an "Overleaf sync" section to the project settings sheet that:
  - Text input for the Overleaf **project id** + branch (default `master`); on save, commit `<id>/overleaf.json` via the existing source-commit helper (`importdoc.commitSourceFile` / the same path that writes `source.json`) using `overleafMarker(projectId, branch)`.
  - A **"Seal Overleaf token"** control that seals `secretName(projectId)` (and offers the shared `OVERLEAF_TOKEN`) via the existing `ghsecrets` seal flow (owner Secrets scope). Shows the `bridgeUrlHint(projectId)` so the user knows which project (never displays the token).
  - A **"Pull from Overleaf"** button → `ghsecrets.dispatch`/`renderRun`-style `workflow_dispatch` of `overleaf-sync.yml` with the project id, then poll the run (reuse the render dispatch/poll helpers).
  - Calls `ensureOverleafPipeline(dataRepo, tok())` before dispatch (self-heal, mirrors the render button).
  - A **conflict banner** when `<id>/overleaf_conflict.json` exists: render `conflictSummary(marker)` + a link to the `overleaf-sync/<id>` branch for resolution.

- [ ] **Step 2: Browser gate** (per the verification workflow — serve origin/main+branch locally, drive the owner UI):
  - Set a project id → Save → confirm `overleaf.json` committed (network tab / repo).
  - Seal token → confirm the seal call fires with `secretName(...)`.
  - "Pull from Overleaf" → confirm a `workflow_dispatch` for `overleaf-sync.yml`.
  - Stub `overleaf_conflict.json` → confirm the banner renders `conflictSummary`.
  - Re-grep `advisor.js` AI-clean: `grep -aiE "claude|anthropic|\bAI\b|\bagent\b|gpt|llm|copilot" js/advisor.js` → empty.

- [ ] **Step 3: Commit**

```bash
git add js/hub.js
git commit -m "feat(overleaf): owner UI — marker, token seal, Pull from Overleaf, conflict banner"
```

### Task M3.4: Final suite + cachebust + push

- [ ] **Step 1:** `python3 -m pytest -q tests/` → all green.
- [ ] **Step 2:** `npm test` → all green (524 + new JS tests).
- [ ] **Step 3:** Confirm `advisor.js` AI-clean grep is empty.
- [ ] **Step 4:** Rebase onto origin/main (resolve `?v=` cachebust on any new import lines, keeping newer shas + new symbols), push:
  ```bash
  git fetch origin && git rebase origin/main && git push
  ```
- [ ] **Step 5:** Report to Matt for review/merge (do NOT self-merge — advisors are live).

---

## Deferred (documented, not silently dropped)

- **Real-Overleaf verification** — the git bridge is premium; when Matt has a paid plan + a throwaway project id/token, run one real round-trip (auth + protocol quirks are all that remain unproven).
- **Per-project token injection into the workflow** — v1 uses the shared `OVERLEAF_TOKEN`; a generated matrix step per marked project would inject `OVERLEAF_TOKEN_<ID>` individually.
- **Cron poll** — scaffolded (commented `schedule:` in the workflow); the owner enables it explicitly.
- **Partial edge-overlap merges** — the line merge conflicts on overlapping base ranges; a finer char-offset merge is a later refinement.

## Self-Review notes (author)

- Spec coverage: mapping (M1.1), secret split (M1.2/M3.3), `.overleaf-base` 3-way (M1.3–M1.5), pull+render (M1.8/M1.10/M1.11), conflict→branch (M1.9), push-back (M2.1), idempotence/loop-safety (M2.2), owner UI+seed+cron (M3). Overleaf-gap/premium honesty (Deferred).
- Type consistency: `sync_project(prefix, remote_url, branch, push_back=False)`, `plan_sync(...) -> {merged, conflicts, pull_needed, push_needed}`, `merge_file(base,a,b,is_text) -> {content, conflict}`, `secretName` identical in Python + JS — used consistently across tasks.
- Placeholders: none — every code step is concrete. UI (M3.3) is explicitly a browser gate with its logic pre-tested in M3.1.
