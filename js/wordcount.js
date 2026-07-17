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

// Fallback: same rules as the engine (refs / footnotes / math excluded). Quote-tolerant so it matches the
// Python engine and both attribute styles. Regex-based so it runs in node tests too.
const REF = /<section\b[^>]*\bid=["']refs["'][^>]*>[\s\S]*?<\/section>/gi;
const REF_C = /<(section|div)\b[^>]*\bclass=["'][^"']*\breferences\b[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi;
const FN = /<section\b[^>]*\bclass=["'][^"']*\bfootnotes\b[^"']*["'][^>]*>[\s\S]*?<\/section>/gi;
const MATH = /<span\b[^>]*\bclass=["'][^"']*\bmath\b[^"']*["'][^>]*>[\s\S]*?<\/span>/gi;
const TAG = /<[^>]+>/g;
const ENT = /&[a-zA-Z]+;|&#\d+;/g;

export function countWords(html) {
  let s = String(html || '');
  s = s.replace(REF, ' ').replace(REF_C, ' ').replace(FN, ' ').replace(MATH, ' ').replace(TAG, ' ').replace(ENT, ' ');
  const words = s.split(/\s+/).filter(Boolean);
  return { words: words.length, chars: words.reduce((n, w) => n + w.length, 0) };
}
