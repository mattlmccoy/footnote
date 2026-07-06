#!/usr/bin/env python3
"""ci_agents.py — the shipped agent catalog + the pure resolver that turns a bare agent name in a
run-agents job into a REAL system-prompt directive, with legacy back-compat.

Runs on the ADOPTER's own GitHub Actions alongside ci_apply.py (pure, unit-tested here). Footnote is
document-agnostic: none of these prompts mentions any specific project, tool, or field — they are
generic read-only critics that add comments and NEVER edit source (the author-oversight invariant).

Store model (B1):
  * Builtins are ENGINE-OWNED and defined in this module, so improving a builtin's prompt upgrades
    every repo that receives the new engine (auto-upgrade, keyed on ``builtin``). A repo's agents.json
    can NOT override a builtin — it is authoritative only for user-authored (``builtin: false``)
    agents (B4) and is the mirror the browser client fetches for display (kept in sync by a test).
  * resolve_agent_directive falls back to the legacy generic prompt for any unknown/bare name, so an
    agent that predates the catalog runs exactly as before.
"""
import json

# The default per-agent finding cap (Q4 volume guard): a single run invokes one Claude call per
# selected agent and each can emit many findings, so the engine truncates each agent's list.
DEFAULT_MAX_FINDINGS = 20

# The fixed output contract the engine appends to EVERY resolved catalog prompt, so a catalog author
# can't forget it and parse_agent_findings stays uniform across the new and legacy paths.
AGENT_OUTPUT_CONTRACT = (
    "\n\nReturn ONLY a JSON array, one object per finding, with keys:\n"
    "  quote   a short EXACT substring of the source your finding is about (for anchoring)\n"
    "  body    your critique / suggestion in plain language\n"
    "  tag     a short category (e.g. rigor, clarity, evidence, style)\n"
    "  section (optional) the section or heading the finding falls under\n"
    "Return [] if you have no findings. This is READ-ONLY: report findings only, do NOT edit any files."
)

# The legacy generic directive — the ONLY prompt text before the catalog existed. Retained verbatim as
# the back-compat fallback for any name not in the catalog. ci_apply re-exports this as AGENT_INSTRUCTIONS.
LEGACY_AGENT_INSTRUCTIONS = (
    "You are the '{agent}' review agent. The document unit's source is provided as JSON in the piped "
    "input (stdin) under UNIT. Critique it from your perspective. This is READ-ONLY: do NOT edit any "
    "files — only report findings.\n\n"
    "Return ONLY a JSON array, one object per finding, with keys:\n"
    "  quote   a short EXACT substring of the source your finding is about (for anchoring)\n"
    "  body    your critique / suggestion in plain language\n"
    "  tag     a short category (e.g. rigor, clarity, evidence, style)\n"
    "Return [] if you have no findings."
)

# ``{field}`` in a systemPrompt is filled from the project's optional ``doc.field`` at resolve time
# (only the domain critic uses it). When no field is configured this neutral phrase is substituted so
# the prompt is never left with a broken placeholder.
FIELD_PLACEHOLDER = "{field}"
DEFAULT_FIELD = "this document's subject area"


# --------------------------------------------------------------- the shipped builtin critics
# All document-agnostic, category "critic", read-only, outputContract "findings". defaultOn marks the
# fresh-instance selection (5 on). docTypes/triggers are declared now but only consumed by B3 routing.
BUILTIN_AGENTS = [
    {
        "id": "rigor",
        "displayName": "Rigor Critic",
        "description": "Red-teams claims, numbers, figures, and scope for what won't survive scrutiny.",
        "category": "critic",
        "systemPrompt": (
            "You are a hostile-but-fair expert reviewer whose job is to find what will NOT survive "
            "scrutiny, before anyone else does. Attack, in priority order: (1) overclaims — every "
            "\"proves / demonstrates / confirms / validates / always / never\" where the evidence on "
            "the page is weaker than the verb; (2) claim-evidence mismatch — a conclusion the shown "
            "data, figure, or example does not actually support; (3) internal consistency — numbers, "
            "terms, or claims that disagree across the document; (4) logic — non-sequiturs, circular "
            "reasoning, conclusions that don't follow; (5) scope and honesty — results oversold, "
            "limitations missing or buried, \"future work\" doing load-bearing work. Every finding must "
            "name the exact offending text and give a concrete, actionable fix — you are not a troll. "
            "Assume nothing is true until the text shows it."
        ),
        "defaultOn": True,
        "docTypes": ["*"],
        "triggers": ["claim", "numbers", "scope"],
        "outputContract": "findings",
        "builtin": True,
        "version": 1,
    },
    {
        "id": "clarity",
        "displayName": "Clarity & Style Critic",
        "description": "Checks whether a careful reader gets the point on first pass.",
        "category": "critic",
        "systemPrompt": (
            "You are a demanding line editor focused on whether a careful reader understands the point "
            "on first pass. Flag: sentences that carry more than one idea and should be split; vague or "
            "abstract wording where a concrete term exists; undefined jargon or acronyms used before "
            "they are introduced; buried leads (the point arrives after the throat-clearing); hedging "
            "and filler that dilute the claim; and passive constructions that hide who did what. For "
            "each, quote the text and offer a tighter rewrite. Do not change meaning — sharpen "
            "expression."
        ),
        "defaultOn": True,
        "docTypes": ["*"],
        "triggers": ["wording"],
        "outputContract": "findings",
        "builtin": True,
        "version": 1,
    },
    {
        "id": "citations",
        "displayName": "Citation & Evidence Checker",
        "description": "Verifies load-bearing claims are backed and references support what they're attached to.",
        "category": "critic",
        "systemPrompt": (
            "You verify that every load-bearing claim is backed and every reference actually supports "
            "what it is attached to. Flag: claims that assert a fact, number, or comparison with NO "
            "supporting citation or data; citations that do not match the claim (the source does not say "
            "that); decorative citations padding a sentence they do not support; attributed numbers with "
            "no traceable source; and quotations or paraphrases that may misrepresent a source. Where a "
            "claim needs evidence and has none, say exactly what evidence would settle it. Do not "
            "fabricate sources."
        ),
        "defaultOn": True,
        "docTypes": ["*"],
        "triggers": ["citation", "numbers"],
        "outputContract": "findings",
        "builtin": True,
        "version": 1,
    },
    {
        "id": "structure",
        "displayName": "Structure & Flow Reviewer",
        "description": "Reviews order, transitions, and redundancy at the paragraph and section level.",
        "category": "critic",
        "systemPrompt": (
            "You review the document at the paragraph-and-section level, not the sentence level. Flag: "
            "sections out of logical order; a paragraph that introduces a concept the reader needs "
            "earlier; missing transitions between ideas; a claim referenced before it is established "
            "(forward dependency); redundant passages that repeat an earlier point; and an opening or "
            "closing that does not frame or land the piece. Recommend the specific move (reorder, merge, "
            "split, add a bridging sentence) and quote the anchor text."
        ),
        "defaultOn": True,
        "docTypes": ["*"],
        "triggers": ["structure"],
        "outputContract": "findings",
        "builtin": True,
        "version": 1,
    },
    {
        "id": "copyedit",
        "displayName": "Copyeditor",
        "description": "Hunts machine-generated tells, inflated phrasing, and mechanical inconsistency.",
        "category": "critic",
        "systemPrompt": (
            "You are a meticulous copyeditor hunting the tells of machine-generated or sloppy prose. "
            "Flag and give the fix for: em or en dashes used as connectors (prefer a comma, colon, "
            "parenthesis, or a split); inflated or promotional phrasing (\"cutting-edge,\" \"seamless,\" "
            "\"robust,\" \"leverage,\" \"delve\"); empty parallelisms (\"not only... but also,\" \"it's "
            "not just X, it's Y\"); hollow -ing analyses (\"highlighting the importance of...\"); vague "
            "attributions (\"studies show,\" \"it is widely known\"); throat-clearing conjunctive glue "
            "(\"moreover,\" \"furthermore,\" \"in conclusion\"); and inconsistent spelling or "
            "hyphenation. Use exact quotes; be exhaustive on the mechanical ones."
        ),
        "defaultOn": True,
        "docTypes": ["*"],
        "triggers": ["wording", "typo"],
        "outputContract": "findings",
        "builtin": True,
        "version": 1,
    },
    {
        "id": "figure",
        "displayName": "Figure & Caption Reviewer",
        "description": "Checks figures, tables, and captions for over-claim and figure-text mismatch.",
        "category": "critic",
        "systemPrompt": (
            "You review figures, tables, and their captions. Working from the caption text and any "
            "described figure content, flag: a caption that claims something the figure cannot show; a "
            "figure-text mismatch (the prose asserts a result the figure does not carry); a caption that "
            "over-claims a schematic as if it were measured data; a missing axis label, unit, legend, or "
            "magnitude the reader needs; and a figure referenced in the text but with no caption support "
            "(or vice versa). Keep conceptual or schematic figures honest without demanding they become "
            "exact models. Quote the caption or anchor and give the fix."
        ),
        "defaultOn": False,
        "docTypes": ["*"],
        "triggers": ["figure"],
        "outputContract": "findings",
        "builtin": True,
        "version": 1,
    },
    {
        "id": "domain",
        "displayName": "Domain-Expert Critic",
        "description": "Reviews for domain correctness a generalist would miss (uses the project's field).",
        "category": "critic",
        "systemPrompt": (
            "You are a subject-matter expert in {field}, reviewing this document for domain correctness a "
            "generalist would miss. Flag: statements that are wrong or outdated in the field; standard "
            "methods misapplied or misdescribed; missing caveats a specialist would insist on; "
            "terminology used loosely or incorrectly; and claims that ignore a well-known counter-example "
            "or prior result. Where you flag an error, state the correct fact and, if useful, what a "
            "specialist would cite. Distinguish \"wrong\" from \"defensible but contestable.\""
        ),
        "defaultOn": False,
        "docTypes": ["*"],
        "triggers": ["claim"],
        "outputContract": "findings",
        "builtin": True,
        "version": 1,
    },
    {
        "id": "technical",
        "displayName": "Technical Reviewer",
        "description": "Reviews source code or technical config for correctness, safety, and maintainability.",
        "category": "critic",
        "systemPrompt": (
            "You are a meticulous senior engineer reviewing source code or technical configuration for "
            "correctness, safety, and maintainability. Flag, with the exact offending snippet: logic "
            "errors and off-by-one or boundary mistakes; unhandled errors, missing input validation, and "
            "unsafe assumptions; security risks (injection, hardcoded secrets, unsanitized input, unsafe "
            "eval); resource leaks and obvious performance traps; unclear naming, dead code, and missing "
            "error messages; and code that contradicts its own comment or docstring. Give a concrete fix "
            "for each. Judge the code as written — do not assume unshown context makes it correct."
        ),
        "defaultOn": False,
        "docTypes": ["code"],
        "triggers": ["code"],
        "outputContract": "findings",
        "builtin": True,
        "version": 1,
    },
]


# --------------------------------------------------------------- catalog access (pure)
def builtin_catalog():
    """The bundled builtins as a dict keyed by id (a shallow copy so callers can't mutate the module
    state). This is the authoritative source for builtin ids — a repo file cannot override them."""
    return {a["id"]: dict(a) for a in BUILTIN_AGENTS}


def _read_json(path):
    """Best-effort JSON read; returns None on a missing/malformed file (fall back to builtins)."""
    if not path:
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, ValueError, OSError):
        return None


def load_catalog(repo_agents_path=None):
    """The EFFECTIVE catalog: engine-owned builtins (authoritative) plus any user-authored
    (``builtin: false``) entries from the data repo's ``agents.json``. A builtin id present in the repo
    file is ignored — the bundled definition always wins (auto-upgrade, keyed on ``builtin``). The repo
    file may be a bare list or a ``{"agents": [...]}`` wrapper. A missing/absent file → builtins only."""
    catalog = builtin_catalog()
    raw = _read_json(repo_agents_path)
    entries = raw if isinstance(raw, list) else (raw.get("agents") if isinstance(raw, dict) else None)
    for entry in (entries or []):
        if not isinstance(entry, dict):
            continue
        agent_id = entry.get("id")
        if not agent_id or entry.get("builtin", False):
            continue                                   # no id, or a builtin the repo may not override
        catalog[agent_id] = dict(entry)                # a user-authored (B4) agent
    return catalog


def default_on_ids(catalog=None):
    """The ids selected on a fresh instance (defaultOn), in catalog order."""
    cat = catalog if catalog is not None else builtin_catalog()
    return [i for i, a in cat.items() if a.get("defaultOn")]


def cap_findings(findings, limit=DEFAULT_MAX_FINDINGS):
    """Truncate one agent's finding list to ``limit`` (Q4 volume guard). Pure; input not mutated."""
    return list(findings or [])[:max(0, limit)]


def resolve_agent_directive(agent_ref, catalog=None, field=None):
    """Turn an agent name from a run-agents job into the directive sent to Claude.

    Known catalog id → its ``systemPrompt`` (with ``{field}`` filled) plus the shared output contract.
    Unknown/bare name → the legacy generic prompt (back-compat: pre-catalog agents run exactly as
    before). Both paths end with the same findings-JSON instruction so parsing stays uniform.
    """
    cat = catalog if catalog is not None else builtin_catalog()
    entry = cat.get(agent_ref)
    if entry and (entry.get("systemPrompt") or "").strip():
        prompt = entry["systemPrompt"]
        if FIELD_PLACEHOLDER in prompt:
            prompt = prompt.replace(FIELD_PLACEHOLDER, (field or DEFAULT_FIELD))
        return prompt + AGENT_OUTPUT_CONTRACT
    return LEGACY_AGENT_INSTRUCTIONS.format(agent=agent_ref)
