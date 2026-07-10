"""Tests for ci_local — the B5 LOCAL agent runner.

Some agents (tool-using, path-bound) can't run in the data repo's CI: they need the operator's own
machine, tools, and working directory. ci_local drains the same run-agents jobs LOCALLY, invoking a
tool-enabled Claude with each agent's cwd/model, and writes findings back via the shared pure core.

The live ``claude`` invocation is behind an injectable boundary (agent_fn); everything here is pure.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-template"))
import ci_review_common as R  # noqa: E402
import ci_agents as C  # noqa: E402
import ci_local as L  # noqa: E402


# --------------------------------------------------------------- build_local_command (pure)
def test_build_local_command_enables_tools_and_honors_model_and_cwd():
    entry = {"id": "heatr", "execution": "local", "tools": ["Bash", "Read", "Write"],
             "model": "opus", "cwd": "/research/geo-prewarp"}
    cmd = L.build_local_command(entry, "SYSTEM PROMPT DIRECTIVE", default_model="claude-opus-4-8")
    assert cmd["argv"][0] == "claude"
    assert "-p" in cmd["argv"] and "SYSTEM PROMPT DIRECTIVE" in cmd["argv"]
    mi = cmd["argv"].index("--model")
    assert cmd["argv"][mi + 1] == "opus"                 # per-agent model override wins
    assert cmd["cwd"] == "/research/geo-prewarp"         # runs where the agent's code lives
    # local agents need their tools — the CI call is json-only with no tools; local allows them
    joined = " ".join(cmd["argv"])
    assert "Bash" in joined and "Read" in joined and "Write" in joined


def test_build_local_command_defaults_model_and_leaves_cwd_none_when_absent():
    cmd = L.build_local_command({"id": "a", "execution": "local"}, "D", default_model="claude-opus-4-8")
    mi = cmd["argv"].index("--model")
    assert cmd["argv"][mi + 1] == "claude-opus-4-8"
    assert cmd["cwd"] is None


# --------------------------------------------------------------- run_local_job (pure orchestration)
def _catalog_with_local():
    cat = C.builtin_catalog()
    cat["heatr"] = {"id": "heatr", "category": "doer", "execution": "local",
                    "systemPrompt": "run the sim", "builtin": False}
    return cat


def test_run_local_job_runs_only_local_agents_and_skips_ci_ones():
    cat = _catalog_with_local()
    review = {"comments": []}
    # the job mixes a CI builtin (rigor) and a local agent (heatr); only heatr runs here
    job = {"id": "j1", "type": "run-agents", "chapter": "ch1", "agents": ["rigor", "heatr"]}
    calls = []

    def fake_agent(agent_id, task):
        calls.append(agent_id)
        return [{"quote": "x", "body": f"{agent_id} ran locally", "tag": "run"}]

    fc = L.run_local_job(job, review, cat, fake_agent, "2026-07-06T00:00:00Z", idgen=lambda i: f"l{i}")
    assert calls == ["heatr"]                            # rigor (CI) was NOT run locally
    assert [c["body"] for c in fc] == ["heatr ran locally"]
    assert fc[0]["author"] == "heatr" and fc[0]["status"] == "submitted"   # → AI reviewer, accept/decline


def test_run_local_job_with_no_local_agents_is_a_noop():
    cat = C.builtin_catalog()
    review = {"comments": [{"id": "e", "status": "open"}]}
    job = {"type": "run-agents", "chapter": "ch1", "agents": ["rigor", "clarity"]}
    fc = L.run_local_job(job, review, cat, lambda a, t: [{"body": "nope"}], "t", idgen=lambda i: f"l{i}")
    assert fc == []                                       # no local agents → nothing


# --------------------------------------------------------------- process_prefix (working-tree drain)
def test_process_prefix_routes_findings_to_the_ai_reviewer_and_removes_job(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    import json
    (tmp_path / "jobs.json").write_text(json.dumps([
        {"id": "j1", "type": "run-agents", "chapter": "ch1", "agents": ["heatr"]},
    ]), encoding="utf-8")
    cat = _catalog_with_local()
    n = L.process_prefix("", cat, agent_fn=lambda a, t: [{"quote": "q", "body": f"{a} ran", "tag": "run"}])
    assert n == 1
    # findings land as the AI reviewer's SUBMITTED comments (accept/decline flow), NOT the owner review
    adv = json.loads((tmp_path / "advisor" / "ai-review-agents" / "ch1.json").read_text())
    assert adv["comments"][0]["author"] == "heatr" and adv["comments"][0]["body"] == "heatr ran"
    assert adv["comments"][0]["status"] == "submitted"
    reg = json.loads((tmp_path / "advisors.json").read_text())
    ai = next(a for a in reg["advisors"] if a["id"] == "ai-review-agents")
    assert ai["email"] == "" and ai.get("ai") is True     # invite-safe (never emailed)
    assert json.loads((tmp_path / "jobs.json").read_text()) == []       # job removed after handling


def test_process_prefix_handles_an_author_agent_job(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    import json
    (tmp_path / "agents.json").write_text(json.dumps([{"id": "rigor", "builtin": True}]), encoding="utf-8")
    (tmp_path / "jobs.json").write_text(json.dumps([
        {"id": "jA", "type": "author-agent", "name": "Jargon Buster", "brief": "flag undefined jargon"},
    ]), encoding="utf-8")
    gen = lambda j: {"displayName": j["name"], "category": "critic", "execution": "ci",
                     "systemPrompt": "flag " + j["brief"], "tools": []}
    n = L.process_prefix("", C.builtin_catalog(), agent_fn=lambda a, t: [], generate_fn=gen)
    assert n == 1
    agents = json.loads((tmp_path / "agents.json").read_text())
    entry = next(a for a in agents if a["id"] == "jargon-buster")
    assert entry["status"] == "draft" and entry["builtin"] is False and entry["source"] == "authored"
    assert json.loads((tmp_path / "jobs.json").read_text()) == []       # job removed


def test_process_prefix_leaves_a_pure_ci_job_untouched(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "reviews").mkdir()
    import json
    jobs = [{"id": "j2", "type": "run-agents", "chapter": "ch1", "agents": ["rigor", "clarity"]}]
    (tmp_path / "jobs.json").write_text(json.dumps(jobs), encoding="utf-8")
    (tmp_path / "reviews" / "ch1.json").write_text(json.dumps({"comments": []}), encoding="utf-8")
    n = L.process_prefix("", C.builtin_catalog(), agent_fn=lambda a, t: [{"body": "x"}])
    assert n == 0
    assert json.loads((tmp_path / "jobs.json").read_text()) == jobs     # CI job left for the CI drain
