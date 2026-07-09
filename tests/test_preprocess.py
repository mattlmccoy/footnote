"""Phase 3 — the genericized export/preprocess.py must render ANY adopter's LaTeX:
a journal article (\\section top level, single main.tex) exactly like a dissertation
(\\chapter, one file per unit), driven by chapters.json (unit -> sourceFile), with all
Matt-specific hardcodes (ROOT=parents[1], chapters/ prefix, preamble/*) removed.

Run: python3 -m pytest tests/test_preprocess.py
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "data-template" / "export"))

import preprocess as P  # noqa: E402


def reader_from(files):
    """Build a read_tex(name) over an in-memory {name: content} map, mimicking the real
    resolver: try `name` then `name.tex`, missing -> "" (optional-preamble fallback)."""
    def read_tex(name):
        if name in files:
            return files[name]
        if (name + ".tex") in files:
            return files[name + ".tex"]
        return ""
    return read_tex


# ---------------- level detection (article vs chapter) ----------------

def test_detect_level_chapter_when_chapter_present():
    assert P.detect_level("\\chapter{Intro}\n\\section{Sub}") == "chapter"


def test_detect_level_section_for_article():
    assert P.detect_level("\\section{Intro}\n\\section{Method}") == "section"


# ---------------- flatten \input/\include with injected reader ----------------

def test_flatten_inlines_includes():
    files = {"main.tex": "A \\include{chapters/one} B", "chapters/one.tex": "ONE"}
    assert P.flatten("main.tex", reader_from(files)).strip() == "A ONE B"


# ---------------- unit -> source resolution ----------------

def test_unit_body_multifile_returns_whole_chapter_file():
    rows = [{"id": "ch_a", "n": 1, "title": "A", "sourceFile": "chapters/ch_a.tex"},
            {"id": "ch_b", "n": 2, "title": "B", "sourceFile": "chapters/ch_b.tex"}]
    files = {"chapters/ch_a.tex": "\\chapter{A}\nAlpha body.",
             "chapters/ch_b.tex": "\\chapter{B}\nBeta body."}
    body = P.unit_body(rows, "ch_b", reader_from(files), "main.tex")
    assert "Beta body." in body
    assert "Alpha body." not in body


def test_unit_body_singlefile_article_slices_target_section():
    # journal article: every unit maps to the same main.tex; must slice the k-th section
    rows = [{"id": "intro", "n": 1, "title": "Intro", "sourceFile": "main.tex"},
            {"id": "method", "n": 2, "title": "Method", "sourceFile": "main.tex"},
            {"id": "results", "n": 3, "title": "Results", "sourceFile": "main.tex"}]
    files = {"main.tex": (
        "\\documentclass{article}\\begin{document}\n"
        "\\section{Intro}\nIntro prose.\n"
        "\\section{Method}\nMethod prose.\n"
        "\\section{Results}\nResults prose.\n"
        "\\end{document}\n")}
    body = P.unit_body(rows, "method", reader_from(files), "main.tex")
    assert "Method prose." in body
    assert "Intro prose." not in body
    assert "Results prose." not in body


def test_unit_body_last_section_excludes_document_wrapper():
    # the final section must NOT swallow \end{document} (pandoc chokes on the stray token)
    rows = [{"id": "intro", "n": 1, "title": "Intro", "sourceFile": "main.tex"},
            {"id": "results", "n": 2, "title": "Results", "sourceFile": "main.tex"}]
    files = {"main.tex": (
        "\\documentclass{article}\n\\begin{document}\n"
        "\\section{Intro}\nIntro prose.\n"
        "\\section{Results}\nFinal prose.\n"
        "\\end{document}\n")}
    body = P.unit_body(rows, "results", reader_from(files), "main.tex")
    assert "Final prose." in body
    assert "\\end{document}" not in body
    assert "\\documentclass" not in body


# ---------------- numbering + cref resolution, article-aware ----------------

def test_label_map_numbers_article_sections_top_level():
    rows = [{"id": "intro", "n": 1, "title": "Intro", "sourceFile": "main.tex"},
            {"id": "method", "n": 2, "title": "Method", "sourceFile": "main.tex"}]
    files = {"main.tex": (
        "\\section{Intro}\\label{sec:intro}\n"
        "\\section{Method}\\label{sec:method}\n")}
    labels = P.build_label_map(reader_from(files), rows, "main.tex")
    assert labels["sec:intro"] == ("Section", "1")
    assert labels["sec:method"] == ("Section", "2")


def test_label_map_numbers_chapters():
    rows = [{"id": "ch_a", "n": 1, "title": "A", "sourceFile": "chapters/ch_a.tex"},
            {"id": "ch_b", "n": 2, "title": "B", "sourceFile": "chapters/ch_b.tex"}]
    files = {"main.tex": "\\include{chapters/ch_a}\n\\include{chapters/ch_b}",
             "chapters/ch_a.tex": "\\chapter{A}\\label{ch:a}\n\\section{S}\\label{sec:s}",
             "chapters/ch_b.tex": "\\chapter{B}\\label{ch:b}"}
    labels = P.build_label_map(reader_from(files), rows, "main.tex")
    assert labels["ch:a"] == ("Chapter", "1")
    assert labels["sec:s"] == ("Section", "1.1")
    assert labels["ch:b"] == ("Chapter", "2")


def test_resolve_cref_uses_label_map():
    labels = {"sec:intro": ("Section", "1")}
    assert P.resolve_cref("see \\cref{sec:intro} now", labels) == "see section 1 now"
    assert P.resolve_cref("see \\Cref{sec:intro}", labels) == "see Section 1"


# ---------------- optional preamble ----------------

def test_build_acronyms_empty_when_absent():
    assert P.build_acronyms(reader_from({})) == {}


def test_expand_gls_falls_back_to_key_when_no_acronyms():
    # no acronyms defined -> \gls{foo} degrades to the key, never crashes
    assert P.expand_gls("\\gls{rf} heating", {}) == "rf heating"


def test_expand_gls_uses_defined_acronym():
    acr = {"rf": ("RF", "radio frequency")}
    assert P.expand_gls("\\gls{rf} and \\acrlong{rf}", acr) == "RF and radio frequency"


# ---------------- equation numbering (reader \tag) ----------------
# Ported from the dissertation reader: labeled display equations must show the (N) that
# in-text \cref/\eqref point at, numbered per-\label (unlabeled blocks consume nothing,
# multi-row aligns get consecutive numbers), with a bare-number \tag (KaTeX adds the parens)
# and align/eqnarray starred so KaTeX's per-block auto-numbering can't collide.

def _eqmap(body):
    rows = [{"id": "m", "n": 1, "title": "M", "sourceFile": "main.tex"}]
    files = {"main.tex": "\\section{M}\\label{sec:m}\n" + body}
    return P.build_label_map(reader_from(files), rows, "main.tex")


def test_label_map_numbers_labeled_equations_consecutively():
    labels = _eqmap("\\begin{equation} a=b \\label{eq:one}\\end{equation}\n"
                    "\\begin{equation} c=d \\label{eq:two}\\end{equation}\n")
    assert labels["eq:one"] == ("Equation", "(1)")
    assert labels["eq:two"] == ("Equation", "(2)")


def test_unlabeled_align_consumes_no_number():
    labels = _eqmap("\\begin{align} x=y \\\\ p=q \\end{align}\n"
                    "\\begin{equation} a=b \\label{eq:one}\\end{equation}\n")
    assert labels["eq:one"] == ("Equation", "(1)")   # unlabeled align must not eat number (1)


def test_multi_label_align_rows_get_consecutive_numbers():
    labels = _eqmap("\\begin{align} a=b, \\label{eq:r1}\\\\ c=d, \\label{eq:r2}\\end{align}\n")
    assert labels["eq:r1"] == ("Equation", "(1)")
    assert labels["eq:r2"] == ("Equation", "(2)")


def test_tag_equations_bare_number_no_double_parens():
    out = P.tag_equations("\\begin{equation} a=b \\label{eq:one}\\end{equation}",
                          {"eq:one": ("Equation", "(1)")})
    assert "\\tag{1}" in out and "((" not in out


def test_tag_equations_stars_align_and_tags_labeled_rows():
    out = P.tag_equations("\\begin{align} a=b, \\label{eq:r1}\\\\ c=d, \\label{eq:r2}\\end{align}",
                          {"eq:r1": ("Equation", "(1)"), "eq:r2": ("Equation", "(2)")})
    assert "\\begin{align*}" in out and "\\begin{align}" not in out
    assert out.count("\\tag{") == 2 and "((" not in out


def test_tag_equations_stars_unlabeled_align_untagged():
    out = P.tag_equations("\\begin{align} a=b \\\\ c=d \\end{align}", {})
    assert "\\begin{align*}" in out and "\\tag{" not in out
