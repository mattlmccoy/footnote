#!/usr/bin/env python3
"""The degenerate-content guard must measure VISIBLE PROSE, not raw bytes.

2026-08-10: ch_validation legitimately dropped its 3 embedded IR figures (their section moved
to ch_modeling). Raw bytes fell 726K -> 69K (90%) — almost entirely figure data-URIs — so the
byte-ratio guard flagged a correct render as "degenerate" and churned last-good. Embedded
figures are data:-URIs inside tag attributes, so stripping tags removes them: measuring shrink
on visible text makes figure changes invisible to the guard while still catching a real prose
collapse (the 2026-07-08 "5" stub had ~1 visible char over a KB/MB chapter).

The prose fixture is a real slice of ch_validation's rendered paragraphs.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import ci_review_common as R  # noqa: E402

PROSE = open(os.path.join(HERE, "fixtures", "srcmap", "ch_validation.prose.html"),
             encoding="utf-8").read()
BIG_FIGURE = '<figure><img src="data:image/png;base64,' + ("A" * 600_000) + '"></figure>'


def test_figure_removal_is_not_degenerate():
    """Prose intact but a large embedded figure removed -> ~90% raw-byte drop -> must NOT flag."""
    prev = PROSE + BIG_FIGURE          # chapter WITH an embedded figure (the a238844 state)
    new = PROSE                        # same prose, figure gone (current state)
    assert len(new) < len(prev) * 0.2, "fixture must reproduce the >80% raw-byte shrink"
    degenerate, why = R.is_degenerate_content(new, prev)
    assert not degenerate, f"figure removal wrongly flagged degenerate: {why}"


def test_prose_collapse_is_degenerate():
    """A real chapter replaced by a stub -> visible prose collapses -> must flag."""
    degenerate, why = R.is_degenerate_content("<p>5</p>", PROSE)
    assert degenerate, "prose collapse to a stub must be degenerate"


def test_empty_output_is_degenerate():
    degenerate, why = R.is_degenerate_content("   \n ", PROSE)
    assert degenerate and "empty" in why


def test_small_first_build_is_degenerate():
    """No last-good and no rendered content (a bare stub, no heading/text block) -> degenerate."""
    degenerate, why = R.is_degenerate_content("5", "")
    assert degenerate


def test_similar_prose_is_not_degenerate():
    """A normal edit that trims a little prose stays under the shrink floor -> not degenerate."""
    trimmed = PROSE[: int(len(PROSE) * 0.85)]
    degenerate, why = R.is_degenerate_content(trimmed, PROSE)
    assert not degenerate, f"a 15% prose edit must not be degenerate: {why}"


if __name__ == "__main__":
    for fn in [test_figure_removal_is_not_degenerate, test_prose_collapse_is_degenerate,
               test_empty_output_is_degenerate, test_small_first_build_is_degenerate,
               test_similar_prose_is_not_degenerate]:
        fn()
    print("PASS")
