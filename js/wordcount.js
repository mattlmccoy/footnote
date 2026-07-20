// Word-count display helpers + a client-side fallback counter. The fallback mirrors data-template/
// wordcount.py so a project without counts.json (not re-rendered yet) still shows a count. Term-neutral.

export function formatCount(n) {
  const v = Number(n) || 0;
  return `${v.toLocaleString('en-US')} word${v === 1 ? '' : 's'}`;
}

export function totalWords(counts = {}) {
  return Object.values(counts || {}).reduce((s, c) => s + (c && c.words ? c.words : 0), 0);
}
export function totalChars(counts = {}) {
  return Object.values(counts || {}).reduce((s, c) => s + (c && c.chars ? c.chars : 0), 0);
}

// Fallback: same rules as the engine (refs / footnotes / math excluded), quote-tolerant. Reference and
// footnote blocks are stripped by BALANCED tag depth (citeproc's <div id="refs"> nests same-name divs, so a
// non-greedy regex would stop at the first inner </div> and leak the rest). Openers keep group 1 = tag name.
const REF_OPEN = '<(div|section)\\b[^>]*\\bid=["\']refs["\'][^>]*>';
const REFCLASS_OPEN = '<(div|section)\\b[^>]*\\bclass=["\'][^"\']*\\breferences\\b[^"\']*["\'][^>]*>';
const FN_OPEN = '<(section|div|aside)\\b[^>]*\\bclass=["\'][^"\']*\\bfootnotes\\b[^"\']*["\'][^>]*>';
const MATH = /<span\b[^>]*\bclass=["'][^"']*\bmath\b[^"']*["'][^>]*>[\s\S]*?<\/span>/gi;   // leaf, no nesting
const TAG = /<[^>]+>/g;
const ENT = /&[a-zA-Z]+;|&#\d+;/g;

function stripBalanced(s, openerSrc) {
  for (;;) {
    const m = new RegExp(openerSrc, 'i').exec(s);
    if (!m) return s;
    const close = new RegExp('<(/?)' + m[1] + '\\b[^>]*>', 'gi');
    close.lastIndex = m.index + m[0].length;
    let depth = 1, end = -1, t;
    while ((t = close.exec(s))) { depth += t[1] ? -1 : 1; if (depth === 0) { end = close.lastIndex; break; } }
    s = s.slice(0, m.index) + ' ' + (end >= 0 ? s.slice(end) : '');
  }
}

export function countWords(html) {
  let s = String(html || '');
  s = stripBalanced(s, REF_OPEN);
  s = stripBalanced(s, REFCLASS_OPEN);
  s = stripBalanced(s, FN_OPEN);
  s = s.replace(MATH, ' ').replace(TAG, ' ').replace(ENT, ' ');
  const words = s.split(/\s+/).filter(Boolean);
  return { words: words.length, chars: [...words.join(' ')].length };   // chars WITH spaces (codepoint-accurate)
}

// A unit counts as "not counted yet" only when its words value isn't a number. A genuine 0 (an empty
// unit) is a real answer and must not be refetched forever — but it is also what an unopened unit shows
// before anything has counted it, which is why the count-all pass writes a number for every unit.
export function missingCountIds(units = [], counts = {}) {
  return (units || []).filter(u => u && u.id && typeof (counts?.[u.id]?.words) !== 'number').map(u => u.id);
}

// The engine's counts.json is authoritative (written at render time from the real built HTML); the local
// cache only fills units the engine hasn't published yet, so a stale cached number can never mask a fresh
// rendered one.
export function mergeCounts(engine, cached) {
  const ok = v => v && typeof v.words === 'number';
  const out = {};
  for (const [k, v] of Object.entries(cached || {})) if (ok(v)) out[k] = v;
  for (const [k, v] of Object.entries(engine || {})) if (ok(v)) out[k] = v;
  return out;
}
