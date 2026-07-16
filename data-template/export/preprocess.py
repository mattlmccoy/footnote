#!/usr/bin/env python3
"""export/preprocess.py — make ONE reading unit of an adopter's LaTeX digestible by pandoc.

Genericized from the dissertation build so it renders ANY document type identically:
a journal article (``\\section`` top level, a single ``main.tex``) exactly like a
dissertation (``\\chapter``, one file per unit). Nothing here is document-specific — the
unit list and each unit's source file come from ``chapters.json`` (parsed from the adopter's
own document), and paths come from the environment.

Usage:  SOURCE_DIR=<repo> CHAPTERS_JSON=<path> python3 export/preprocess.py <unit_id>
Emits the flattened, glossary-expanded, cref-resolved LaTeX of that unit to stdout.
siunitx units and custom math macros are handled by export/shim.tex (prepended by the
shell script); this script handles \\input flattening, \\gls, and \\cref.

Environment:
  SOURCE_DIR     root of the adopter's LaTeX source (default: cwd)
  CHAPTERS_JSON  path to the parsed unit manifest (default: <cwd>/chapters.json)
  RENDER_ENTRY   the main entry .tex used for numbering/order (default: main.tex)
  BUILD_DIR      scratch dir for rasterized figures (default: <SOURCE_DIR>/.render-build)

Cross-reference numbers are computed deterministically from the source and are
article-aware: with no ``\\chapter`` present, ``\\section`` is the top level (1, 2, 3…);
otherwise chapters number and sections nest under them (1.1, 1.2…).
"""
import os, re, sys, json, subprocess, hashlib, shutil, tempfile
from pathlib import Path

PDFLATEX = shutil.which("pdflatex") or "pdflatex"

# ---------------------------------------------------------------------------
# File access (env-driven; no hardcoded repo root)
# ---------------------------------------------------------------------------

def make_reader(source_dir):
    """read_tex(name) over an on-disk source tree: try `name` then `name.tex`, missing -> ""."""
    root = Path(source_dir)
    def read_tex(name):
        for cand in (root / name, root / (name + ".tex")):
            if cand.is_file():
                return cand.read_text(encoding="utf-8", errors="ignore")
        return ""
    return read_tex


def flatten(name, read_tex, seen=None):
    """Recursively inline \\input / \\include content, starting from `name`."""
    seen = seen or set()
    if name in seen:
        return ""
    seen.add(name)
    t = read_tex(name)
    return re.sub(r"\\(?:input|include)\{([^}]+)\}",
                  lambda m: flatten(m.group(1), read_tex, seen), t)


def strip_comments(t):
    out = []
    for line in t.splitlines():
        m = re.search(r"(?<!\\)%", line)
        out.append(line[:m.start()] if m else line)
    return "\n".join(out)


# ---------------------------------------------------------------------------
# Unit resolution (chapters.json driven, article/chapter aware)
# ---------------------------------------------------------------------------

TOP_CMD = {"chapter": "chapter", "section": "section"}


def detect_level(full_tex):
    """Top sectioning level of the assembled document: 'chapter' if any \\chapter exists,
    else 'section' (journal articles: article/elsarticle/IEEEtran have no \\chapter)."""
    return "chapter" if re.search(r"\\chapter\b", full_tex) else "section"


def _source_of(row, entry):
    return (row.get("sourceFile") or entry)


def assemble_full(rows, read_tex, entry):
    """The whole document in reading order (for numbering + cross-refs): flatten each unique
    source file once, in row order. Single-file articles collapse to flatten(entry)."""
    seen, parts = set(), []
    for r in rows:
        sf = _source_of(r, entry)
        if sf in seen:
            continue
        seen.add(sf)
        parts.append(strip_comments(flatten(sf, read_tex)))
    if not parts:                       # no rows / no sourceFiles -> fall back to the entry
        parts.append(strip_comments(flatten(entry, read_tex)))
    return "\n".join(parts)


def document_body(tex):
    """The content between \\begin{document} and \\end{document} (the whole string if the
    unit file has no document wrapper, e.g. a per-chapter \\include'd file)."""
    m = re.search(r"\\begin\{document\}(.*?)(?:\\end\{document\}|$)", tex, flags=re.S)
    return m.group(1) if m else tex


def split_top_level(tex, level):
    """Split a single file's body into blocks, one per NUMBERED top-level sectioning command
    (\\chapter or \\section). Text before the first command is dropped (preamble/intro).

    STARRED commands (\\chapter*, \\section*) are frontmatter/backmatter (Summary, Acknowledgments,
    unnumbered entries), NOT reading units — chapters.json lists only the numbered ones. Counting a
    \\chapter* as a block shifts every subsequent unit's index by one, so unit N renders unit N-1 (the
    live dtd bug: ch_platform rendered ch_background). Excluding the star keeps the block list aligned
    1:1 with the numbered units the manifest carries."""
    cmd = TOP_CMD[level]
    marker = re.compile(r"\\" + cmd + r"(?!\*)\s*(?:\[[^\]]*\])?\s*\{")
    starts = [m.start() for m in marker.finditer(tex)]
    if not starts:
        return [tex]
    bounds = starts + [len(tex)]
    return [tex[bounds[i]:bounds[i + 1]] for i in range(len(starts))]


def unit_body(rows, unit_id, read_tex, entry):
    """The raw LaTeX for one reading unit.

    - Dedicated file per unit (dissertation): return the whole flattened source file.
    - Single file shared by many units (article): slice the k-th top-level section block.
    """
    row = next((r for r in rows if r.get("id") == unit_id), None)
    if row is None:
        raise SystemExit(f"unit '{unit_id}' not found in chapters.json")
    sf = _source_of(row, entry)
    siblings = [r for r in rows if _source_of(r, entry) == sf]
    raw = flatten(sf, read_tex)
    if len(siblings) <= 1:
        return raw
    body = document_body(raw)                 # drop preamble + \end{document} wrapper
    level = detect_level(strip_comments(body))
    blocks = split_top_level(body, level)
    idx = siblings.index(row)
    return blocks[idx] if idx < len(blocks) else body


# ---------------------------------------------------------------------------
# acronym map (optional preamble)
# ---------------------------------------------------------------------------

def build_acronyms(read_tex):
    t = read_tex("preamble/acronyms")
    acr = {}
    brace = r"\{((?:[^{}]|\{[^}]*\})*)\}"
    for m in re.finditer(r"\\newacronym(?:\[[^\]]*\])?" + brace + brace + brace, t):
        key, short, long = m.group(1).strip(), m.group(2).strip(), m.group(3).strip()
        acr[key] = (short, long)
    return acr


# ---------------------------------------------------------------------------
# label -> (kind, number) map, article/chapter aware
# ---------------------------------------------------------------------------

def _letter(n):
    """Spreadsheet-column style top-level label used after \\appendix: 1->A, 26->Z, 27->AA.
    Mirrors how report/book renumber appendix chapters as letters."""
    s = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def build_label_map(read_tex, rows, entry):
    full = assemble_full(rows, read_tex, entry)
    has_chapter = detect_level(full) == "chapter"
    labels = {}
    chap = appc = sec = subsec = subsubsec = 0
    figc = tabc = eqc = 0
    in_app = False   # after \appendix / \begin{theappendices}: top level renumbers as letters
    env_stack = []   # list of (env_name, starred)
    last = None
    # Equations follow the report/book class: one number per numbered ROW (align rows count
    # individually), reset per chapter (chapter mode) or flat across the document (article mode),
    # formatted (chap.N) or (N). Nested \\-using envs (matrix, cases, aligned, …) are tracked so
    # their row breaks don't count as equation rows.
    NUM_ENVS = {"equation", "align", "gather", "multline", "eqnarray"}
    ROW_ENVS = {"align", "gather", "eqnarray"}
    NEST = "matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix|cases|array|aligned|split|gathered|subarray"
    token = re.compile(
        r"\\(chapter|section|subsection|subsubsection)\*?\{|"
        r"\\begin\{(figure|table|equation|align|gather|multline|eqnarray|" + NEST + r")(\*?)\}|"
        r"\\end\{(figure|table|equation|align|gather|multline|eqnarray|" + NEST + r")\*?\}|"
        r"\\label\{([^}]+)\}|"
        r"(\\\\)|"
        r"(\\appendix\b|\\begin\{theappendices\})")

    def topnum():
        # top-level number for section/figure/equation prefixes: letter in appendix mode, else digit
        return _letter(appc) if in_app else str(chap)

    def secnum():
        # In article mode there is no chapter: sections are the top level.
        parts = ([topnum()] if has_chapter else []) + \
                [str(x) for x in (sec, subsec, subsubsec) if x]
        return ".".join(parts) if parts else "0"

    def fignum(counter):
        return f"{topnum()}.{counter}" if has_chapter else f"{counter}"

    def eqnum(counter):
        return f"({topnum()}.{counter})" if has_chapter else f"({counter})"

    for m in token.finditer(full):
        if m.group(7):
            in_app = True
        elif m.group(1):
            lvl = m.group(1)
            if lvl == "chapter" and in_app:
                appc += 1; sec = subsec = subsubsec = 0; figc = tabc = eqc = 0; last = "appendix"
            elif lvl == "chapter":
                chap += 1; sec = subsec = subsubsec = 0; figc = tabc = eqc = 0; last = "chapter"
            elif lvl == "section":
                sec += 1; subsec = subsubsec = 0; last = "section"
                if not has_chapter:               # article: sections reset floats (not equations)
                    figc = tabc = 0
            elif lvl == "subsection":
                subsec += 1; subsubsec = 0; last = "section"
            elif lvl == "subsubsection":
                subsubsec += 1; last = "section"
        elif m.group(2):
            e = m.group(2); starred = bool(m.group(3))
            if e == "figure": figc += 1
            elif e == "table": tabc += 1
            elif e in NUM_ENVS and not starred: eqc += 1   # first (or only) numbered row
            env_stack.append((e, starred))
        elif m.group(4):
            if env_stack: env_stack.pop()
        elif m.group(5):
            lbl = m.group(5).strip()
            if env_stack:
                e, starred = env_stack[-1]
                if e == "figure":  labels[lbl] = ("Figure", fignum(figc))
                elif e == "table": labels[lbl] = ("Table", fignum(tabc))
                elif e in NUM_ENVS and not starred: labels[lbl] = ("Equation", eqnum(eqc))
            elif last == "chapter":
                labels[lbl] = ("Chapter", str(chap))
            elif last == "appendix":
                labels[lbl] = ("Appendix", _letter(appc))
            else:
                labels[lbl] = ("Section", secnum())
        elif m.group(6):   # row break: a new numbered row inside an align-family environment
            if env_stack:
                e, starred = env_stack[-1]
                if e in ROW_ENVS and not starred: eqc += 1
    return labels


# ---------------------------------------------------------------------------
# glossary expansion (pure over an acronym map)
# ---------------------------------------------------------------------------

def expand_gls(t, acr):
    def short(k): return acr.get(k, (k, k))[0]
    def long(k):  return acr.get(k, (k, k))[1]
    t = re.sub(r"\\acrfull\{([^}]+)\}",  lambda m: f"{long(m.group(1))} ({short(m.group(1))})", t)
    t = re.sub(r"\\acrlong\{([^}]+)\}",  lambda m: long(m.group(1)), t)
    t = re.sub(r"\\acrshort\{([^}]+)\}", lambda m: short(m.group(1)), t)
    t = re.sub(r"\\Glspl\{([^}]+)\}", lambda m: short(m.group(1)).capitalize() + "s", t)
    t = re.sub(r"\\glspl\{([^}]+)\}", lambda m: short(m.group(1)) + "s", t)
    t = re.sub(r"\\Gls\{([^}]+)\}",   lambda m: (lambda s: s[:1].upper() + s[1:])(short(m.group(1))), t)
    t = re.sub(r"\\gls\{([^}]+)\}",   lambda m: short(m.group(1)), t)
    return t


# ---------------------------------------------------------------------------
# cleveref resolution (pure over a label map)
# ---------------------------------------------------------------------------

PREFIX_KIND = {"ch": "Chapter", "chap": "Chapter", "sec": "Section", "subsec": "Section",
               "fig": "Figure", "tab": "Table", "eq": "Equation", "app": "Appendix",
               "alg": "Algorithm"}


def _kindnum(lbl, labels):
    if lbl in labels: return labels[lbl]
    pre = lbl.split(":", 1)[0]
    return (PREFIX_KIND.get(pre, "Item"), "")


def _fmt_group(label_list, cap, labels):
    items = [_kindnum(l.strip(), labels) for l in label_list if l.strip()]
    kinds = {k for k, n in items}
    if len(kinds) == 1:
        kind = next(iter(kinds))
        kind_disp = kind if cap else kind.lower()
        nums = [n for k, n in items if n]
        if not nums: return kind_disp
        plural = (kind_disp + "s") if len(nums) > 1 else kind_disp
        if len(nums) == 1: return f"{kind_disp} {nums[0]}"
        if len(nums) == 2: return f"{plural} {nums[0]} and {nums[1]}"
        return f"{plural} " + ", ".join(nums[:-1]) + f" and {nums[-1]}"
    parts = []
    for k, n in items:
        kd = k if cap else k.lower()
        parts.append(f"{kd} {n}".strip())
    return ", ".join(parts[:-1]) + " and " + parts[-1] if len(parts) > 1 else parts[0]


def resolve_cref(t, labels):
    t = re.sub(r"\\[Cc]refrange\{([^}]+)\}\{([^}]+)\}",
               lambda m: _fmt_group([m.group(1)], m.group(0)[1] == 'C', labels).split()[0]
               + f" {_kindnum(m.group(1), labels)[1]}–{_kindnum(m.group(2), labels)[1]}", t)
    t = re.sub(r"\\Cref\{([^}]+)\}", lambda m: _fmt_group(m.group(1).split(","), True, labels), t)
    t = re.sub(r"\\cref\{([^}]+)\}", lambda m: _fmt_group(m.group(1).split(","), False, labels), t)
    t = re.sub(r"\\namecref\{([^}]+)\}", lambda m: _kindnum(m.group(1), labels)[0].lower(), t)
    t = re.sub(r"\\(?:autoref|ref|labelcref)\{([^}]+)\}",
               lambda m: _fmt_group([m.group(1)], True, labels), t)
    return t


# ---------------------------------------------------------------------------
# surface equation numbers on labeled display equations (pandoc --katex drops LaTeX numbering)
# ---------------------------------------------------------------------------

_NEST = "matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix|cases|array|aligned|split|gathered|subarray"


def _count_eq_rows(text):
    """Number of numbered equation rows in `text` (equation/multline = 1; align/gather/eqnarray =
    one per row), ignoring starred environments and nested matrix/cases \\ breaks."""
    total = 0
    for m in re.finditer(r"\\begin\{(equation|align|gather|multline|eqnarray)(\*?)\}(.*?)\\end\{\1\*?\}",
                         text, re.S):
        env, star, body = m.group(1), m.group(2), m.group(3)
        if star:
            continue
        if env in {"align", "gather", "eqnarray"}:
            masked = re.sub(r"\\begin\{(" + _NEST + r")\*?\}.*?\\end\{\1\*?\}", " ", body, flags=re.S)
            parts = re.split(r"\\\\(?:\[[^\]]*\])?", masked)
            total += sum(1 for p in parts if p.strip() and not re.search(r"\\nonumber|\\notag", p))
        else:
            total += 1
    return total


def unit_equation_context(rows, unit_id, read_tex, entry):
    """(prefix, offset) for numbering one unit's equations. Chapter mode: prefix '<chap>.' (or the
    appendix LETTER '<A>.' for kind=='appendix' units) and offset 0 — the equation counter resets each
    chapter/appendix. Article mode: prefix '' and offset = the count of numbered equation rows in all
    preceding units (equations run flat across the doc)."""
    full = assemble_full(rows, read_tex, entry)
    has_chapter = detect_level(full) == "chapter"
    chap_before = app_before = eq_before = 0
    for row in rows:
        rid = row.get("id")
        is_app = row.get("kind") == "appendix"
        body = unit_body(rows, rid, read_tex, entry)
        if rid == unit_id:
            if not has_chapter:
                return ("", eq_before)
            if is_app:
                return (f"{_letter(app_before + 1)}.", 0)
            return (f"{chap_before + 1}.", 0)
        # appendix units advance the letter counter, not the numeric chapter counter (their internal
        # \chapter commands must not inflate the chapter number of a later main-matter unit)
        if is_app:
            app_before += 1
        else:
            chap_before += len(re.findall(r"\\chapter\b", strip_comments(body)))
        eq_before += _count_eq_rows(body)
    return ("", 0)


def tag_equations(t, prefix, offset=0):
    """Number labeled AND unlabeled display equations as the source class does: one number per
    numbered ROW (align rows individually), formatted <prefix>N starting at offset+1. The bare
    number goes in \\tag; KaTeX adds the parens. align/gather/eqnarray are starred to suppress
    KaTeX's per-block auto-numbering; every numbered row is tagged explicitly. Starred environments
    stay unnumbered."""
    n = [offset]
    def nxt():
        n[0] += 1
        return f"{prefix}{n[0]}"

    def tag_rows(body):
        masks = []
        masked = re.sub(r"\\begin\{(" + _NEST + r")\*?\}.*?\\end\{\1\*?\}",
                        lambda mm: (masks.append(mm.group(0)), f"\x00{len(masks)-1}\x00")[1], body, flags=re.S)
        parts = re.split(r"(\\\\(?:\[[^\]]*\])?)", masked)
        out = []
        for i, seg in enumerate(parts):
            if i % 2 == 1:                       # a \\ row-break delimiter
                out.append(seg); continue
            if seg.strip() and not re.search(r"\\nonumber|\\notag", seg):
                rs = seg.rstrip()
                out.append(rs + f"\\tag{{{nxt()}}}" + seg[len(rs):])
            else:
                out.append(seg)
        res = "".join(out)
        for i, orig in enumerate(masks):
            res = res.replace(f"\x00{i}\x00", orig)
        return res

    ROW_ENVS = {"align", "gather", "eqnarray"}
    def repl(m):
        env, star, body = m.group(1), m.group(2), m.group(3)
        if star or r"\tag" in body:            # starred = unnumbered; already-tagged = leave alone
            return m.group(0)
        if env in ROW_ENVS:
            return f"\\begin{{{env}*}}{tag_rows(body)}\\end{{{env}*}}"
        return f"\\begin{{{env}}}{body}\\tag{{{nxt()}}}\\end{{{env}}}"   # equation/multline: one number
    return re.sub(r"\\begin\{(equation|align|gather|multline|eqnarray)(\*?)\}(.*?)\\end\{\1\*?\}",
                  repl, t, flags=re.S)


# ---------------------------------------------------------------------------
# inject "Figure N." / "Table N." into captions (pandoc drops LaTeX numbering)
# ---------------------------------------------------------------------------

def number_captions(t, labels):
    def do(block, env):
        kind = "Figure" if env == "figure" else "Table"
        masked = re.sub(r"\\begin\{subfigure\}.*?\\end\{subfigure\}",
                        lambda mm: " " * len(mm.group(0)), block, flags=re.S)
        num = None
        for lab in re.findall(r"\\label\{([^}]+)\}", masked):
            info = labels.get(lab.strip())
            if info and info[0] == kind:
                num = info[1]; break
        if num is None:
            return block
        cm = re.search(r"\\caption\s*(?:\[[^\]]*\])?(?:\s|%[^\n]*\n)*\{", masked)
        if not cm:
            return block
        i = cm.end()
        return block[:i] + f"{kind} {num}. " + block[i:]
    for env in ("figure", "table"):
        t = re.sub(r"\\begin\{" + env + r"\*?\}.*?\\end\{" + env + r"\*?\}",
                   lambda m, e=env: do(m.group(0), e), t, flags=re.S)
    return t


# ---------------------------------------------------------------------------
# siunitx optional-arg stripping
# ---------------------------------------------------------------------------

def strip_si_optionals(t):
    return re.sub(r"\\(SI|si|num|SIrange|qty|qtyrange|numrange|numlist|SIlist|ang)\[[^\]]*\]",
                  r"\\\1", t)


# ---------------------------------------------------------------------------
# figures: rasterize inline TikZ + PDF graphics to PNG (pandoc/HTML can't show them)
# ---------------------------------------------------------------------------

def _tikz_preamble(read_tex):
    pkg = read_tex("preamble/packages")
    libs = re.findall(r"\\usetikzlibrary\{[^}]*\}", pkg)
    tset = re.search(r"\\tikzset\{.*?\n\}", pkg, re.S)
    si = [ln.strip() for ln in pkg.splitlines()
          if ln.lstrip().startswith(("\\DeclareSIUnit", "\\sisetup"))]
    parts = [r"\documentclass[border=4pt]{standalone}", r"\usepackage{amsmath}",
             r"\usepackage{amssymb}", r"\usepackage{siunitx}", r"\usepackage{tikz}"] + libs
    parts += si
    if tset:
        parts.append(tset.group(0))
    return "\n".join(parts)


def _compile_tikz(doc, stem, figdir):
    with tempfile.TemporaryDirectory() as td:
        (Path(td) / "p.tex").write_text(doc, encoding="utf-8")
        subprocess.run([PDFLATEX, "-interaction=nonstopmode", "-halt-on-error", "p.tex"],
                       cwd=td, capture_output=True)
        pdf = Path(td) / "p.pdf"
        if not pdf.exists():
            return False
        subprocess.run(["pdftoppm", "-png", "-r", "200", "-singlefile", str(pdf), str(figdir / stem)],
                       check=False)
        return (figdir / (stem + ".png")).exists()


def rasterize_tikz(t, read_tex, build_dir, ref):
    if "\\begin{tikzpicture}" not in t:
        return t
    figdir = build_dir / "figs"
    figdir.mkdir(parents=True, exist_ok=True)
    preamble = _tikz_preamble(read_tex)
    macros = read_tex("preamble/macros") or ""

    def repl(m):
        pic = m.group(0)
        stem = "tikz_" + hashlib.sha1(pic.encode("utf-8")).hexdigest()[:12]
        out = figdir / (stem + ".png")
        if not out.exists():
            body = "\n\\begin{document}\n" + pic + "\n\\end{document}\n"
            ok = _compile_tikz(preamble + "\n" + macros + body, stem, figdir) \
                or _compile_tikz(preamble + body, stem, figdir)
            if not ok:
                print(f"  tikz: could not rasterize {stem} — leaving caption only", file=sys.stderr)
        return f"\\includegraphics{{{ref}/figs/{out.name}}}" if out.exists() else pic
    return re.sub(r"\\begin\{tikzpicture\}.*?\\end\{tikzpicture\}", repl, t, flags=re.S)


def _resolve_graphic(source_dir, p):
    pp = source_dir / p
    cands = [pp] if pp.suffix else [source_dir / (p + ext) for ext in (".pdf", ".png", ".jpg", ".jpeg")]
    for c in cands:
        if c.is_file():
            return c
    return None


def convert_figs(t, source_dir, build_dir, ref):
    figdir = build_dir / "figs"
    figdir.mkdir(parents=True, exist_ok=True)

    def repl(m):
        opt, p = (m.group(1) or ""), m.group(2).strip()
        src = _resolve_graphic(source_dir, p)
        if src is None:
            return m.group(0)
        if src.suffix.lower() == ".pdf":
            stem = re.sub(r"[^A-Za-z0-9_.-]", "_", p)
            out = figdir / (stem + ".png")
            if not out.exists():
                subprocess.run(["pdftoppm", "-png", "-r", "200", "-singlefile",
                                str(src), str(figdir / stem)], check=False)
            return f"\\includegraphics{opt}{{{ref}/figs/{out.name}}}" if out.exists() else m.group(0)
        return f"\\includegraphics{opt}{{{src.relative_to(source_dir)}}}"
    return re.sub(r"\\includegraphics(\[[^\]]*\])?\{([^}]+)\}", repl, t)


# ---------------------------------------------------------------------------
# unwrap \resizebox / \scalebox (pandoc drops their content)
# ---------------------------------------------------------------------------

def _skip_group(s, i):
    depth = 0
    while i < len(s):
        if s[i] == "{": depth += 1
        elif s[i] == "}":
            depth -= 1
            if depth == 0: return i + 1
        i += 1
    return i


def strip_boxes(t):
    for cmd, nskip in (("resizebox", 2), ("scalebox", 1)):
        key = "\\" + cmd; out = []; i = 0
        while True:
            j = t.find(key, i)
            if j < 0: out.append(t[i:]); break
            out.append(t[i:j]); k = j + len(key)
            for _ in range(nskip):
                while k < len(t) and t[k] in " \n\t": k += 1
                if k < len(t) and t[k] == "[":
                    k = t.find("]", k) + 1
                    while k < len(t) and t[k] in " \n\t": k += 1
                if k < len(t) and t[k] == "{": k = _skip_group(t, k)
            while k < len(t) and t[k] in " \n\t": k += 1
            if k < len(t) and t[k] == "{":
                end = _skip_group(t, k); out.append(t[k + 1:end - 1]); i = end
            else:
                out.append(key); i = j + len(key)
        t = "".join(out)
    return t


# ---------------------------------------------------------------------------
# driver
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) < 2:
        sys.exit("usage: SOURCE_DIR=<repo> preprocess.py <unit_id>")
    unit_id = sys.argv[1]
    source_dir = Path(os.environ.get("SOURCE_DIR", ".")).resolve()
    entry = os.environ.get("RENDER_ENTRY", "main.tex")
    chapters_json = os.environ.get("CHAPTERS_JSON", "chapters.json")
    build_dir = Path(os.environ.get("BUILD_DIR", str(source_dir / ".render-build"))).resolve()
    build_ref = os.path.relpath(build_dir, source_dir)   # path pandoc can resolve from SOURCE_DIR

    rows = json.loads(Path(chapters_json).read_text(encoding="utf-8"))
    if isinstance(rows, dict):                 # tolerate {chapters:[…]} or a bare list
        rows = rows.get("chapters") or rows.get("units") or []
    read_tex = make_reader(source_dir)
    acr = build_acronyms(read_tex)
    labels = build_label_map(read_tex, rows, entry)

    t = unit_body(rows, unit_id, read_tex, entry)
    t = strip_si_optionals(t)
    t = expand_gls(t, acr)
    prefix, offset = unit_equation_context(rows, unit_id, read_tex, entry)
    t = resolve_cref(t, labels)
    t = tag_equations(t, prefix, offset)
    t = number_captions(t, labels)
    t = rasterize_tikz(t, read_tex, build_dir, build_ref)
    t = strip_boxes(t)
    t = convert_figs(t, source_dir, build_dir, build_ref)
    sys.stdout.write(t)


if __name__ == "__main__":
    main()
