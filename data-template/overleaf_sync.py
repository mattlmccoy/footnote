"""Pure core for Overleaf Tier-2 sync: marker discovery, secret-name derivation, and a
line-based three-way merge. NO git, network, or filesystem — every function is a pure
data transform so the whole reconcile logic is unit-testable without a real Overleaf.
The thin shell (ci_overleaf.py) supplies the trees and performs the git/IO."""
import difflib
import re


def marked_prefixes(marker_paths):
    """Map discovered ``overleaf.json`` marker paths to project prefixes.
    ``"a/overleaf.json"`` -> ``"a/"``; a root ``"overleaf.json"`` -> ``""`` (legacy single project).
    Sorted, deduped. Only marked projects sync — unmarked (uploaded/github-mode) are never touched."""
    out = set()
    for p in marker_paths or []:
        if p == "overleaf.json":
            out.add("")
        elif p.endswith("/overleaf.json"):
            out.add(p[: -len("overleaf.json")])
    return sorted(out)


def secret_name(project_id):
    """The per-project Actions secret name holding that Overleaf project's git-bridge token.
    GitHub secret names allow ``[A-Z0-9_]`` — upper-case the id, map every other run to a single
    ``_``, trim leading/trailing ``_``. Empty id -> the shared ``OVERLEAF_TOKEN`` fallback name."""
    slug = re.sub(r"[^A-Za-z0-9]+", "_", (project_id or "")).strip("_").upper()
    return f"OVERLEAF_TOKEN_{slug}" if slug else "OVERLEAF_TOKEN"


def _regions(base_lines, other_lines):
    """Changed base-line regions turning base into other: list of (i1, i2, replacement_lines)
    for every non-equal opcode. (i1, i2) is a half-open base-line range; a pure insertion has
    i1 == i2."""
    sm = difflib.SequenceMatcher(a=base_lines, b=other_lines, autojunk=False)
    regs = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag != "equal":
            regs.append((i1, i2, other_lines[j1:j2]))
    return regs


def three_way_lines(base, a, b):
    """diff3-style line merge with ``base`` as the common ancestor. ``a`` = Overleaf side,
    ``b`` = GitHub side. Returns ``(merged_text, conflict)``. Disjoint hunks merge; hunks whose
    base ranges overlap are a conflict (merged_text is '' when conflict is True — the shell never
    writes it). Non-overlapping insertions at the same base index both apply, deterministically
    ordered by base position."""
    if a == b:
        return a, False
    if a == base:
        return b, False
    if b == base:
        return a, False
    base_l = base.splitlines(keepends=True)
    ra = _regions(base_l, a.splitlines(keepends=True))
    rb = _regions(base_l, b.splitlines(keepends=True))
    for (ai1, ai2, _ra) in ra:
        for (bi1, bi2, _rb) in rb:
            if ai1 < bi2 and bi1 < ai2:      # overlapping base ranges (zero-width never overlaps)
                return "", True
    changes = sorted(ra + rb, key=lambda r: (r[0], r[1]))
    out, pos = [], 0
    for (i1, i2, rep) in changes:
        out.extend(base_l[pos:i1])
        out.extend(rep)
        pos = i2
    out.extend(base_l[pos:])
    return "".join(out), False


def merge_file(base, a, b, is_text):
    """Reconcile one path. ``base`` = last-synced ancestor, ``a`` = Overleaf-now, ``b`` = GitHub-now;
    ``None`` means the path is absent on that side. Returns ``{"content", "conflict"}`` where
    ``content is None`` means "deleted" (conflict False) or "unresolved" (conflict True). Text paths
    line-merge; binaries (and any add/delete-vs-modify) are whole-file: take the single changed side,
    conflict when both changed differently."""
    if a == b:
        return {"content": a, "conflict": False}
    if a == base:
        return {"content": b, "conflict": False}      # only GitHub changed (incl. delete when b is None)
    if b == base:
        return {"content": a, "conflict": False}       # only Overleaf changed
    if not is_text or a is None or b is None:
        return {"content": None, "conflict": True}     # binary both-changed, or modify-vs-delete
    text, conflict = three_way_lines(base, a, b)
    return {"content": (None if conflict else text), "conflict": conflict}


def plan_sync(base, overleaf, github, text_paths=None):
    """Reconcile whole trees (dict path -> content). ``text_paths`` (a set) marks which paths
    line-merge; ``None`` = treat all as text. Returns ``{"merged", "conflicts", "pull_needed",
    "push_needed"}``. ``merged`` is the reconciled tree (GitHub gets it on pull, Overleaf on push);
    a path absent from ``merged`` with no conflict is a deletion. ``pull_needed`` / ``push_needed``
    are True only when the merged tree differs from that side — the base snapshot makes a no-op
    no-op (prevents ping-pong)."""
    paths = set(base) | set(overleaf) | set(github)
    merged, conflicts = {}, []
    for p in sorted(paths):
        is_text = True if text_paths is None else (p in text_paths)
        r = merge_file(base.get(p), overleaf.get(p), github.get(p), is_text)
        if r["conflict"]:
            conflicts.append(p)
        elif r["content"] is not None:
            merged[p] = r["content"]
    pull_needed = any(merged.get(p) != github.get(p) for p in set(merged) | set(github))
    push_needed = any(merged.get(p) != overleaf.get(p) for p in set(merged) | set(overleaf))
    return {"merged": merged, "conflicts": conflicts,
            "pull_needed": pull_needed, "push_needed": push_needed}
