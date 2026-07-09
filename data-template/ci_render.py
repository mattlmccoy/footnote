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
import ci_review_common as R  # noqa: E402

HERE = Path(__file__).resolve().parent
CHAPTER_HTML = HERE / "export" / "chapter-html.sh"


def build_guarded(unit_id, out_html, env, workdir, label="content"):
    """Render one unit to a TEMP file, then replace ``out_html`` (and its .srcmap.json sidecar)
    ONLY if the result is not degenerate (R.is_degenerate_content vs the current last-good).

    This is the P0 anti-corruption guard (2026-07-08 incident): chapter-html.sh can exit 0 yet
    emit a stub, so a plain "build straight to out" destroys the last-good content. Building to a
    temp .html (srcmap lands beside it as <tmp>.srcmap.json) and swapping both only on success
    means a failed OR degenerate build always keeps the previous good files. Returns True when a
    new build was published, False when the last-good was kept.
    """
    out_html = Path(out_html)
    out_html.parent.mkdir(parents=True, exist_ok=True)
    out_map = Path(str(out_html)[:-5] + ".srcmap.json") if str(out_html).endswith(".html") else None
    prev = out_html.read_text(encoding="utf-8") if out_html.exists() else ""
    gdir = Path(workdir) / "guard"
    gdir.mkdir(parents=True, exist_ok=True)
    tmp_html = gdir / f"{unit_id}.html"
    tmp_map = gdir / f"{unit_id}.srcmap.json"
    for p in (tmp_html, tmp_map):
        if p.exists():
            p.unlink()
    try:
        subprocess.run(["bash", str(CHAPTER_HTML), unit_id, str(tmp_html.resolve())],
                       check=True, env=env, stdout=sys.stderr, stderr=sys.stderr)
    except subprocess.CalledProcessError as e:
        print(f"[build] {label} {unit_id}: build FAILED ({e}) — kept last-good", file=sys.stderr)
        return False
    new = tmp_html.read_text(encoding="utf-8") if tmp_html.exists() else ""
    degenerate, why = R.is_degenerate_content(new, prev)
    if degenerate:
        print(f"[build] {label} {unit_id}: REJECTED degenerate build ({why}) — kept last-good",
              file=sys.stderr)
        return False
    tmp_html.replace(out_html)
    if out_map is not None and tmp_map.exists():
        out_map.parent.mkdir(parents=True, exist_ok=True)
        tmp_map.replace(out_map)
    return True


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
        if build_guarded(uid, out, env, workdir, "content"):
            built += 1
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
