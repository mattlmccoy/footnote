"""Degenerate-build guard (P0): a rebuilt content/<unit>.html must never replace the
last-good file with a degenerate result (the 2026-07-08 incident published 253-byte "5"
files over real chapters on cloud approve). The pure predicate is unit-tested here; the
build-to-temp → validate → swap-or-keep wiring is exercised by the render/apply I/O.

Run: python3 -m pytest tests/test_degenerate_guard.py
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "data-template"))

import ci_review_common as R  # noqa: E402


def test_empty_output_is_degenerate():
    deg, why = R.is_degenerate_content("", "<h1>Real chapter</h1>" + "<p>x</p>" * 200)
    assert deg and why


def test_whitespace_only_is_degenerate():
    deg, _ = R.is_degenerate_content("   \n\t ", "x" * 2000)
    assert deg


def test_massive_shrink_over_real_content_is_degenerate():
    # the actual incident: a 253-byte stub replacing a substantial chapter
    prev = "<h1>Chapter</h1>" + "<p>real content here</p>" * 500
    deg, why = R.is_degenerate_content("5" * 253, prev)
    assert deg and "shr" in why.lower()


def test_similar_size_replacement_is_ok():
    prev = "<p>" + "a" * 1000 + "</p>"
    new = "<p>" + "b" * 1000 + "</p>"
    assert not R.is_degenerate_content(new, prev)[0]


def test_tiny_first_build_no_prev_is_degenerate():
    # no last-good to compare, but a 1-char build is obviously broken
    deg, _ = R.is_degenerate_content("5", "")
    assert deg


def test_normal_first_build_no_prev_is_ok():
    new = "<h1>Introduction</h1><p>" + "word " * 200 + "</p>"
    assert not R.is_degenerate_content(new, "")[0]


def test_legit_growth_is_ok():
    prev = "<p>" + "a" * 1000 + "</p>"
    new = "<p>" + "a" * 6000 + "</p>"
    assert not R.is_degenerate_content(new, prev)[0]


def test_thresholds_are_tunable():
    prev = "y" * 1000
    # a 40% shrink passes at default (max_shrink 0.6) but fails at a stricter 0.3
    new = "y" * 600
    assert not R.is_degenerate_content(new, prev)[0]
    assert R.is_degenerate_content(new, prev, max_shrink=0.3)[0]
