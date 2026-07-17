import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "data-template"))
from wordcount import word_count


def test_counts_plain_prose():
    r = word_count("<p>Hello brave new world</p>")
    assert r["words"] == 4
    assert r["chars"] == len("Hello brave new world")   # characters WITH spaces (Word's default)


def test_excludes_nested_reference_divs():
    # citeproc: <div id="refs"> wraps NESTED <div class="csl-entry"> — a non-greedy regex stops at the first
    # inner </div> and leaks the rest. Balanced stripping must drop the WHOLE block.
    html = ('<p>real prose words here</p>'
            '<div id="refs" class="references csl-bib-body">'
            '<div class="csl-entry">Smith 2020 first reference entry text</div>'
            '<div class="csl-entry">Jones 2019 second reference entry text</div>'
            '</div>')
    assert word_count(html)["words"] == 4   # only "real prose words here"


def test_includes_headings_and_captions():
    html = "<h1>Intro Title</h1><p>body text here</p><figcaption>Figure 1. A caption line</figcaption>"
    assert word_count(html)["words"] == 2 + 3 + 5   # heading + body + caption


def test_excludes_references_section():
    html = "<p>real words only</p><section id='refs'><div>Smith 2020 reference junk here</div></section>"
    assert word_count(html)["words"] == 3


def test_excludes_references_by_class():
    html = "<p>real words only</p><div class='references'>Smith 2020 reference junk</div>"
    assert word_count(html)["words"] == 3


def test_excludes_footnotes():
    html = "<p>main body words</p><section class='footnotes'><ol><li>a footnote here now</li></ol></section>"
    assert word_count(html)["words"] == 3


def test_excludes_math():
    html = "<p>energy equals <span class='math inline'>\\(E=mc^2\\)</span> mass</p>"
    assert word_count(html)["words"] == 3   # energy equals mass (math dropped)


def test_empty_and_none():
    assert word_count("") == {"words": 0, "chars": 0}
    assert word_count(None) == {"words": 0, "chars": 0}
