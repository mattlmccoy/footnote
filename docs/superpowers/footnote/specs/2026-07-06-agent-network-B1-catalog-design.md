# Agent Network — B1: Agent Catalog & Registry (Design / Spec)

**Status:** DESIGN DISCOVERY (no product code). Awaiting Matt's review before implementation.
**Worktree:** `footnote-agents-wt` (branch `feat/agent-network`). This doc only; do not commit.
**Author:** design pass, 2026-07-06.
**Scope of this piece (B1):** turn the bare-name `reviewAgents` array into a real, shipped **agent catalog** with stored definitions (id, description, category, system prompt, suitability) and evolve the `run-agents` job to carry real system prompts, WITHOUT breaking the current bare-name path. Later pieces (B3 routing, B4 user-authored agents, B5 local runner) are noted only as clean seams.

---

## 1. Current-state analysis (what an "agent" is today)

Today a review agent is **just a name string**. There is no stored definition, description, routing, authoring UI, or local execution. The name is interpolated straight into a generic instruction.

### 1.1 Where the name lives (client / config)

- `js/config.js`
  - App-level default: `reviewAgents: []` (DEFAULTS, line ~22; normalizeConfig line ~45).
  - Per-project: `PROJECT_DEFAULTS.reviewAgents: []` (line ~128); `normalizeProject` passes `p.reviewAgents || []` (line ~144); `resolveProject` resolves `p.reviewAgents || appCfg.reviewAgents` (line ~172).
  - `assistantEnabled(cfg, flag)` (line ~276): AI is on if the flag is `'1'` **or** `reviewAgents.length > 0`.
  - `sendMenuActions(assistantOn, reviewAgents)` (line ~284): the top-bar "Send" menu adds a `run-agents` action **only when** `reviewAgents.length > 0`. So the array is both the catalog AND the feature flag for the menu row.
- `footnote.config.json` / `footnote.config.example.json` carry `reviewAgents` as an array of strings (currently empty in the live config).

**Key fact:** `reviewAgents` is an array of **opaque strings**. It doubles as (a) the enable-flag for the run-agents menu row and (b) the list of agents to run. Nothing describes what each name means.

### 1.2 How a run-agents job flows end-to-end

1. **Client queues a job.** The UI writes a job of `type: "run-agents"` carrying `agents: [<name>, ...]` (the selected subset of `reviewAgents`) into the project's `review.json` jobs list. (The client-side queuing helper is a later slice per `js/seed.js:26`; the engine already consumes `job.agents`.)
2. **CI drains the job.** GitHub Actions (`workflows/apply.yml`) runs `data-template/ci_apply.py` → `process_project(...)`.
   - `HANDLED_TYPES = ("apply-direct", "apply-edits", "run-agents", "merge")` (ci_apply.py:330).
   - `process_project` accepts an injectable `agent_fn(agent_id, task)`; default `run_agent_cli` (line ~344).
   - The `run-agents` branch (lines ~382–395):
     - requires `have_claude` (a `CLAUDE_CODE_OAUTH_TOKEN`); otherwise leaves the job queued.
     - builds the task: `task = R.build_apply_task(job, review, R.author_source(files))`.
     - runs each agent: `outputs = {a: (agent_fn(a, task) or []) for a in (job.get("agents") or [])}`.
     - folds findings into `review.json`: `R.process_run_agents_job(job, review, outputs, now, idgen=...)`.
     - removes the job, writes `review.json`.
3. **Per-agent Claude invocation.** `run_agent_cli(agent_id, task, model)` (ci_apply.py:168):
   - `out = _run_claude(AGENT_INSTRUCTIONS.format(agent=agent_id), agent_context(task), model, ...)`.
   - `AGENT_INSTRUCTIONS` (ci_apply.py:132) is the **only** prompt text: *"You are the '{agent}' review agent. The document unit's source is provided as JSON... Critique it from your perspective. This is READ-ONLY... Return ONLY a JSON array [{quote, body, tag}]... Return [] if no findings."*
   - `agent_context(task)` (line ~144) pipes the unit as `UNIT:\n<json>` on stdin.
   - `_run_claude` (line ~150) calls headless `claude -p <directive> --output-format json --model <model>` with the context on stdin. Missing CLI / non-zero exit → `None` → job left queued (safe).
   - `parse_agent_findings(raw)` (line ~121) tolerantly recovers a **list** of `{quote, body, tag, section?}` finding specs (findings have no id).
4. **Findings become comments.** `ci_review_common.process_run_agents_job` (line ~199): each finding spec becomes a `review.json` comment with `author=<agentId>`, `kind:"text"`, `status:"open"`, `anchor.quote` from the finding, `tag`, `body`. Agents **never** edit source — they only add open comments the owner then acts on. Ids via injected `idgen`.

### 1.3 The gap

- The agent's entire "personality" is the literal string `{agent}` dropped into one sentence. `"rigor"` and `"citation-checker"` produce almost identical prompts differing only by that word. There is **no** stored description, system prompt, category, default-on state, or document-type suitability.
- No authoring UI, no routing, no local execution.
- **This is the seam B1 fills:** replace/augment the bare name with a real definition resolved from a shipped catalog, while the bare-name path keeps working.

---

## 2. The 12 dissertation/RFAM agents — inventory

These are Matt's local `~/.claude/agents/*.md`. They are the **inspiration** for Footnote's shipped catalog, but almost all are **domain-specific** (RFAM/HEATR/dissertation/Matt's paths). Footnote is document-agnostic and must NOT hardcode any of that. The table records doer/critic and whether the *idea* generalizes.

| # | Agent (name) | One-line role | Tools (frontmatter) | Model | Doer / Critic | Domain | Generalizes to Footnote? |
|---|---|---|---|---|---|---|---|
| 1 | code-reviewer | Senior review of RFAM Python for quality/security/maintainability | Read, Grep, Glob, Bash | opus | **Critic** (read-only) | Domain-specific (RFAM solvers, HEATR, dissertation export scripts) | Concept yes (a "code/technical-review" critic) but Footnote reviews **documents**, not code — DROP for now |
| 2 | computational-solver-engineer | Develops + FD-verifies PDE/adjoint solver code | Read, Write, Edit, Bash, Grep, Glob | — | **Doer** | Domain-specific (adjoint, ILT, heatr3d, RFAM paths) | No — solver dev, out of scope. DROP |
| 3 | concept-figure-creator | Draws NEW conceptual/schematic figures (TikZ/matplotlib) | (implicit all) | — | **Doer** | Domain-specific (RFAM colormaps, dissertation house style) | Figure *authoring* is a doer, out of B1 review scope. DROP (revisit as a doer later) |
| 4 | concept-figure-reviewer | Read-only review of loose schematic figures vs their caption/claim | Read, Grep, Glob, Bash | — | **Critic** (read-only) | Mostly domain-specific framing, but the *mechanic* (figure conveys its idea, matches caption, no over-claim) is general | **YES** → generalize to a **Figure & Caption Reviewer** |
| 5 | critical-thinking-assistant | Socratic tutor: makes the human understand/verify the work | Read, Grep, Glob, Bash, WebFetch, WebSearch | — | **Critic** (read-only tutor) | Domain-specific (Matt, RFAM), but "surface the reasoning / what to verify" generalizes | Partial — its *logic-scrutiny* half → **Reasoning & Logic Reviewer** |
| 6 | dissertation-adversary | Harshest reviewer: teardown of claims/figures/numbers/citations + copy-edit audit | Read, Grep, Glob, Bash, WebFetch, WebSearch | — | **Critic** (read-only) | Framing domain-specific; the *attack list* (overclaims, figure–claim mismatch, consistency, logic, citations, methodology, scope) is fully general | **YES** → the flagship **Rigor / Adversary Critic** (+ splits into citation + copyedit critics) |
| 7 | dissertation-writer | Owns the LaTeX document; writes/refines prose, captions, contributions | Read, Write, Edit, Bash, Grep, Glob | — | **Doer** | Domain-specific (phd-dissertation repo, Overleaf) | Doer, out of B1 review scope. DROP (the existing apply-edits path already covers editing) |
| 8 | heatr-simulation-engineer | Runs HEATR/heatr3d simulations, study recipes | Bash, Read, Write, Edit, Grep, Glob | — | **Doer** | Domain-specific (HEATR, EQS, FGM) | No. DROP |
| 9 | literature-reviewer | Sources/organizes/vets literature; Zotero; references.bib | (Zotero-heavy) | — | Mixed (produces notes) | Domain-specific (RFAM topics, Zotero) | The *evidence/citation-vetting* half → folds into **Citation & Evidence Checker** |
| 10 | paper-miner | Extracts reusable writing patterns from strong papers into a memory | Read, ... | — | **Doer** (writes to a memory) | Domain-specific (target venues, ml-paper-writing memory) | No (meta-writing tool). DROP |
| 11 | rebuttal-writer | Writes reviewer-response letters for journal peer review | Read, Write, Edit, Grep, Glob | inherit | **Doer** | Domain-specific (RFAM journal portfolio) | Doer, out of scope. DROP |
| 12 | rfam-experimentalist | Designs physical DoE / metrology to validate claims | Read, Write, Edit, Bash, Grep, Glob | — | **Doer** | Domain-specific (RFAM lab rigs, IR/VNA) | No. DROP |

**Takeaways for Footnote:**
- Only the **read-only critics** map onto Footnote's run-agents model (agents add comments, never edit). The doers (2,3,7,8,10,11,12) are the *apply-edits* lane's territory or out of scope.
- Every one is written in the FIRST person for a headless Claude and hardcodes Matt/RFAM/dissertation. The shipped catalog must **re-author each system prompt from scratch, document-agnostic**, borrowing only the *mechanics* (attack lists, review checklists).
- The single richest source is **dissertation-adversary**: its 7-point attack list + copy-editor audit decomposes cleanly into several generally-useful Footnote critics (rigor, citations, anti-AI copyedit).

---

## 3. Routing framework (from `rules/agents.md` + `dissertation-text-edit-rules` memory)

**`rules/agents.md`** — a fixed table mapping *situations* → agents (code just written → code-reviewer; new survey → literature-reviewer; etc.), plus "run independent agents in parallel" and a "multi-perspective split-role" pattern (factual reviewer / senior engineer / security expert / consistency reviewer / redundancy checker). It is about *which* agents to dispatch, in parallel, and to retry-once on failure.

**`dissertation-text-edit-rules` memory** — the substantive routing model. Edit is **classified by type**, then a **subset** (union) of reviewers runs — NOT the whole panel:

| Edit type | Reviewers (union) |
|---|---|
| typo / formatting | adversary |
| wording / caption clarification | writer + adversary |
| claim / mechanism / argument | writer + adversary + critical-thinking |
| numbers / results / data figure | writer + adversary + solver |
| physics / simulation claim | writer + adversary + heatr (+ solver) |
| concept figure (schematic) | concept-figure-creator → concept-figure-reviewer + writer |
| citation only | adversary |
| mixed / major (≥3 dimensions) | full panel |

Principles worth generalizing (these feed **B3**, not B1):
- One agent is an **always-on cheap backstop** (adversary: em dashes, consistency, British→American, citation integrity).
- Routing is **union of triggered reviewers**, escalating to the full panel when the edit spans ≥3 dimensions.
- The classifier **announces** its choice ("Type: wording → writer + adversary") and the human can override.

**Document-agnostic generalization (B3 target, seam only here):** replace RFAM-specific edit types with generic ones — `{ typo/format, wording/clarity, claim/argument, numbers/data, figure/caption, citation, structure/flow, mixed }` — and route each to a subset of the shipped catalog by a per-agent `triggers: [<editType>...]` field. B1 must therefore leave a place on each catalog entry to hang those triggers (see §4.1 `triggers`), even though B1 does not implement the classifier.

---

## 4. Proposed design — the Agent Catalog & Registry

### 4.1 Data model (one shipped agent definition)

```jsonc
{
  "id": "rigor",                    // stable slug; matches author=<id> on comments; back-compat key
  "displayName": "Rigor Critic",    // shown in UI
  "description": "Red-teams claims, numbers, figures and scope for what won't survive scrutiny.",
  "category": "critic",             // "critic" (adds comments) | "doer" (edits) — B1 ships critics only
  "systemPrompt": "You are ...",    // the REAL directive text sent to Claude (replaces the {agent} sentence)
  "defaultOn": true,                // seeded into a new project's selected set
  "docTypes": ["*"],                // suitability: ["*"] = any; or ["latex","markdown","prose","code",...]
  "triggers": ["claim","numbers","scope"],  // B3 routing hook (edit-types this agent answers) — inert in B1
  "outputContract": "findings",     // "findings" = [{quote,body,tag,section?}] (the only contract in B1)
  "builtin": true,                  // shipped vs user-authored (B4 hook)
  "version": 1                      // bump when the prompt changes; lets a repo pin/refresh
}
```

Notes:
- `id` is the **join key** to today's world: a bare string `"rigor"` in `reviewAgents` resolves to this entry. Comment `author` stays `id` so existing `process_run_agents_job` is untouched.
- `systemPrompt` is the whole point: it replaces `AGENT_INSTRUCTIONS.format(agent=...)` with a real, per-agent directive. The **output contract** (return `[{quote, body, tag, section?}]`, read-only) is appended by the engine so every catalog author can't forget it and so parsing stays uniform.
- `docTypes` and `triggers` are declared now but only *consumed* later (B3). Declaring them now avoids a schema migration.
- `builtin` distinguishes shipped from user-authored (B4).

### 4.2 Where the catalog lives — options weighed

| Option | Where | Pros | Cons | Verdict |
|---|---|---|---|---|
| **A. JSON in data-template, seeded per data repo** | `data-template/agents.json`, copied into each data repo at seed time; engine reads it from the repo | Engine (Python CI) reads it with no JS coupling; each repo can diverge / be edited by its owner; naturally supports B4 user agents in the same file; version-pinnable per repo | Duplicated across repos; a catalog upgrade must be re-seeded/merged into existing repos | **RECOMMENDED (primary store)** |
| **B. JS module** | `js/agents.js` exporting the catalog | Trivial for the client UI to import; one source of truth in the app repo | The **Python CI engine can't import JS**; it would need a duplicate or a build step; not per-repo editable → blocks B4 | Rejected as the store; see hybrid |
| **C. Single source, generated both ways** | Author in `data-template/agents.json`; a tiny build/lint copies/validates it for the JS client | One authored source; both sides read it | Adds a generate/verify step | **Adopt the spirit:** JSON is authoritative; the JS client fetches the same `agents.json` at runtime (no build step) |

**Recommendation:** **Option A with a C-style single source.** Ship `data-template/agents.json` as the authoritative catalog. The CI engine reads `<dataRepo>/agents.json` (falling back to bundled defaults if absent). The **client** fetches the same `agents.json` from the data repo to render names/descriptions/checkboxes in the Send menu — it does NOT need a JS copy. This keeps one authored file, lets each repo edit/extend it (B4), and keeps the Python engine JS-free.

- Seeding: `js/seed.js` (which already seeds the data-template) copies `agents.json` into a new data repo. Existing repos without it → engine uses bundled defaults, so nothing breaks.

### 4.3 How `run-agents` evolves (with back-compat)

Introduce a **resolver** between "a name in a job" and "the prompt sent to Claude":

```
resolve_agent(agent_ref, catalog) -> { id, systemPrompt, model? }
```

Rules (pure, unit-testable):
1. If `catalog[agent_ref]` exists → use its `systemPrompt` (+ optional per-agent `model`). **New path.**
2. If not found → **fall back to the legacy generic prompt** `AGENT_INSTRUCTIONS.format(agent=agent_ref)`. **Back-compat path** — any bare name that predates the catalog still runs exactly as today.
3. The engine always **appends the fixed output contract** (`Return ONLY a JSON array [{quote, body, tag, section?}]... READ-ONLY`) to whichever prompt, so `parse_agent_findings` is unchanged.

Engine change is minimal and localized to `run_agent_cli`:

```python
def run_agent_cli(agent_id, task, model=None, catalog=None):
    directive = resolve_agent_directive(agent_id, catalog)   # catalog prompt OR legacy AGENT_INSTRUCTIONS
    out = _run_claude(directive, agent_context(task), model, f"agent {agent_id}")
    return parse_agent_findings(out) if out is not None else []
```

- `catalog` is loaded once in `process_project` from `<dataRepo>/agents.json` (or bundled default) and threaded to `agent_fn`. Because `agent_fn` is already injectable, tests pass a fake catalog with no live Claude.
- **Nothing else in the pipeline changes.** Job shape (`agents: [id,...]`), `build_apply_task`, `process_run_agents_job`, comment authoring — all identical. `author=<id>` still holds.
- `AGENT_INSTRUCTIONS` is **retained** as the fallback directive — this IS the back-compat guarantee.

**Back-compat matrix:**

| `reviewAgents` entry | `agents.json` present? | Behavior |
|---|---|---|
| known id (`"rigor"`) | yes | new: real system prompt |
| unknown/bare name (`"my-old-agent"`) | yes | legacy generic prompt (fallback) |
| any name | no (old repo) | legacy generic prompt for all — identical to today |

### 4.4 Proposed starter catalog (shipped, document-agnostic critics)

All are `category: "critic"`, read-only, `outputContract: "findings"`. Prompts are drafted document-agnostic — no RFAM/dissertation. `docTypes: ["*"]` unless noted. `triggers` are B3 hints (inert in B1).

> Drafted system prompts below are the `systemPrompt` field values. The engine appends the shared output contract, so the drafts focus on *perspective* and *what to look for*. "The document unit" = the piped `UNIT` JSON.

1. **`rigor` — Rigor Critic** (`defaultOn:true`, triggers: claim, numbers, scope)
   > You are a hostile-but-fair expert reviewer whose job is to find what will NOT survive scrutiny, before anyone else does. Attack, in priority order: (1) **overclaims** — every "proves / demonstrates / confirms / validates / always / never" where the evidence on the page is weaker than the verb; (2) **claim–evidence mismatch** — a conclusion the shown data, figure, or example does not actually support; (3) **internal consistency** — numbers, terms, or claims that disagree across the document; (4) **logic** — non-sequiturs, circular reasoning, conclusions that don't follow; (5) **scope & honesty** — results oversold, limitations missing or buried, "future work" doing load-bearing work. Every finding must name the exact offending text and give a concrete, actionable fix — you are not a troll. Assume nothing is true until the text shows it.

2. **`clarity` — Clarity & Style Critic** (`defaultOn:true`, triggers: wording)
   > You are a demanding line editor focused on whether a careful reader understands the point on first pass. Flag: sentences that carry more than one idea and should be split; vague or abstract wording where a concrete term exists; undefined jargon or acronyms used before they're introduced; buried leads (the point arrives after the throat-clearing); hedging and filler that dilute the claim; and passive constructions that hide who did what. For each, quote the text and offer a tighter rewrite. Do not change meaning — sharpen expression.

3. **`citations` — Citation & Evidence Checker** (`defaultOn:true`, triggers: citation, numbers)
   > You verify that every load-bearing claim is backed and every reference actually supports what it's attached to. Flag: claims that assert a fact, number, or comparison with **no** supporting citation or data; citations that don't match the claim (the source doesn't say that); decorative citations padding a sentence they don't support; attributed numbers with no traceable source; and quotations or paraphrases that may misrepresent a source. Where a claim needs evidence and has none, say exactly what evidence would settle it. Do not fabricate sources.

4. **`structure` — Structure & Flow Reviewer** (`defaultOn:true`, triggers: structure)
   > You review the document at the paragraph-and-section level, not the sentence level. Flag: sections out of logical order; a paragraph that introduces a concept the reader needs earlier; missing transitions between ideas; a claim referenced before it's established (forward-dependency); redundant passages that repeat an earlier point; and an opening or closing that doesn't frame or land the piece. Recommend the specific move (reorder, merge, split, add a bridging sentence) and quote the anchor text.

5. **`copyedit` — Anti-AI-Tells Copyeditor** (`defaultOn:true`, triggers: wording, typo)
   > You are a meticulous copyeditor hunting the tells of machine-generated or sloppy prose. Flag and give the fix for: em/en dashes used as connectors (prefer a comma, colon, parenthesis, or a split); inflated or promotional phrasing ("cutting-edge," "seamless," "robust," "leverage," "delve"); empty parallelisms ("not only... but also," "it's not just X, it's Y"); hollow -ing analyses ("highlighting the importance of..."); vague attributions ("studies show," "it is widely known"); throat-clearing conjunctive glue ("moreover," "furthermore," "in conclusion"); and inconsistent spelling/hyphenation. Use exact quotes; be exhaustive on the mechanical ones.

6. **`figure` — Figure & Caption Reviewer** (`defaultOn:false`, triggers: figure, docTypes: `["*"]`)
   > You review figures, tables, and their captions for a document. Working from the caption text and any described figure content, flag: a caption that claims something the figure cannot show; a figure–text mismatch (the prose asserts a result the figure doesn't carry); a caption that over-claims a schematic as if it were measured data; a missing axis label, unit, legend, or magnitude the reader needs; and a figure referenced in the text but with no caption support (or vice versa). Keep conceptual/schematic figures honest without demanding they become exact models. Quote the caption/anchor and give the fix.

7. **`domain` — Domain-Expert Critic** (`defaultOn:false`, triggers: claim, docTypes: `["*"]`)
   > You are a subject-matter expert in this document's field, reviewing for domain correctness a generalist would miss. Flag: statements that are wrong or outdated in the field; standard methods misapplied or misdescribed; missing caveats a specialist would insist on; terminology used loosely or incorrectly; and claims that ignore a well-known counter-example or prior result. Where you flag an error, state the correct fact and, if useful, what a specialist would cite. Distinguish "wrong" from "defensible but contestable."

> This ships **7 generally-useful critics**, ≥5 default-on, all document-agnostic. `figure` and `domain` default OFF (more specialized). This satisfies the "aim for ≥7" target and covers rigor, clarity, citations, structure, anti-AI copyedit, figures, and domain expertise.

### 4.5 Forward hooks (seams only — DO NOT build in B1)

- **B3 routing:** the `triggers` and `docTypes` fields already exist on each entry. A future classifier maps an edit's type → the union of catalog agents whose `triggers` match, mirroring the dissertation routing table but with generic edit types. B1 leaves these fields inert.
- **B4 user-authored agents:** `builtin:false` entries added to `<dataRepo>/agents.json` flow through the **same** resolver and job path — no engine change. The authoring UI (validation, prompt editor) is B4; the data model already accommodates it.
- **B5 local runner:** `run_agent_cli` is already the single injectable boundary (`agent_fn`). A local (non-CI) runner is a second `agent_fn` implementation; the resolver + catalog are reused unchanged.

---

## 5. Testability (TDD plan for implementation — not built here)

Pure, unit-testable units (write the failing test first per red-green):
- `resolve_agent_directive(id, catalog)`: (a) known id → returns its `systemPrompt`; (b) unknown id → returns legacy `AGENT_INSTRUCTIONS.format(agent=id)`; (c) missing catalog → legacy for all. **Back-compat is a test.**
- Catalog **parse/validate**: `agents.json` → dict keyed by `id`; reject entries missing required fields; tolerate extra fields.
- Catalog **lookup**: `catalog[id]` and default-on selection set.
- The **output contract** is appended regardless of path (assert both paths end with the findings-JSON instruction) so `parse_agent_findings` stays uniform.
- Client config: `sendMenuActions` / `assistantEnabled` still behave when `reviewAgents` holds ids that resolve to catalog entries (existing tests should stay green).

Not unit-testable (substitute a gate): the live `claude -p` call in `run_agent_cli` (already CI-gated via injectable `agent_fn`); the actual prose quality of the drafted system prompts (human review + a smoke run against a sample document).

---

## 6b. RESOLVED — B1 implemented (commit `9446e8b`, branch `feat/agent-network`)

Matt's decisions on the six questions below, as built:

1. **Store — Option A confirmed.** `data-template/agents.json` is the seeded JSON mirror; builtins are engine-owned in `data-template/ci_agents.py` (`BUILTIN_AGENTS`); a pytest gate keeps the two byte-equivalent. No JS copy.
2. **Upgrades — builtins auto-upgrade, keyed on `builtin`.** `load_catalog` takes builtins from the engine (authoritative) and reads the repo `agents.json` ONLY for `builtin:false` user agents; a builtin id in the repo file is ignored.
3. **Default-on — 5:** `rigor, clarity, citations, structure, copyedit`. Off: `figure, domain, technical`.
4. **Volume — cap findings per agent.** `cap_findings(..., DEFAULT_MAX_FINDINGS=20)` applied in `run_agent_cli`.
5. **`domain` field — optional `doc.field`.** Added to config `doc` defaults; the domain prompt's `{field}` is filled at resolve time (neutral phrase when unset); `domain` ships OFF. The run-agents job carries `field` (app.js).
6. **UI author identity — deferred to B2.** Comments stay `author=<id>`; no rendering change in B1.

**Extra decision:** shipped an **8th critic `technical`** (generic code/technical reviewer, `docTypes:["code"]`, default-OFF) — the one read-only-critic mechanic (fleet `code-reviewer`) otherwise unrepresented.

**Follow-up decision (Matt): represent the WHOLE active fleet in B1.** The catalog now carries all 12 active fleet agents, generalized document-agnostically (retired kaggle-miner / tdd-guide excluded). 16 entries total = 11 critics + 5 doers:

| Fleet agent | Catalog id | Category |
|---|---|---|
| dissertation-adversary | `rigor` (+ inspired `copyedit`) | critic |
| code-reviewer | `technical` | critic |
| concept-figure-reviewer | `figure` | critic |
| critical-thinking-assistant | `reasoning` | critic |
| computational-solver-engineer | `methods` | critic |
| rfam-experimentalist | `evidence` | critic |
| literature-reviewer | `citations` | critic |
| dissertation-writer | `writer` | doer |
| concept-figure-creator | `figure-drafter` | doer |
| rebuttal-writer | `responder` | doer |
| paper-miner | `patterns` | doer |
| heatr-simulation-engineer | `reproduce` | doer |

Plus the native generic critics `clarity`, `structure`, `domain`.

## 6c. B5 local runner + personal overlay (commits `ea86b93`, live)

Matt asked for the FULL feature set of his tool-using agents (heatr-simulation-engineer et al.) for his own instance. Those can't run in the data repo's CI (they need his machine, tools, and code paths), so:

- **Data model**: added `execution` ("ci" default | "local"). `ci_agents.runnable_in_ci` (read-only, non-doer, non-local) vs `runnable_local` (execution:"local", critic or doer). No shipped builtin is local.
- **`data-template/ci_local.py`** (generic, document-agnostic, shipped): the local runner. `build_local_command` (tool-enabled argv + per-agent cwd/model), `run_local_job` (pure fold), `process_prefix` (working-tree drain: run local agents → write comments → remove job), `run_local_agent_cli` (live boundary), CLI. CI's run-agents lane skips any job carrying a local agent and leaves it for the local runner.
- **Personal overlay (NOT in the public repo)**: Matt's 12 active `~/.claude/agents/*.md` generalized to `builtin:false`, `execution:"local"` entries carrying their FULL prompts + tools/model, delivered to **`mattlmccoy/footnote-projects/agents.json`** (repo-root, merged with the builtin mirror → 28-agent effective catalog). Adopter-owned; the shipped product never sees them.
- **Author-oversight intact**: a local agent acts through its own tools on Matt's OWN research code and reports back a comment; it never writes the Footnote-reviewed source.

Activation for live end-to-end use still needs the B1/B5 engine + updated client deployed to footnote-projects (via merging `feat/agent-network`), then wiring `reviewAgents`. The overlay data is in place and validated now. **Doers are catalogued but NOT executed by B1's read-only run-agents** — `ci_agents.is_runnable()` returns False for `category:"doer"` and `process_project` filters them out; they act through the editing/authoring lanes in B2–B5. Unknown/legacy names stay runnable (legacy fallback). Default-on unchanged (5 critics). Weak generalizations to revisit: `reproduce` (fleet heatr-simulation-engineer) and `methods`/`evidence` are thinner as generic document agents — recategorize/rename freely.

Engine boundary: `resolve_agent_directive` (pure) resolves catalog prompt + shared output contract, legacy fallback for unknown names. `run_agent_cli(agent_id, task, catalog=, field=)`. `process_project` loads the catalog once and threads it. Seams B2–B5 left inert (`triggers`/`docTypes` fields present, `builtin:false` path works, `agent_fn` still the single injectable local-runner boundary).

---

## 6. Open questions needing Matt's decision (ANSWERED — see §6b)

1. **Catalog store — confirm Option A?** Authoritative `data-template/agents.json` seeded per data repo, engine reads from the repo with a bundled fallback, client fetches the same file. (Alternative: keep a JS copy for the client. Recommendation: don't — one source.)
2. **Catalog upgrades for existing repos.** When the shipped catalog changes (new agent, improved prompt), how do live data repos get it? Options: (a) engine always prefers **bundled defaults** for `builtin` ids and only reads the repo file for user agents (auto-upgrade, but overrides local edits); (b) repo file wins, upgrades are an explicit re-seed/merge (stable, but repos drift). Recommendation leans (a) for builtins + (b) for user agents, keyed on `builtin`. Confirm?
3. **Which starter agents default ON?** Proposed default-on: rigor, clarity, citations, structure, copyedit (5). Off by default: figure, domain. Right set, or leaner (e.g. only rigor + copyedit) to avoid comment flooding on first run?
4. **Comment volume / cost.** Running 5 critics on a unit can produce many comments and 5 Claude calls per run. Do we want a per-run agent cap, a max-findings-per-agent, or a "dry-run/preview count" before spending? (Ties to the per-reviewer-token/rate-limit thrift note.)
5. **`domain` critic without a stated domain.** A generic "domain expert" with no configured field is weak. Should `docTypes`/a project `field` string feed it (e.g. project config `doc.field: "materials engineering"`)? That's a small config addition — in or out of B1?
6. **Naming & `author` identity in the UI.** Comments are authored `author=<id>` (e.g. `rigor`). Should the reviewer UI show `displayName` ("Rigor Critic") with an agent badge, and does that need any change to how comment authors are rendered/attributed today? (Affects only display, not the engine.)
