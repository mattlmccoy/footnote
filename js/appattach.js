// Pure appendix->chapter attachment logic. No DOM, no I/O.
// An appendix "attaches" to a chapter when a label the appendix DEFINES is REFERENCED by that chapter.

const isAppendix = u => u && u.kind === 'appendix';

// input: { chapters: units[], refsByChapter: {chId:label[]}, labelsByAppendix: {appId:label[]}, override:{appId:chId} }
export function computeAttachments({ chapters = [], refsByChapter = {}, labelsByAppendix = {}, override = {} }) {
  const chapterUnits = chapters.filter(u => !isAppendix(u));
  const appendixUnits = chapters.filter(isAppendix);
  const citersOf = {}, homeOf = {}, byChapter = {}, uncited = [];

  for (const app of appendixUnits) {
    const defined = new Set(labelsByAppendix[app.id] || []);
    const citers = chapterUnits
      .filter(c => (refsByChapter[c.id] || []).some(l => defined.has(l)))
      .map(c => c.id);                                   // document order (chapterUnits is ordered)
    citersOf[app.id] = citers;
    if (!citers.length) { uncited.push(app.id); continue; }
    const pin = override[app.id];
    homeOf[app.id] = citers.includes(pin) ? pin : citers[0];
  }
  for (const c of chapterUnits)
    byChapter[c.id] = appendixUnits.filter(a => (citersOf[a.id] || []).includes(c.id)).map(a => a.id);

  return { byChapter, homeOf, citersOf, uncited };
}

import { referencedLabels, appendixLabels } from './apprefs.js?v=662b702';

// Look up a unit's source text tolerant of a trailing .tex on either the key or the sourceFile.
function srcFor(sourceByFile, sf) {
  if (sf == null) return '';
  const bare = String(sf).replace(/\.tex$/, '');
  return sourceByFile[sf] ?? sourceByFile[bare] ?? sourceByFile[bare + '.tex'] ?? '';
}

// SCAN-TIME: compute attachment from source and write additive home/citedBy onto appendix units.
// Returns the same units array (mutated appendix entries) for chaining into saveChapters.
export function annotateAttachments(units, sourceByFile = {}) {
  const refsByChapter = {}, labelsByAppendix = {};
  for (const u of units) {
    if (u.kind === 'appendix') labelsByAppendix[u.id] = appendixLabels(srcFor(sourceByFile, u.sourceFile));
    else refsByChapter[u.id] = referencedLabels(srcFor(sourceByFile, u.sourceFile));
  }
  const { citersOf, homeOf } = computeAttachments({ chapters: units, refsByChapter, labelsByAppendix, override: {} });
  for (const u of units) {
    if (u.kind !== 'appendix') continue;
    u.citedBy = citersOf[u.id] || [];
    u.home = homeOf[u.id] ?? null;
  }
  return units;
}

// LOAD-TIME: rebuild the maps purely from the stored home/citedBy fields (no source, no fetch).
export function attachmentsView(units = []) {
  const citersOf = {}, homeOf = {}, byChapter = {}, uncited = [];
  const chapterUnits = units.filter(u => !isAppendix(u));
  for (const u of units) if (isAppendix(u)) {
    citersOf[u.id] = u.citedBy || [];
    if (u.home) homeOf[u.id] = u.home; else uncited.push(u.id);
  }
  for (const c of chapterUnits)
    byChapter[c.id] = units.filter(a => isAppendix(a) && (a.citedBy || []).includes(c.id)).map(a => a.id);
  return { byChapter, homeOf, citersOf, uncited };
}
