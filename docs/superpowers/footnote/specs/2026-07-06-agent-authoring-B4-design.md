# Agent Network — B4: User-Authored Agents ("describe → Claude spins it up")

**Status:** DESIGN (approved 2026-07-06). Builds on B1 (catalog/registry), B2 (visible catalog UI), B5 (local runner).
**Branch:** `feat/agent-network`.

## Goal
Let an owner **describe** an agent in plain language and have **Claude generate** a full, working Footnote agent from it — including read-only critics AND local tool-using agents — with an owner **review-then-activate** gate before anything runs. Authored agents are `builtin:false` entries in the data repo's `agents.json`, so they flow through the existing resolver, run-agents lane, and local runner with no new execution surface.

## Decisions (locked)
1. **Describe → Claude generates.** Owner supplies `name` + a plain-language `brief` (+ optional hints: working dir, "may run tools locally"). Claude expands it into the full definition.
2. **Both kinds.** Authored agents may be `category:"critic"` (read-only, `execution:"ci"`) or `category:"doer"`/`execution:"local"` (tool-using, runs via `ci_local` on the owner's machine).
3. **Review gate.** A generated definition lands as a **draft**; the owner reviews the full result (system prompt, category, execution, tools, cwd) and approves/edits before it can run.

## Data model — an authored agent in `agents.json`
```jsonc
{ "id", "displayName", "description", "category": "critic"|"doer",
  "execution": "ci"|"local", "systemPrompt", "tools": [...], "cwd"?,
  "triggers": [...], "outputContract",
  "builtin": false, "source": "authored", "status": "draft"|"active",
  "brief": "<owner's original description>", "version": 1 }
```
- **`status` gates execution.** `is_runnable` / `runnable_in_ci` / `runnable_local` additionally require `status == "active"`. A `draft` never runs. Entries with no `status` default to `"active"` (so builtins + the existing personal overlay are unaffected).
- Authored agents can **never** be `builtin:true` and can **never** reuse a builtin id — validation rejects it, so builtins stay engine-owned and un-hijackable.

## Flow
1. Settings → Review agents → **"Describe an agent"** → form: `name` + `brief`; optional advanced: `cwd` + "may run tools locally".
2. Client queues `{type:"author-agent", name, brief, hints}` → `jobs.json`.
3. Engine (`ci_apply.py` and `ci_local.py`) drains `author-agent`: runs Claude with the **authoring directive** → parses `{category, execution, tools, cwd?, triggers, systemPrompt}` → **validate + normalize** → merge into `agents.json` (as `status:"draft"`) → remove job.
4. Catalog UI shows a **"Drafts — review"** section: the generated system prompt (expandable) + category/execution/tools/cwd badges + **Approve / Edit / Delete**.
5. **Approve** → `status:"active"` (client write) → appears in the normal catalog, selectable, runs like any agent (critic in run-agents; local via `ci_local`).

## Safety / author-oversight (reuses existing invariants)
- The draft-review gate: nothing an authored agent does happens until the owner reads the full generated definition — **including tools and cwd** — and approves.
- Local tool-using authored agents run **only via the local runner the owner invokes on their own machine**, never in CI, never touching the reviewed source (same invariant as the personal fleet).
- Validation blocks: builtin-id collision, unknown tool names, empty prompt, malformed `category`/`execution`, and any attempt to set `builtin:true`.
- `advisor.js` is never touched (the reviewer surface stays AI-free).

## Components (each a small, testable unit)

### Python — `ci_authoring.py` (new, pure) + wiring
- `AUTHOR_DIRECTIVE` — the meta-prompt: turn `{name, brief, hints}` into a strict JSON agent definition; instruct Claude to choose `critic` vs `doer`, `ci` vs `local`, minimal `tools`, and write the `systemPrompt`.
- `author_context(job)` — the piped stdin (name/brief/hints) for the Claude call.
- `parse_authored_agent(raw)` — recover the JSON def from Claude's CLI output (reuse `_parse_claude_json`).
- `sanitize_agent_id(name, taken)` — kebab-case slug; unique against `taken`; never a builtin id.
- `validate_authored_agent(def)` → `(ok, reason)` — enums, tools ⊆ known Claude Code tools, non-empty prompt, no builtin collision, `builtin` not true.
- `normalize_authored_agent(def, brief, taken)` — force `builtin:false`, `source:"authored"`, `status:"draft"`, `outputContract` by category, sanitized id, defaulted metadata.
- `merge_authored(catalog_list, entry)` — add/replace the authored entry in the `agents.json` list; preserve builtins + other authored entries.
- `ci_agents`: extend `is_runnable`/`runnable_in_ci`/`runnable_local` with the `status=="active"` requirement (default active).
- `ci_apply.py` + `ci_local.py`: handle `type:"author-agent"` — `generate_fn(job)` (injectable; default the Claude CLI) → parse/validate/normalize/merge → write `agents.json` → remove job.

### JS — `agentcatalog.js` (extend) + `app.js` UI
- `partitionCatalog(catalog)` → `{active, drafts}` (by `status`, treating missing as active).
- `buildAuthorJob(name, brief, hints)` → the `author-agent` job payload.
- `approveAuthored(list, id)` / `deleteAuthored(list, id)` / `editAuthored(list, id, patch)` — pure `agents.json`-list transforms.
- `writeAgentsJson(cfg, token, transformFn, fetchImpl)` — client read-modify-write of the data repo's `agents.json` (mirrors `writeProjectPatch`; injectable fetch).
- `app.js renderSettingsAgents`: add the "Describe an agent" form + a "Drafts — review" section with Approve/Edit/Delete; authored-active agents shown with an "authored" badge + Delete. DOM-only; browser/preview-verified.

## Testability (TDD)
Pure + unit-tested (pytest / node): the directive/context, parse, `sanitize_agent_id`, `validate_authored_agent`, `normalize_authored_agent`, `merge_authored`, the `status`-gated runnability, and the JS `partition/buildAuthorJob/approve/delete/edit` transforms + `writeAgentsJson` (injected fetch). The live Claude call and git/CI I/O stay behind injectable boundaries (`generate_fn`, `fetchImpl`) — no live model in tests. The DOM form/section is verified in the browser/preview.

## Out of scope (v1)
- Sharing/publishing authored agents across repos (they're per-data-repo).
- Regenerating a draft in place (delete + re-describe covers it).
- Marketplace/discovery of community agents.
