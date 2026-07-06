"""Tests for ci_authoring — B4 user-authored agents. An owner describes an agent in plain language;
Claude generates a full definition; it lands as a DRAFT the owner reviews before it can run.

Everything here is pure (no live Claude, no git). The Claude call is the injectable ``generate_fn``.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-template"))
import ci_authoring as W  # noqa: E402
import ci_agents as C  # noqa: E402


# --------------------------------------------------------------- sanitize_agent_id
def test_sanitize_agent_id_kebabs_and_dedupes():
    assert W.sanitize_agent_id("My Rigor Bot!", set()) == "my-rigor-bot"
    assert W.sanitize_agent_id("  Spaces  &  Symbols  ", set()) == "spaces-symbols"
    # collision → numeric suffix
    assert W.sanitize_agent_id("Helper", {"helper"}) == "helper-2"
    assert W.sanitize_agent_id("Helper", {"helper", "helper-2"}) == "helper-3"


def test_sanitize_agent_id_never_collides_with_a_builtin():
    taken = set(C.builtin_catalog().keys())
    assert W.sanitize_agent_id("rigor", taken) != "rigor"     # builtin id is protected
    assert W.sanitize_agent_id("", set()).strip()             # empty → a real fallback slug


# --------------------------------------------------------------- validate_authored_agent
def _good():
    return {"id": "x", "displayName": "X", "description": "d", "category": "critic",
            "execution": "ci", "systemPrompt": "review it", "tools": [], "triggers": [],
            "outputContract": "findings", "builtin": False, "status": "draft"}


def test_validate_accepts_a_well_formed_agent():
    ok, reason = W.validate_authored_agent(_good())
    assert ok and reason == ""


def test_validate_rejects_bad_shape():
    for mut in (
        {"systemPrompt": ""},              # empty prompt
        {"category": "wizard"},            # bad category
        {"execution": "cloud"},            # bad execution
        {"tools": ["Bash", "Nuke"]},       # unknown tool
        {"builtin": True},                 # authored agents may never be builtin
    ):
        bad = {**_good(), **mut}
        ok, reason = W.validate_authored_agent(bad)
        assert not ok and reason, mut


# --------------------------------------------------------------- normalize_authored_agent
def test_normalize_forces_authored_draft_and_contract():
    raw = {"displayName": "Style Nazi", "description": "picky", "category": "critic",
           "execution": "ci", "systemPrompt": "flag wordiness", "builtin": True, "status": "active"}
    e = W.normalize_authored_agent(raw, brief="be picky about style", taken=set())
    assert e["builtin"] is False              # forced
    assert e["status"] == "draft"             # forced — review gate
    assert e["source"] == "authored"
    assert e["brief"] == "be picky about style"
    assert e["id"] == "style-nazi"
    assert e["outputContract"] == "findings"  # critic
    assert e["version"] == 1


def test_normalize_doer_gets_a_nonfindings_contract_and_local_default():
    raw = {"displayName": "Sim Runner", "category": "doer", "execution": "local",
           "systemPrompt": "run the sim", "tools": ["Bash", "Read"], "cwd": "/work"}
    e = W.normalize_authored_agent(raw, brief="run my sim", taken=set())
    assert e["category"] == "doer" and e["execution"] == "local"
    assert e["outputContract"] != "findings"
    assert e["tools"] == ["Bash", "Read"] and e["cwd"] == "/work"


# --------------------------------------------------------------- merge_authored
def test_merge_adds_then_replaces_by_id_preserving_others():
    base = [{"id": "rigor", "builtin": True}, {"id": "a", "builtin": False, "status": "draft"}]
    e = {"id": "b", "builtin": False, "status": "draft"}
    merged = W.merge_authored(base, e)
    assert [x["id"] for x in merged] == ["rigor", "a", "b"]
    # same id replaces in place, others untouched
    e2 = {"id": "a", "builtin": False, "status": "active"}
    merged2 = W.merge_authored(merged, e2)
    assert [x["id"] for x in merged2] == ["rigor", "a", "b"]
    assert next(x for x in merged2 if x["id"] == "a")["status"] == "active"
    assert next(x for x in merged2 if x["id"] == "rigor")["builtin"] is True


# --------------------------------------------------------------- author_agent (orchestration)
def test_author_agent_generates_validates_and_merges_a_draft():
    base = list(C.BUILTIN_AGENTS)
    job = {"type": "author-agent", "name": "Jargon Buster", "brief": "flag undefined jargon"}
    gen = lambda j: {"displayName": "Jargon Buster", "description": "flags jargon",
                     "category": "critic", "execution": "ci", "systemPrompt": "flag undefined jargon",
                     "tools": [], "triggers": ["wording"]}
    new_list, entry, err = W.author_agent(job, base, gen)
    assert err is None and entry["id"] == "jargon-buster"
    assert entry["builtin"] is False and entry["status"] == "draft" and entry["source"] == "authored"
    assert any(a["id"] == "jargon-buster" for a in new_list)
    # a fresh id is chosen even if Claude tries to reuse a builtin id
    job2 = {"name": "rigor", "brief": "x"}
    _, e2, _ = W.author_agent(job2, base, lambda j: {"displayName": "rigor", "category": "critic",
                                                     "execution": "ci", "systemPrompt": "p"})
    assert e2["id"] != "rigor"


def test_author_agent_rejects_unparseable_or_invalid_generation():
    base = list(C.BUILTIN_AGENTS)
    job = {"name": "n", "brief": "b"}
    new_list, entry, err = W.author_agent(job, base, lambda j: "not json at all")
    assert entry is None and err and new_list == base       # unchanged on failure
    # invalid (bad category) → rejected, list unchanged
    nl2, e2, err2 = W.author_agent(job, base, lambda j: {"category": "wizard", "systemPrompt": "p",
                                                         "displayName": "n", "execution": "ci"})
    assert e2 is None and err2 and nl2 == base


def test_author_directive_and_context_are_present():
    assert "JSON" in W.AUTHOR_DIRECTIVE and "systemPrompt" in W.AUTHOR_DIRECTIVE
    ctx = W.author_context({"name": "Foo", "brief": "do bar"})
    assert "Foo" in ctx and "do bar" in ctx
