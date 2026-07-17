// One place that turns a unit into its display label. Appendices read "Appendix A", not "Chapter 8";
// everything else is "<UnitNoun> <n>" (Chapter 3, Section 2). Shared by both portals so a doc with an
// \appendix labels consistently everywhere. AI-term-free (advisor.js imports it).

// 1 -> A, 26 -> Z, 27 -> AA (spreadsheet-column style) so appendices past Z still get a unique letter.
function appendixLetter(n) {
  let x = Number(n) || 1, s = '';
  while (x > 0) { x--; s = String.fromCharCode(65 + (x % 26)) + s; x = Math.floor(x / 26); }
  return s || 'A';
}

export function unitLabel(unit, unitNoun = 'chapter') {
  const u = unit || {};
  if (u.kind === 'appendix') return 'Appendix ' + appendixLetter(u.n);
  const noun = String(unitNoun || 'chapter');
  return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${u.n}`;
}

// COMPACT form for narrow number columns (chapter dropdown, export picker): a chapter is its number,
// an appendix is its LETTER. Use this anywhere the full "Appendix A" won't fit — never a raw `.n`, which
// makes appendices restart at 1 alongside the chapters.
export function unitTag(unit) {
  const u = unit || {};
  if (u.kind === 'appendix') return appendixLetter(u.n);
  return u.n == null ? '' : String(u.n);
}

export function unitLabelWithTitle(unit, unitNoun = 'chapter') {
  const t = unit && unit.title ? ' · ' + unit.title : '';
  return unitLabel(unit, unitNoun) + t;
}
