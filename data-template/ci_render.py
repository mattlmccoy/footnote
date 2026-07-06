#!/usr/bin/env python3
"""ci_render.py — build the reading view for every project in a data repo.

Runs on the ADOPTER's own GitHub Actions (render.yml). For each project (legacy root or a
workspace ``<id>/`` subfolder) it reads ``<prefix>chapters.json``, locates the LaTeX source
(in-repo under ``<id>/source/`` for a workspace project, or an external ``sourceRepo`` cloned
read-only with ``SOURCE_TOKEN``), and runs the generic export pipeline
(``export/chapter-html.sh``) per unit, writing the reader's contract into the data repo:

    <prefix>content/<unit>.html          reading HTML fragment
    <prefix>content/<unit>.srcmap.json   paragraph -> source map

Never touches the source repo beyond a read-only clone. The workflow commits the outputs
with ``[skip ci]``. Dual-mode via ci_notify_common.project_prefixes() so one workflow serves
both a legacy single-project repo and a consolidated workspace repo.

Environment:
  SOURCE_TOKEN   read-only PAT for external source repos (unused for in-repo sources)
  PROJECT        restrict to one project prefix / id (optional; default: all)
  SOURCE_DIR     legacy-root fallback source dir when there is no sourceRepo (default: source)
"""
import glob
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ci_notify_common as C  # noqa: E402

HERE = Path(__file__).resolve().parent
CHAPTER_HTML = HERE / "export" / "chapter-html.sh"


# --------------------------------------------------------------------------- pure helpers

def render_prefixes():
    """Which project subtrees have a parsed unit list to render. Keys off chapters.json (a
    project can have units before any reviewer is added), unlike the advisor-centric
    ci_notify_common.project_prefixes(). [""] for a legacy root, ["<id>/", …] for a workspace."""
    out = []
    if os.path.exists("chapters.json"):
        out.append("")
    for p in sorted(glob.glob("*/chapters.json")):
        out.append(p.split(os.sep)[0] + "/")
    return out


def content_out(prefix, unit_id):
    """Reader contract: <prefix>content/<unit>.html (matches app.js dpath('content/…'))."""
    return f"{prefix}content/{unit_id}.html"


def srcmap_out(prefix, unit_id):
    """The source map sits beside the HTML: <prefix>content/<unit>.srcmap.json."""
    return f"{prefix}content/{unit_id}.srcmap.json"


def load_units(prefix):
    """The parsed unit manifest from <prefix>chapters.json ([] if absent/malformed)."""
    rows = C.load_json(f"{prefix}chapters.json", [])
    if isinstance(rows, dict):
        rows = rows.get("chapters") or rows.get("units") or []
    return rows if isinstance(rows, list) else []


def derive_entry(rows):
    """The main entry .tex for numbering/order. A single-file article has every unit pointing
    at one file -> use it; otherwise default to main.tex."""
    files = {r.get("sourceFile") for r in rows if r.get("sourceFile")}
    if len(files) == 1:
        return next(iter(files))
    return "main.tex"


def project_entry(prefix):
    """The project's dict from the root projects.json (None if not found / legacy)."""
    pid = prefix.rstrip("/")
    for p in C.load_json("projects.json", []) or []:
        if isinstance(p, dict) and p.get("id") == pid:
            return p
    return None


def resolve_source(project, prefix, this_repo, env_source_repo=""):
    """Decide where a project's LaTeX lives.

    Returns ("inrepo", path) when the source is checked into THIS data repo (a workspace
    project keeps it under ``<id>/source/``; a legacy root falls back to ``source``), or
    ("clone", "owner/repo") when it is an external source repo to clone read-only.

    The external repo comes from the project's ``sourceRepo`` (workspace repos carry
    projects.json), else from the ``SOURCE_REPO`` Actions variable (``env_source_repo``) —
    a legacy data repo has no projects.json, so its external source is configured as a repo
    variable alongside the SOURCE_TOKEN secret.
    """
    src_repo = (project or {}).get("sourceRepo") or env_source_repo
    external = bool(src_repo) and src_repo != this_repo
    if external:
        return ("clone", src_repo)
    if prefix:                                  # workspace project: <id>/source/
        return ("inrepo", f"{prefix}source")
    return ("inrepo", os.environ.get("SOURCE_DIR", "source"))   # legacy root


# --------------------------------------------------------------------------- I/O

def _clone(repo, dest, token):
    url = f"https://x-access-token:{token}@github.com/{repo}.git" if token \
        else f"https://github.com/{repo}.git"
    subprocess.run(["git", "clone", "--depth", "1", url, str(dest)], check=True,
                   stdout=sys.stderr, stderr=sys.stderr)


def render_project(prefix, this_repo, token, workdir):
    rows = load_units(prefix)
    if not rows:
        print(f"[render] {prefix or '(root)'}: no chapters.json / no units — skipping")
        return 0
    project = project_entry(prefix)
    kind, ref = resolve_source(project, prefix, this_repo, os.environ.get("SOURCE_REPO", ""))
    if kind == "clone":
        source_dir = workdir / (prefix.rstrip("/") or "root")
        if not source_dir.exists():
            print(f"[render] {prefix or '(root)'}: cloning source {ref} (read-only)")
            _clone(ref, source_dir, token)
    else:
        source_dir = Path(ref).resolve()
    if not source_dir.is_dir():
        print(f"[render] {prefix or '(root)'}: source dir {source_dir} missing — skipping")
        return 0

    entry = derive_entry(rows)
    chapters_json = str(Path(f"{prefix}chapters.json").resolve())
    Path(f"{prefix}content").mkdir(parents=True, exist_ok=True)
    built = 0
    for r in rows:
        uid = r.get("id")
        if not uid:
            continue
        out = str(Path(content_out(prefix, uid)).resolve())
        env = dict(os.environ,
                   SOURCE_DIR=str(source_dir),
                   CHAPTERS_JSON=chapters_json,
                   RENDER_ENTRY=entry,
                   BUILD_DIR=str((workdir / "build" / (prefix.rstrip("/") or "root")).resolve()))
        try:
            subprocess.run(["bash", str(CHAPTER_HTML), uid, out], check=True, env=env,
                           stdout=sys.stderr, stderr=sys.stderr)
            built += 1
        except subprocess.CalledProcessError as e:
            print(f"[render] {prefix}{uid}: render failed ({e}) — leaving prior output", file=sys.stderr)
    print(f"[render] {prefix or '(root)'}: built {built}/{len(rows)} units")
    return built


def main():
    token = os.environ.get("SOURCE_TOKEN", "")
    this_repo = os.environ.get("GITHUB_REPOSITORY", "")
    only = os.environ.get("PROJECT", "").strip()
    prefixes = render_prefixes()
    if only:
        want = only if only.endswith("/") or only == "" else only + "/"
        prefixes = [p for p in prefixes if p == want or (want == "/" and p == "")]
        if not prefixes:
            prefixes = [want if want != "/" else ""]
    if not prefixes:
        print("[render] nothing to render (no chapters.json anywhere)")
        return
    import tempfile
    workdir = Path(tempfile.mkdtemp(prefix="footnote-render-"))
    total = 0
    for prefix in prefixes:
        total += render_project(prefix, this_repo, token, workdir)
    print(f"[render] done — {total} unit(s) rendered across {len(prefixes)} project(s)")


if __name__ == "__main__":
    main()
