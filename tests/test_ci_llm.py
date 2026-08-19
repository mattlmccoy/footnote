"""Tests for ci_llm — the provider seam that lets one review run drive either Claude Code or Codex.

Everything here is pure: model-spec parsing, argv construction, response unwrapping, and usage
extraction. The single subprocess boundary (ci_llm.run_llm) is thin and verified live.

The Codex fixtures in tests/fixtures/codex/ were CAPTURED from a real `codex exec --json -o` run
(codex-cli 0.146.0-alpha.9.2, 2026-08-19), not hand-authored. Notably the real usage object carries
five fields — the published docs showed four — which is exactly the kind of drift an invented
fixture would have hidden.
"""
import json
import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-template"))
import ci_llm as L  # noqa: E402

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "codex")


def _fixture(name):
    with open(os.path.join(FIX, name), encoding="utf-8") as f:
        return f.read()


# --------------------------------------------------------------- parse_model_spec
def test_bare_value_means_claude_so_every_existing_config_keeps_working():
    assert L.parse_model_spec("opus") == ("claude", "opus")


def test_codex_prefix_selects_the_codex_provider():
    assert L.parse_model_spec("codex:gpt-5.6-terra") == ("codex", "gpt-5.6-terra")


def test_an_explicit_claude_prefix_is_accepted_and_stripped():
    assert L.parse_model_spec("claude:sonnet") == ("claude", "sonnet")


def test_a_pinned_model_id_containing_a_colon_is_not_mistaken_for_a_provider():
    """A Bedrock-style id ends in a version suffix after a colon. Splitting on the FIRST colon would
    silently route it to a provider named 'anthropic.claude-...'. Only a KNOWN provider prefix may
    split, so this value must pass through to Claude untouched."""
    pinned = "anthropic.claude-3-5-sonnet-20241022-v2:0"
    assert L.parse_model_spec(pinned) == ("claude", pinned)


def test_an_empty_value_falls_back_to_claude_with_an_empty_model():
    assert L.parse_model_spec("") == ("claude", "")


# --------------------------------------------------------------- argv construction
def test_codex_argv_passes_the_directive_as_argv_and_never_as_stdin():
    argv = L.codex_argv("BE A COPY EDITOR", "gpt-5.6-terra", "/tmp/last.txt")
    assert argv[:2] == ["codex", "exec"]
    assert argv[-1] == "BE A COPY EDITOR"      # directive is the final positional
    assert "--json" in argv
    assert argv[argv.index("--model") + 1] == "gpt-5.6-terra"
    assert argv[argv.index("-o") + 1] == "/tmp/last.txt"


def test_codex_argv_defaults_to_a_read_only_sandbox():
    """The author-oversight invariant: the engine returns specs, it never edits the manuscript."""
    argv = L.codex_argv("d", "m", "/tmp/x")
    assert argv[argv.index("--sandbox") + 1] == "read-only"


def test_codex_argv_can_be_opened_up_for_the_local_tool_using_agents():
    argv = L.codex_argv("d", "m", "/tmp/x", sandbox="workspace-write")
    assert argv[argv.index("--sandbox") + 1] == "workspace-write"


def test_claude_argv_is_unchanged_from_todays_invocation():
    argv = L.claude_argv("DIRECTIVE", "opus")
    assert argv == ["claude", "-p", "DIRECTIVE", "--output-format", "json", "--model", "opus"]


# --------------------------------------------------------------- usage extraction
def test_codex_usage_reads_every_field_the_real_cli_emits_including_the_undocumented_one():
    u = L.codex_usage(_fixture("codex-events.jsonl"))
    assert u["input_tokens"] == 15744
    assert u["cached_input_tokens"] == 11008
    assert u["cache_write_input_tokens"] == 0
    assert u["output_tokens"] == 126
    assert u["reasoning_output_tokens"] == 65


def test_codex_usage_reports_cost_as_unknown_rather_than_zero():
    """Codex emits no dollar figure. Reporting 0.0 would render as 'verified cheap' when it means
    'not measured' — the cost must be explicitly absent until the token semantics are settled."""
    u = L.codex_usage(_fixture("codex-events.jsonl"))
    assert u["cost_usd"] is None


def test_codex_usage_survives_a_stream_with_no_completed_turn():
    assert L.codex_usage('{"type":"turn.started"}\n')["input_tokens"] == 0


def test_codex_usage_ignores_unparseable_lines():
    raw = 'not json at all\n{"type":"turn.completed","usage":{"input_tokens":7,"output_tokens":2}}\n'
    assert L.codex_usage(raw)["input_tokens"] == 7


# --------------------------------------------------------------- failure detection
def test_a_turn_failed_event_is_a_failure_even_though_the_stream_parses():
    """The invalid-model run exited 1 but still wrote valid JSONL. Parseable output is not success."""
    raw = ('{"type":"turn.started"}\n'
           '{"type":"turn.failed","error":{"message":"model not supported"}}\n')
    assert L.codex_failed(raw) == "model not supported"


def test_a_completed_turn_is_not_a_failure():
    assert L.codex_failed(_fixture("codex-events.jsonl")) == ""


# --------------------------------------------------------------- response unwrapping
def test_codex_output_is_bare_json_and_parses_directly():
    edits = L.unwrap_payload(_fixture("codex-last.txt"))
    assert [e["before"] for e in edits] == ["reuslt", "signficant", "We seen"]


def test_unwrap_still_recovers_a_fenced_payload():
    assert L.unwrap_payload('```json\n[{"id":"a"}]\n```') == [{"id": "a"}]


def test_unwrap_still_recovers_a_payload_the_model_narrated_around():
    assert L.unwrap_payload('Here are my edits:\n[{"id":"a"}]\nHope that helps.') == [{"id": "a"}]


def test_unwrap_returns_none_on_unrecoverable_output():
    assert L.unwrap_payload("I could not complete this task.") is None


# --------------------------------------------------------------- credential detection
def test_codex_is_configured_by_either_recognized_key():
    assert L.ai_configured({"CODEX_API_KEY": "sk-x"}, "codex")
    assert L.ai_configured({"OPENAI_API_KEY": "sk-x"}, "codex")


def test_a_claude_credential_does_not_enable_codex():
    assert not L.ai_configured({"CLAUDE_CODE_OAUTH_TOKEN": "tok"}, "codex")


def test_a_codex_credential_does_not_enable_claude():
    assert not L.ai_configured({"CODEX_API_KEY": "sk-x"}, "claude")


def test_blank_credentials_do_not_count_as_configured():
    assert not L.ai_configured({"CODEX_API_KEY": "   "}, "codex")


def test_an_unknown_provider_is_never_configured():
    assert not L.ai_configured({"CODEX_API_KEY": "sk-x"}, "gemini")


# --------------------------------------------------------------- claude usage (moved into the seam)
def test_claude_usage_sums_fresh_and_cached_input_as_the_whole_billed_context():
    raw = json.dumps({"total_cost_usd": 0.25, "usage": {
        "input_tokens": 100, "cache_read_input_tokens": 20,
        "cache_creation_input_tokens": 5, "output_tokens": 7}})
    u = L.claude_usage(raw)
    assert u["input_tokens"] == 125
    assert u["output_tokens"] == 7
    assert u["cost_usd"] == 0.25


def test_claude_usage_accepts_the_older_cost_key():
    assert L.claude_usage(json.dumps({"cost_usd": 0.5, "usage": {}}))["cost_usd"] == 0.5


def test_claude_usage_zeroes_on_unparseable_output():
    assert L.claude_usage("not json")["cost_usd"] == 0.0


def test_claude_cost_is_a_real_zero_not_an_absent_measurement():
    """Claude REPORTS a dollar figure, so 0.0 means 'this call cost nothing' — unlike Codex, where a
    zero would mean 'not measured'. The two must stay distinguishable."""
    assert L.claude_usage(json.dumps({"total_cost_usd": 0.0, "usage": {}}))["cost_usd"] == 0.0
    assert L.codex_usage('{"type":"turn.completed","usage":{}}')["cost_usd"] is None


def test_usage_for_dispatches_on_provider():
    assert L.usage_for("claude", json.dumps({"total_cost_usd": 1.0, "usage": {}}))["cost_usd"] == 1.0
    assert L.usage_for("codex", _fixture("codex-events.jsonl"))["input_tokens"] == 15744


# --------------------------------------------------------------- end-to-end config routing
# The point of folding the provider into the model value: per-agent engine choice needs NO new
# plumbing. The existing AGENT_MODELS / CLAUDE_MODEL resolution already carries it.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-template"))
import ci_review_common as R  # noqa: E402


def test_an_agent_can_be_pointed_at_codex_through_the_existing_agent_models_variable():
    env = {"AGENT_MODELS": json.dumps({"critic": "codex:gpt-5.6-terra"}), "CLAUDE_MODEL": "opus"}
    assert L.parse_model_spec(R.resolve_agent_model("critic", env)) == ("codex", "gpt-5.6-terra")


def test_agents_without_an_override_still_run_on_the_global_claude_default():
    env = {"AGENT_MODELS": json.dumps({"critic": "codex:gpt-5.6-terra"}), "CLAUDE_MODEL": "opus"}
    assert L.parse_model_spec(R.resolve_agent_model("writer", env)) == ("claude", "opus")


def test_the_whole_run_can_be_switched_to_codex_with_one_global_value():
    assert L.parse_model_spec(R.resolve_agent_model("anything", {"CLAUDE_MODEL": "codex:gpt-5.6-sol"})) \
        == ("codex", "gpt-5.6-sol")


def test_an_installed_config_with_no_codex_anywhere_is_completely_unaffected():
    for agent in ("writer", "critic", ""):
        assert L.parse_model_spec(R.resolve_agent_model(agent, {}))[0] == "claude"


# --------------------------------------------------------------- codex cost estimate
# Token semantics settled empirically 2026-08-19 (probe 2): a cache-cold and cache-warm run of
# IDENTICAL content both reported input_tokens=57867 while cached_input_tokens went 0 -> 6912.
# input_tokens is therefore INCLUSIVE of cached_input_tokens; adding them would double-bill.
def test_uncached_input_is_the_difference_not_the_sum():
    u = {"input_tokens": 57867, "cached_input_tokens": 6912,
         "cache_write_input_tokens": 0, "output_tokens": 0}
    # terra: $2/Mtok uncached, $0.2/Mtok cached
    cost = L.codex_cost("gpt-5.6-terra", u)
    expected = (57867 - 6912) / 1e6 * 2.0 + 6912 / 1e6 * 0.2
    assert cost == pytest.approx(expected)


def test_output_tokens_are_billed_at_the_output_rate():
    u = {"input_tokens": 0, "cached_input_tokens": 0,
         "cache_write_input_tokens": 0, "output_tokens": 1_000_000}
    assert L.codex_cost("gpt-5.6-terra", u) == pytest.approx(12.0)


def test_each_tier_uses_its_own_verified_rates():
    """100K input tokens — deliberately under the 272K long-prompt threshold so this measures the
    base rates alone. The multiplier has its own test."""
    m = {"input_tokens": 100_000, "cached_input_tokens": 0,
         "cache_write_input_tokens": 0, "output_tokens": 0}
    assert L.codex_cost("gpt-5.6-sol", m) == pytest.approx(0.5)
    assert L.codex_cost("gpt-5.6-terra", m) == pytest.approx(0.2)
    assert L.codex_cost("gpt-5.6-luna", m) == pytest.approx(0.02)


def test_a_very_long_prompt_doubles_input_and_multiplies_output():
    """OpenAI: prompts over 272K input tokens bill at 2x input and 1.5x output for the FULL request.
    A whole-manuscript review can cross that line, so the cap must see the real figure."""
    u = {"input_tokens": 300_000, "cached_input_tokens": 0,
         "cache_write_input_tokens": 0, "output_tokens": 1_000_000}
    expected = (300_000 / 1e6 * 2.0) * 2 + 12.0 * 1.5
    assert L.codex_cost("gpt-5.6-terra", u) == pytest.approx(expected)


def test_an_unpriced_model_yields_no_estimate_rather_than_a_free_one():
    """A model we have no verified rate for must report cost as UNKNOWN. Returning 0.0 would let an
    unmetered run read as free and slip past the cost cap."""
    u = {"input_tokens": 999_999, "cached_input_tokens": 0,
         "cache_write_input_tokens": 0, "output_tokens": 999_999}
    assert L.codex_cost("some-unreleased-model", u) is None


def test_codex_usage_now_estimates_cost_when_the_model_is_known():
    u = L.codex_usage(_fixture("codex-events.jsonl"), model="gpt-5.6-terra")
    assert u["cost_usd"] == pytest.approx((15744 - 11008) / 1e6 * 2.0
                                          + 11008 / 1e6 * 0.2
                                          + 126 / 1e6 * 12.0)
    assert u["cost_estimated"] is True


def test_codex_usage_without_a_model_still_reports_cost_as_unknown():
    u = L.codex_usage(_fixture("codex-events.jsonl"))
    assert u["cost_usd"] is None


def test_a_claude_cost_is_never_marked_estimated():
    """Claude's figure is billed, Codex's is derived. The UI must be able to tell them apart."""
    assert L.claude_usage(json.dumps({"total_cost_usd": 1.0, "usage": {}}))["cost_estimated"] is False


# --------------------------------------------------------------- the WRITER must be selectable
# The writer is the agent that actually drafts prose edits. Pointing IT at Codex is the whole point
# of this feature, so it must honor a per-agent override rather than only the global default.
import ci_apply as A  # noqa: E402


def _capture_model(monkeypatch):
    seen = {}

    def fake(directive, context, model, label, sandbox="read-only"):
        seen["model"] = model
        seen["label"] = label
        return None
    monkeypatch.setattr(A, "_run_claude", fake)
    return seen


def test_the_prose_writer_honors_its_own_agent_models_override(monkeypatch, tmp_path):
    seen = _capture_model(monkeypatch)
    monkeypatch.setenv("AGENT_MODELS", json.dumps({"writer": "codex:gpt-5.6-terra"}))
    monkeypatch.setenv("CLAUDE_MODEL", "opus")
    A.run_writer_cli({"chapter": "ch1"}, catalog={}, field="", writer_id="writer")
    assert L.parse_model_spec(seen["model"]) == ("codex", "gpt-5.6-terra")


def test_the_figure_drafter_is_selectable_independently_of_the_prose_writer(monkeypatch):
    seen = _capture_model(monkeypatch)
    monkeypatch.setenv("AGENT_MODELS", json.dumps({
        "writer": "codex:gpt-5.6-terra", "figure-drafter": "opus"}))
    monkeypatch.setenv("CLAUDE_MODEL", "opus")
    A.run_writer_cli({"chapter": "ch1"}, catalog={}, field="", writer_id="figure-drafter")
    assert L.parse_model_spec(seen["model"]) == ("claude", "opus")


def test_a_writer_with_no_override_still_falls_back_to_the_global_default(monkeypatch):
    seen = _capture_model(monkeypatch)
    monkeypatch.delenv("AGENT_MODELS", raising=False)
    monkeypatch.setenv("CLAUDE_MODEL", "opus")
    A.run_writer_cli({"chapter": "ch1"}, catalog={}, field="", writer_id="writer")
    assert L.parse_model_spec(seen["model"]) == ("claude", "opus")
