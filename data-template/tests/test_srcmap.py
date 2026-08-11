#!/usr/bin/env python3
"""Regression guard for the paragraph->source map (export/srcmap.py).

Root cause of the 2026-08-10 empty-srcmap incident (every content/<unit>.srcmap.json had
"paragraphs": []): chapter-html.sh handed srcmap.py the *full.tex* (Footnote's shim + the
adopter's preamble/macros.tex + pre.tex). The adopter's macros.tex grew enough blank-line
separated \\newcommand/\\Declare blocks that several of them survive strip_tex at >=24 chars,
so tex_paragraphs() emitted them as leading pseudo-paragraphs. align()'s narrow forward
window (j..j+3) then never reached the first real prose block -> j stuck at 0 -> 0 aligned
for every unit.

The fix: align against the flattened *pre.tex* (the chapter source only), matching srcmap.py's
own docstring ("a verbatim block from the flattened pre.tex - locatable in the real source
files on apply"). The injected shim/preamble must never be fed to the aligner.

Fixtures are CAPTURED FROM REALITY (a real ch_introduction render from phd-dissertation main
3f4ae1e), never hand-authored, per the data-contract-verification rule.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "export"))
import srcmap  # noqa: E402

FIX = os.path.join(HERE, "fixtures", "srcmap")


def _read(name):
    with open(os.path.join(FIX, name), encoding="utf-8") as f:
        return f.read()


def test_source_only_pretex_aligns_real_prose():
    """The FIX contract: aligning HTML against the source-only pre.tex yields a non-empty map."""
    hps = srcmap.html_paragraphs(_read("ch_introduction.paras.html"))
    tps = srcmap.tex_paragraphs(_read("ch_introduction.pre.tex"))
    mapping = srcmap.align(hps, tps)
    assert len(hps) > 0, "fixture must contain real HTML paragraphs"
    assert len(mapping) > 0, "pre.tex alignment must not be empty (this is the whole point)"
    # every real captured HTML paragraph should map (the fixture is contiguous body prose)
    assert len(mapping) >= len(hps) - 1, f"expected near-total alignment, got {len(mapping)}/{len(hps)}"


def test_align_skips_leading_preamble_blocks():
    """Defense-in-depth: align() must SKIP leading non-prose (the injected shim+macros) rather
    than starve on it, so srcmap is robust regardless of whether it is handed pre.tex or full.tex
    (the diverged footnote-* engine copies still feed full.tex). The pre-fix narrow window
    (j..j+3) returned [] here because the first real prose sat past the window; the hardened
    window must clear the >=4 leading preamble blocks and recover the same map as pre.tex."""
    hps = srcmap.html_paragraphs(_read("ch_introduction.paras.html"))
    tps_full = srcmap.tex_paragraphs(_read("ch_introduction.full.tex"))
    # the injected preamble contributes leading pseudo-paragraphs before the first real prose
    first_prose = next(i for i, t in enumerate(tps_full)
                       if t["plain"].startswith("additive manufacturing"))
    assert first_prose >= 4, (
        f"expected >=4 leading preamble blocks (the starvation trigger), got {first_prose}")
    from_full = srcmap.align(hps, tps_full)
    from_pre = srcmap.align(hps, srcmap.tex_paragraphs(_read("ch_introduction.pre.tex")))
    assert len(from_full) >= len(from_pre) - 1 > 0, (
        f"full.tex must no longer starve: got {len(from_full)} vs pre.tex {len(from_pre)}")


if __name__ == "__main__":
    test_source_only_pretex_aligns_real_prose()
    test_preamble_poisoned_fulltex_reproduces_the_bug()
    print("PASS")
