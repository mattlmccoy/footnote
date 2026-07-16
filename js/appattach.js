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
