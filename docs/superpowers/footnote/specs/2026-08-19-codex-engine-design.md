# OpenAI Codex as a second AI engine (cloud + local)

**Date:** 2026-08-19
**Repo:** `mattlmccoy/footnote` · **Branch:** `feat/codex-engine` (to be created)
**Builds on:** the existing Claude Code cloud/local review pipeline (`ci_apply.py`, `ci_local.py`,
`ci_review_common.py`) and the per-agent model registry (`js/aimodels.js`).

## Goal

Let an adopter run Footnote's review pipeline on **OpenAI Codex** as well as **Claude Code**, chosen
**per agent**, in both the CLOUD route (GitHub Actions) and the LOCAL route (operator's machine) —
without changing a single line of the deterministic comment -> spec -> stage -> approve -> merge path.

## Hard constraints

- **Non-breaking.** Every existing `CLAUDE_MODEL` / `AGENT_MODELS` value keeps meaning exactly what it
  means today. No config migration. AI stays off by default; the AI-free core path is untouched.
- **Author-oversight preserved.** Codex, like Claude, only ever returns edit SPECS. It never mutates the
  reviewed document's source and never merges.
- **Advisor bundle stays assistant-free.** No `codex` / `openai` string may reach `advisor.js` or the
  generated reviewer shells.
- **Serverless.** Runs on the adopter's own Actions with the adopter's own credential.

## Why this is small: the AI boundary is already one function

| Concern | Today |
|---|---|
| The single CLI call | `ci_apply.py:256` `_run_claude()` |
| Credential detection | `ci_apply.py:48` `CLAUDE_CRED_ENVS` / `claude_configured()` |
| Envelope unwrap | `ci_apply.py:126` `_parse_claude_json()` |
| Cost/token accounting | `ci_apply.py:190` `claude_usage()` |
| Model resolution | `ci_review_common.py:819` `resolve_agent_model()`, `DEFAULT_MODEL = "opus"` |
| CLI install + env | `data-template/workflows/apply.yml:47-76` |
| Browser model registry | `js/aimodels.js` |
| Browser secret sealing | `js/ghsecrets.js:150` `aiSecretsPlan()` / `claudeConnectionStatus()` |
| Browser credential docs | `js/tokenscopes.js:140` |

Everything downstream of `_run_claude` (`parse_claude_edits`, `parse_agent_findings`, the deterministic
apply engine, staging, approval) already operates on plain text and is provider-agnostic. The work is a
seam at one place plus a mirrored UI.

## Verified facts

Probe run 2026-08-19 on `codex-cli 0.146.0-alpha.9.2`, ChatGPT-plan auth. Fixtures captured to
`data-template/tests/fixtures/codex/` and verified on disk — NOT transcribed, NOT authored.

**CONFIRMED against the real CLI:**

- **Prompt argv + piped stdin composes.** The model acted on content that existed only in stdin;
  stderr logged `Reading additional input from stdin...`. This is the exact split Footnote needs.
- **`-o` is byte-identical to the final `item.completed` agent_message text.** 161 bytes, `cmp`
  exit 0, **no trailing newline**, reasoning excluded. `codex-last.txt` ends at `]` (0x5d).
- **Output was bare JSON** — no ```json fence, no narration. The existing fence-stripper and
  `_first_json_value` recovery in `_parse_model_json` remain useful as fallbacks but will not be the
  hot path.
- **Event sequence:** `thread.started` -> `turn.started` -> `item.completed` -> `turn.completed`.
- **Failure contract (invalid model):** exit code **1**, `-o` file **absent**, stdout still valid
  JSONL carrying BOTH `{"type":"error"}` and `{"type":"turn.failed"}`. Stderr carried unrelated WARN
  noise. **The integration must key on exit code / `turn.failed`, never on absence of the `-o` file**,
  and must not treat parseable stdout as evidence of success.

**CORRECTION to the docs-derived design:** the real `usage` object has **five** fields, not the four
the public sample showed. It includes `cache_write_input_tokens`:

```json
{"input_tokens":15744,"cached_input_tokens":11008,"cache_write_input_tokens":0,
 "output_tokens":126,"reasoning_output_tokens":65}
```

A parser written against the documented four-field shape would have silently ignored a billable
category. The usage parser is written against the captured fixture, not the docs.

**RESOLVED — token accounting is INCLUSIVE.** Probe 2 ran a cache-cold and a cache-warm invocation of
identical content. Both reported `input_tokens: 57867`; `cached_input_tokens` went `0` -> `6912`. If the
fields were additive the warm run would have reported a larger total. Therefore:

```
uncached input = input_tokens - cached_input_tokens
cached input   = cached_input_tokens
total input    = input_tokens
```

`cache_write_input_tokens` stayed `0` in both runs even though the warm run demonstrably READ 6,912
cached tokens. It is therefore **not** a cache indicator, and whether it sits inside `input_tokens` is
UNVERIFIED. It is billed additively (a no-op while it stays 0) and flagged in code.

**RESOLVED — the cloud route is viable.** The "trusted directory" message is a Git-repository-presence
check, not a per-project trust gate. A fresh `git clone` into a directory Codex had never seen ran
unattended: exit 0, no prompt, no `projects.*.trust_level` entry required. A GitHub Actions workspace is
a checkout, so `codex exec` runs there as-is. `--skip-git-repo-check` exists for non-Git directories and
`-C <dir>` sets the working root; neither is needed for the normal path.

**Pricing (verified from OpenAI's model pages, 2026-08-19)**, $/Mtok as (uncached, cached, output):
`gpt-5.6-sol` (5.0, 0.5, 30.0) · `gpt-5.6-terra` (2.0, 0.2, 12.0) · `gpt-5.6-luna` (0.2, 0.02, 1.2).
Prompts over 272K input tokens bill at 2x input / 1.5x output for the whole request — reachable on a
whole-manuscript review, so it is applied. Cache writes bill at 1.25x the uncached input rate. A model
absent from the table yields **no estimate** (None), never 0.0.

**Model availability.** All three models were accepted under ChatGPT-plan auth. Availability under
API-key auth on Actions is UNVERIFIED and will be confirmed by the first live cloud run.

**CLI maturity.** `0.146.0-alpha.9.2` is an alpha. The JSONL shape is a moving target and already
differs from the published docs, so `apply.yml` must **pin an exact CLI version** rather than
installing latest.

## Design

### 1. The seam: `data-template/ci_llm.py` (new, ~200 lines)

Chosen over branching inside `_run_claude` (`ci_apply.py` is already ~1,600 lines against the 400-line
house target, and `ci_local.py` would have to reach into `ci_apply` to reuse it) and over a bash adapter
(moves logic out of Python where it cannot be unit-tested).

Model values carry the provider:

```
parse_model_spec("codex:gpt-5.6-terra") -> ("codex", "gpt-5.6-terra")
parse_model_spec("opus")                -> ("claude", "opus")     # bare == claude
```

Backward compatibility falls out of the bare-value rule: no existing config changes meaning.

A `PROVIDERS` registry where each backend declares `argv()`, `cred_envs`, `unwrap()`, `usage()`. One
function `run_llm(spec, directive, context, label)` holds the single `subprocess.run`, preserving today's
contract: **return `None` on a missing CLI or non-zero exit so the job stays QUEUED** rather than
crashing the drain.

`_run_claude()` becomes a three-line delegate, so `run_agent_cli`, `run_claude_cli`, and `run_writer_cli`
are untouched.

### 2. The Codex backend

- **argv:** `codex exec --json --sandbox read-only --model <m> -o <tmp> <directive>`, manuscript on stdin.
- **unwrap:** read `<tmp>`, then feed the EXISTING fence-stripper and `_first_json_value` recovery in
  `_parse_claude_json` — renamed `_parse_model_json`, as it stops being Claude-specific. Downstream
  parsing is unchanged.
- **usage:** the last `turn.completed` event in the JSONL stream.
- `--sandbox read-only` upgrades "the model never edits files, only returns specs" from a prompt-level
  promise to a kernel-enforced one. A real hardening of the author-oversight invariant, for free.
- `ci_local.py`'s tool-using agents get `--sandbox workspace-write` instead. This maps exactly onto the
  `execution: "local"` vs `"ci"` split already in the agent catalog (`ci_local.py:11`).

### 3. Credentials

- `CODEX_CRED_ENVS = ("CODEX_API_KEY", "OPENAI_API_KEY")`; `claude_configured()` generalizes to
  `ai_configured(env, provider)`.
- **Cloud:** seal `CODEX_API_KEY` through the same sealed-secret path as `CLAUDE_CODE_OAUTH_TOKEN`.
- **Local:** use the ambient `~/.codex` login from `codex login`. No secret needed on the operator's
  own machine, and it bills an existing ChatGPT plan rather than the API.
- `apply.yml` installs BOTH CLIs, each `|| echo`-guarded, so an absent one leaves jobs queued instead of
  failing the run.
- Browser mirror: `aiSecretsPlan` gains `codexApiKey`; `claudeConnectionStatus` becomes
  `aiConnectionStatus` returning per-provider status; `tokenscopes.js` gains a `codex` entry.

### 4. Model registry

`js/aimodels.js` gains entries whose `value` is the full provider-prefixed spec
(`codex:gpt-5.6-sol` / `terra` / `luna`), tiered to mirror opus/sonnet/haiku. Each entry ALSO carries a
derived `provider` field — redundant with the prefix, but it is what the picker groups by, so the UI
never re-parses the string. `resolveModel` keeps passing values through unchanged. Python `DEFAULT_MODEL` stays `opus` — existing
adopters see no behavior change.

### 5. Budget: mimic the Claude workflow

Decision: same knobs, same caps, same UI on both engines. Codex reports tokens but no dollars, so a
`PRICES` table (per-model $/Mtok for input, cached input, output) converts tokens to USD and
`COST_CAP_USD` trips identically to Claude.

The derived figure is tagged `estimated: True` and renders as **"$0.42 est."** everywhere it appears, so
a derived number is never mistaken for a billed one. `MAX_CLAUDE_CALLS` and `MAX_CLAUDE_ERRORS` need no
dollars and work unchanged.

### 6. Testing

Red-green throughout. Per the data-contract rule, fixtures are **captured, not authored**.

**Phase 0 (must precede any implementation):** install `codex`, run one real
`codex exec --json -o <file>` against a small task, save stdout JSONL + the last-message file into
`data-template/tests/fixtures/codex/`, and answer the `input_tokens`-inclusive-of-cached question from
the captured numbers.

**Pure unit tests (Python):** `parse_model_spec` both directions; Codex argv construction; usage
extraction against the CAPTURED JSONL; `unwrap` against the CAPTURED last-message file; price math;
`ai_configured` per provider; and a regression that bare `opus` still resolves to Claude.

**Pure unit tests (JS):** extensions to `aimodels.test.mjs`, `ghsecrets.test.mjs`, `tokenscopes.test.mjs`.

**Integration:** one real end-to-end cloud run against a throwaway comment before shipping.

### 7. Targeted improvement in code being touched

The README claims the advisor bundle is "grep-clean of assistant references," but no test enforces it —
`tests/advisor-*.test.mjs` has no such gate. Adding a second engine doubles the vocabulary that could
leak to external reviewers, so this adds the automated gate covering both `claude` and `codex`.

## Known risks

- **Token semantics unverified.** The USD estimate depends on whether `input_tokens` includes
  `cached_input_tokens`. Resolved in Phase 0; the price math is not written until it is.
- **Codex model ids expire on dates.** `gpt-5.4` retires 2026-08-31. Unlike the `opus`/`sonnet` aliases,
  which resolve to the latest tier with zero code change, the Codex half of the registry needs periodic
  review. A real ongoing maintenance cost the Claude side does not carry.
- **Estimated cost can drift.** If OpenAI reprices, the `PRICES` table goes stale and the cap trips at
  the wrong threshold. Mitigated by the "est." labelling, not eliminated.

## Out of scope

- Codex Cloud / the OpenAI GitHub App reviewing PRs directly (bypasses the Footnote queue rather than
  feeding it).
- Calling the OpenAI HTTP API without the CLI.
- Sealing ChatGPT `auth.json` into cloud Actions secrets.
