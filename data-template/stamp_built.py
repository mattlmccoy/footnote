#!/usr/bin/env python3
"""stamp_built.py — record which SOURCE COMMIT each rendered unit came from, for a data repo that
is rendered BY HAND rather than by the render workflow.

``ci_render.py`` writes ``content/built.json`` itself, but a project that re-renders manually (run
``export/chapter-html.sh`` / a local ``ci_render.py``, then commit ``content/``) never gets it. Run
this straight after a manual re-render and the reader gains commit-exact drift ("is this doc built
from current main?") instead of inferring it from file timestamps.

Only units whose HTML is NEWER than its recorded stamp are re-stamped. A unit you did not re-render
keeps its real provenance, so the manifest never claims a unit was built from a commit it wasn't.

Usage:
    python3 stamp_built.py --data /path/to/data-repo --source /path/to/source-repo [--prefix ""]
    python3 stamp_built.py --data . --source ../phd-dissertation --dry-run

Writes/merges <data>/<prefix>content/built.json = {unitId: {sha, ts}}. Never touches reviews/.
"""
import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

SKIP = {"counts.json", "built.json"}


def source_sha(source_dir):
    """HEAD of the source checkout. '' when it is not a git repo — an unknown ref is never recorded."""
    try:
        out = subprocess.run(["git", "-C", str(source_dir), "rev-parse", "HEAD"],
                             check=True, capture_output=True, text=True)
        return out.stdout.strip()
    except Exception:
        return ""


def _stamp_ts(entry):
    """The recorded stamp time as epoch seconds, or None when absent/unparseable."""
    ts = (entry or {}).get("ts")
    if not ts:
        return None
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).timestamp()
    except Exception:
        return None


def head_commit_epoch(source_dir):
    """Commit time of the source HEAD, as epoch seconds. None when unknown."""
    try:
        out = subprocess.run(["git", "-C", str(source_dir), "show", "-s", "--format=%ct", "HEAD"],
                             check=True, capture_output=True, text=True)
        return float(out.stdout.strip())
    except Exception:
        return None


def partition_units(content_dir, manifest, head_epoch):
    """Split the units that need stamping into (fresh, stale).

    `stale` = its HTML is OLDER than the source HEAD commit, so it was rendered BEFORE that commit
    existed and was therefore NOT built from it. Stamping those would record provenance they never
    had — the exact mistake a blanket backfill makes (13 units rendered 18:22 vs a HEAD from 18:35).
    They are held back, not guessed at.
    """
    todo = units_needing_stamp(content_dir, manifest)
    if head_epoch is None:
        return todo, []
    fresh, stale = [], []
    for uid in todo:
        p = Path(content_dir) / f"{uid}.html"
        (fresh if p.stat().st_mtime >= head_epoch else stale).append(uid)
    return fresh, stale


def units_needing_stamp(content_dir, manifest):
    """Unit ids whose content/<id>.html has changed since it was last stamped (or was never
    stamped). Sorted for a stable manifest diff."""
    out = []
    for p in sorted(Path(content_dir).glob("*.html")):
        uid = p.stem
        if p.name in SKIP:
            continue
        recorded = _stamp_ts((manifest or {}).get(uid))
        if recorded is None or p.stat().st_mtime > recorded:
            out.append(uid)
    return out


def load_manifest(path):
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8")) or {}
    except Exception:
        return {}


def main(argv=None):
    ap = argparse.ArgumentParser(description="Stamp content/built.json after a manual re-render.")
    ap.add_argument("--data", required=True, help="path to the data repo (holds content/)")
    ap.add_argument("--source", required=True, help="path to the LaTeX source checkout")
    ap.add_argument("--prefix", default="", help="workspace project prefix, e.g. 'my-paper/'")
    ap.add_argument("--dry-run", action="store_true", help="print what would change, write nothing")
    a = ap.parse_args(argv)

    sha = source_sha(a.source)
    if not sha:
        print(f"[stamp] {a.source} is not a git checkout — refusing to record an unknown ref", file=sys.stderr)
        return 1

    content_dir = Path(a.data) / f"{a.prefix}content"
    if not content_dir.is_dir():
        print(f"[stamp] no {content_dir} — nothing to stamp", file=sys.stderr)
        return 1

    out = content_dir / "built.json"
    manifest = load_manifest(out)
    todo, stale = partition_units(content_dir, manifest, head_commit_epoch(a.source))
    for uid in stale:
        print(f"[stamp] SKIP {uid}: rendered before {sha[:7]} existed — re-render it to record provenance",
              file=sys.stderr)
    if not todo:
        print(f"[stamp] nothing to stamp ({len(manifest)} recorded"
              + (f", {len(stale)} held back as not-built-from-HEAD" if stale else "") + ")")
        return 0

    now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    for uid in todo:
        manifest[uid] = {"sha": sha, "ts": now}
    print(f"[stamp] source {sha[:7]} → {len(todo)} unit(s): {', '.join(todo)}")
    if a.dry_run:
        print("[stamp] --dry-run: nothing written")
        return 0
    out.write_text(json.dumps(manifest, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"[stamp] wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
