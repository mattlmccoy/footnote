import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeChapters } from '../js/docparse.js';
import { annotateAttachments } from '../js/appattach.js';

// The whole point of #3: a re-scan must preserve unit ids AND keep attachment pointing at those preserved
// ids — otherwise home/citedBy would reference the fresh (hyphenated) chapter ids that no longer exist.
test('re-scan preserves ids and attachment references the preserved chapter id', () => {
  const existing = [
    { id: 'ch_platform', title: 'Platform', sourceFile: 'chapters/ch_platform.tex', n: 3 },
    { id: 'appb-metrology', title: 'Metrology', sourceFile: 'appendices/appB.tex', kind: 'appendix', n: 1 },
  ];
  // a fresh re-scan slugifies ids with hyphens for the SAME source files
  const fresh = [
    { id: 'ch-platform', title: 'Platform', sourceFile: 'chapters/ch_platform.tex', n: 3 },
    { id: 'appb-metrology-2', title: 'Metrology', sourceFile: 'appendices/appB.tex', kind: 'appendix', n: 1 },
  ];

  const merged = mergeChapters(existing, fresh);
  assert.deepEqual(merged.map(u => u.id), ['ch_platform', 'appb-metrology']);   // ids preserved

  // annotate the MERGED units (final ids); the chapter \cref's the appendix's label
  annotateAttachments(merged, {
    'chapters/ch_platform': 'see \\cref{app:metrology} for details',
    'appendices/appB': '\\chapter{Metrology}\\label{app:metrology}',
  });
  const app = merged.find(u => u.id === 'appb-metrology');
  assert.equal(app.home, 'ch_platform');            // NOT 'ch-platform' (the discarded fresh id)
  assert.deepEqual(app.citedBy, ['ch_platform']);
});
