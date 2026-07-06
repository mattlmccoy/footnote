#!/usr/bin/env python3
"""srcmap.py — emit a paragraph→source map so the reviewer app can offer in-context direct
editing. For each rendered prose paragraph in the chapter HTML, record the verbatim .tex
paragraph it came from, by sequentially aligning the preprocessed source to the HTML.

    python3 export/srcmap.py <ch> <pre_tex> <html> <out.json>

The map is best-effort: paragraphs that can't be confidently aligned are omitted (their
pencil is disabled in the app). `source_text` is a verbatim block from the flattened
pre.tex — locatable in the real source files on apply.
"""
import sys, re, json, html as _html
from difflib import SequenceMatcher

def strip_tex(s):
    s = re.sub(r"(?<!\\)%.*", "", s)                      # comments
    s = re.sub(r"\\(cite|ref|cref|Cref|eqref|gls|glspl|label)\s*\{[^}]*\}", " ", s)
    s = re.sub(r"\$[^$]*\$", " ", s)                      # inline math
    s = re.sub(r"\\[a-zA-Z@]+\*?", " ", s)                # control sequences
    s = re.sub(r"[{}~\\]", " ", s)
    return re.sub(r"\s+", " ", s).strip().lower()

ENV_RE = re.compile(r"\\(begin|end)\{(figure|table|equation|align|gather|multline|tabular|"
                    r"itemize|enumerate|verbatim|lstlisting|tikzpicture|center)\*?\}")

def tex_paragraphs(pre):
    """Verbatim prose blocks from the flattened source (blank-line separated), skipping
    float/list/math environments and pure-command blocks."""
    out, depth = [], 0
    for block in re.split(r"\n\s*\n", pre):
        b = block.strip()
        if not b:
            continue
        begins = len(re.findall(r"\\begin\{", b)); ends = len(re.findall(r"\\end\{", b))
        in_env = depth > 0
        depth += begins - ends
        if in_env or ENV_RE.search(b):
            continue
        if b.startswith("\\") and strip_tex(b) == "":     # section headings / standalone commands
            continue
        plain = strip_tex(b)
        if len(plain) >= 24:                              # real prose, not a stray macro
            out.append({"source_text": block.strip("\n"), "plain": plain})
    return out

def html_paragraphs(htmltext):
    paras = []
    for m in re.finditer(r"<p[^>]*>(.*?)</p>", htmltext, re.S):
        inner = m.group(1)
        txt = re.sub(r"<[^>]+>", " ", inner)              # drop tags (incl. citation links, math spans)
        txt = _html.unescape(re.sub(r"\s+", " ", txt)).strip()
        if len(txt) >= 24:
            paras.append(txt.lower())
    return paras

def align(hps, tps):
    """Greedy in-order alignment: each HTML paragraph -> best nearby source block."""
    out, j = [], 0
    for i, h in enumerate(hps):
        best, bj = 0.0, -1
        for k in range(j, min(j + 4, len(tps))):         # small forward window
            r = SequenceMatcher(None, h, tps[k]["plain"]).ratio()
            if r > best:
                best, bj = r, k
        if bj >= 0 and best >= 0.6:
            out.append({"i": i, "head": h[:80], "source_text": tps[bj]["source_text"]})
            j = bj + 1
    return out

def main():
    if len(sys.argv) != 5:
        print(__doc__); sys.exit(2)
    ch, pre_path, html_path, out_path = sys.argv[1:5]
    pre = open(pre_path, encoding="utf-8").read()
    htmltext = open(html_path, encoding="utf-8").read()
    hps = html_paragraphs(htmltext); tps = tex_paragraphs(pre)
    mapping = align(hps, tps)
    json.dump({"chapter": ch, "paragraphs": mapping}, open(out_path, "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    pct = round(100 * len(mapping) / max(1, len(hps)))
    print(f"srcmap {ch}: {len(mapping)}/{len(hps)} prose paragraphs aligned ({pct}%) -> {out_path}")

if __name__ == "__main__":
    main()
