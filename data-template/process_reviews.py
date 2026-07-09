#!/usr/bin/env python3
"""process_reviews.py — the generic LOCAL review executor (the Claude-Code round-trip).

Document-agnostic port of the dissertation-tracker process-reviews.py: the trusted local route
where a human + agents make and review edits on a branch, then the owner previews/approves/merges.
It drives two LOCAL clones — the DATA repo (comments/jobs/content) and the SOURCE repo (the LaTeX) —
and reuses Footnote's shared pure core (ci_review_common) + the SAME degenerate-safe content build
(ci_render.build_guarded) the cloud engine uses, so local and cloud can never diverge.

Commands (core round-trip):
    list                     queued jobs + comments as a changelist (confirms each unit's source)
    start  <job_id>          branch review-edits/<unit> off main in the source repo
    stage  <job_id>          AFTER edits are committed+pushed on that branch, flip the job's comments
                             to status='staged' (+branch/ts), mark the job done, push the data repo
    preview <unit>           build preview/<unit>.html from the branch (degenerate-guarded)
    merge  <unit>            merge review-edits/<unit> -> main, rebuild content, mark comments merged,
                             drop the branch
    done   <job_id>          mark any job done (e.g. after run-agents)

Paths are args/env-driven (no repo assumptions): --data <data clone> --source <source clone>
--prefix <id/> (workspace subfolder; '' for a legacy root). The actual LaTeX edits between start and
stage are made by the operator/agents — this script never invents edits; it moves state + branches.
"""
import argparse
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ci_review_common as R  # noqa: E402
import ci_render  # noqa: E402
import ci_apply  # noqa: E402


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _git(args, cwd, check=True, capture=False):
    return subprocess.run(["git", *args], cwd=str(cwd), check=check,
                          capture_output=capture, text=True)


def _pull(repo):
    """Best-effort fast-forward so local state matches the remote (the browser also writes the data
    repo). Never fatal — an offline/first-run clone just proceeds."""
    if _git(["remote", "get-url", "origin"], repo, check=False, capture=True).returncode != 0:
        return
    _git(["fetch", "origin"], repo, check=False, capture=True)
    _git(["merge", "--ff-only", "origin/HEAD"], repo, check=False, capture=True)


def _push_data(data, msg):
    """Commit + push the data repo, self-healing a rejected push by rebasing onto the remote (the
    browser may have committed since our pull; our commit replays on top — no lost data)."""
    _git(["add", "-A"], data, check=False)
    _git(["commit", "-m", msg], data, check=False)
    for _ in range(4):
        if _git(["push", "origin", "HEAD"], data, check=False, capture=True).returncode == 0:
            return True
        rb = _git(["pull", "--rebase", "origin", "HEAD"], data, check=False, capture=True)
        if rb.returncode != 0:
            _git(["rebase", "--abort"], data, check=False, capture=True)
            print(f"push rejected + auto-rebase conflict — resolve by hand: "
                  f"git -C {data} pull --rebase && git -C {data} push", file=sys.stderr)
            return False
    return False


# --------------------------------------------------------------------------- helpers

def _P(a):
    """The project prefix ('' legacy root, '<id>/' workspace), normalized with a trailing slash."""
    p = (a.prefix or "").strip()
    return p if not p or p.endswith("/") else p + "/"


def _dpath(a, rel):
    return os.path.join(a.data, _P(a) + rel)


def _unit_source_file(a, unit):
    """The source .tex for a unit, from <prefix>chapters.json (default main.tex)."""
    cwd = os.getcwd()
    try:
        os.chdir(a.data)
        for r in ci_render.load_units(_P(a)):
            if r.get("id") == unit:
                return r.get("sourceFile") or "main.tex"
    finally:
        os.chdir(cwd)
    return "main.tex"


def _source_root(a):
    """Where the LaTeX lives in the source clone: <prefix>source/ for an in-repo workspace layout,
    else the source-clone root (an external/dedicated source repo)."""
    ws = Path(a.source) / (_P(a) + "source")
    return ws if ws.is_dir() else Path(a.source)


def _load_reviews_by_unit(a, units):
    out = {}
    for u in units:
        out[u] = R.load_json(_dpath(a, f"reviews/{u}.json"), {"comments": []})
    return out


def _queued_units(jobs):
    return sorted({j.get("chapter") or j.get("unit") for j in jobs
                   if isinstance(j, dict) and j.get("status") != "done" and (j.get("chapter") or j.get("unit"))})


# --------------------------------------------------------------------------- commands

def cmd_list(a):
    _pull(a.data)
    jobs = R.load_json(_dpath(a, "jobs.json"), [])
    if not isinstance(jobs, list) or not any(j.get("status") != "done" for j in jobs if isinstance(j, dict)):
        print("No queued jobs. (Click 'Send to Claude'/'Review actions' in the app to queue one.)")
        return
    reviews = _load_reviews_by_unit(a, _queued_units(jobs))
    src = _source_root(a)
    rows = R.changelist(jobs, reviews, lambda u: (src / _unit_source_file(a, u)).exists())
    print(f"{len([r for r in rows])} queued job(s)\n")
    for r in rows:
        ok = "" if r["source_ok"] else "  [source MISSING]"
        if r["type"] == "run-agents":
            print(f"{r['id']}  {r['unit']}  -> run agents: {', '.join(r['agents'])}{ok}")
            print(f"   run the agent(s), then: process_reviews.py done {r['id']}\n")
        elif r["type"] == "merge":
            print(f"{r['id']}  {r['unit']}  -> APPROVED — merge: process_reviews.py merge {r['unit']}\n")
        elif r["type"] == "export":
            print(f"{r['id']}  {r['unit']}  -> export: {', '.join(r['formats'])}\n")
        else:
            verb = "direct edits" if r["type"] == "apply-direct" else "edits"
            print(f"{r['id']}  {r['unit']}  -> {verb} ({len(r['comments'])}) on {_unit_source_file(a, r['unit'])}{ok}")
            for c in r["comments"]:
                print(f"   {c['id']} [{c['tag']}] {c['section']}")
                print(f"      quote: “{c['quote']}”")
                if c["edit"]:
                    e = c["edit"]
                    print(f"      VERBATIM {str(e.get('op','')).upper()} — apply EXACTLY; do not paraphrase.")
                    print(f"        find: “{(e.get('find','') or '')[:160]}”")
                    if e.get("op") != "delete":
                        print(f"        -> “{(e.get('replacement','') or '')[:200]}”")
                elif c["ask"]:
                    print(f"      ask: {c['ask']}")
            print()
    print("apply-edits -> start <job> -> edit + push -> stage <job>   |   approved -> merge <unit>")


def _find_job(a, job_id):
    for j in R.load_json(_dpath(a, "jobs.json"), []):
        if isinstance(j, dict) and j.get("id") == job_id:
            return j
    sys.exit(f"no job {job_id} in {_dpath(a, 'jobs.json')}")


def cmd_start(a):
    _pull(a.data)
    _pull(a.source)
    job = _find_job(a, a.job_id)
    unit = job.get("chapter") or job.get("unit")
    branch = R.branch_for(unit)
    if _git(["rev-parse", "--verify", branch], a.source, check=False, capture=True).returncode == 0:
        _git(["checkout", branch], a.source)
    else:
        if _git(["checkout", "-b", branch, "origin/main"], a.source, check=False, capture=True).returncode != 0:
            _git(["checkout", "-b", branch], a.source)
    src_file = _unit_source_file(a, unit)
    print(f"On branch {branch} in {a.source}")
    print(f"Edit {src_file} for this unit, commit, then:")
    print(f"  git -C {a.source} push -u origin {branch}")
    print(f"  process_reviews.py stage {a.job_id}")


def cmd_stage(a):
    _pull(a.data)
    job = _find_job(a, a.job_id)
    unit = job.get("chapter") or job.get("unit")
    branch = R.branch_for(unit)
    remote = _git(["ls-remote", "--heads", "origin", branch], a.source, check=False, capture=True)
    if not (remote.stdout or "").strip() and not a.force:
        sys.exit(f"{branch} not on origin — push it first, or re-run with --force.")
    rp = _dpath(a, f"reviews/{unit}.json")
    review = R.load_json(rp, None)
    if review is None:
        sys.exit(f"no review file at {rp}")
    ids = set(job.get("comment_ids") or [])
    n = 0
    for c in review.get("comments", []):
        if c.get("id") in ids and c.get("status") in ("queued", "open"):
            c["status"] = "staged"
            c.setdefault("claude", {})
            c["claude"]["branch"] = branch
            c["claude"]["ts"] = _now()
            n += 1
    _write_json(rp, review)
    jobs = R.load_json(_dpath(a, "jobs.json"), [])
    for j in jobs:
        if isinstance(j, dict) and j.get("id") == a.job_id:
            j["status"] = "done"
            j["done_ts"] = _now()
    _write_json(_dpath(a, "jobs.json"), jobs)
    _push_data(a.data, f"review: stage {unit} ({n} comment(s)) -> {branch}")
    print(f"Staged {n} comment(s) for {unit} -> {branch}; job {a.job_id} done.")


def cmd_preview(a):
    _pull(a.data)
    unit = a.unit
    src = _source_root(a)
    _git(["checkout", R.branch_for(unit)], a.source, check=False, capture=True)
    workdir = Path(a.data) / ".render-build"
    cwd0 = os.getcwd()
    try:  # build helpers write <prefix>preview/… relative to CWD (like the Action) → run from the data repo
        os.chdir(a.data)
        ci_apply.build_preview(_P(a), unit, str(src), str(workdir))
    finally:
        os.chdir(cwd0)
    _push_data(a.data, f"preview: build {unit} from {R.branch_for(unit)}")
    print(f"Built preview/{unit}.html")


def cmd_merge(a):
    _pull(a.data)
    _pull(a.source)
    unit = a.unit
    branch = R.branch_for(unit)
    if _git(["rev-parse", "--verify", branch], a.source, check=False, capture=True).returncode != 0:
        sys.exit(f"no branch {branch} to merge")
    _git(["checkout", "main"], a.source)
    m = _git(["merge", "--no-ff", "-m", f"merge {branch}: reviewed edits", branch], a.source,
             check=False, capture=True)
    if m.returncode != 0:
        _git(["merge", "--abort"], a.source, check=False, capture=True)
        sys.exit(f"merge conflict on {branch} — resolve by hand:\n{(m.stderr or '')[-400:]}")
    _git(["push", "origin", "main"], a.source, check=False, capture=True)
    # rebuild the published reading view from the merged source — degenerate-guarded (keeps last-good
    # if the build ever emits a stub), the exact protection the 2026-07-08 incident lacked.
    src = _source_root(a)
    workdir = Path(a.data) / ".render-build"
    cwd0 = os.getcwd()
    try:  # content_out is CWD-relative (like the Action) → build from the data repo
        os.chdir(a.data)
        published = ci_apply.build_content(_P(a), unit, str(src), str(workdir))
    finally:
        os.chdir(cwd0)
    if not published:
        print(f"WARNING: content build for {unit} was rejected (degenerate) — kept last-good; "
              f"merge to source main still happened. Investigate the source before republishing.",
              file=sys.stderr)
    # mark this unit's staged comments merged
    rp = _dpath(a, f"reviews/{unit}.json")
    review = R.load_json(rp, {"comments": []})
    n = 0
    for c in review.get("comments", []):
        if c.get("status") == "staged":
            c["status"] = "merged"
            c.setdefault("claude", {})["merged_ts"] = _now()
            n += 1
    _write_json(rp, review)
    # close any merge job for this unit + drop the branch
    jobs = R.load_json(_dpath(a, "jobs.json"), [])
    for j in jobs:
        if isinstance(j, dict) and (j.get("chapter") or j.get("unit")) == unit and j.get("type") == "merge":
            j["status"] = "done"
            j["done_ts"] = _now()
    _write_json(_dpath(a, "jobs.json"), jobs)
    _git(["branch", "-D", branch], a.source, check=False, capture=True)
    _git(["push", "origin", "--delete", branch], a.source, check=False, capture=True)
    _push_data(a.data, f"merge: publish {unit} ({n} comment(s) merged)")
    print(f"Merged {branch} -> main; rebuilt content/{unit}.html; {n} comment(s) marked merged.")


def _mutate_comment(a, unit, comment_id, fn, msg):
    """Load reviews/<unit>.json, replace the matching comment via ``fn(comment)`` (a pure helper),
    write + push. Shared by respond/note/decide."""
    _pull(a.data)
    rp = _dpath(a, f"reviews/{unit}.json")
    review = R.load_json(rp, None)
    if review is None:
        sys.exit(f"no review file at {rp}")
    hit = False
    for i, c in enumerate(review.get("comments", [])):
        if c.get("id") == comment_id:
            review["comments"][i] = fn(c)
            hit = True
    if not hit:
        sys.exit(f"comment {comment_id} not in {unit}")
    _write_json(rp, review)
    _push_data(a.data, msg)


def cmd_respond(a):
    _mutate_comment(a, a.unit, a.comment_id, lambda c: R.answer_comment(c, _now(), a.text),
                    f"review: answer {a.comment_id} in {a.unit}")
    print(f"Answered {a.comment_id} in {a.unit} (status 'answered').")


def cmd_note(a):
    _mutate_comment(a, a.unit, a.comment_id,
                    lambda c: R.note_comment(c, _now(), a.text, before=a.before, after=a.after),
                    f"review: note on {a.comment_id} in {a.unit}")
    print(f"Noted {a.comment_id} in {a.unit} (status kept).")


def cmd_decide(a):
    _mutate_comment(a, a.unit, a.comment_id,
                    lambda c: R.decide_comment(c, _now(), a.decision, note=a.note),
                    f"review: decide {a.comment_id} {a.decision}")
    print(f"Recorded {a.decision} on {a.comment_id}.")


def _checkout_review_branch(a, branch):
    if _git(["rev-parse", "--verify", branch], a.source, check=False, capture=True).returncode == 0:
        _git(["checkout", branch], a.source)
    elif _git(["checkout", "-b", branch, "origin/main"], a.source, check=False, capture=True).returncode != 0:
        _git(["checkout", "-b", branch], a.source)


def cmd_apply_direct(a):
    """Apply owner direct-edits literally to source on review-edits/<unit> — deterministic, no AI.
    Reuses the SAME pure core as the cloud apply-direct, so the two routes can't diverge."""
    _pull(a.data)
    _pull(a.source)
    job = _find_job(a, a.job_id)
    unit = job.get("chapter") or job.get("unit")
    branch = R.branch_for(unit)
    _checkout_review_branch(a, branch)
    src = _source_root(a)
    review = R.load_json(_dpath(a, f"reviews/{unit}.json"), {"comments": []})
    files = ci_apply.read_text_files(str(src))
    new_review, new_files, branch, applied = R.process_apply_direct_job(job, review, files, _now())
    for rel, txt in new_files.items():
        if files.get(rel) != txt:
            (src / rel).write_text(txt, encoding="utf-8")
    _write_json(_dpath(a, f"reviews/{unit}.json"), new_review)
    staged = sum(1 for c in new_review.get("comments", []) if c.get("status") == "staged")
    flagged = sum(1 for c in new_review.get("comments", []) if c.get("status") == "conflict")
    if applied:
        _git(["add", "-A"], src if str(src) == a.source else Path(a.source), check=False)
        _git(["commit", "-m", f"direct edits on {unit} from reviewer app"], a.source, check=False, capture=True)
        _git(["push", "-u", "origin", branch], a.source, check=False, capture=True)
    jobs = R.load_json(_dpath(a, "jobs.json"), [])
    for j in jobs:
        if isinstance(j, dict) and j.get("id") == a.job_id:
            j["status"] = "done"
            j["done_ts"] = _now()
    _write_json(_dpath(a, "jobs.json"), jobs)
    _push_data(a.data, f"direct: {unit} — {staged} applied, {flagged} flagged")
    print(f"apply-direct {unit}: {staged} applied, {flagged} flagged. Preview, then merge {unit}.")


def cmd_refresh_source(a):
    """Materialize the source entry main.tex into the data repo as <prefix>source/main.tex, so the
    reviewer header parses the real \\title from the source of truth. Idempotent; --dry-run reports."""
    src = _source_root(a) / "main.tex"
    if not src.exists():
        sys.exit(f"main.tex not found at {src}")
    new = src.read_text(encoding="utf-8")
    dst = Path(a.data) / (_P(a) + "source/main.tex")
    old = dst.read_text(encoding="utf-8") if dst.exists() else None
    if new == old:
        print("source/main.tex already up to date.")
        return
    if a.dry_run:
        print(f"[dry-run] would refresh source/main.tex ({len(new)} bytes) from {src}")
        return
    _pull(a.data)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(new, encoding="utf-8")
    _push_data(a.data, "refresh: source/main.tex from source of truth")
    print(f"Refreshed source/main.tex ({len(new)} bytes).")


def cmd_publish_srcmaps(a):
    """Generate <prefix>content/<unit>.srcmap.json for every unit with published content, so the app
    can offer in-context editing. Reuses export/preprocess.py + export/srcmap.py (needs TeX/pandoc env)."""
    _pull(a.data)
    src = _source_root(a)
    exportdir = ci_render.HERE / "export"
    built = 0
    cwd0 = os.getcwd()
    try:
        os.chdir(a.data)
        for r in ci_render.load_units(_P(a)):
            unit = r.get("id")
            html = Path(_dpath(a, f"content/{unit}.html"))
            if not unit or not html.exists():
                continue
            env = dict(os.environ, SOURCE_DIR=str(src), CHAPTERS_JSON=str(Path(_P(a) + "chapters.json").resolve()))
            pre = Path(a.data) / ".render-build" / f"{unit}.pre.tex"
            pre.parent.mkdir(parents=True, exist_ok=True)
            with open(pre, "w", encoding="utf-8") as f:
                subprocess.run(["python3", str(exportdir / "preprocess.py"), unit],
                               stdout=f, env=env, cwd=str(src), check=False)
            out = _dpath(a, f"content/{unit}.srcmap.json")
            subprocess.run(["python3", str(exportdir / "srcmap.py"), unit, str(pre), str(html), out],
                           env=env, cwd=str(src), check=False)
            if os.path.exists(out):
                built += 1
    finally:
        os.chdir(cwd0)
    _push_data(a.data, f"srcmaps: published {built} unit map(s)")
    print(f"Published {built} source map(s).")


def cmd_done(a):
    _pull(a.data)
    jobs = R.load_json(_dpath(a, "jobs.json"), [])
    hit = False
    for j in jobs:
        if isinstance(j, dict) and j.get("id") == a.job_id:
            j["status"] = "done"
            j["done_ts"] = _now()
            hit = True
    if not hit:
        sys.exit(f"no job {a.job_id}")
    _write_json(_dpath(a, "jobs.json"), jobs)
    _push_data(a.data, f"review: job {a.job_id} done")
    print(f"Job {a.job_id} marked done.")


def _write_json(path, obj):
    import json
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)


def build_parser():
    p = argparse.ArgumentParser(description="Footnote local review executor (generic)")
    p.add_argument("--data", default=os.environ.get("FOOTNOTE_DATA", "."), help="local clone of the DATA repo")
    p.add_argument("--source", default=os.environ.get("FOOTNOTE_SOURCE", "."), help="local clone of the SOURCE repo")
    p.add_argument("--prefix", default=os.environ.get("FOOTNOTE_PREFIX", ""), help="workspace subfolder '<id>/' ('' = legacy root)")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", help="show queued jobs + comments").set_defaults(fn=cmd_list)
    sp = sub.add_parser("start", help="branch review-edits/<unit> off main"); sp.add_argument("job_id"); sp.set_defaults(fn=cmd_start)
    sp = sub.add_parser("stage", help="mark comments staged + job done"); sp.add_argument("job_id"); sp.add_argument("--force", action="store_true"); sp.set_defaults(fn=cmd_stage)
    sp = sub.add_parser("preview", help="build preview/<unit>.html from the branch"); sp.add_argument("unit"); sp.set_defaults(fn=cmd_preview)
    sp = sub.add_parser("merge", help="merge review-edits/<unit> -> main, republish, mark merged"); sp.add_argument("unit"); sp.set_defaults(fn=cmd_merge)
    sp = sub.add_parser("respond", help="answer a question-comment (status=answered)"); sp.add_argument("unit"); sp.add_argument("comment_id"); sp.add_argument("text"); sp.set_defaults(fn=cmd_respond)
    sp = sub.add_parser("note", help="attach an explanation (+optional staged-edit diff), keep status"); sp.add_argument("unit"); sp.add_argument("comment_id"); sp.add_argument("text"); sp.add_argument("--before", default=""); sp.add_argument("--after", default=""); sp.set_defaults(fn=cmd_note)
    sp = sub.add_parser("decide", help="record an owner decision on a comment"); sp.add_argument("unit"); sp.add_argument("comment_id"); sp.add_argument("decision", choices=["approve", "reject", "revise"]); sp.add_argument("note", nargs="?", default=""); sp.set_defaults(fn=cmd_decide)
    sp = sub.add_parser("apply-direct", help="apply owner direct-edits literally to source on review-edits/<unit>"); sp.add_argument("job_id"); sp.set_defaults(fn=cmd_apply_direct)
    sp = sub.add_parser("refresh-source", help="materialize source main.tex -> data source/main.tex (title source)"); sp.add_argument("--dry-run", action="store_true"); sp.set_defaults(fn=cmd_refresh_source)
    sub.add_parser("publish-srcmaps", help="build content/<unit>.srcmap.json for all units (in-context editing)").set_defaults(fn=cmd_publish_srcmaps)
    sp = sub.add_parser("done", help="mark any job done"); sp.add_argument("job_id"); sp.set_defaults(fn=cmd_done)
    return p


def main(argv=None):
    a = build_parser().parse_args(argv)
    # absolute paths so the build's chdir-to-data (below) can't misplace source/output
    a.data = os.path.abspath(a.data)
    a.source = os.path.abspath(a.source)
    a.fn(a)


if __name__ == "__main__":
    main()
