#!/usr/bin/env python3
"""ci_authoring.py — B4 user-authored agents.

An owner describes an agent in plain language; Claude turns the description into a full Footnote agent
definition; it lands in the data repo's ``agents.json`` as a ``builtin:false`` DRAFT the owner reviews
before it can run. Pure helpers (directive, parse, id-sanitize, validate, normalize, merge, and the
``author_agent`` orchestration) are unit-tested; the live Claude call is the injectable ``generate_fn``.
"""
import json
import re

import ci_agents

# The Claude Code tools an authored agent may declare (a local runner enables exactly these).
KNOWN_TOOLS = frozenset({
    "Read", "Write", "Edit", "Bash", "Grep", "Glob", "WebFetch", "WebSearch", "TodoWrite",
})

# The authoring meta-prompt: turn the owner's brief into a strict JSON agent definition. The engine
# forces builtin:false + status:draft afterward, so this focuses on the perspective and shape.
AUTHOR_DIRECTIVE = (
    "You design a review agent for a document-review tool from a short description. The owner's name "
    "and brief are provided as JSON on stdin under REQUEST. Decide whether this is a read-only CRITIC "
    "(reads a document and returns comment findings) or a tool-using DOER (runs on the owner's own "
    "machine with tools), and write a strong, specific system prompt for it.\n\n"
    "Return ONLY a JSON object with keys:\n"
    "  displayName   a short human label\n"
    "  description   one line describing what it does\n"
    "  category      \"critic\" (read-only, adds comments) or \"doer\" (acts with tools)\n"
    "  execution     \"ci\" (runs in the cloud; critics only) or \"local\" (runs on the owner's machine)\n"
    "  systemPrompt  the agent's directive — concrete about what to look for or do\n"
    "  tools         array of tool names it needs (only for a doer/local agent; else [])\n"
    "  cwd           optional working directory for a local agent (omit if unknown)\n"
    "  triggers      array of edit-type hints (e.g. wording, claim, numbers, figure, structure)\n"
    "A read-only critic must be category \"critic\", execution \"ci\", tools []. Keep tools minimal."
)


def author_context(job):
    """The piped stdin (name + brief + any hints) for the authoring Claude call. Pure/testable."""
    req = {"name": job.get("name", ""), "brief": job.get("brief", ""),
           "hints": {k: job.get(k) for k in ("cwd", "wantsTools") if job.get(k) is not None}}
    return "REQUEST:\n" + json.dumps(req, ensure_ascii=False, indent=2)


def parse_authored_agent(raw):
    """Recover the generated definition dict from Claude's output (envelope / fenced / bare object).
    Returns a dict, or None if unparseable / not an object."""
    if isinstance(raw, dict):
        return raw
    text = raw if isinstance(raw, str) else ""
    try:
        env = json.loads(text)
        if isinstance(env, dict) and "result" in env:
            text = env["result"]
        elif isinstance(env, dict):
            return env
    except (ValueError, TypeError):
        pass
    m = re.search(r"```(?:json)?\s*(.*?)```", text or "", re.DOTALL)
    if m:
        text = m.group(1)
    m2 = re.search(r"\{.*\}", text or "", re.DOTALL)
    if m2:
        text = m2.group(0)
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else None
    except (ValueError, TypeError):
        return None


def sanitize_agent_id(name, taken):
    """A stable kebab-case slug for ``name``, unique against ``taken`` (which should include every
    existing id AND the builtin ids, so an authored agent can never shadow a builtin). Falls back to
    ``"agent"`` for an empty/garbage name; appends ``-2``, ``-3`` … on collision."""
    slug = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    slug = slug or "agent"
    blocked = set(taken) | set(ci_agents.builtin_catalog().keys())
    if slug not in blocked:
        return slug
    i = 2
    while f"{slug}-{i}" in blocked:
        i += 1
    return f"{slug}-{i}"


def validate_authored_agent(entry):
    """Check a (normalized) authored entry is safe to store. Returns ``(ok, reason)``."""
    if not isinstance(entry, dict):
        return False, "not an object"
    if not (entry.get("systemPrompt") or "").strip():
        return False, "empty systemPrompt"
    if entry.get("category") not in ("critic", "doer"):
        return False, "bad category"
    if entry.get("execution") not in ("ci", "local"):
        return False, "bad execution"
    tools = entry.get("tools", [])
    if not isinstance(tools, list) or any(t not in KNOWN_TOOLS for t in tools):
        return False, "unknown tool"
    if entry.get("builtin") is True:
        return False, "authored agents may not be builtin"
    return True, ""


def normalize_authored_agent(raw, brief, taken):
    """Coerce a generated definition into a clean, safe catalog entry: sanitized unique id, forced
    ``builtin:false`` / ``source:"authored"`` / ``status:"draft"``, contract by category, and defaulted
    metadata. The owner reviews + approves before it ever runs (status flips to active on approval)."""
    # Default only when the field is MISSING; pass a present-but-invalid value through so validation
    # rejects it (a garbage category signals Claude misunderstood — don't silently reshape it).
    category = raw.get("category") if raw.get("category") is not None else "critic"
    execution = raw.get("execution") if raw.get("execution") is not None else "ci"
    if category == "critic":
        execution = "ci"                                   # a read-only critic never needs local tools
    display = raw.get("displayName") or raw.get("id") or brief or "agent"
    tools = [t for t in (raw.get("tools") or []) if isinstance(t, str)] if category == "doer" else []
    entry = {
        "id": sanitize_agent_id(raw.get("id") or display, taken),
        "displayName": str(display)[:80],
        "description": str(raw.get("description") or "")[:200],
        "category": category,
        "execution": execution,
        "systemPrompt": raw.get("systemPrompt") or "",
        "tools": tools,
        "triggers": [t for t in (raw.get("triggers") or []) if isinstance(t, str)],
        "outputContract": "findings" if category == "critic" else "notes",
        "builtin": False,
        "source": "authored",
        "status": "draft",
        "brief": brief or "",
        "version": 1,
    }
    cwd = raw.get("cwd")
    if category == "doer" and isinstance(cwd, str) and cwd.strip():
        entry["cwd"] = cwd
    return entry


def merge_authored(catalog_list, entry):
    """Return a new ``agents.json`` list with ``entry`` added (or replaced in place if its id already
    exists). Every other entry — builtins mirror and other authored agents — is preserved untouched."""
    out = [dict(a) for a in (catalog_list or [])]
    for i, a in enumerate(out):
        if a.get("id") == entry.get("id"):
            out[i] = entry
            return out
    out.append(entry)
    return out


def author_agent(job, catalog_list, generate_fn):
    """Orchestrate one author-agent job: generate → parse → normalize → validate → merge.

    ``generate_fn(job)`` is the injectable Claude boundary (returns the raw generated definition, str
    or dict). Returns ``(new_catalog_list, entry, error)``: on success ``entry`` is the stored draft and
    ``error`` is None; on any failure the list is returned unchanged with ``entry=None`` and a reason.
    """
    parsed = parse_authored_agent(generate_fn(job))
    if not parsed:
        return catalog_list, None, "unparseable generation"
    taken = {a.get("id") for a in (catalog_list or [])}
    entry = normalize_authored_agent(parsed, job.get("brief", ""), taken)
    ok, reason = validate_authored_agent(entry)
    if not ok:
        return catalog_list, None, reason
    return merge_authored(catalog_list, entry), entry, None
