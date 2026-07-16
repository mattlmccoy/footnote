// Pure LaTeX source parsers for appendix attachment. Read-only; SEPARATE from docparse.js's
// title-extraction strip — these COLLECT reference/label strings, they do not rewrite text.

// Cross-reference commands that point AT a label (NOT \label which DEFINES one, NOT \cite).
const REF_RE = /\\(?:cref|Cref|autoref|eqref|ref)\*?\s*\{([^{}]*)\}/g;
const LABEL_RE = /\\label\s*\{([^{}]*)\}/g;

function collect(src, re) {
  const out = [];
  for (const m of String(src || '').matchAll(re))
    for (const part of m[1].split(',')) { const s = part.trim(); if (s) out.push(s); }
  return out;
}

// Every label string referenced by \cref/\Cref/\autoref/\eqref/\ref in one unit's source.
export function referencedLabels(src) { return collect(src, REF_RE); }

// Every label string DEFINED (\label{...}) in one unit's source.
export function appendixLabels(src) { return collect(src, LABEL_RE); }

// The \input/\include target paths in one unit's source (.tex stripped), so a chapter's references can be
// gathered from its whole nested include tree, not just the top file (rfam cites appendices from sections/ sub-files).
const INCLUDE_RE = /\\(?:input|include)\s*\{([^{}]+)\}/g;
export function includePaths(src) {
  return [...String(src || '').matchAll(INCLUDE_RE)].map(m => m[1].trim().replace(/\.tex$/, '')).filter(Boolean);
}
