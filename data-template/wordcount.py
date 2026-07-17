"""Pure word/character count for a rendered reading fragment (content/<id>.html).

Counts the AUTHOR'S PROSE: headings, body text, figure/table captions. Excludes the References /
bibliography block, the footnotes list, and math (equations are not words). Regex-based on purpose —
the input is a well-formed pandoc HTML5 fragment and this must run without extra dependencies.
"""
import re

# citeproc emits <section id="refs"> ... ; some templates use a .references wrapper.
# Attribute values may be single- or double-quoted, so both quote styles are matched.
_REF_RE = re.compile(r'<section\b[^>]*\bid=["\']refs["\'][^>]*>.*?</section>', re.I | re.S)
_REF_CLASS_RE = re.compile(r'<(section|div)\b[^>]*\bclass=["\'][^"\']*\breferences\b[^"\']*["\'][^>]*>.*?</\1>', re.I | re.S)
# pandoc footnotes: <section class="footnotes" ...> ... </section>
_FN_RE = re.compile(r'<section\b[^>]*\bclass=["\'][^"\']*\bfootnotes\b[^"\']*["\'][^>]*>.*?</section>', re.I | re.S)
# math stays as <span class="math ...">\(...\)</span> in server HTML (KaTeX renders client-side)
_MATH_RE = re.compile(r'<span\b[^>]*\bclass=["\'][^"\']*\bmath\b[^"\']*["\'][^>]*>.*?</span>', re.I | re.S)
_TAG_RE = re.compile(r'<[^>]+>')
_ENT_RE = re.compile(r'&[a-zA-Z]+;|&#\d+;')


def word_count(html):
    s = html or ""
    for rx in (_REF_RE, _REF_CLASS_RE, _FN_RE, _MATH_RE):
        s = rx.sub(" ", s)
    s = _TAG_RE.sub(" ", s)
    s = _ENT_RE.sub(" ", s)
    words = s.split()
    return {"words": len(words), "chars": sum(len(w) for w in words)}
