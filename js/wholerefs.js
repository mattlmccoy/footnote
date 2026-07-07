// Whole-document reference consolidation. Each unit is rendered by its own pandoc --citeproc pass, so
// every citing unit carries its own <div id="refs"> block. In the concatenated whole-doc view those
// scatter after each chapter; this collapses them into ONE References section at the end. The DOM
// extraction lives in the portals; the dedupe + section-building logic is pure and lives here.
// AI-term-free so advisor.js can import it and stay grep-clean.

// Order-preserving unique-by-key. Entries: [{key, html}]. First occurrence of a key wins; blank/missing
// keys are dropped (a citeproc entry always has an id="ref-<key>").
export function dedupeRefs(entries) {
  const seen = new Set();
  const out = [];
  for (const e of entries || []) {
    const key = e && e.key;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

// Build the single consolidated References section, or '' when there are no entries (no empty heading).
export function buildRefsSection(entries, heading = 'References') {
  const list = dedupeRefs(entries);
  if (!list.length) return '';
  const items = list.map(e => e.html).join('\n');
  return `<section class="wd-references"><h2>${heading}</h2><div class="references csl-bib-body" role="list">${items}</div></section>`;
}
