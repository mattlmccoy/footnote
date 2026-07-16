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
