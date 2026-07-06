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


# --------------------------------------------------------------- apply-edits (Claude-authored)
# The apply-edits path is the one place Claude writes. Claude never mutates files directly: it reads
# the chapter + comments (build_apply_task) and returns per-comment edit SPECS, which this tested
# deterministic code applies via literal_replace and stages on the review branch for author approval.
# Author-oversight invariant: Claude output only ever becomes a staged edit on review-edits/<unit>.

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
    return {"chapter": job.get("chapter"), "source": dict(files), "comments": out_comments}


def stage_claude_edit(comment, branch, ts, response, prose_before, prose_after):
    """A comment STAGED from a Claude edit: records Claude's response text and the reader-facing
    diff (prose before/after Claude reported), on the review branch. Input not mutated."""
    out = dict(comment)
    out["status"] = "staged"
    out["claude"] = {**(comment.get("claude") or {}),
                     "branch": branch, "response": response, "ts": ts}
    out["staged_edit"] = {"before": prose_before or "", "after": prose_after or ""}
    return out


def answer_comment(comment, ts, response):
    """A comment ANSWERED by Claude without a source edit (e.g. a question) — records the response,
    terminal-for-display status 'answered', no staged_edit. Input not mutated."""
    out = dict(comment)
    out["status"] = "answered"
    out["claude"] = {**(comment.get("claude") or {}), "response": response, "ts": ts}
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
                                             spec.get("prose_before"), spec.get("prose_after"))
            applied = True
        else:
            updated[cid] = answer_comment(comment, ts, response)
    new_comments = [updated.get(c.get("id"), c) for c in (review.get("comments") or [])]
    return {**review, "comments": new_comments}, work, branch, applied
