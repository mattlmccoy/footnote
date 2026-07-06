#!/usr/bin/env python3
"""ci_apply.py — drain the review job queue on the ADOPTER's own GitHub Actions.

Slice 2 handles the DETERMINISTIC ``apply-direct`` job: an owner's verbatim edit (from the
per-comment pencil editor) is applied to the LaTeX source on a ``review-edits/<unit>`` branch,
the comment is staged with a reader-facing diff, and the job is removed from the queue. This
path uses NO Claude, so it works with the AI assistant OFF — the core review flow.

The Claude-authored jobs (``apply-edits``, ``run-agents``) and the ``merge`` job are handled by
ci_apply's apply-edits path / ci_agents.py / ci_merge.py in later slices; this script skips them.

Author-oversight invariant: edits only ever land on ``review-edits/<unit>`` (never the source
main); the author previews and approves before anything merges.

Pure decision logic lives in ci_review_common (unit-tested). This script is the thin git/IO shell,
verified live on Actions and by a local in-repo integration test.

Environment:
  SOURCE_TOKEN        PAT for pushing the review branch to an external source repo (unused in-repo)
  SOURCE_REPO         external source repo for a legacy data repo without projects.json (optional)
  GITHUB_REPOSITORY   owner/repo of this data repo (for the in-repo-vs-external decision)
  PROJECT             restrict to one project prefix / id (optional; default: all)
"""
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ci_review_common as R  # noqa: E402
import ci_render  # noqa: E402  (reuse the tested source resolution)

TEXT_EXTS = {".tex", ".bib", ".cls", ".sty", ".bbl", ".txt"}


def _now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def read_text_files(root):
    """Every text source file under ``root`` as ``{relpath: text}`` (skips binaries/figures)."""
    out = {}
    root = Path(root)
    for p in root.rglob("*"):
        if p.is_file() and p.suffix.lower() in TEXT_EXTS:
            try:
                out[str(p.relative_to(root))] = p.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                pass
    return out


def _git(args, cwd, check=True):
    return subprocess.run(["git", *args], cwd=str(cwd), check=check,
                          stdout=sys.stderr, stderr=sys.stderr)


def commit_branch(repo_dir, branch, changed, base, msg, token=None, remote_repo=None,
                  push=True, after_commit=None):
    """Create/switch to ``branch`` off ``base`` in ``repo_dir``, write ``changed`` ({relpath: text}),
    commit, and (when ``push``) push to origin. ``after_commit`` (if given) runs WHILE the branch is
    still checked out — used to build the preview from the branch's edited source. Returns to
    ``base`` afterwards so the data-repo working tree is left on its default branch for the
    review/jobs writeback."""
    _git(["config", "user.name", "github-actions[bot]"], repo_dir, check=False)
    _git(["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], repo_dir, check=False)
    # start the branch from base (create if new, reset onto base if it exists)
    if _git(["rev-parse", "--verify", branch], repo_dir, check=False).returncode == 0:
        _git(["checkout", branch], repo_dir)
    else:
        _git(["checkout", "-b", branch, base], repo_dir)
    for rel, text in changed.items():
        fp = Path(repo_dir) / rel
        fp.parent.mkdir(parents=True, exist_ok=True)
        fp.write_text(text, encoding="utf-8")
    _git(["add", *changed.keys()], repo_dir)
    if _git(["diff", "--cached", "--quiet"], repo_dir, check=False).returncode != 0:
        _git(["commit", "-m", msg], repo_dir)
        if push:
            if token and remote_repo:
                url = f"https://x-access-token:{token}@github.com/{remote_repo}.git"
                _git(["push", url, f"HEAD:{branch}"], repo_dir)
            else:
                _git(["push", "origin", branch], repo_dir)
    if after_commit is not None:
        after_commit()                 # build preview while the branch source is checked out
    _git(["checkout", base], repo_dir)


def build_preview(prefix, unit_id, source_dir, workdir):
    """Build the branch preview ``<prefix>preview/<unit>.html`` from ``source_dir`` (a checkout of
    the review-edits branch), reusing the SAME export/chapter-html.sh the render pipeline uses — so
    preview and the published reading view are byte-for-byte the same renderer, just a different
    source tree and output path. Best-effort: a failed build leaves any prior preview in place.
    Output always goes into the data repo (cwd); only SOURCE_DIR points at the branch."""
    rows = ci_render.load_units(prefix)
    entry = ci_render.derive_entry(rows)
    out = Path(R.preview_out(prefix, unit_id))
    out.parent.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ,
               SOURCE_DIR=str(Path(source_dir).resolve()),
               CHAPTERS_JSON=str(Path(f"{prefix}chapters.json").resolve()),
               RENDER_ENTRY=entry,
               BUILD_DIR=str((Path(workdir) / "build" / (prefix.rstrip("/") or "root")).resolve()))
    try:
        subprocess.run(["bash", str(ci_render.CHAPTER_HTML), unit_id, str(out.resolve())],
                       check=True, env=env, stdout=sys.stderr, stderr=sys.stderr)
    except subprocess.CalledProcessError as e:
        print(f"[apply] preview {prefix}{unit_id}: build failed ({e}) — leaving prior preview", file=sys.stderr)


def process_project(prefix, this_repo, token, base_branch="main"):
    """Drain the apply-direct jobs for one project prefix. Returns the number of jobs processed."""
    jobs = R.load_json(R.jobs_path(prefix), [])
    if not isinstance(jobs, list):
        return 0
    direct = [j for j in jobs if j.get("type") == "apply-direct" and j.get("status") != "done"]
    if not direct:
        return 0

    project = ci_render.project_entry(prefix)
    kind, ref = ci_render.resolve_source(project, prefix, this_repo,
                                         os.environ.get("SOURCE_REPO", ""))
    external = kind == "clone"
    if external:
        workdir = Path(os.environ.get("RUNNER_TEMP", "/tmp")) / f"src-{prefix.rstrip('/') or 'root'}"
        if not workdir.exists():
            ci_render._clone(ref, workdir, token)
        repo_dir, source_dir, remote_repo = workdir, workdir, ref
    else:
        # in-repo (workspace) source: branch lives on THIS data repo, source under <prefix>source/
        repo_dir = Path(".").resolve()
        source_dir = Path(ref).resolve()
        remote_repo = None

    import tempfile
    build_root = Path(tempfile.mkdtemp(prefix="footnote-apply-"))
    done = 0
    for job in direct:
        ch = job.get("chapter")
        review = R.load_json(R.review_path(prefix, ch), {"comments": []})
        files = read_text_files(source_dir)
        new_review, new_files, branch, applied = R.process_apply_direct_job(
            job, review, files, _now_iso())
        if applied:
            # read_text_files keys are source_dir-relative; the branch commit needs them
            # repo_dir-relative (workspace source sits under <prefix>source/, external clone at root).
            src_rel = os.path.relpath(source_dir, repo_dir)
            changed = {os.path.normpath(os.path.join(src_rel, rel)): txt
                       for rel, txt in new_files.items() if files.get(rel) != txt}
            # build the preview from the branch's edited source (after_commit runs on-branch), so
            # the author can review the rendered change before approving — the oversight gate.
            commit_branch(repo_dir, branch, changed, base_branch,
                          f"apply-direct: stage edits on {ch}",
                          token=token, remote_repo=remote_repo, push=True,
                          after_commit=lambda c=ch: build_preview(prefix, c, source_dir, build_root))
        _write_json(R.review_path(prefix, ch), new_review)
        jobs = R.remove_job(jobs, job.get("id"))
        done += 1
    _write_json(R.jobs_path(prefix), jobs)
    print(f"[apply] {prefix or '(root)'}: processed {done} apply-direct job(s)")
    return done


def _write_json(path, obj):
    import json
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)


def main():
    token = os.environ.get("SOURCE_TOKEN", "")
    this_repo = os.environ.get("GITHUB_REPOSITORY", "")
    only = os.environ.get("PROJECT", "").strip()
    prefixes = R.apply_prefixes()
    if only:
        want = only if only.endswith("/") or only == "" else only + "/"
        prefixes = [p for p in prefixes if p == want] or [want]
    total = sum(process_project(p, this_repo, token) for p in prefixes)
    print(f"[apply] done — {total} job(s) across {len(prefixes)} project(s)")


if __name__ == "__main__":
    main()
