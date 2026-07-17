// Resolve a cross-reference number ("3", "3.3.1", "A", "C.2") to the unit it points at. One rule for both
// portals. Kept free of reviewer-tool vocabulary so the reviewer portal can import it.
//
// Why this exists: the old inline lookup was `CHAPTERS.find(c => c.n === lead)`, which does NOT exclude
// appendices — an appendix numbered n=3 could answer a "Chapter 3" reference purely by array order. A DIGIT
// ref always means a chapter; a LETTER ref always means an appendix.

import { appendixLetter } from './unitlabel.js';   // single source of truth for appendix lettering (no drift)

const isAppendix = u => u && u.kind === 'appendix';

export function refTargetUnit(units = [], num = '') {
  const head = String(num || '').split('.')[0].trim();
  if (!head) return null;
  const list = units || [];
  if (/^\d+$/.test(head)) {                       // digit ref → a CHAPTER (never an appendix)
    const n = parseInt(head, 10);
    return list.find(u => !isAppendix(u) && u.n === n) || null;
  }
  if (/^[A-Z]{1,2}$/i.test(head)) {               // letter ref → an APPENDIX
    const tag = head.toUpperCase();
    return list.find(u => isAppendix(u) && appendixLetter(u.n) === tag) || null;
  }
  return null;
}
