"""Slice 4: the engine resolves a figure comment's hand-drawn markup PNG to an on-disk path so the
Figure Drafter can Read it. figure_markup_path is the pure resolver; it must only return a path that
actually exists, so a broken/absent markup degrades to the text round-trip (never a dangling path)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "data-template"))
import ci_apply as A


def _write(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n")  # not a real PNG; existence is all that matters


def test_returns_abspath_when_the_markup_file_exists(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)                      # apply runs with the data repo as cwd
    _write("markups/c_abc.png")                      # prefix "" (single-project data repo)
    comment = {"id": "c_abc", "anchor": {"figure": "x"}, "tag": "figure", "markup": {"path": "markups/c_abc.png"}}
    got = A.figure_markup_path(comment, "")
    assert got == os.path.abspath("markups/c_abc.png")
    assert os.path.exists(got)


def test_honors_a_subtree_prefix(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _write("sub/markups/c_9.png")
    comment = {"markup": {"path": "markups/c_9.png"}}
    assert A.figure_markup_path(comment, "sub/") == os.path.abspath("sub/markups/c_9.png")


def test_none_when_no_markup_or_file_missing(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert A.figure_markup_path({"tag": "figure"}, "") is None                       # no markup at all
    assert A.figure_markup_path({"markup": {}}, "") is None                          # markup dict, no path
    assert A.figure_markup_path({"markup": {"path": "markups/nope.png"}}, "") is None  # path recorded but file absent
    assert A.figure_markup_path(None, "") is None
