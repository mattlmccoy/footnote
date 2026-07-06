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


# Claude Code credentials the headless CLI honors. The RECOMMENDED path for adopters is a Claude Code
# SUBSCRIPTION token (CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`, Pro/Max/Team/Enterprise) — most
# users have a subscription, not a raw API key. ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN remain supported
# alternatives. `claude -p` picks up whichever is set (usage counts against the subscription, no API bill).
CLAUDE_CRED_ENVS = ("CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")


def claude_configured(env):
    """True if any recognized Claude Code credential is present (non-empty) in ``env``. When none is,
    Claude jobs are left queued — honest 'nothing runs until you connect Claude Code'."""
    return any((env.get(name) or "").strip() for name in CLAUDE_CRED_ENVS)


# --------------------------------------------------------------- Claude boundary
# Claude produces per-comment edit SPECS; the tested deterministic engine applies them. Claude is
# never asked to mutate files or merge — that keeps the author-oversight invariant enforceable in code.

CLAUDE_INSTRUCTIONS = (
    "You are a LaTeX copy-editor addressing reviewer comments on one document unit. For EACH comment "
    "below, decide how to resolve it and return a machine-readable answer. Do NOT edit any files "
    "yourself and do NOT merge anything — only return the specs; a deterministic tool applies them and "
    "the author approves before anything lands.\n\n"
    "Return ONLY a JSON array, one object per comment you act on, with keys:\n"
    "  id            the comment id\n"
    "  response      a short plain-language note to the author on how you addressed it\n"
    "  source_before EXACT existing LaTeX substring to replace (omit if you are only answering)\n"
    "  source_after  its replacement LaTeX (omit if only answering)\n"
    "  prose_before  the reader-facing text before your change (for the track-changes diff)\n"
    "  prose_after   the reader-facing text after your change\n"
    "source_before must appear VERBATIM exactly once in the source, or the edit is rejected. If a "
    "comment is a question, return only id + response.\n\n"
)


def claude_prompt(task):
    """The prompt handed to Claude Code for an apply-edits job: instructions + the packaged task
    (unit id, source files, comments). Pure so it can be asserted in tests."""
    import json
    return CLAUDE_INSTRUCTIONS + "TASK:\n" + json.dumps(task, ensure_ascii=False, indent=2)


def _parse_claude_json(raw):
    """Pull the JSON payload out of Claude's CLI output: unwrap the ``--output-format json`` envelope
    (assistant text under ``result``), strip a fenced ```json block, and parse. Returns the decoded
    value (list/dict/…) or None if unparseable. Shared by the edit-map and findings-list parsers."""
    import json
    import re
    text = raw
    try:
        env = json.loads(raw)
        if isinstance(env, dict) and "result" in env:
            text = env["result"]                        # CLI envelope → assistant text
        else:
            return env                                  # already the payload (dict/list)
    except (ValueError, TypeError):
        pass
    m = re.search(r"```(?:json)?\s*(.*?)```", text or "", re.DOTALL)
    if m:
        text = m.group(1)
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        return None


def parse_claude_edits(raw):
    """Recover the ``{comment_id: edit_spec}`` map from Claude's apply-edits output (envelope, fenced
    block, array, or object map). Returns {} on anything unparseable (the caller leaves the job for a
    retry rather than crashing the whole queue)."""
    data = _parse_claude_json(raw)
    if isinstance(data, list):
        return {e.get("id"): e for e in data if isinstance(e, dict) and e.get("id")}
    if isinstance(data, dict):
        return data
    return {}


def parse_agent_findings(raw):
    """Recover the LIST of finding specs from a review agent's output (findings have no id, so this
    keeps them as a list rather than id-mapping them). Returns [] on anything unparseable."""
    data = _parse_claude_json(raw)
    if isinstance(data, list):
        return [e for e in data if isinstance(e, dict)]
    if isinstance(data, dict):
        return list(data.values())                      # tolerate an object map of findings
    return []


AGENT_INSTRUCTIONS = (
    "You are the '{agent}' review agent. Critique the document unit below from your perspective. "
    "This is READ-ONLY: do NOT edit any files — only report findings.\n\n"
    "Return ONLY a JSON array, one object per finding, with keys:\n"
    "  quote   a short EXACT substring of the source your finding is about (for anchoring)\n"
    "  body    your critique / suggestion in plain language\n"
    "  tag     a short category (e.g. rigor, clarity, evidence, style)\n"
    "Return [] if you have no findings.\n\n"
)


def agent_prompt(agent_id, task):
    """Prompt for one read-only review agent over an apply-task-shaped payload. Pure (asserted in tests)."""
    import json
    return AGENT_INSTRUCTIONS.format(agent=agent_id) + "UNIT:\n" + json.dumps(task, ensure_ascii=False, indent=2)


def run_agent_cli(agent_id, task, model=None):
    """Invoke Claude Code (headless) as one review agent; returns a list of finding specs. Thin,
    live-CI-gated boundary around the pure agent_prompt + parse_claude_edits list handling."""
    model = model or os.environ.get("CLAUDE_MODEL") or "claude-opus-4-8"
    proc = subprocess.run(
        ["claude", "-p", agent_prompt(agent_id, task), "--output-format", "json", "--model", model],
        capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"[apply] agent {agent_id} failed ({proc.returncode}): {proc.stderr[:200]}", file=sys.stderr)
        return []
    return parse_agent_findings(proc.stdout)


def run_claude_cli(task, model=None):
    """Invoke Claude Code (headless) to produce edit specs for one apply-edits task. This is the thin,
    live-CI-gated boundary; the parse/prompt logic around it is pure and unit-tested. Requires the
    ``claude`` CLI on PATH and ANTHROPIC_API_KEY in the environment (the adopter's own)."""
    model = model or os.environ.get("CLAUDE_MODEL") or "claude-opus-4-8"
    proc = subprocess.run(
        ["claude", "-p", claude_prompt(task), "--output-format", "json", "--model", model],
        capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"[apply] claude CLI failed ({proc.returncode}): {proc.stderr[:300]}", file=sys.stderr)
        return {}
    return parse_claude_edits(proc.stdout)


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


def _build_unit(prefix, unit_id, source_dir, out_path, workdir, label):
    """Render one unit to ``out_path`` via the SAME export/chapter-html.sh the render pipeline uses —
    so preview (branch) and published content (merged) are byte-for-byte the same renderer, differing
    only in source tree and output path. Best-effort: a failed build leaves any prior output."""
    rows = ci_render.load_units(prefix)
    entry = ci_render.derive_entry(rows)
    out = Path(out_path)
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
        print(f"[apply] {label} {prefix}{unit_id}: build failed ({e}) — leaving prior output", file=sys.stderr)


def build_preview(prefix, unit_id, source_dir, workdir):
    """Branch preview → ``<prefix>preview/<unit>.html`` (the review-edits view, distinct from content/)."""
    _build_unit(prefix, unit_id, source_dir, R.preview_out(prefix, unit_id), workdir, "preview")


def build_content(prefix, unit_id, source_dir, workdir):
    """Published reading view → ``<prefix>content/<unit>.html`` (rebuilt from merged main source)."""
    _build_unit(prefix, unit_id, source_dir, ci_render.content_out(prefix, unit_id), workdir, "content")


def _delete_branch(repo_dir, branch, token=None, remote_repo=None):
    """Best-effort delete of the review branch on its origin (the branch's edits are now merged)."""
    if token and remote_repo:
        url = f"https://x-access-token:{token}@github.com/{remote_repo}.git"
        _git(["push", url, "--delete", branch], repo_dir, check=False)
    else:
        _git(["push", "origin", "--delete", branch], repo_dir, check=False)


def publish_merge(prefix, ch, job, review, files, source_dir, repo_dir, remote_repo,
                  token, base_branch, workdir):
    """Publish the author-approved edits for a unit (author-triggered merge job). Reapplies ONLY the
    approved comments' source edits to main (so rejected edits never land), writes the merged source
    to the source main, rebuilds the published content/<unit>.html, drops the review branch + its
    preview, and returns the updated review (approved→merged). This is the one place edits become
    permanent — and it only runs on an author-queued merge job."""
    new_review, new_files, merged = R.process_merge_job(job, review, files, _now_iso())
    if not merged:
        print(f"[apply] merge {prefix}{ch}: nothing approved to publish", file=sys.stderr)
        return new_review
    branch = R.branch_for(ch)
    changed = {rel: txt for rel, txt in new_files.items() if files.get(rel) != txt}
    if remote_repo:
        # external source repo: write merged files into the clone and push to its main
        for rel, txt in changed.items():
            fp = Path(source_dir) / rel
            fp.parent.mkdir(parents=True, exist_ok=True)
            fp.write_text(txt, encoding="utf-8")
        if changed:
            _git(["checkout", base_branch], repo_dir, check=False)
            _git(["add", *changed.keys()], repo_dir)
            if _git(["diff", "--cached", "--quiet"], repo_dir, check=False).returncode != 0:
                _git(["commit", "-m", f"merge: publish approved edits on {ch}"], repo_dir)
                url = f"https://x-access-token:{token}@github.com/{remote_repo}.git"
                _git(["push", url, f"HEAD:{base_branch}"], repo_dir)
    else:
        # in-repo (workspace) source: write merged files into <prefix>source/ on the data-repo main;
        # the workflow's final commit lands them together with content/review/queue writeback.
        src_rel = os.path.relpath(source_dir, repo_dir)
        for rel, txt in changed.items():
            fp = Path(repo_dir) / os.path.normpath(os.path.join(src_rel, rel))
            fp.parent.mkdir(parents=True, exist_ok=True)
            fp.write_text(txt, encoding="utf-8")
    # rebuild the published reading view from the merged source, then drop the branch + its preview
    build_content(prefix, ch, source_dir, workdir)
    _delete_branch(repo_dir, branch, token, remote_repo)
    try:
        Path(R.preview_out(prefix, ch)).unlink()
    except FileNotFoundError:
        pass
    print(f"[apply] merge {prefix}{ch}: published {len(merged)} approved edit(s)")
    return new_review


HANDLED_TYPES = ("apply-direct", "apply-edits", "run-agents", "merge")


def process_project(prefix, this_repo, token, base_branch="main", claude_fn=None, agent_fn=None):
    """Drain the review jobs for one project prefix: apply-direct (deterministic), apply-edits and
    run-agents (Claude), and merge (author-triggered publish).

    ``claude_fn(task)`` and ``agent_fn(agent_id, task)`` are the Claude boundaries (defaults: the
    Claude Code CLI), injected so the finalize logic is testable without a live model. Claude jobs
    are skipped (left queued) when Claude is not configured — honest "nothing runs until set up".
    Returns the number of jobs processed.
    """
    if claude_fn is None:
        claude_fn = run_claude_cli
    if agent_fn is None:
        agent_fn = run_agent_cli
    jobs = R.load_json(R.jobs_path(prefix), [])
    if not isinstance(jobs, list):
        return 0
    todo = [j for j in jobs if j.get("type") in HANDLED_TYPES and j.get("status") != "done"]
    if not todo:
        return 0

    project = ci_render.project_entry(prefix)
    kind, ref = ci_render.resolve_source(project, prefix, this_repo,
                                         os.environ.get("SOURCE_REPO", ""))
    if kind == "clone":
        workdir = Path(os.environ.get("RUNNER_TEMP", "/tmp")) / f"src-{prefix.rstrip('/') or 'root'}"
        if not workdir.exists():
            ci_render._clone(ref, workdir, token)
        repo_dir, source_dir, remote_repo = workdir, workdir, ref
    else:
        # in-repo (workspace) source: branch lives on THIS data repo, source under <prefix>source/
        repo_dir, source_dir, remote_repo = Path(".").resolve(), Path(ref).resolve(), None

    import tempfile
    build_root = Path(tempfile.mkdtemp(prefix="footnote-apply-"))
    have_claude = claude_configured(os.environ)
    done = 0
    for job in todo:
        ch = job.get("chapter")
        review = R.load_json(R.review_path(prefix, ch), {"comments": []})
        files = read_text_files(source_dir)

        if job.get("type") == "merge":
            new_review = publish_merge(prefix, ch, job, review, files,
                                       source_dir, repo_dir, remote_repo, token, base_branch, build_root)
            _write_json(R.review_path(prefix, ch), new_review)
            jobs = R.remove_job(jobs, job.get("id"))
            done += 1
            continue

        if job.get("type") == "run-agents":
            if not have_claude:
                print(f"[apply] {prefix}{ch}: run-agents queued but Claude not configured "
                      f"(connect Claude Code: set CLAUDE_CODE_OAUTH_TOKEN) — leaving job", file=sys.stderr)
                continue
            task = R.build_apply_task(job, review, files)
            outputs = {a: (agent_fn(a, task) or []) for a in (job.get("agents") or [])}
            jid = job.get("id")
            new_review = R.process_run_agents_job(job, review, outputs, _now_iso(),
                                                  idgen=lambda i, j=jid: f"a_{j}_{i}")
            _write_json(R.review_path(prefix, ch), new_review)
            jobs = R.remove_job(jobs, job.get("id"))
            done += 1
            continue

        if job.get("type") == "apply-edits":
            if not have_claude:
                print(f"[apply] {prefix}{ch}: apply-edits queued but Claude not configured "
                      f"(connect Claude Code: set CLAUDE_CODE_OAUTH_TOKEN) — leaving job", file=sys.stderr)
                continue
            task = R.build_apply_task(job, review, files)
            edits = claude_fn(task) or {}
            new_review, new_files, branch, applied = R.process_apply_edits_job(
                job, review, files, edits, _now_iso())
            msg = f"apply-edits: stage Claude edits on {ch}"
        else:
            new_review, new_files, branch, applied = R.process_apply_direct_job(
                job, review, files, _now_iso())
            msg = f"apply-direct: stage edits on {ch}"

        if applied:
            # read_text_files keys are source_dir-relative; the branch commit needs them repo_dir-
            # relative (workspace source sits under <prefix>source/, external clone at root).
            src_rel = os.path.relpath(source_dir, repo_dir)
            changed = {os.path.normpath(os.path.join(src_rel, rel)): txt
                       for rel, txt in new_files.items() if files.get(rel) != txt}
            # preview from the branch's edited source (after_commit runs on-branch) — the author
            # reviews the rendered change before approving. Nothing merges here (oversight gate).
            commit_branch(repo_dir, branch, changed, base_branch, msg,
                          token=token, remote_repo=remote_repo, push=True,
                          after_commit=lambda c=ch: build_preview(prefix, c, source_dir, build_root))
        _write_json(R.review_path(prefix, ch), new_review)
        jobs = R.remove_job(jobs, job.get("id"))
        done += 1
    _write_json(R.jobs_path(prefix), jobs)
    print(f"[apply] {prefix or '(root)'}: processed {done} job(s)")
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
