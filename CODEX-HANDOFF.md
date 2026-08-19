# Handoff: finish the Codex engine integration in Footnote

**Repo:** `/Users/mattmccoy/code/put_github_repos_here/footnote` — launch from inside it.
**Branch:** `feat/codex-engine` (already created, work staged and uncommitted).
**Design spec:** `docs/superpowers/footnote/specs/2026-08-19-codex-engine-design.md` — read it first.

## What Footnote is

A static-site LaTeX review tool. Reviewers comment on a rendered document; an AI engine turns those
comments into edit SPECS; a deterministic engine applies the specs and stages them on a branch; the
author approves before anything merges. The engine never edits the manuscript and never merges.

## The actual motivation — read this before choosing what to prioritize

The author wants **Codex to write the prose**. Claude has recognizable stylistic tells, and this is a
PhD dissertation. The engine that matters most is the **writer** (`run_writer_cli`), which drafts the
LaTeX edits that resolve reviewer comments, plus the **figure-drafter** for figure comments. Critics
and other agents are secondary.

So when you build the UI, the primary thing a user must be able to do is: **point the Writer/Editor
agent at Codex while leaving everything else alone.** Make that the obvious, prominent choice — not a
buried per-agent override.

Note also: Footnote already gates writer output against em-dashes (`ci_review_common.em_dash_count`),
a known AI tell, delta-wise so it only blocks NEWLY introduced ones. Codex output flows through the
same gate. Do not weaken it.

## What we are building

Let each agent run on **OpenAI Codex** instead of Claude Code, selected by prefixing its model value
with `codex:`. Example — one existing Actions variable, no new plumbing:

```
AGENT_MODELS = {"critic": "codex:gpt-5.6-terra"}
```

That agent runs `codex exec`; every other agent stays on Claude.

## What is ALREADY DONE — do not redo or redesign this

`data-template/ci_llm.py` is the provider seam. It is complete, wired, and covered by 41 tests in
`tests/test_ci_llm.py`. Its public API:

```python
parse_model_spec(value)        -> (provider, model)   # bare value == claude
ai_configured(env, provider)   -> bool
claude_argv(directive, model)  -> list[str]
codex_argv(directive, model, out_path, sandbox="read-only") -> list[str]
unwrap_payload(text)           -> decoded JSON or None
codex_usage(raw, model=None)   -> dict incl. cost_usd (None when unpriced)
claude_usage(raw)              -> dict incl. cost_usd, cost_estimated=False
usage_for(provider, raw, model=None)
codex_cost(model, usage)       -> float or None
codex_failed(raw)              -> error message or ""
run_llm(spec, directive, context, label, sandbox=..., usage_acc=...)  # the ONE subprocess call
```

Also done: `ci_apply._run_claude` delegates to `run_llm`; `data-template/workflows/apply.yml` installs
the pinned Codex CLI and passes `CODEX_API_KEY`/`OPENAI_API_KEY`; the advisor grep gate in
`.github/workflows/test.yml` covers `codex|openai`.

## Facts established by real probes — treat as settled, do not re-litigate

- `codex exec` takes the directive as **argv** and the manuscript on **piped stdin**.
- `-o <path>` is byte-identical to the final `agent_message`, **no trailing newline**.
- Failure = **nonzero exit** and/or a `turn.failed` event. Valid JSONL on stdout does NOT mean success,
  and the `-o` file is absent on failure — never use its absence as the signal.
- The real `usage` object has **five** fields; the published docs showed four. It includes
  `cache_write_input_tokens`, which stayed `0` even in a run that read 6,912 cached tokens — it is
  **not** a cache indicator.
- `input_tokens` is **INCLUSIVE** of `cached_input_tokens`. Uncached input is their DIFFERENCE.
  Proven by a cold/warm pair: both reported 57,867 while cached went 0 -> 6,912.
- Codex runs unattended in a fresh CI checkout. No trust config needed.
- Verified $/Mtok (uncached, cached, output): sol (5.0, 0.5, 30.0), terra (2.0, 0.2, 12.0),
  luna (0.2, 0.02, 1.2). Over 272K input tokens: 2x input, 1.5x output for the whole request.

## YOUR TASKS

### 1. `js/aimodels.js` — offer Codex in the model picker

Today `MODELS` lists `opus` / `sonnet` / `haiku` and `DEFAULT_MODEL = 'opus'`.

Add three entries whose `value` is the full prefixed spec — `codex:gpt-5.6-sol`, `codex:gpt-5.6-terra`,
`codex:gpt-5.6-luna` — tiered to mirror most-capable / balanced / cheapest. Give every entry (Claude
ones too) a `provider` field so the picker can group by engine without re-parsing the string.

- `DEFAULT_MODEL` stays `'opus'`. Existing installs must see no behavior change.
- `resolveModel` keeps passing values through unchanged.
- `isKnownModel` must accept the new values. It currently also accepts any pinned `claude-*` id — keep
  that, and do not let it start rejecting a pinned id.
- Mirror any change into the Python side's docstring reference in `ci_review_common.DEFAULT_MODEL`.

Update `tests/aimodels.test.mjs`.

### 2. `js/ghsecrets.js` — seal the Codex credential

- `aiSecretsPlan({...})` at line 150 currently maps `claudeCodeToken`/`anthropicKey`/`sourceToken` to
  secret names. Add `codexApiKey` -> `CODEX_API_KEY`. Blank values must still be skipped so Save never
  clobbers an existing secret with an empty string.
- `claudeConnectionStatus(names)` at line 163 returns `{claude, via, source}`. Generalize it to report
  per-provider status (e.g. add `codex` and `codexVia`) **without breaking existing callers** — find
  every call site before you change the shape.

Update `tests/ghsecrets.test.mjs`.

### 3. `js/tokenscopes.js` — document the credential

`CREDENTIALS` (line 117) has an entry per credential. Add a `codex` entry alongside the `claude` one at
line 140. Copy must say: an API key is for cloud runs; local runs use the ambient `codex login` session
and need no secret. Update `tests/tokenscopes.test.mjs`.

### 4. Wire the UI form

Find where `setAiSecrets` / `aiSecretsPlan` are called from (likely `js/settings.js` or
`js/owneradmin.js`) and add the Codex API key field to that form, next to the Claude credential.

### 5. `data-template/ci_local.py` — local tool-using agents

`local_argv` at line ~40 hardcodes `["claude", "-p", ...]`. Route it through
`ci_llm.parse_model_spec` + the appropriate argv builder so a local agent can also be `codex:`-prefixed.
Local tool-using agents need `sandbox="workspace-write"` — they act on the operator's own code — while
the CI path stays `read-only`. Keep the existing `--allowedTools` behavior for Claude.

## HARD CONSTRAINTS — a change that violates any of these is wrong

1. **Backward compatibility.** Every existing config value keeps its current meaning. A bare `opus`
   still means Claude. No migration.
2. **A pinned id containing a colon must not be misread.** `anthropic.claude-3-5-sonnet-20241022-v2:0`
   is a valid value; only a KNOWN provider prefix may split. There is a test for this — keep it green.
3. **Unknown must never render as healthy.** An unpriced model reports cost `None`, never `0.0`.
   Claude's cost is billed (`cost_estimated: False`); Codex's is derived (`cost_estimated: True`). The
   UI must be able to tell them apart and must label the estimate.
4. **The advisor bundle stays assistant-free.** No `codex`/`openai`/vendor string may reach
   `js/advisor.js` or any HTML shell that loads it. The gate in `.github/workflows/test.yml` enforces
   this — run it.
5. **AI stays off by default.** With no credential, jobs WAIT. They must not fail or silently no-op.

## HOW TO WORK — this is not optional

Strict red-green TDD, per unit of behavior:

1. Write ONE failing test. Run it. **Confirm it fails for the intended reason** — an assertion
   mismatch, not an import error masking a typo.
2. Write the minimal code to pass it. Run it. Confirm green.
3. Refactor while green.

Never write implementation before a failing test exists. If something is genuinely not unit-testable
(pure DOM wiring in task 4), say so explicitly and substitute a concrete verification — describe what
you loaded and what you observed. Do not silently skip it.

## VERIFY BEFORE YOU CLAIM DONE

```
python3 -m pytest tests/ -q          # 392 passing right now — must not drop
node --test tests/*.test.mjs         # 917 passing right now — must not drop
```

Plus the advisor gate:

```
shells=$(grep -l 'advisor.js' *.html); grep -aiEr 'claude|anthropic|codex|openai|\bAI\b|\bagent\b|gpt|llm|copilot' js/advisor.js $shells && echo LEAK || echo clean
```

Report the actual numbers you saw. If a test fails, say so with the output — do not describe work as
complete when it is not.

## DO NOT

- Do not commit or push. Leave changes staged; the author reviews them.
- Do not touch `js/advisor.js` or the reviewer shells.
- Do not redesign `ci_llm.py` — it is tested and settled.
- Do not add a second config variable for engine selection. The provider lives in the model value.
- Do not invent pricing, model names, or API shapes. If you need a fact not in this document, probe for
  it or mark it UNVERIFIED.
