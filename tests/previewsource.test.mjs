import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingSource, showPreviewToggle } from '../js/previewsource.js';

// readingSource decides which rendered HTML path the owner reader fetches. The default MUST stay
// content/<id>.html (the merged reading view). It returns preview/<id>.html ONLY when the unit has a
// staged edit, its branch preview was actually built, AND the owner has toggled preview on.
test('readingSource: default is the merged content path', () => {
  assert.equal(
    readingSource({ unitId: 'ch3', hasStaged: false, previewExists: false, previewOn: false }),
    'content/ch3.html'
  );
});

test('readingSource: staged + preview built + toggled on → preview path', () => {
  assert.equal(
    readingSource({ unitId: 'ch3', hasStaged: true, previewExists: true, previewOn: true }),
    'preview/ch3.html'
  );
});

test('readingSource: toggled on but no staged edit → content (never preview)', () => {
  assert.equal(
    readingSource({ unitId: 'ch3', hasStaged: false, previewExists: true, previewOn: true }),
    'content/ch3.html'
  );
});

test('readingSource: staged + toggled on but preview NOT built → content (graceful)', () => {
  assert.equal(
    readingSource({ unitId: 'ch3', hasStaged: true, previewExists: false, previewOn: true }),
    'content/ch3.html'
  );
});

test('readingSource: staged + preview built but toggled OFF → content (opt-in)', () => {
  assert.equal(
    readingSource({ unitId: 'ch3', hasStaged: true, previewExists: true, previewOn: false }),
    'content/ch3.html'
  );
});

// showPreviewToggle decides whether the "Preview staged edits" control is shown at all. Both a staged
// edit and a built branch preview are required, otherwise the control is hidden entirely (no dead click).
test('showPreviewToggle: true only when staged AND preview built', () => {
  assert.equal(showPreviewToggle({ hasStaged: true, previewExists: true }), true);
});

test('showPreviewToggle: staged but no preview built → hidden', () => {
  assert.equal(showPreviewToggle({ hasStaged: true, previewExists: false }), false);
});

test('showPreviewToggle: preview built but nothing staged → hidden', () => {
  assert.equal(showPreviewToggle({ hasStaged: false, previewExists: true }), false);
});

test('showPreviewToggle: neither → hidden', () => {
  assert.equal(showPreviewToggle({ hasStaged: false, previewExists: false }), false);
});
