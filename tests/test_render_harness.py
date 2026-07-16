"""Render regression harness + appendix parity gate.

This is the SAFETY GATE for the appendix-render-parity work: it proves that the generic
export pipeline (``data-template/export/preprocess.py`` + ``chapter-html.sh``, driven by
``ci_render.py``) maps every reading unit — chapter OR appendix — to the correct
``content/<id>.html``, using a self-contained synthetic fixture (2 chapters + 2 ``\\input``
appendices, ``kind:"appendix"``) so it is reproducible without live data.

Two layers:
  * Pure (no external tools): ``unit_body`` resolves each unit's LaTeX to its own source,
    with no cross-unit leakage — the correctness core the HTML render depends on.
  * Real render (pandoc, skipped when absent): drive ``chapter-html.sh`` per unit and assert
    each unit's own prose lands in its own HTML fragment and nowhere else, and that an
    appendix unit renders exactly like a chapter (well-formed fragment, its own heading + prose).
  * End-to-end (pandoc): ``ci_render.render_project`` writes ``content/<appendix-id>.html`` for
    appendix units through the same loop as chapters — the ci_render parity claim.

Run: python3 -m pytest tests/test_render_harness.py
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
DT = ROOT / "data-template"
EXPORT = DT / "export"
FIX = pathlib.Path(__file__).resolve().parent / "fixtures" / "appendix_render"

sys.path.insert(0, str(DT))
sys.path.insert(0, str(EXPORT))

import preprocess as P  # noqa: E402
import ci_render as R    # noqa: E402

# each unit carries a distinctive marker so leakage between units is detectable
UNIT_MARKERS = {
    "ch_intro": "INTRO-PROSE-MARKER",
    "ch_methods": "METHODS-PROSE-MARKER",
    "app_deriv": "DERIV-PROSE-MARKER",
    "app_data": "DATA-PROSE-MARKER",
}
APPENDIX_UNITS = {"app_deriv", "app_data"}
CHAPTER_UNITS = {"ch_intro", "ch_methods"}

pandoc = pytest.mark.skipif(shutil.which("pandoc") is None, reason="pandoc not installed")


def _rows():
    return json.loads((FIX / "chapters.json").read_text())


# --------------------------------------------------------------------------- pure layer

def test_fixture_manifest_marks_appendices():
    rows = _rows()
    kinds = {r["id"]: r.get("kind") for r in rows}
    assert kinds["ch_intro"] is None and kinds["ch_methods"] is None
    assert kinds["app_deriv"] == "appendix" and kinds["app_data"] == "appendix"


def test_unit_body_resolves_each_unit_to_its_own_source_no_leakage():
    """The correctness core: an appendix unit resolves to its own file exactly like a chapter,
    and never leaks a sibling's prose. This is what the HTML render is built on."""
    rows = _rows()
    read_tex = P.make_reader(FIX / "src")
    for uid, marker in UNIT_MARKERS.items():
        body = P.unit_body(rows, uid, read_tex, "main.tex")
        assert marker in body, f"{uid}: own prose missing from its resolved body"
        for other, omark in UNIT_MARKERS.items():
            if other != uid:
                assert omark not in body, f"{uid}: leaked {other}'s prose"


def test_appendix_unit_body_resolves_like_a_chapter_unit():
    """Parity at the resolver level: appendix units go through the identical code path as
    chapters (dedicated sourceFile -> whole flattened file). No kind-specific branch needed."""
    rows = _rows()
    read_tex = P.make_reader(FIX / "src")
    chap = P.unit_body(rows, "ch_methods", read_tex, "main.tex")
    appx = P.unit_body(rows, "app_deriv", read_tex, "main.tex")
    # both carry a chapter heading + their own labeled equation, resolved the same way
    assert "\\chapter{Methods}" in chap and "\\chapter{Derivations}" in appx
    assert "\\label{eq:deriv}" in appx


def test_section_mode_appendix_slices_like_a_body_section():
    """Section-mode parity (single shared main.tex): an appendix that is a \\section after
    \\appendix is sliced to its own block just like a body section — no kind branch, no leakage.
    Covers the article/single-file layout the chapter/dedicated-file fixture does not."""
    rows = [{"id": "overview", "n": 1, "title": "Overview",  "sourceFile": "main.tex"},
            {"id": "results",  "n": 2, "title": "Results",   "sourceFile": "main.tex"},
            {"id": "app_x", "n": 1, "title": "Extra Tables", "sourceFile": "main.tex",
             "kind": "appendix"}]
    files = {"main.tex": (
        "\\documentclass{article}\\begin{document}\n"
        "\\section{Overview}\nOVERVIEW-MARK prose.\n"
        "\\section{Results}\nRESULTS-MARK prose.\n"
        "\\appendix\n"
        "\\section{Extra Tables}\nAPPENDIX-MARK prose.\n"
        "\\end{document}\n")}

    def read_tex(name):
        return files.get(name) or files.get(name + ".tex") or ""

    body = P.unit_body(rows, "app_x", read_tex, "main.tex")
    assert "APPENDIX-MARK" in body
    assert "OVERVIEW-MARK" not in body and "RESULTS-MARK" not in body


# ------------------------------------------------------------- ci_render loop (no kind filter)

def test_ci_render_loop_includes_appendix_units():
    """render_project iterates every manifest row by id with no kind filter, so appendix units
    are scheduled for rendering exactly like chapters. Guard against a future 'skip appendices'
    regression without needing the toolchain."""
    rows = _rows()
    ids = [r["id"] for r in rows if r.get("id")]
    assert APPENDIX_UNITS.issubset(set(ids))
    # every unit maps to the reader-contract output path, appendix included
    for uid in ids:
        assert R.content_out("proj/", uid) == f"proj/content/{uid}.html"


def test_render_project_schedules_every_unit_including_appendices(tmp_path, monkeypatch):
    """Pandoc-free teeth for the loop: stub the actual renderer and assert render_project asks
    to build EVERY manifest unit — chapters and appendices alike. A future 'skip kind==appendix'
    filter fails here even on a machine without pandoc/pdflatex."""
    data = tmp_path / "data"
    (data / "source").mkdir(parents=True)
    shutil.copy(FIX / "chapters.json", data / "chapters.json")
    monkeypatch.chdir(data)

    scheduled = []
    monkeypatch.setattr(R, "build_guarded",
                        lambda uid, out, env, wd, label="content": (scheduled.append(uid), True)[1])

    R.render_project("", "owner/data", "", tmp_path / "wd")
    assert set(scheduled) == set(UNIT_MARKERS), f"not every unit scheduled: {scheduled}"


# --------------------------------------------------------------------------- real render layer

def _render_unit(unit_id, out_html, build_dir):
    env = dict(
        os.environ,
        SOURCE_DIR=str(FIX / "src"),
        CHAPTERS_JSON=str(FIX / "chapters.json"),
        RENDER_ENTRY="main.tex",
        BUILD_DIR=str(build_dir),
    )
    subprocess.run(
        ["bash", str(EXPORT / "chapter-html.sh"), unit_id, str(out_html)],
        check=True, env=env, capture_output=True, text=True,
    )
    return pathlib.Path(out_html).read_text(encoding="utf-8")


@pandoc
@pytest.mark.parametrize("unit_id", sorted(UNIT_MARKERS))
def test_pipeline_maps_each_unit_to_its_own_html(unit_id, tmp_path):
    """The regression gate: each unit (chapter AND appendix) renders a well-formed fragment
    containing ONLY its own prose. A wrong unit->content mapping (the class of bug appendices
    have historically hit) fails here."""
    html = _render_unit(unit_id, tmp_path / f"{unit_id}.html", tmp_path / "build")
    assert re.search(r"<h1[\s>]", html), f"{unit_id}: no heading in rendered fragment"
    assert UNIT_MARKERS[unit_id] in html, f"{unit_id}: own prose missing from HTML"
    for other, omark in UNIT_MARKERS.items():
        if other != unit_id:
            assert omark not in html, f"{unit_id}: leaked {other}'s prose into HTML"


@pandoc
def test_appendix_html_is_structurally_equivalent_to_a_chapter(tmp_path):
    """Appendix parity: an appendix unit produces the same shape of content fragment as a
    chapter — a <section> wrapper with an <h1> and a prose <p>. Nothing about being an appendix
    changes the rendered contract."""
    chap = _render_unit("ch_methods", tmp_path / "ch.html", tmp_path / "b1")
    appx = _render_unit("app_deriv", tmp_path / "ap.html", tmp_path / "b2")
    for html in (chap, appx):
        assert re.search(r'<section[^>]*class="level1"', html)
        assert re.search(r"<h1[\s>]", html)
        assert re.search(r"<p[\s>][^<]*\S", html)


@pandoc
def test_render_project_writes_content_html_for_appendix_units(tmp_path, monkeypatch):
    """End-to-end ci_render parity: driving render_project over a data repo whose manifest
    contains appendix units writes content/<appendix-id>.html for them, through the SAME loop
    and guard as chapters."""
    data = tmp_path / "data"
    (data / "content").mkdir(parents=True)
    shutil.copy(FIX / "chapters.json", data / "chapters.json")
    shutil.copytree(FIX / "src", data / "source")   # legacy-root in-repo source at <root>/source
    monkeypatch.chdir(data)

    built = R.render_project("", "owner/data", "", tmp_path / "wd")

    assert built == 4, f"expected all 4 units built, got {built}"
    for uid in sorted(UNIT_MARKERS):
        out = data / "content" / f"{uid}.html"
        assert out.is_file(), f"{uid}: content HTML not written"
    # appendix content is real, not a stub — carries its own prose
    for uid in APPENDIX_UNITS:
        assert UNIT_MARKERS[uid] in (data / "content" / f"{uid}.html").read_text()
