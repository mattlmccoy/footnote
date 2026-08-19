#!/usr/bin/env python3
"""ci_local.py — the LOCAL agent runner (B5).

Some agents can't run in the data repo's GitHub Actions: they use tools (Bash/Read/Write) and are
bound to code and paths that live only on the operator's own machine. ci_local drains the SAME
run-agents job queue LOCALLY — invoking the selected tool-enabled engine with each agent's working
directory and model — and writes the results back through the shared pure core (ci_review_common).

Split of responsibility (keyed on each catalog entry's ``execution`` field):
  * CI (ci_apply.run_agent_cli): read-only, document-only critics — ``execution: "ci"`` (the default).
  * LOCAL (this module): tool-using, path-bound agents — ``execution: "local"`` — a user overlay
    (builtin:false) in the operator's own data repo. No shipped builtin is local.

Author-oversight invariant is preserved: a local agent acts through its own tools on the operator's
OWN code; it never writes the Footnote-reviewed document's source. Its result comes back as a comment
the author then acts on — the deterministic review→stage→approve→merge path is unchanged.

Pure decision logic (command construction, agent selection, comment folding) is unit-tested; the live
engine subprocess is behind an injectable ``agent_fn`` and verified by running it locally.
"""
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ci_review_common as R  # noqa: E402
import ci_agents  # noqa: E402
import ci_authoring  # noqa: E402
import ci_llm  # noqa: E402


def _now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# --------------------------------------------------------------- command construction (pure)
def build_local_command(agent_entry, directive, default_model, codex_out_path=None):
    """Build one local engine invocation. Returns ``{argv, cwd, provider, out_path}``.

    Unlike the CI call (``claude -p <directive> --output-format json`` with NO tools, document piped on
    stdin), a local agent gets its declared tools allowed and runs in its own working directory, so it
    can read/run the operator's code. ``model`` from the entry overrides the default; ``cwd`` is the
    agent's working directory (None → the runner's current directory). Pure — no subprocess here.
    """
    entry = agent_entry or {}
    provider, model = ci_llm.parse_model_spec(entry.get("model") or default_model)
    if provider == "codex":
        if not codex_out_path:
            raise ValueError("codex_out_path is required for a local Codex invocation")
        argv = ci_llm.codex_argv(directive, model, codex_out_path, sandbox="workspace-write")
    else:
        argv = ci_llm.claude_argv(directive, model)
        tools = [t for t in (entry.get("tools") or []) if isinstance(t, str)]
        if tools:
            # Claude needs its declared tools allowlisted; Codex gets them from its workspace sandbox.
            argv += ["--allowedTools", ",".join(tools)]
    return {"argv": argv, "cwd": entry.get("cwd") or None,
            "provider": provider, "out_path": codex_out_path if provider == "codex" else None}


# --------------------------------------------------------------- job orchestration (pure)
def run_local_job(job, review, catalog, agent_fn, ts, idgen, field=""):
    """Run the LOCAL agents selected by a run-agents job and fold their findings into the review.

    Only agents whose catalog entry is ``execution: "local"`` are run here (CI agents are left for CI).
    ``agent_fn(agent_id, task)`` is the injectable local-engine boundary. Returns the findings shaped as
    SUBMITTED reviewer comments (via ``R.agent_findings_comments``) — the caller routes them to the AI
    reviewer so LOCAL and CLOUD both give the owner the accept/decline flow. Pure: ``ts`` injected.
    """
    selected = [a for a in (job.get("agents") or []) if ci_agents.runnable_local(a, catalog)]
    if not selected:
        return []
    task = R.build_apply_task(job, review, R.author_source(job.get("_source") or {})) \
        if job.get("_source") else {"chapter": job.get("chapter")}
    outputs = {a: (agent_fn(a, task) or []) for a in selected}
    local_job = {**job, "agents": selected}
    return R.agent_findings_comments(local_job, outputs, ts, idgen=idgen)


# --------------------------------------------------------------- live engine boundary (local)
def run_local_agent_cli(agent_id, task, catalog=None, field="", default_model=None):
    """Invoke a tool-enabled engine locally as one agent; returns a capped list of finding specs.
    Thin, live-gated boundary: resolves the directive from the catalog, builds the local command
    (tools + cwd + model), runs it, and parses findings. Missing CLI / non-zero exit → [] (the job is
    left for a retry rather than crashing the drain)."""
    import ci_apply  # lazy: only the live path needs the findings parser
    default_model = default_model or os.environ.get("CLAUDE_MODEL") or "claude-opus-4-8"
    directive = ci_agents.resolve_agent_directive(agent_id, catalog, field)
    entry = (catalog or ci_agents.builtin_catalog()).get(agent_id)
    context = ci_apply.agent_context(task)
    with tempfile.TemporaryDirectory(prefix="footnote-local-") as tmpdir:
        out_path = str(Path(tmpdir) / "codex-last.txt")
        cmd = build_local_command(entry, directive, default_model, codex_out_path=out_path)
        try:
            proc = subprocess.run(cmd["argv"], input=context, capture_output=True, text=True, cwd=cmd["cwd"])
        except OSError as e:
            print(f"[local] agent {agent_id}: {cmd['provider']} CLI unavailable ({e}) — leaving job",
                  file=sys.stderr)
            return []
        failed = ci_llm.codex_failed(proc.stdout) if cmd["provider"] == "codex" else ""
        if proc.returncode != 0 or failed:
            detail = failed or proc.stderr[:300]
            print(f"[local] agent {agent_id}: {cmd['provider']} failed ({proc.returncode}): {detail}",
                  file=sys.stderr)
            return []
        if cmd["provider"] == "codex":
            try:
                raw = Path(out_path).read_text(encoding="utf-8")
            except OSError:
                return []
        else:
            raw = proc.stdout
        return ci_agents.cap_findings(ci_apply.parse_agent_findings(raw))


# --------------------------------------------------------------- thin CLI (live-gated)
def _write_json(path, obj):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)


def run_author_local_cli(job):
    """Generate an agent definition locally from the owner's brief (the live Claude boundary for the
    author-agent job). Returns the raw generated definition (str) or None."""
    import ci_apply  # lazy — reuse the shared headless-Claude runner
    return ci_apply._run_claude(ci_authoring.AUTHOR_DIRECTIVE, ci_authoring.author_context(job),
                                None, "author-agent")


def process_prefix(prefix, catalog, agent_fn=None, generate_fn=None):
    """Drain the LOCAL run-agents + author-agent work for one project prefix against the working tree.

    run-agents: for each job that carries a local agent, run its local agents, write the review back,
    remove the job (a job with only CI agents is left for the CI drain). author-agent: generate the
    described agent, merge it into agents.json as a DRAFT, remove the job. Returns the number of jobs
    handled. ``agent_fn`` / ``generate_fn`` are the injectable Claude boundaries."""
    import ci_apply  # shared reviewer-routing (register the AI reviewer + write its advisor file)
    if agent_fn is None:
        agent_fn = lambda aid, task, c=catalog: run_local_agent_cli(aid, task, catalog=c)
    if generate_fn is None:
        generate_fn = run_author_local_cli
    jobs = R.load_json(R.jobs_path(prefix), [])
    if not isinstance(jobs, list):
        return 0
    done = 0
    for job in [j for j in jobs if j.get("type") in ("run-agents", "author-agent")]:
        if job.get("type") == "author-agent":
            agents_list = R.load_json("agents.json", [])
            if not isinstance(agents_list, list):
                agents_list = []
            new_list, entry, err = ci_authoring.author_agent(job, agents_list, generate_fn)
            if entry is not None:
                _write_json("agents.json", new_list)
                print(f"[local] authored draft '{entry['id']}' — review it in Settings before it runs")
            else:
                print(f"[local] author-agent failed: {err}", file=sys.stderr)
            jobs = R.remove_job(jobs, job.get("id"))
            done += 1
            continue
        agents = job.get("agents") or []
        if not any(ci_agents.runnable_local(a, catalog) for a in agents):
            continue                                        # no local agent — CI's job, leave it
        ci_present = [a for a in agents if ci_agents.runnable_in_ci(a, catalog)]
        if ci_present:
            # a mixed job: the local runner claims and removes it, so its CI agents would be dropped.
            # Surface this rather than silently losing them (the proper fix is a per-lane split at queue
            # time). In practice a local overlay's jobs are all-local, so this is an edge case.
            print(f"[local] {prefix}{job.get('chapter')}: job also lists CI agents {ci_present} — "
                  f"running only the local agents; queue CI agents in a separate job", file=sys.stderr)
        ch = job.get("chapter")
        review = R.load_json(R.review_path(prefix, ch), {"comments": []})
        jid = job.get("id")
        fc = run_local_job(job, review, catalog, agent_fn, _now_iso(),
                           idgen=lambda i, j=jid: f"l_{j}_{i}", field=job.get("field") or "")
        ci_apply.route_findings_to_reviewer(prefix, ch, fc, _now_iso())   # AI reviewer → accept/decline flow
        jobs = R.remove_job(jobs, jid)
        done += 1
    _write_json(R.jobs_path(prefix), jobs)
    return done


def main():
    catalog = ci_agents.load_catalog("agents.json")
    prefixes = R.apply_prefixes()
    total = sum(process_prefix(p, catalog) for p in prefixes)
    print(f"[local] done — handled {total} job(s) across {len(prefixes)} project(s)")


if __name__ == "__main__":
    main()
