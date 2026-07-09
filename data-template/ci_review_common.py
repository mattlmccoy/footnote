#!/usr/bin/env python3
"""ci_review_common.py — shared pure core for the Claude round-trip backend.

Runs on the ADOPTER's own GitHub Actions. This module holds only pure, side-effect-free
helpers (job/comment plumbing, the deterministic edit application, the project-prefix
routing) so they can be unit-tested under pytest. The git checkout/commit/clone I/O and
the Claude invocation live in the engine scripts (ci_apply.py, ci_merge.py, ci_agents.py)
behind a thin, mockable boundary; the real Claude run is verified live on Actions.

Data layout mirrors the front-end (js/gh.js, js/config.js): per project there is a
``<prefix>jobs.json`` queue and ``<prefix>reviews/<unit>.json`` review files, where
``<prefix>`` is "" for a legacy root project or "<id>/" for a workspace subfolder.
"""
import glob
import json
import os


def apply_prefixes():
    """Which project subtrees have a job queue to drain. Keys off ``jobs.json`` (a project can have
    queued jobs independent of whether reviewers are configured), mirroring
    ci_render.render_prefixes(). Returns [""] for a legacy root, ["<id>/", …] for workspace
    subfolders (sorted), dual-mode so one workflow serves both layouts."""
    out = []
    if os.path.exists("jobs.json"):
        out.append("")
    for p in sorted(glob.glob("*/jobs.json")):
        out.append(p.split(os.sep)[0] + "/")
    return out


def load_json(path, default):
    """Read JSON at ``path``, returning ``default`` if it is missing or malformed."""
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return default


class EditConflict(Exception):
    """A deterministic edit could not be applied unambiguously — the target text was
    absent or appeared more than once. The comment is marked ``conflict`` rather than
    guessing which occurrence the reviewer meant."""


def literal_replace(text, find, replacement):
    """Replace the SINGLE occurrence of ``find`` in ``text`` with ``replacement``.

    Refuses (raises EditConflict) when ``find`` occurs zero or more than one time — a
    verbatim owner edit must map to exactly one location, or a human decides. Port of
    process-reviews.py ``_literal_replace``, generalized off any file/path assumptions.
    """
    count = text.count(find)
    if count != 1:
        raise EditConflict(
            f"expected exactly one occurrence of the target text, found {count}"
        )
    return text.replace(find, replacement)


def is_degenerate_content(new_text, prev_text, min_bytes=200, max_shrink=0.6):
    """Guard a freshly-built ``content/<unit>.html`` before it replaces the last-good file.

    Returns ``(degenerate: bool, reason: str)``. The 2026-07-08 incident published 253-byte
    stub files ("5") over real chapters because the build exited 0 but produced garbage — the
    exit code cannot catch that; only inspecting the OUTPUT can. A build is degenerate when:
      - it is empty / whitespace-only, or
      - a last-good version exists and the new output lost more than ``max_shrink`` of it
        (the incident: KB/MB chapter -> 253 bytes), or
      - there is no last-good and the output is below ``min_bytes`` (a real rendered unit
        fragment is a heading + prose; a sub-200-byte first build is almost certainly broken).
    A similar-size or larger rebuild is never degenerate. Thresholds are parameters so callers
    (and tests) can tune strictness. Pure — the caller does build-to-temp then swap-or-keep.
    """
    new = new_text or ""
    if not new.strip():
        return True, "empty output"
    prev = prev_text or ""
    if prev.strip():
        floor = len(prev) * (1.0 - max_shrink)
        if len(new) < floor:
            pct = int((1.0 - len(new) / len(prev)) * 100)
            return True, f"shrank {pct}% (from {len(prev)} to {len(new)} bytes) vs last-good"
    elif len(new) < min_bytes:
        return True, f"suspiciously small first build ({len(new)} bytes < {min_bytes})"
    return False, ""


# ------------------------------------------------------- local/cloud processing hard gate

def resolve_processing_mode(marker):
    """Resolve a parsed ``mode.json`` marker to ``"cloud"`` or ``"local"``.

    Returns ``"cloud"`` ONLY when the marker is a dict that explicitly says so; a missing
    (None), malformed, or local marker resolves to ``"local"``. Default-local is deliberate:
    a repo with no marker keeps the cloud write CI inert until cloud is explicitly chosen, so
    the two routes can never both be live (the 2026-07-08 collision). Pure — the caller reads
    ``<prefix>mode.json`` and passes the parsed value in.
    """
    if isinstance(marker, dict) and str(marker.get("processingMode", "")).strip().lower() == "cloud":
        return "cloud"
    return "local"


def cloud_enabled_marker(marker):
    """True iff a parsed marker selects cloud processing (see resolve_processing_mode)."""
    return resolve_processing_mode(marker) == "cloud"


def processing_mode(prefix=""):
    """The processing mode for a project from its committed ``<prefix>mode.json`` (default local)."""
    return resolve_processing_mode(load_json(f"{prefix}mode.json", None))


def cloud_enabled(prefix=""):
    """True iff this project is in cloud mode — the gate every cloud write workflow checks."""
    return processing_mode(prefix) == "cloud"


# ------------------------------------------------------- local operator changelist (pure)

_CHANGELIST_TYPES = ("apply-edits", "apply-direct", "run-agents", "merge", "export")


def changelist(jobs, reviews_by_unit, source_exists):
    """Structured view of the queued jobs for the local operator CLI (the `list` command).

    Pure port of process-reviews.py cmd_list: the CLI colors/prints; this decides WHAT to show.
    ``jobs`` is jobs.json; ``reviews_by_unit`` maps unit id -> its review dict; ``source_exists``
    is ``fn(unit_id) -> bool`` (does the unit's source file exist). Returns a list of row dicts
    (only queued, known-type jobs), each: ``{id, unit, type, source_ok}`` plus, per type,
    ``comments`` (apply-edits/apply-direct — each {id, tag, section, quote, edit, body, ask}),
    ``agents`` (run-agents), or ``formats`` (export).
    """
    rows = []
    for j in jobs or []:
        if not isinstance(j, dict) or j.get("status") == "done":
            continue
        jtype = j.get("type")
        if jtype not in _CHANGELIST_TYPES:
            continue
        unit = j.get("chapter") or j.get("unit")
        row = {"id": j.get("id"), "unit": unit, "type": jtype,
               "source_ok": bool(source_exists(unit))}
        if jtype == "run-agents":
            row["agents"] = list(j.get("agents") or [])
        elif jtype == "export":
            row["formats"] = list(j.get("formats") or [])
        elif jtype in ("apply-edits", "apply-direct"):
            review = reviews_by_unit.get(unit) or {}
            wanted = set(j.get("comment_ids") or [])
            out = []
            for c in review.get("comments", []):
                if wanted and c.get("id") not in wanted:
                    continue
                anchor = c.get("anchor") or {}
                out.append({
                    "id": c.get("id"),
                    "tag": c.get("tag", "?"),
                    "section": anchor.get("section", ""),
                    "quote": (anchor.get("quote", "") or "").replace("\n", " ")[:90],
                    "edit": c.get("edit"),
                    "body": (c.get("body", "") or "").strip(),
                    "ask": (c.get("body", "") or "").strip() if not c.get("edit") else "",
                })
            row["comments"] = out
        rows.append(row)
    return rows


# --------------------------------------------------------------- job / comment plumbing

def remove_job(jobs, job_id):
    """Return a new job list with ``job_id`` dropped (input untouched). The backend
    removes a job once it has processed it, so the queue drains to empty."""
    return [j for j in jobs if j.get("id") != job_id]


def comments_by_id(review, ids):
    """The review's comment dicts matching ``ids``, in the order ``ids`` gives, skipping
    any id with no matching comment (a stale reference is ignored, not fatal)."""
    by_id = {c.get("id"): c for c in (review.get("comments") or [])}
    return [by_id[i] for i in ids if i in by_id]


# --------------------------------------------------------------- data-repo paths

def jobs_path(prefix):
    """The per-project job queue: ``<prefix>jobs.json`` (matches js/gh.js dp('jobs.json'))."""
    return f"{prefix}jobs.json"


def review_path(prefix, unit_id):
    """A unit's review file: ``<prefix>reviews/<unit>.json`` (matches js/gh.js reviewPath)."""
    return f"{prefix}reviews/{unit_id}.json"


def preview_out(prefix, unit_id):
    """The branch-preview reading view: ``<prefix>preview/<unit>.html`` (matches js/app.js
    dpath('preview/…')). Distinct from ``<prefix>content/<unit>.html``, the merged/published view
    the render pipeline writes — preview shows the review-edits/<unit> branch without merging."""
    return f"{prefix}preview/{unit_id}.html"


# --------------------------------------------------------------- apply-direct (deterministic)
# The apply-direct path applies an owner's VERBATIM edit — no Claude. It must keep working with the
# AI assistant OFF: the front-end (js/app.js stageDirectEdit) writes a comment with
# edit:{op:'replace', find, replacement} plus prose_before/prose_after; the backend applies the
# literal source replacement on the review-edits/<unit> branch and stages the reader diff.

def apply_comment_edit(source_text, comment):
    """Apply one comment's verbatim ``edit`` to ``source_text`` and return the new text.

    Raises EditConflict when the target text is absent or ambiguous (caller marks the comment
    ``conflict``). Only 'replace' is applied literally today; that is what the pencil editor emits.
    """
    edit = comment.get("edit") or {}
    return literal_replace(source_text, edit.get("find", ""), edit.get("replacement", ""))


def stage_direct_edit(comment, branch, ts):
    """A new comment marked STAGED on ``branch`` with the reader-facing track-changes diff.

    The diff (staged_edit.before/after) is the prose the front-end captured (prose_before/after),
    so the reviewer sees a clean reading-view change rather than raw LaTeX. Pure: ``ts`` is passed
    in and the input comment is not mutated.
    """
    out = dict(comment)
    out["status"] = "staged"
    out["claude"] = {**(comment.get("claude") or {}), "branch": branch, "ts": ts}
    out["staged_edit"] = {
        "before": comment.get("prose_before", ""),
        "after": comment.get("prose_after", ""),
    }
    return out


def conflict_comment(comment, reason, ts):
    """A new comment marked CONFLICT (the edit could not be applied), carrying the reason for the
    author. No staged_edit — there is nothing to preview. Input not mutated."""
    out = dict(comment)
    out["status"] = "conflict"
    out["claude"] = {**(comment.get("claude") or {}), "reason": reason, "ts": ts}
    out.pop("staged_edit", None)
    return out


def branch_for(unit_id):
    """The review branch for a unit: ``review-edits/<unit>`` (author-oversight invariant — every
    edit lands here, never on the source main)."""
    return f"review-edits/{unit_id}"


def apply_direct_to_files(files, comment):
    """Apply one comment's verbatim edit across a map of ``{path: text}``, returning
    ``(new_files, edited_path)``. Exactly one file must contain exactly one occurrence of the
    target; zero or several matching files raise EditConflict (we never guess). Input not mutated.
    """
    edit = comment.get("edit") or {}
    find = edit.get("find", "")
    hits = [p for p, text in files.items() if find and text.count(find) >= 1]
    if len(hits) != 1:
        raise EditConflict(
            f"expected the target text in exactly one source file, found it in {len(hits)}"
        )
    path = hits[0]
    new_files = dict(files)
    new_files[path] = literal_replace(files[path], find, edit.get("replacement", ""))
    return new_files, path


def process_apply_direct_job(job, review, files, ts):
    """Process one deterministic apply-direct job against a chapter's review + source files.

    For each referenced comment, apply its verbatim edit to the working source map and mark the
    comment STAGED on the review branch; a comment whose target is absent/ambiguous is flagged
    CONFLICT and left unapplied. Returns ``(new_review, new_files, branch, applied)`` where
    ``applied`` is True iff at least one edit landed (so the caller knows whether to commit).
    Pure: no git, no clock — ``ts`` is injected and inputs are not mutated.
    """
    branch = branch_for(job.get("chapter"))
    work = dict(files)
    by_id = {c.get("id"): c for c in (review.get("comments") or [])}
    updated = dict(by_id)
    applied = False
    for cid in job.get("comment_ids") or []:
        comment = by_id.get(cid)
        if comment is None:
            continue
        try:
            work, _ = apply_direct_to_files(work, comment)
            updated[cid] = stage_direct_edit(comment, branch, ts)
            applied = True
        except EditConflict as e:
            updated[cid] = conflict_comment(comment, str(e), ts)
    new_comments = [updated.get(c.get("id"), c) for c in (review.get("comments") or [])]
    return {**review, "comments": new_comments}, work, branch, applied


# --------------------------------------------------------------- approve -> merge
# Merge is the ONE place edits become permanent, and it is author-triggered only (the front-end sets
# approved comments to status 'approved' and queues a merge job; reject -> 'declined', revise ->
# 're-queued'). Partial approval on a shared per-unit branch is handled by NOT merging the branch:
# instead we reapply ONLY the approved comments' source edits to main from scratch, so rejected edits
# never land. A comment's source edit is its verbatim ``edit`` (apply-direct) or ``source_edit``
# (Claude) — the same shape, so both merge uniformly.

def process_run_agents_job(job, review, outputs_by_agent, ts, idgen):
    """Append read-only critique comments produced by the review agents. ``outputs_by_agent`` maps
    each agent id to a list of finding specs ({quote, body, tag, section?}); each becomes a comment
    authored by that agent (author=<agentId>), status 'open' so it surfaces like a reviewer comment
    for the owner to act on. Agents NEVER edit source — they only add comments. ``idgen(i)`` supplies
    unique ids (injected for tests). Pure: inputs not mutated."""
    added = []
    i = 0
    for agent in (job.get("agents") or []):
        for spec in (outputs_by_agent.get(agent) or []):
            added.append({
                "id": idgen(i),
                "author": agent,
                "kind": "text",
                "status": "open",
                "anchor": {"quote": spec.get("quote", ""), "section": spec.get("section", ""),
                           "synctex": None, "rects": [], "figure": None, "confirmed": False},
                "tag": spec.get("tag", "other"),
                "body": spec.get("body", ""),
                "claude": {"branch": None, "commit": None, "response": None,
                           "resolved_line": None, "ts": None},
                "created_ts": ts,
            })
            i += 1
    return {**review, "comments": [*(review.get("comments") or []), *added]}


def comment_source_edit(comment):
    """The {find, replacement} source edit for a comment, from ``edit`` (apply-direct) or
    ``source_edit`` (Claude apply-edits), or None if it carries neither."""
    spec = comment.get("edit") or comment.get("source_edit")
    if not spec or spec.get("find") is None:
        return None
    return {"find": spec.get("find"), "replacement": spec.get("replacement", "")}


def process_merge_job(job, review, files, ts):
    """Publish the APPROVED edits for a unit. Reapplies each approved comment's source edit to the
    working files via literal_replace (rejected/other comments are ignored, so their edits never
    land), marks the applied comments ``merged``, and flags any whose target is missing/ambiguous
    ``conflict``. Returns ``(new_review, new_files, merged_ids, drop_branch)`` where ``drop_branch``
    is True when no comment is left ``staged``, ``approved``, or ``queued`` — i.e. the review-edits/
    <unit> branch and its preview are now orphaned and the caller should delete them (covers a pure
    rejection, where nothing is approved but the staged edits must still be cleaned up, and the normal
    post-merge case). A ``queued`` comment keeps the branch: a pending revise re-run will re-stage it.
    Pure: ``ts`` injected, inputs untouched. The caller writes new_files to the source main and
    republishes content/<unit>.html."""
    work = dict(files)
    by_id = {c.get("id"): c for c in (review.get("comments") or [])}
    updated = dict(by_id)
    merged = []
    for c in (review.get("comments") or []):
        if c.get("status") != "approved":
            continue
        cid = c.get("id")
        edit = comment_source_edit(c)
        if not edit:                                   # approved but no source change (e.g. answered)
            updated[cid] = {**c, "status": "merged"}
            merged.append(cid)
            continue
        find = edit["find"]
        hits = [p for p, text in work.items() if find and text.count(find) >= 1]
        if len(hits) != 1:
            updated[cid] = conflict_comment(c, f"approved edit's target matched {len(hits)} files", ts)
            continue
        try:
            work[hits[0]] = literal_replace(work[hits[0]], find, edit["replacement"])
        except EditConflict as e:
            updated[cid] = conflict_comment(c, str(e), ts)
            continue
        updated[cid] = {**c, "status": "merged"}
        merged.append(cid)
    new_comments = [updated.get(c.get("id"), c) for c in (review.get("comments") or [])]
    drop_branch = not any(c.get("status") in ("staged", "approved", "queued") for c in new_comments)
    return {**review, "comments": new_comments}, work, merged, drop_branch


# --------------------------------------------------------------- apply-edits (Claude-authored)
# The apply-edits path is the one place Claude writes. Claude never mutates files directly: it reads
# the chapter + comments (build_apply_task) and returns per-comment edit SPECS, which this tested
# deterministic code applies via literal_replace and stages on the review branch for author approval.
# Author-oversight invariant: Claude output only ever becomes a staged edit on review-edits/<unit>.

def author_source(files):
    """The author-editable subset of a source tree for Claude's context: ``.tex`` and ``.bib`` only.
    Drops vendored/build files (``.cls``/``.sty``/``.bbl``/``.bst``/``.txt``) Claude never edits —
    keeping the prompt small (a class file alone can be tens of KB, which blew the CLI arg-size limit)
    and focused on the manuscript. Applying still runs over the full tree; this only trims what
    Claude sees."""
    return {p: t for p, t in (files or {}).items() if p.lower().endswith((".tex", ".bib"))}


def build_apply_task(job, review, files):
    """Package what Claude needs to act on an apply-edits job: the unit id, the source files, and
    each referenced comment flattened to the fields Claude reasons over (anchor quote/section, tag,
    body/ask, any revise_note or verbatim edit, from_advisor attribution). Pure — the transport
    (writing it for the Claude Code Action) lives in the engine script."""
    out_comments = []
    for c in comments_by_id(review, job.get("comment_ids") or []):
        out_comments.append({
            "id": c.get("id"),
            "quote": (c.get("anchor") or {}).get("quote", ""),
            "section": (c.get("anchor") or {}).get("section", ""),
            "tag": c.get("tag", ""),
            "body": c.get("body", ""),
            "revise_note": c.get("revise_note", ""),
            "edit": c.get("edit"),
            "from_advisor": c.get("from_advisor"),
        })
    return {"chapter": job.get("chapter"), "source": dict(files), "comments": out_comments,
            "revision": bool(job.get("revision")), "revise_note": job.get("revise_note", "")}


def stage_claude_edit(comment, branch, ts, response, prose_before, prose_after,
                      source_before=None, source_after=None):
    """A comment STAGED from a Claude edit: records Claude's response, the reader-facing diff (prose
    before/after), AND the SOURCE diff as ``source_edit`` (mirroring apply-direct's ``edit``) so
    merge can reapply only the approved comments' source edits from main. Input not mutated."""
    out = dict(comment)
    out["status"] = "staged"
    out["claude"] = {**(comment.get("claude") or {}),
                     "branch": branch, "response": response, "ts": ts}
    out["staged_edit"] = {"before": prose_before or "", "after": prose_after or ""}
    if source_before is not None and source_after is not None:
        out["source_edit"] = {"op": "replace", "find": source_before, "replacement": source_after}
    return out


def answer_comment(comment, ts, response):
    """A comment ANSWERED by Claude without a source edit (e.g. a question) — records the response,
    terminal-for-display status 'answered', no staged_edit. Input not mutated."""
    out = dict(comment)
    out["status"] = "answered"
    out["claude"] = {**(comment.get("claude") or {}), "response": response, "ts": ts}
    return out


def note_comment(comment, ts, response, before="", after=""):
    """Attach an explanation to a comment WITHOUT changing its status (e.g. how a staged edit was
    made). Optionally records the in-context ``staged_edit`` diff the reviewer renders inline.
    Pure — input not mutated. Port of process-reviews.py cmd_note."""
    out = dict(comment)
    out["claude"] = {**(comment.get("claude") or {}), "response": response, "ts": ts}
    if before or after:
        out["staged_edit"] = {"before": before, "after": after}
    return out


def decide_comment(comment, ts, decision, note=""):
    """Record an owner decision (approve|reject|revise) on a comment. Pure — input not mutated.
    Port of process-reviews.py cmd_decide."""
    out = dict(comment)
    out["decision"] = decision
    out["decision_ts"] = ts
    if note:
        out["decision_note"] = note
    return out


def process_apply_edits_job(job, review, files, edits_by_id, ts):
    """Apply Claude's edit specs for one apply-edits job. For each referenced comment:
      * a spec with a source change → apply source_before→source_after via literal_replace on the
        working files and stage it (response + prose diff); an absent/ambiguous target → conflict;
      * a spec with only a response (no source change) → 'answered';
      * no spec at all → left as-is (a later revision can retry).
    Returns ``(new_review, new_files, branch, applied)``. Pure: ``ts`` injected, inputs untouched.
    """
    branch = branch_for(job.get("chapter"))
    work = dict(files)
    by_id = {c.get("id"): c for c in (review.get("comments") or [])}
    updated = dict(by_id)
    applied = False
    for cid in job.get("comment_ids") or []:
        comment = by_id.get(cid)
        if comment is None:
            continue
        spec = edits_by_id.get(cid)
        if not spec:
            continue
        before, after = spec.get("source_before"), spec.get("source_after")
        response = spec.get("response", "")
        if before and after is not None and before != after:
            hits = [p for p, text in work.items() if text.count(before) >= 1]
            if len(hits) != 1:
                updated[cid] = conflict_comment(
                    comment, f"Claude's target text matched {len(hits)} files", ts)
                continue
            try:
                work[hits[0]] = literal_replace(work[hits[0]], before, after)
            except EditConflict as e:
                updated[cid] = conflict_comment(comment, str(e), ts)
                continue
            updated[cid] = stage_claude_edit(comment, branch, ts, response,
                                             spec.get("prose_before"), spec.get("prose_after"),
                                             source_before=before, source_after=after)
            applied = True
        else:
            updated[cid] = answer_comment(comment, ts, response)
    new_comments = [updated.get(c.get("id"), c) for c in (review.get("comments") or [])]
    return {**review, "comments": new_comments}, work, branch, applied
