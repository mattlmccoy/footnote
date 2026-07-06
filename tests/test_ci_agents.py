"""Tests for ci_agents — the shipped agent catalog (bundled builtins) and the pure resolver that
turns a bare agent name into a real system-prompt directive, with legacy back-compat.

B1 of the agent network. Everything here is pure (no git, no network, no live Claude) so it runs
under pytest; the live ``claude -p`` boundary stays in ci_apply.run_agent_cli, verified on Actions.
"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-template"))
import ci_agents as C  # noqa: E402
import ci_apply as A  # noqa: E402


# --------------------------------------------------------------- bundled builtin catalog
DEFAULT_ON = {"rigor", "clarity", "citations", "structure", "copyedit"}
CRITIC_IDS = DEFAULT_ON | {"figure", "domain", "technical", "methods", "reasoning", "evidence"}
DOER_IDS = {"writer", "figure-drafter", "responder", "patterns", "reproduce"}
ALL_IDS = CRITIC_IDS | DOER_IDS


def test_builtin_catalog_ships_every_active_fleet_role():
    # the whole tuned fleet is represented (retired kaggle-miner / tdd-guide excluded), generalized
    cat = C.builtin_catalog()
    assert set(cat.keys()) == ALL_IDS
    for a in cat.values():
        assert a["category"] in ("critic", "doer")
        assert a["builtin"] is True
        assert a["systemPrompt"].strip()          # a real prompt, not a bare name
        assert a["displayName"].strip()
        assert a["description"].strip()
        assert isinstance(a["docTypes"], list) and a["docTypes"]
        assert isinstance(a["triggers"], list)
        assert isinstance(a["version"], int)


def test_critics_produce_findings_and_doers_do_not():
    cat = C.builtin_catalog()
    assert {i for i, a in cat.items() if a["category"] == "critic"} == CRITIC_IDS
    assert {i for i, a in cat.items() if a["category"] == "doer"} == DOER_IDS
    for i in CRITIC_IDS:
        assert cat[i]["outputContract"] == "findings"
    for i in DOER_IDS:
        assert cat[i]["outputContract"] != "findings"   # doers act via a later lane, not run-agents


def test_exactly_five_critics_default_on_and_no_doer_is_on():
    cat = C.builtin_catalog()
    on = {i for i, a in cat.items() if a.get("defaultOn")}
    assert on == DEFAULT_ON
    assert set(C.default_on_ids()) == DEFAULT_ON
    assert not (on & DOER_IDS)                          # a doer is never selected by default


def test_technical_critic_is_code_scoped_and_off_by_default():
    tech = C.builtin_catalog()["technical"]
    assert tech["defaultOn"] is False
    assert tech["docTypes"] == ["code"]


def test_doers_are_registered_but_not_run_by_run_agents():
    # B1 catalogs the fleet's doers (writer/responder/…) but run-agents is read-only — it must NOT
    # execute a doer as if it were a critic. Unknown/legacy names stay runnable (back-compat).
    cat = C.builtin_catalog()
    assert C.is_runnable("rigor", cat) is True
    assert C.is_runnable("writer", cat) is False
    assert C.is_runnable("responder", cat) is False
    assert C.is_runnable("some-legacy-agent", cat) is True


# --------------------------------------------------------------- CI vs local execution (B5 seam)
def test_execution_defaults_to_ci_and_local_is_flagged():
    cat = C.builtin_catalog()
    assert C.agent_execution(cat["rigor"]) == "ci"          # every shipped builtin runs in CI
    assert C.agent_execution({"execution": "local"}) == "local"
    assert C.agent_execution({}) == "ci"


def _with_local(cat):
    # simulate a user overlay: a local tool-using doer + a local critic (builtin:false)
    cat = dict(cat)
    cat["heatr"] = {"id": "heatr", "category": "doer", "execution": "local", "systemPrompt": "p", "builtin": False}
    cat["adv"] = {"id": "adv", "category": "critic", "execution": "local", "systemPrompt": "p", "builtin": False}
    return cat


def test_ci_runs_read_only_builtins_not_local_agents():
    cat = _with_local(C.builtin_catalog())
    assert C.runnable_in_ci("rigor", cat) is True           # read-only builtin critic
    assert C.runnable_in_ci("writer", cat) is False         # doer never runs in the read-only lane
    assert C.runnable_in_ci("heatr", cat) is False          # local agent can't run in CI
    assert C.runnable_in_ci("adv", cat) is False            # even a local critic is CI-excluded
    assert C.runnable_in_ci("legacy-name", cat) is True     # unknown → legacy CI critic (back-compat)


def test_local_runner_runs_local_agents_critic_or_doer():
    cat = _with_local(C.builtin_catalog())
    assert C.runnable_local("heatr", cat) is True           # local doer runs on the machine (has tools)
    assert C.runnable_local("adv", cat) is True             # local critic too
    assert C.runnable_local("rigor", cat) is False          # a CI builtin is not the local runner's job
    assert C.runnable_local("legacy-name", cat) is False    # unknown is a CI legacy critic, not local


# --------------------------------------------------------------- status gate (B4 draft-review)
def test_a_draft_agent_never_runs_in_either_lane():
    cat = C.builtin_catalog()
    cat["draft-critic"] = {"id": "draft-critic", "category": "critic", "execution": "ci",
                           "status": "draft", "builtin": False, "systemPrompt": "p"}
    cat["draft-local"] = {"id": "draft-local", "category": "doer", "execution": "local",
                          "status": "draft", "builtin": False, "systemPrompt": "p"}
    cat["active-critic"] = {"id": "active-critic", "category": "critic", "execution": "ci",
                            "status": "active", "builtin": False, "systemPrompt": "p"}
    cat["active-local"] = {"id": "active-local", "category": "doer", "execution": "local",
                           "status": "active", "builtin": False, "systemPrompt": "p"}
    # drafts are inert until approved
    assert C.runnable_in_ci("draft-critic", cat) is False
    assert C.runnable_local("draft-local", cat) is False
    assert C.is_runnable("draft-critic", cat) is False
    # approved authored agents run
    assert C.runnable_in_ci("active-critic", cat) is True
    assert C.runnable_local("active-local", cat) is True
    # builtins carry no status → default active → unaffected
    assert C.runnable_in_ci("rigor", cat) is True
    assert C.agent_status(cat["rigor"]) == "active"


def test_no_builtin_prompt_leaks_domain_specific_terms():
    # document-agnostic hard constraint: no RFAM / dissertation / Matt-specific hardcoding
    banned = ("rfam", "heatr", "dissertation", "phd-dissertation", "overleaf")
    for a in C.builtin_catalog().values():
        low = (a["systemPrompt"] + a["description"]).lower()
        assert not any(b in low for b in banned), f"{a['id']} leaks a domain term"


# --------------------------------------------------------------- load_catalog (merge)
def test_load_catalog_without_a_repo_file_is_builtins_only():
    cat = C.load_catalog(None)
    assert set(cat.keys()) == ALL_IDS


def test_load_catalog_missing_path_falls_back_to_builtins(tmp_path):
    cat = C.load_catalog(str(tmp_path / "nope.json"))
    assert set(cat.keys()) == ALL_IDS


def test_load_catalog_merges_a_user_authored_agent(tmp_path):
    p = tmp_path / "agents.json"
    p.write_text(json.dumps([
        {"id": "house-style", "displayName": "House Style", "category": "critic",
         "systemPrompt": "Check the house style guide.", "builtin": False,
         "docTypes": ["*"], "triggers": [], "outputContract": "findings", "version": 1},
    ]), encoding="utf-8")
    cat = C.load_catalog(str(p))
    assert "house-style" in cat
    assert cat["house-style"]["systemPrompt"] == "Check the house style guide."
    assert set(ALL_IDS).issubset(cat.keys())          # builtins still present


def test_repo_file_cannot_override_a_builtin(tmp_path):
    # Q2 auto-upgrade, keyed on `builtin`: a builtin id in the repo file is IGNORED; the bundled
    # definition wins, so improving a builtin prompt upgrades every repo carrying the new engine.
    p = tmp_path / "agents.json"
    p.write_text(json.dumps([
        {"id": "rigor", "builtin": True, "systemPrompt": "HIJACKED — repo override.", "version": 999},
    ]), encoding="utf-8")
    cat = C.load_catalog(str(p))
    assert "HIJACKED" not in cat["rigor"]["systemPrompt"]
    assert cat["rigor"]["systemPrompt"] == C.builtin_catalog()["rigor"]["systemPrompt"]


def test_load_catalog_accepts_object_wrapper(tmp_path):
    p = tmp_path / "agents.json"
    p.write_text(json.dumps({"agents": [
        {"id": "extra", "builtin": False, "systemPrompt": "x", "category": "critic"},
    ]}), encoding="utf-8")
    cat = C.load_catalog(str(p))
    assert "extra" in cat


# --------------------------------------------------------------- resolve_agent_directive
def test_known_id_resolves_to_its_system_prompt_plus_output_contract():
    d = C.resolve_agent_directive("rigor", C.builtin_catalog())
    # the real perspective is carried, plus the shared findings contract the engine always appends
    assert "survive scrutiny" in d.lower() or "overclaim" in d.lower()
    assert "Return ONLY a JSON array" in d
    assert "READ-ONLY" in d.upper()


def test_unknown_name_falls_back_to_the_legacy_generic_prompt():
    # back-compat: a bare name that predates the catalog runs EXACTLY as today
    d = C.resolve_agent_directive("my-old-agent", C.builtin_catalog())
    assert "my-old-agent" in d                        # legacy names the agent
    assert d == A.AGENT_INSTRUCTIONS.format(agent="my-old-agent")


def test_both_paths_end_with_the_findings_json_instruction():
    known = C.resolve_agent_directive("clarity", C.builtin_catalog())
    legacy = C.resolve_agent_directive("whatever", C.builtin_catalog())
    for d in (known, legacy):
        assert "Return ONLY a JSON array" in d        # keeps parse_agent_findings uniform


def test_domain_prompt_substitutes_the_configured_field():
    d = C.resolve_agent_directive("domain", C.builtin_catalog(), field="materials engineering")
    assert "materials engineering" in d
    assert "{field}" not in d


def test_domain_prompt_without_a_field_has_no_leftover_placeholder():
    d = C.resolve_agent_directive("domain", C.builtin_catalog(), field=None)
    assert "{field}" not in d


def test_resolve_with_no_catalog_still_resolves_builtins():
    d = C.resolve_agent_directive("copyedit")          # catalog defaults to builtins
    assert "Return ONLY a JSON array" in d
    assert "{field}" not in d                          # non-domain prompts have no placeholder


# --------------------------------------------------------------- cap_findings (Q4 volume guard)
def test_cap_findings_truncates_to_the_limit():
    findings = [{"quote": str(i), "body": "b"} for i in range(30)]
    assert len(C.cap_findings(findings, 20)) == 20


def test_cap_findings_default_limit_is_reasonable_and_keeps_short_lists():
    assert C.cap_findings([{"a": 1}]) == [{"a": 1}]
    assert len(C.cap_findings([{} for _ in range(1000)])) == C.DEFAULT_MAX_FINDINGS


# --------------------------------------------------------------- agents.json mirror stays in sync
def test_shipped_agents_json_mirrors_the_bundled_builtins():
    # single authored source: the browser client fetches agents.json, the engine uses BUILTIN_AGENTS;
    # this gate keeps them byte-equivalent (no build step) so display never drifts from what runs.
    here = os.path.dirname(__file__)
    with open(os.path.join(here, "..", "data-template", "agents.json"), encoding="utf-8") as f:
        shipped = json.load(f)
    entries = shipped if isinstance(shipped, list) else shipped["agents"]
    assert entries == C.BUILTIN_AGENTS
