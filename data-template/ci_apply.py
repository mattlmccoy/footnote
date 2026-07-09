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
import ci_agents  # noqa: E402  (the shipped agent catalog + the pure directive resolver)
import ci_authoring  # noqa: E402  (B4 — generate a user-described agent into agents.json as a draft)

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

# The headless CLI reads the SHORT instruction as its `-p` argument and the (potentially large)
# manuscript as piped STDIN context — a whole paper exceeds the OS command-line arg limit, so it can't
# be an argv. CLAUDE_INSTRUCTIONS is the directive (argv); the TASK json goes on stdin (see claude_context).
CLAUDE_INSTRUCTIONS = (
    "You are a LaTeX copy-editor addressing reviewer comments on one document unit. The unit's source "
    "files and the reviewer comments are provided as JSON in the piped input (stdin) under TASK. For "
    "EACH comment, decide how to resolve it and return a machine-readable answer. Do NOT edit any files "
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
    "comment is a question, return only id + response."
)


def claude_context(task):
    """The apply-edits task (unit id, source files, comments) as the piped-stdin context. Pure/testable."""
    import json
    return "TASK:\n" + json.dumps(task, ensure_ascii=False, indent=2)


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


# The legacy generic directive is the back-compat fallback for any name not in the catalog. It now
# lives in ci_agents (single source) so the resolver and this module agree; re-exported here because
# tests and the resolver both reference it.
AGENT_INSTRUCTIONS = ci_agents.LEGACY_AGENT_INSTRUCTIONS


def agent_context(task):
    """The review unit as the piped-stdin context for a review agent. Pure/testable."""
    import json
    return "UNIT:\n" + json.dumps(task, ensure_ascii=False, indent=2)


def _run_claude(directive, context, model, label):
    """Run the headless Claude Code CLI: ``directive`` is the ``-p`` argument (short), ``context`` is the
    piped STDIN (the manuscript — too large for argv, which blew the OS arg-size limit). Returns stdout,
    or None on a missing CLI or non-zero exit so a broken/absent Claude leaves the job queued rather than
    crashing the whole drain."""
    model = model or os.environ.get("CLAUDE_MODEL") or "claude-opus-4-8"
    try:
        proc = subprocess.run(["claude", "-p", directive, "--output-format", "json", "--model", model],
                              input=context, capture_output=True, text=True)
    except OSError as e:
        print(f"[apply] {label}: claude CLI unavailable ({e}) — leaving job", file=sys.stderr)
        return None
    if proc.returncode != 0:
        print(f"[apply] {label}: claude CLI failed ({proc.returncode}): {proc.stderr[:300]}", file=sys.stderr)
        return None
    return proc.stdout


def run_agent_cli(agent_id, task, model=None, catalog=None, field=None):
    """Invoke Claude Code (headless) as one review agent; returns a (capped) list of finding specs.
    Thin, live-CI-gated boundary. The directive is resolved from the catalog (real system prompt) with
    a legacy fallback for unknown/bare names; findings are capped per agent (Q4 volume guard)."""
    directive = ci_agents.resolve_agent_directive(agent_id, catalog, field)
    out = _run_claude(directive, agent_context(task), model, f"agent {agent_id}")
    return ci_agents.cap_findings(parse_agent_findings(out)) if out is not None else []


def run_claude_cli(task, model=None):
    """Invoke Claude Code (headless) to produce edit specs for one apply-edits task. This is the thin,
    live-CI-gated boundary; the parse/prompt logic around it is pure and unit-tested. The directive is
    the -p arg and the manuscript is piped stdin; auth is the adopter's own Claude Code credential."""
    out = _run_claude(CLAUDE_INSTRUCTIONS, claude_context(task), model, "apply-edits")
    return parse_claude_edits(out) if out is not None else {}


def writer_directive(catalog=None, field="", writer_id="writer"):
    """The apply-edits directive spoken in the configured Writer/Editor DOER agent's voice: that agent's
    systemPrompt (its editing persona) prepended to the shared edit-output contract — so the CONFIGURED
    writer agent does the drafting, not a generic copy-editor call, while still returning parseable edit
    specs. Falls back to the generic directive when no writer agent is configured."""
    cat = catalog if catalog is not None else ci_agents.builtin_catalog()
    sp = ((cat.get(writer_id) or {}).get("systemPrompt") or "")
    if ci_agents.FIELD_PLACEHOLDER in sp:
        sp = sp.replace(ci_agents.FIELD_PLACEHOLDER, field or ci_agents.DEFAULT_FIELD)
    if not sp.strip():
        return CLAUDE_INSTRUCTIONS
    return ("You are the document's Writer/Editor agent. Work in this persona:\n" + sp
            + "\n\nNow do that editing to resolve the reviewer comments, following this EXACT output "
              "contract:\n" + CLAUDE_INSTRUCTIONS)


def run_writer_cli(task, catalog=None, field="", writer_id="writer", model=None):
    """Produce apply-edits specs using the CONFIGURED Writer/Editor agent's prompt (not the generic
    copy-editor). Live-CI-gated boundary; the parse is pure."""
    out = _run_claude(writer_directive(catalog, field, writer_id), claude_context(task), model, "writer:" + writer_id)
    return parse_claude_edits(out) if out is not None else {}


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
    # start the branch from base — create if new, RESET onto base if it exists (-B does both). Without the
    # reset, an existing review-edits/<unit> branch stays behind main, so the preview builds from a stale
    # tree and `changed` (diffed against main) is applied onto divergent source. The approved-only merge
    # reapplies from main, so the branch never needs its own history.
    _git(["checkout", "-B", branch, base], repo_dir)
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
    only in source tree and output path. Goes through ci_render.build_guarded, so a failed OR
    degenerate build (the 2026-07-08 253-byte incident) keeps the last-good file instead of
    destroying it. Returns True when a new build was published."""
    rows = ci_render.load_units(prefix)
    entry = ci_render.derive_entry(rows)
    env = dict(os.environ,
               SOURCE_DIR=str(Path(source_dir).resolve()),
               CHAPTERS_JSON=str(Path(f"{prefix}chapters.json").resolve()),
               RENDER_ENTRY=entry,
               BUILD_DIR=str((Path(workdir) / "build" / (prefix.rstrip("/") or "root")).resolve()))
    return ci_render.build_guarded(unit_id, out_path, env, workdir, label)


def build_preview(prefix, unit_id, source_dir, workdir):
    """Branch preview → ``<prefix>preview/<unit>.html`` (the review-edits view, distinct from content/).
    Returns True when a new (non-degenerate) preview was published, else keeps last-good."""
    return _build_unit(prefix, unit_id, source_dir, R.preview_out(prefix, unit_id), workdir, "preview")


def build_content(prefix, unit_id, source_dir, workdir):
    """Published reading view → ``<prefix>content/<unit>.html`` (rebuilt from merged main source).
    Returns True when a new (non-degenerate) content file was published, else keeps last-good."""
    return _build_unit(prefix, unit_id, source_dir, ci_render.content_out(prefix, unit_id), workdir, "content")


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
    new_review, new_files, merged, drop_branch = R.process_merge_job(job, review, files, _now_iso())
    branch = R.branch_for(ch)
    if not merged and not drop_branch:
        print(f"[apply] merge {prefix}{ch}: nothing approved to publish", file=sys.stderr)
        return new_review
    if not merged:
        # pure rejection: nothing published to main, but the orphaned review branch + preview
        # must still be cleaned up so the reviewer's rejection actually resolves the unit.
        print(f"[apply] merge {prefix}{ch}: no approved edits — clearing rejected review branch")
        _delete_branch(repo_dir, branch, token, remote_repo)
        try:
            Path(R.preview_out(prefix, ch)).unlink()
        except FileNotFoundError:
            pass
        return new_review
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
    # UNLESS undecided edits still remain staged (drop_branch=False keeps the branch alive for them).
    build_content(prefix, ch, source_dir, workdir)
    if drop_branch:
        _delete_branch(repo_dir, branch, token, remote_repo)
        try:
            Path(R.preview_out(prefix, ch)).unlink()
        except FileNotFoundError:
            pass
    print(f"[apply] merge {prefix}{ch}: published {len(merged)} approved edit(s)"
          + ("" if drop_branch else " — branch kept (undecided edits remain)"))
    return new_review


HANDLED_TYPES = ("apply-direct", "apply-edits", "run-agents", "merge", "author-agent", "export", "response")


def _run_response_job(prefix, job, review, field, catalog):
    """Cloud response-letter job in the Review-Response Writer (responder) doer's voice: drafts a
    point-by-point, evidence-grounded response to the unit's reviewer comments and writes it to
    <prefix>responses/<unit>.md. Returns the path or None. Live-CI-gated (needs Claude)."""
    import json as _json
    unit = job.get("chapter")
    rid = job.get("responder") or "responder"
    sp = ((catalog.get(rid) or {}).get("systemPrompt") or "")
    if ci_agents.FIELD_PLACEHOLDER in sp:
        sp = sp.replace(ci_agents.FIELD_PLACEHOLDER, field or ci_agents.DEFAULT_FIELD)
    directive = ((sp or "You draft point-by-point, evidence-grounded responses to reviewer comments.")
                 + "\n\nWrite a clear point-by-point response letter in Markdown for the reviewer comments in "
                   "the piped input. For each comment: summarize it, then state how it was (or will be) "
                   "addressed, grounded in the document. Output ONLY the Markdown letter.")
    comments = [{"id": c.get("id"), "tag": c.get("tag"), "quote": (c.get("anchor") or {}).get("quote", ""),
                 "body": c.get("body", ""), "status": c.get("status")} for c in review.get("comments", [])]
    out = _run_claude(directive, _json.dumps({"unit": unit, "comments": comments}, ensure_ascii=False),
                      None, "responder:" + rid)
    if not out:
        return None
    path = Path(f"{prefix}responses/{unit}.md")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(out, encoding="utf-8")
    return str(path)


def _run_export_job(prefix, job, review, source_dir):
    """Cloud export (parity with the local `export` command): build docx (+md) of a unit WITH the
    reviewer comments, mirroring process_reviews.cmd_export. Reuses export/export-chapter.sh +
    annotate_docx.py + R.export_comment_list/annex_md. Writes artifacts under <prefix>exports/<unit>/;
    PDF is intentionally unsupported. Needs pandoc (+lxml for docx) — live-gated like render. Returns the
    artifact paths."""
    import json as _json
    import tempfile
    unit = job.get("chapter")
    formats = [f.strip() for f in (job.get("formats") or ["docx"]) if f.strip() and f.strip() != "pdf"]
    exportdir = ci_render.HERE / "export"
    advisor = []
    abase = Path(f"{prefix}advisor")
    if abase.is_dir():
        for adir in sorted(p for p in abase.iterdir() if p.is_dir()):
            f = adir / f"{unit}.json"
            if f.exists():
                advisor.append((adir.name, R.load_json(str(f), {"comments": []})))
    comments = R.export_comment_list(review, advisor)
    build = Path(tempfile.mkdtemp(prefix="footnote-export-"))
    env = dict(os.environ, SOURCE_DIR=str(source_dir),
               CHAPTERS_JSON=str(Path(f"{prefix}chapters.json").resolve()), BUILD_DIR=str(build))
    bib = Path(source_dir) / "references.bib"
    if bib.exists():
        env["BIB"] = str(bib)
    outdir = Path(f"{prefix}exports/{unit}")
    outdir.mkdir(parents=True, exist_ok=True)
    base = build / f"{unit}.docx"
    arts = []
    try:
        subprocess.run(["bash", str(exportdir / "export-chapter.sh"), unit, str(base)],
                       env=env, check=True, stdout=sys.stderr, stderr=sys.stderr)
        cj = build / "comments.json"
        cj.write_text(_json.dumps(comments), encoding="utf-8")
        if "docx" in formats:
            out = outdir / f"{unit}.docx"
            subprocess.run(["python3", str(exportdir / "annotate_docx.py"), str(base), str(cj), str(out)],
                           check=True, stdout=sys.stderr, stderr=sys.stderr)
            arts.append(str(out))
        if "md" in formats:
            body = subprocess.run(["pandoc", str(base), "-t", "gfm", "--wrap=none"], capture_output=True, text=True)
            (outdir / f"{unit}.md").write_text((body.stdout or "") + "\n\n---\n\n" + R.annex_md(unit, comments) + "\n",
                                               encoding="utf-8")
            arts.append(str(outdir / f"{unit}.md"))
    except Exception as e:
        print(f"[export] {unit}: failed ({e}) — leaving job for retry", file=sys.stderr)
    return arts


def _run_author_agent_jobs(prefix, author_jobs, jobs):
    """Generate each described agent into ``agents.json`` as a DRAFT (B4). Needs no source, so it runs
    before source resolution. Returns ``(jobs, done)`` with the author-agent jobs removed. A generation
    that fails to parse/validate is dropped with a logged reason (the owner can re-describe)."""
    have_claude = claude_configured(os.environ)
    if not have_claude:
        print(f"[apply] {prefix}: author-agent queued but Claude not configured — leaving job(s)",
              file=sys.stderr)
        return jobs, 0
    agents_list = R.load_json("agents.json", [])
    if not isinstance(agents_list, list):
        agents_list = []
    done = 0
    changed = False
    for job in author_jobs:
        gen = (lambda j: _run_claude(ci_authoring.AUTHOR_DIRECTIVE, ci_authoring.author_context(j),
                                     None, "author-agent"))
        agents_list, entry, err = ci_authoring.author_agent(job, agents_list, gen)
        if entry is not None:
            changed = True
            print(f"[apply] authored draft '{entry['id']}' — review it in Settings before it runs")
        else:
            print(f"[apply] author-agent failed: {err}", file=sys.stderr)
        jobs = R.remove_job(jobs, job.get("id"))
        done += 1
    if changed:
        _write_json("agents.json", agents_list)
    return jobs, done


def _emit(prefix, job_id, seq, phase, say, push=True, **kw):
    """Append one narrated progress event to <prefix>progress/<job>.jsonl in the DATA repo (CWD) and
    commit+push it [skip ci] so the portal's live view sees it as the job runs. progress/** is excluded
    from every workflow trigger, so this never loops. Best-effort: a failed push never fails the job."""
    import json
    ev = R.progress_event(job_id, seq, phase, say, ts=_now_iso(), **kw)
    path = f"{prefix}progress/{job_id}.jsonl"
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(ev, ensure_ascii=False) + "\n")
    if push:
        _git(["add", path], ".", check=False)
        if _git(["diff", "--cached", "--quiet"], ".", check=False).returncode != 0:
            _git(["commit", "-m", f"progress: {job_id} #{seq} [skip ci]"], ".", check=False)
            _git(["push", "origin", "HEAD"], ".", check=False)
    return ev


def _critic_reviews(agent_fn, review_agents, ch, spec, catalog, field):
    """Run each configured critic/adversary agent read-only over a proposed edit and return verdicts
    [{agent, approved, say}]. A critic that returns any finding is treated as raising a concern
    (approved=False); an empty finding list = approved. Reuses the existing agent boundary — no schema
    change. The agent_fn is injectable for tests."""
    verdicts = []
    task = {"chapter": ch, "proposed_edit": spec}
    for a in review_agents or []:
        try:
            findings = agent_fn(a, task) if agent_fn else run_agent_cli(a, task, catalog=catalog, field=field)
        except Exception as e:  # a broken agent must not sink the whole job
            findings = [{"body": f"agent error: {e}"}]
        findings = findings or []
        say = (findings[0].get("body") if findings else "no concerns")
        verdicts.append({"agent": a, "approved": not findings, "say": (say or "")[:200]})
    return verdicts


def _apply_edits_pipeline(prefix, job, review, files, source_dir, repo_dir, remote_repo, token,
                          base_branch, build_root, writer_call, agent_fn, catalog, review_agents, field):
    """Cloud apply-edits with agent parity + a narrated progress stream. Per comment: the configured
    writer agent drafts the edit (``writer_call(comment, task)`` picks the right doer — Figure Drafter for
    a figure comment, Writer/Editor otherwise), verify_refs gates it, the critic/adversary stack reviews
    it, and it is STAGED only if it applies + verifies + no critic objects — otherwise a per-comment
    CONFLICT (never a silent stub). Every step is narrated. Author-oversight preserved: staged edits only
    land on review-edits/<unit>. Returns (new_review, applied_count)."""
    ch = job.get("chapter")
    jid = job.get("id")
    ids = job.get("comment_ids") or []
    seq = [0]

    def ev(phase, say, **kw):
        e = _emit(prefix, jid, seq[0], phase, say, **kw)
        seq[0] += 1
        return e

    ev("read", f"Starting review of {len(ids)} comment(s) on {ch}.")
    work = dict(files)
    kept_review = review
    staged = 0
    conflicts = 0
    max_attempts = int(os.environ.get("REVISE_MAX", "2"))
    for cid in ids:
        comment = next((c for c in review.get("comments", []) if c.get("id") == cid), None)
        if comment is None:
            continue
        ev("read", f"Comment {cid}: {(comment.get('body', '') or '')[:140]}", comment=cid)
        revise_note, attempt, outcome = "", 1, None
        while outcome is None:
            # the configured writer DOER drafts this comment's edit (Figure Drafter for a figure comment,
            # else Writer/Editor); revisions re-ask it with the feedback — the same writer↔critic iteration
            # the local route runs.
            if attempt > 1:
                ev("agent", "Revising the edit based on the feedback…", comment=cid, agent="writer", status="running")
            wjob = {**job, "comment_ids": [cid]}
            if attempt > 1:
                wjob = {**wjob, "revision": True, "revise_note": revise_note}
            wtask = R.build_apply_task(wjob, kept_review, R.author_source(work))
            spec = (writer_call(comment, wtask) or {}).get(cid) or {}
            trial_review, trial_files, branch, applied = R.process_apply_edits_job(
                {**job, "comment_ids": [cid]}, kept_review, work, {cid: spec}, _now_iso())
            diff = {"before": spec.get("prose_before", ""), "after": spec.get("prose_after", "")}
            ev("agent", "Writer: " + (spec.get("response") or "proposed a change."),
               comment=cid, agent="writer", status="running", edit=diff)
            if not applied:
                kept_review = trial_review   # already marked conflict (couldn't anchor) or answered (question)
                st = next((c for c in trial_review["comments"] if c["id"] == cid), {}).get("status")
                ev("stage", "No source change staged (answered, or the edit could not be anchored).",
                   comment=cid, status="conflict" if st == "conflict" else "ok")
                if st == "conflict":
                    conflicts += 1
                break
            undefined = R.verify_refs("\n".join(trial_files.values()))
            if undefined:
                ev("verify", f"verify_refs found undefined references ({', '.join(undefined)}).",
                   comment=cid, agent="verify_refs", status="conflict")
                approved, reason = False, "undefined references: " + ", ".join(undefined)
            else:
                ev("verify", "References check out.", comment=cid, agent="verify_refs", status="ok")
                verdicts = _critic_reviews(agent_fn, review_agents, ch, spec, catalog, field)
                for v in verdicts:
                    ev("agent", f"{v['agent']}: {v['say']}", comment=cid, agent=v["agent"],
                       status="ok" if v["approved"] else "conflict")
                tally = R.critics_verdict(verdicts)
                approved = tally["approved"]
                reason = "; ".join(r["say"] for r in tally["rejections"])
            dec = R.revise_decision(approved, attempt, max_attempts)
            if dec == "stage":
                work, kept_review = trial_files, trial_review
                staged += 1
                ev("stage", f"Staged this change on review-edits/{ch} for your review.", comment=cid, status="ok")
                outcome = "staged"
            elif dec == "revise":
                revise_note, attempt = reason, attempt + 1
            else:
                kept_review = _mark_conflict(kept_review, cid, reason)
                conflicts += 1
                ev("stage", f"Couldn't satisfy the review after {attempt} attempt(s) — flagged for you: {reason}",
                   comment=cid, status="conflict")
                outcome = "conflict"

    if staged:
        src_rel = os.path.relpath(source_dir, repo_dir)
        changed = {os.path.normpath(os.path.join(src_rel, rel)): txt
                   for rel, txt in work.items() if files.get(rel) != txt}
        ev("build", "Building a preview of the staged changes…")
        commit_branch(repo_dir, R.branch_for(ch), changed, base_branch,
                      f"apply-edits: stage {staged} agent-reviewed edit(s) on {ch}",
                      token=token, remote_repo=remote_repo, push=True,
                      after_commit=lambda c=ch: build_preview(prefix, c, source_dir, build_root))
    _write_json(R.review_path(prefix, ch), kept_review)
    ev("done", f"Done — {staged} change(s) staged for your review, {conflicts} flagged as conflicts.")
    return kept_review, staged


def _mark_conflict(review, cid, reason):
    comments = [R.conflict_comment(c, reason, _now_iso()) if c.get("id") == cid else c
                for c in review.get("comments", [])]
    return {**review, "comments": comments}


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
    # HARD GATE: cloud apply runs ONLY when this project is explicitly in cloud mode. A missing/local
    # <prefix>mode.json (the default) makes the cloud engine inert so it can never collide with the
    # local process-reviews.py round-trip (the 2026-07-08 both-routes-live corruption). Clean skip, not
    # a failure — no red X, no email.
    if not R.cloud_enabled(prefix):
        print(f"[apply] {prefix or '(root)'}: processing mode is local — cloud apply inert (skipped)")
        return 0
    # agent_fn is left as passed: None means "use the catalog-aware default", which needs the loaded
    # catalog + per-job field bound in the run-agents branch below (an injected fake is used as-is).
    jobs = R.load_json(R.jobs_path(prefix), [])
    if not isinstance(jobs, list):
        return 0
    todo = [j for j in jobs if j.get("type") in HANDLED_TYPES and j.get("status") != "done"]
    if not todo:
        return 0

    # author-agent jobs (B4) need no source tree — handle them first, then skip the (expensive) source
    # resolution entirely if nothing else is queued.
    author_done = 0
    author_jobs = [j for j in todo if j.get("type") == "author-agent"]
    if author_jobs:
        jobs, author_done = _run_author_agent_jobs(prefix, author_jobs, jobs)
        todo = [j for j in todo if j.get("type") != "author-agent"]
        if not todo:
            _write_json(R.jobs_path(prefix), jobs)
            print(f"[apply] {prefix or '(root)'}: processed {author_done} author-agent job(s)")
            return author_done

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
    # The effective agent catalog: engine-owned builtins + any user-authored agents in the repo's
    # agents.json (repo-level, like the engine itself). Absent file → builtins only. Loaded once here.
    catalog = ci_agents.load_catalog("agents.json")
    done = author_done                                     # count the pre-pass author-agent jobs too
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

        if job.get("type") == "export":
            arts = _run_export_job(prefix, job, review, source_dir)
            jobs = [{**j, "status": "done", "done_ts": _now_iso(),
                     "artifacts": [{"path": a} for a in arts]} if j.get("id") == job.get("id") else j
                    for j in jobs]
            _write_json(R.jobs_path(prefix), jobs)
            print(f"[export] {prefix}{ch}: built {len(arts)} artifact(s)")
            done += 1
            continue

        if job.get("type") == "response":
            if not have_claude:
                print(f"[response] {prefix}{ch}: needs Claude — leaving job", file=sys.stderr)
                continue
            path = _run_response_job(prefix, job, review, job.get("field") or os.environ.get("DOC_FIELD") or "", catalog)
            if path:
                jobs = [{**j, "status": "done", "done_ts": _now_iso(), "artifacts": [{"path": path}]}
                        if j.get("id") == job.get("id") else j for j in jobs]
                _write_json(R.jobs_path(prefix), jobs)
                print(f"[response] {prefix}{ch}: wrote {path}")
                done += 1
            continue

        if job.get("type") == "run-agents":
            if not have_claude:
                print(f"[apply] {prefix}{ch}: run-agents queued but Claude not configured "
                      f"(connect Claude Code: set CLAUDE_CODE_OAUTH_TOKEN) — leaving job", file=sys.stderr)
                continue
            # A job carrying any LOCAL agent (tool-using, machine-bound) belongs to the local runner
            # (ci_local) — CI can't run it, so leave the whole job queued for the operator's local drain.
            agents = job.get("agents") or []
            if any(ci_agents.runnable_local(a, catalog) for a in agents):
                print(f"[apply] {prefix}{ch}: run-agents has local agent(s) — leaving for the local "
                      f"runner (ci_local) — skipping", file=sys.stderr)
                continue
            task = R.build_apply_task(job, review, R.author_source(files))
            # Resolve each selected agent's real system prompt via the catalog (legacy fallback for
            # unknown names). doc.field for the domain critic arrives on the job (client-supplied).
            field = job.get("field") or os.environ.get("DOC_FIELD") or ""
            resolver = agent_fn or (lambda aid, t: run_agent_cli(aid, t, catalog=catalog, field=field))
            # run-agents is READ-ONLY: skip any catalogued doer (writer/responder/…) and any local
            # agent so it can't run as a CI critic. Unknown/legacy names stay runnable (legacy prompt).
            selected = [a for a in agents if ci_agents.runnable_in_ci(a, catalog)]
            outputs = {a: (resolver(a, task) or []) for a in selected}
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
            field = job.get("field") or os.environ.get("DOC_FIELD") or ""
            configured = (job.get("review_agents")
                          or [s.strip() for s in os.environ.get("REVIEW_AGENTS", "").split(",") if s.strip()])
            # the critic/adversary gate: the configured agents that are CI-runnable (non-local, non-doer).
            review_agents = [a for a in configured if ci_agents.runnable_in_ci(a, catalog)]
            # The WRITER that drafts each edit is the configured DOER agent — Figure Drafter for a figure
            # comment (when configured), else Writer/Editor (builtin "writer" or the first configured doer).
            # Its persona drives the edit, NOT a generic call. An injected claude_fn (tests) wins.
            prose_writer = "writer" if "writer" in configured else next(
                (a for a in configured if (catalog.get(a) or {}).get("category") == "doer"), "writer")
            fig_writer = "figure-drafter" if "figure-drafter" in configured else prose_writer
            def _is_fig(c):
                return bool((c.get("anchor") or {}).get("figure")) or c.get("tag") == "figure"
            def writer_call(comment, wtask, _pw=prose_writer, _fw=fig_writer, _f=field):
                if claude_fn:
                    return claude_fn(wtask)
                return run_writer_cli(wtask, catalog, _f, _fw if _is_fig(comment) else _pw)
            _apply_edits_pipeline(prefix, job, review, files, source_dir, repo_dir, remote_repo, token,
                                  base_branch, build_root, writer_call, agent_fn,
                                  catalog, review_agents, field)
            jobs = R.remove_job(jobs, job.get("id"))
            done += 1
            continue

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
