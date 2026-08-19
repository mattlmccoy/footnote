"""ci_llm.py — the provider seam.

Footnote drives a headless coding CLI to turn reviewer comments into edit SPECS. Which CLI is a
per-agent choice: Claude Code (`claude -p`) or OpenAI Codex (`codex exec`). Everything downstream —
the spec parsers, the deterministic apply engine, staging, approval — is provider-agnostic and
untouched by that choice.

Both cloud (`ci_apply.py`, GitHub Actions) and local (`ci_local.py`, the operator's machine) route
through here, so the engine decision lives in exactly one place.

Everything in this module is pure except ``run_llm``, which holds the single subprocess call.

The Codex behaviors encoded here were CAPTURED from a real run (codex-cli 0.146.0-alpha.9.2), not
taken from documentation — the published usage sample was already out of date by one field. See
tests/fixtures/codex/ and tests/test_ci_llm.py.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

# Provider prefixes recognized in a model value. A value is only split when its prefix is one of
# these; see parse_model_spec for why that matters.
PROVIDERS = ("claude", "codex")

DEFAULT_PROVIDER = "claude"

# Credentials each engine's CLI honors. Claude prefers a subscription token; Codex in CI uses an API
# key (locally it uses the ambient `codex login` session and needs nothing here).
CRED_ENVS = {
    "claude": ("CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"),
    "codex": ("CODEX_API_KEY", "OPENAI_API_KEY"),
}


def parse_model_spec(value):
    """Split a configured model value into ``(provider, model)``.

    A BARE value means Claude, so every ``CLAUDE_MODEL`` / ``AGENT_MODELS`` value that exists today
    keeps meaning exactly what it means today — no config migration.

    The split only happens on a KNOWN provider prefix. That is the whole point: a pinned Bedrock-style
    id such as ``anthropic.claude-3-5-sonnet-20241022-v2:0`` contains a colon of its own, and naive
    first-colon splitting would route it to a nonexistent provider and silently break an adopter's
    pinned model. Pure."""
    s = str(value if value is not None else "").strip()
    head, sep, tail = s.partition(":")
    if sep and head in PROVIDERS:
        return (head, tail.strip())
    return (DEFAULT_PROVIDER, s)


def ai_configured(env, provider):
    """True when ``env`` carries a non-empty credential the given provider's CLI recognizes. When it
    does not, jobs for that engine are left QUEUED — an honest 'nothing runs until you connect it'
    rather than a failed run. Unknown providers are never configured. Pure."""
    return any((env or {}).get(name, "").strip() for name in CRED_ENVS.get(provider, ()))


# --------------------------------------------------------------- argv construction
# Both CLIs take a SHORT directive as an argument and the (potentially huge) manuscript on piped
# stdin. A whole paper exceeds the OS argv size limit, so it cannot travel as an argument.

def claude_argv(directive, model):
    """The headless Claude Code invocation. Unchanged from what ci_apply has always run. Pure."""
    return ["claude", "-p", directive, "--output-format", "json", "--model", model]


def codex_argv(directive, model, out_path, sandbox="read-only"):
    """The headless Codex invocation.

    ``--json`` gives the JSONL event stream (the only place usage is reported) and ``-o`` writes the
    final assistant message to ``out_path`` — verified byte-identical to the stream's last
    agent_message, with no trailing newline, so it is the cleanest thing to parse.

    ``--sandbox read-only`` is the default because the engine's job is to RETURN specs, never to edit
    the manuscript. That turns Footnote's author-oversight invariant from a prompt-level request into
    something the sandbox enforces. ci_local's tool-using agents pass ``workspace-write``. Pure."""
    return ["codex", "exec", "--json", "--sandbox", sandbox,
            "--model", model, "-o", out_path, directive]


# --------------------------------------------------------------- response unwrapping
def unwrap_payload(text):
    """The JSON payload the model returned, or None if nothing is recoverable.

    Codex returns bare JSON, so the direct parse is the hot path. The fence-strip and the
    balanced-scan fallback stay because Claude sometimes fences its answer and either model may
    narrate around it on a hard edit. Pure."""
    s = text or ""
    try:
        return json.loads(s)
    except (ValueError, TypeError):
        pass
    m = re.search(r"```(?:json)?\s*(.*?)```", s, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except (ValueError, TypeError):
            pass
    return first_json_value(s)


def first_json_value(text):
    """The first balanced JSON array or object embedded anywhere in ``text`` (decoded), or None.
    Matches brackets while respecting strings and escapes, so prose on either side of the payload
    does not defeat the parse. Pure."""
    s = text or ""
    starts = [i for i in (s.find("["), s.find("{")) if i >= 0]
    for start in sorted(starts):
        close = "]" if s[start] == "[" else "}"
        depth, in_str, esc = 0, False, False
        for i in range(start, len(s)):
            ch = s[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
                continue
            if ch == '"':
                in_str = True
            elif ch in "[{":
                depth += 1
            elif ch in "]}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(s[start:i + 1])
                    except (ValueError, TypeError):
                        break
    return None


# --------------------------------------------------------------- usage + failure
# Per-million-token rates, from OpenAI's own model pages (fetched 2026-08-19):
# (uncached_input, cached_input, output). A model absent from this table has NO estimate — see
# codex_cost. Rates change; this table is the thing to re-verify when they do.
CODEX_PRICES = {
    "gpt-5.6-sol":   (5.0, 0.5, 30.0),
    "gpt-5.6-terra": (2.0, 0.2, 12.0),
    "gpt-5.6-luna":  (0.2, 0.02, 1.2),
}

# OpenAI bills prompts above this many input tokens at 2x input / 1.5x output for the whole request.
# A whole-manuscript review can cross it, so the cost cap must see the real figure.
LONG_PROMPT_TOKENS = 272_000
LONG_PROMPT_INPUT_MULT = 2.0
LONG_PROMPT_OUTPUT_MULT = 1.5

# Cache WRITES bill at 1.25x the uncached input rate (OpenAI docs). Codex reports
# cache_write_input_tokens, but every observed run returned 0 — including a run that demonstrably
# READ 6,912 cached tokens. So the field is not a cache indicator, and whether it is counted inside
# input_tokens is UNVERIFIED. It is billed additively here, which is a no-op while it stays 0; if it
# ever goes nonzero, re-verify before trusting the figure.
CACHE_WRITE_MULT = 1.25


def codex_cost(model, usage):
    """Estimated USD for one Codex call, or None when the model has no verified rate.

    None, never 0.0: an unpriced model must not read as a free one, or an unmetered run slips past
    the cost cap looking healthy.

    Token semantics were settled empirically, not assumed (probe 2, 2026-08-19): a cache-cold and a
    cache-warm run of identical content both reported input_tokens=57867 while cached_input_tokens
    went 0 -> 6912. ``input_tokens`` is therefore INCLUSIVE of ``cached_input_tokens``, so uncached
    input is their DIFFERENCE. Summing them would double-bill every cached token. Pure."""
    rates = CODEX_PRICES.get(str(model or "").strip())
    if not rates:
        return None
    rate_in, rate_cached, rate_out = rates
    total_in = int(usage.get("input_tokens", 0) or 0)
    cached = int(usage.get("cached_input_tokens", 0) or 0)
    written = int(usage.get("cache_write_input_tokens", 0) or 0)
    out = int(usage.get("output_tokens", 0) or 0)
    uncached = max(0, total_in - cached)

    input_cost = (uncached * rate_in + cached * rate_cached
                  + written * rate_in * CACHE_WRITE_MULT) / 1e6
    output_cost = out * rate_out / 1e6
    if total_in > LONG_PROMPT_TOKENS:
        input_cost *= LONG_PROMPT_INPUT_MULT
        output_cost *= LONG_PROMPT_OUTPUT_MULT
    return input_cost + output_cost


CODEX_USAGE_FIELDS = ("input_tokens", "cached_input_tokens", "cache_write_input_tokens",
                      "output_tokens", "reasoning_output_tokens")


def _jsonl(raw):
    """Every parseable JSON object in a JSONL stream, skipping garbage lines. Pure."""
    for line in (raw or "").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except (ValueError, TypeError):
            continue
        if isinstance(obj, dict):
            yield obj


def codex_usage(raw, model=None):
    """Token usage from a `codex exec --json` stream: the last ``turn.completed`` event's ``usage``.

    All five fields the real CLI emits are carried, including ``cache_write_input_tokens``, which the
    published documentation's sample omitted — a parser built from the docs would have silently
    dropped a billable category.

    ``cost_usd`` is None, not 0.0. Codex reports no dollar figure, and a zero would render as
    'verified cheap' when it actually means 'not measured'. It stays explicitly absent until the
    inclusive-vs-additive question about ``input_tokens`` is settled empirically. Pure."""
    out = {k: 0 for k in CODEX_USAGE_FIELDS}
    out["cost_usd"] = None
    out["cost_estimated"] = True
    for obj in _jsonl(raw):
        if obj.get("type") == "turn.completed" and isinstance(obj.get("usage"), dict):
            for k in CODEX_USAGE_FIELDS:
                try:
                    out[k] = int(obj["usage"].get(k, 0) or 0)
                except (ValueError, TypeError):
                    out[k] = 0
    if model:
        out["cost_usd"] = codex_cost(model, out)
    return out


def codex_failed(raw):
    """The failure message if the stream reports ``turn.failed``, else ''.

    An invalid-model run exits non-zero yet still writes well-formed JSONL, and writes no ``-o`` file.
    So neither 'the stream parsed' nor 'the output file exists' can stand in for success — the exit
    code and this event are the signals. Pure."""
    for obj in _jsonl(raw):
        if obj.get("type") == "turn.failed":
            return str((obj.get("error") or {}).get("message", "") or "failed")
    return ""


def claude_usage(raw):
    """Billed usage from a `claude --output-format json` envelope.

    ``input_tokens`` sums fresh + cache-read + cache-creation input: the whole context actually
    billed. Newer CLIs report ``total_cost_usd``, older ones ``cost_usd``. Zeros on anything
    unparseable.

    Note the asymmetry with codex_usage: Claude REPORTS a dollar figure, so ``cost_usd: 0.0`` here
    truthfully means the call cost nothing. Codex reports none, so its cost is None. Collapsing the
    two would let 'not measured' render as 'free'. Pure."""
    zero = {"cost_usd": 0.0, "cost_estimated": False, "input_tokens": 0, "output_tokens": 0}
    try:
        env = json.loads(raw)
    except (ValueError, TypeError):
        return dict(zero)
    if not isinstance(env, dict):
        return dict(zero)
    cost = env.get("total_cost_usd", env.get("cost_usd", 0.0)) or 0.0
    u = env.get("usage") or {}

    def _i(k):
        try:
            return int(u.get(k, 0) or 0)
        except (ValueError, TypeError):
            return 0

    return {"cost_usd": float(cost), "cost_estimated": False,
            "input_tokens": _i("input_tokens") + _i("cache_read_input_tokens") + _i("cache_creation_input_tokens"),
            "output_tokens": _i("output_tokens")}


def usage_for(provider, raw, model=None):
    """One call's usage, parsed the way ``provider`` reports it. Pure."""
    return codex_usage(raw, model=model) if provider == "codex" else claude_usage(raw)


# --------------------------------------------------------------- the one live boundary
def run_llm(spec, directive, context, label, sandbox="read-only", usage_acc=None):
    """Run one engine and return its raw final message, or None on failure.

    ``spec`` is a ``(provider, model)`` from parse_model_spec. Returning None on a missing CLI or a
    failed run is the contract the whole queue depends on: a broken or absent engine leaves the job
    QUEUED rather than crashing the drain or, worse, marking a comment handled with no edit."""
    provider, model = spec
    tmp = None
    try:
        if provider == "codex":
            fd, tmp = tempfile.mkstemp(prefix="codex-last-", suffix=".txt")
            os.close(fd)
            argv = codex_argv(directive, model, tmp, sandbox=sandbox)
        else:
            argv = claude_argv(directive, model)

        try:
            proc = subprocess.run(argv, input=context, capture_output=True, text=True)
        except OSError as e:
            print(f"[llm] {label}: {provider} CLI unavailable ({e}) — leaving job", file=sys.stderr)
            _bump(usage_acc, "errors")
            return None

        if proc.returncode != 0:
            why = codex_failed(proc.stdout) if provider == "codex" else ""
            detail = why or (proc.stderr or "")[:300]
            print(f"[llm] {label}: {provider} failed ({proc.returncode}): {detail}", file=sys.stderr)
            _bump(usage_acc, "errors", last_error=detail[:200])
            return None

        if provider == "codex":
            why = codex_failed(proc.stdout)
            if why:                      # exited 0 but the turn itself failed
                print(f"[llm] {label}: codex turn failed: {why}", file=sys.stderr)
                _bump(usage_acc, "errors", last_error=why[:200])
                return None
            _accumulate(usage_acc, codex_usage(proc.stdout, model=model))
            with open(tmp, encoding="utf-8") as f:
                return f.read()
        _accumulate(usage_acc, claude_usage(proc.stdout))
        return proc.stdout
    finally:
        if tmp and os.path.exists(tmp):
            os.unlink(tmp)


def _bump(acc, key, last_error=None):
    if acc is None:
        return
    acc[key] = (acc.get(key, 0) or 0) + 1
    if last_error is not None:
        acc["last_error"] = last_error


def _accumulate(acc, usage):
    """Fold one call's usage into the run accumulator. A None cost is left absent rather than added
    as zero, so 'not measured' never masquerades as 'cost nothing'."""
    if acc is None:
        return
    acc["calls"] = (acc.get("calls", 0) or 0) + 1
    acc["input_tokens"] = (acc.get("input_tokens", 0) or 0) + usage.get("input_tokens", 0)
    acc["output_tokens"] = (acc.get("output_tokens", 0) or 0) + usage.get("output_tokens", 0)
    if usage.get("cost_usd") is None:
        acc["cost_unmeasured_calls"] = (acc.get("cost_unmeasured_calls", 0) or 0) + 1
    else:
        acc["cost_usd"] = (acc.get("cost_usd", 0.0) or 0.0) + usage["cost_usd"]
