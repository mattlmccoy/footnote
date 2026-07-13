"""Thin I/O shell for Overleaf Tier-2 sync. Clones the Overleaf git-bridge remote (or a local bare
remote in tests), reads the three trees, calls the pure core (overleaf_sync), then writes
<id>/source/, refreshes <id>/.overleaf-base/, commits, pushes back, or lands conflicts on
overleaf-sync/<id>. The ONLY place git + network live (mirrors ci_apply.py's boundary style)."""
import glob
import os
import shutil
import subprocess
import sys
import tempfile

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
        if dirpath != root and os.path.isdir(dirpath) and not os.listdir(dirpath):
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


def discover():
    """Marked project prefixes in the current data repo (glob ``*/overleaf.json`` + root)."""
    paths = []
    if os.path.exists("overleaf.json"):
        paths.append("overleaf.json")
    paths.extend(sorted(glob.glob("*/overleaf.json")))
    return O.marked_prefixes(paths)


def _clone_overleaf(remote_url, branch):
    """Clone the Overleaf remote (bare local path in tests, git.overleaf.com in prod) to a temp
    dir and return its path. Shallow clone of the one branch."""
    dest = tempfile.mkdtemp(prefix="overleaf-")
    subprocess.run(["git", "clone", "--depth", "1", "--branch", branch, remote_url, dest],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return dest


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


def _push_overleaf(clone, merged, binaries, branch):
    raise NotImplementedError  # implemented in Task M2.1


def sync_project(prefix, remote_url, branch, push_back=False):
    """Reconcile one marked project's <prefix>source/ against its Overleaf remote. Reads the three
    trees (<prefix>.overleaf-base = ancestor, the clone = Overleaf-now, <prefix>source = GitHub-now),
    calls the pure core, and on a clean merge writes source/, refreshes the base, and (push_back)
    pushes the merged tree to Overleaf. On conflict, does NOT touch source/ — see land_conflict.
    Returns {"status": merged|noop|conflict, ...}. Assumes cwd = the data repo root."""
    src = os.path.join(prefix, "source")
    base_dir = os.path.join(prefix, ".overleaf-base")
    clone = _clone_overleaf(remote_url, branch)
    try:
        base_tree, base_bin = read_tree(base_dir)
        gh_tree, gh_bin = read_tree(src)
        ov_tree, ov_bin = read_tree(clone)
        text_paths = {p for p in set(base_tree) | set(ov_tree) | set(gh_tree) if _is_text(p)}
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
    retry). The source change SHOULD trigger render.yml, so we do NOT add [skip ci]."""
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
