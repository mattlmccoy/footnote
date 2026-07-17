"""Pure word/character count for a rendered reading fragment (content/<id>.html).

Counts the AUTHOR'S PROSE: headings, body text, figure/table captions. Excludes the References /
bibliography block, the footnotes list, and math (equations are not words). Regex-based on purpose —
the input is a well-formed pandoc HTML5 fragment and this must run without extra dependencies.
"""
import re

# Blocks excluded WITH their nested content: the bibliography and the footnotes list. citeproc emits
# <div id="refs" class="references csl-bib-body"> wrapping NESTED <div class="csl-entry"> — a non-greedy
# regex stops at the FIRST inner </div> and leaks every following reference into the count, so match the
# closing tag by BALANCED depth instead. Attribute values may be single- or double-quoted.
_REF_OPEN = re.compile(r'<(div|section)\b[^>]*\bid=["\']refs["\'][^>]*>', re.I)
_REFCLASS_OPEN = re.compile(r'<(div|section)\b[^>]*\bclass=["\'][^"\']*\breferences\b[^"\']*["\'][^>]*>', re.I)
_FN_OPEN = re.compile(r'<(section|div|aside)\b[^>]*\bclass=["\'][^"\']*\bfootnotes\b[^"\']*["\'][^>]*>', re.I)
# math stays as <span class="math ...">\(...\)</span> in server HTML (KaTeX renders client-side); leaf, no nesting.
_MATH_RE = re.compile(r'<span\b[^>]*\bclass=["\'][^"\']*\bmath\b[^"\']*["\'][^>]*>.*?</span>', re.I | re.S)
_TAG_RE = re.compile(r'<[^>]+>')
_ENT_RE = re.compile(r'&[a-zA-Z]+;|&#\d+;')


def _strip_balanced(s, opener):
    """Remove every element matched by `opener` INCLUDING nested content, finding the matching close by
    counting same-name open/close tags (regex alone can't balance nested divs like a citeproc bibliography)."""
    while True:
        m = opener.search(s)
        if not m:
            return s
        tag = m.group(1)
        close = re.compile(r'<(/?)' + tag + r'\b[^>]*>', re.I)
        depth, end = 1, None
        for t in close.finditer(s, m.end()):
            depth += -1 if t.group(1) else 1
            if depth == 0:
                end = t.end()
                break
        s = s[:m.start()] + " " + (s[end:] if end is not None else "")


def word_count(html):
    s = html or ""
    for opener in (_REF_OPEN, _REFCLASS_OPEN, _FN_OPEN):
        s = _strip_balanced(s, opener)
    s = _MATH_RE.sub(" ", s)
    s = _TAG_RE.sub(" ", s)
    s = _ENT_RE.sub(" ", s)
    words = s.split()
    return {"words": len(words), "chars": len(" ".join(words))}   # chars WITH spaces (Word's default metric)
