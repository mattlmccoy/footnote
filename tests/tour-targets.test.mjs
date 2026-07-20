import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// tour.js skips a step whose target is missing (`if (!el) return advance(+1)`), so a tour pointing at a
// deleted element fails SILENTLY — it races to the end and reads as a dead button. That is exactly how
// "Take the setup tour" broke when run from a reading view, and how the last step would have broken when
// the home "?" button was removed. This guard fails loudly instead: every selector a tour targets must
// still be created somewhere in app.js.
const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

const tourSels = [...app.matchAll(/\bsel:\s*'#([A-Za-z0-9_-]+)'/g)].map(m => m[1]);

test('the tours actually target something (guard is not vacuously passing)', () => {
  assert.ok(tourSels.length >= 8, `expected tour steps, found ${tourSels.length}`);
});

test('every tour target is still created in app.js', () => {
  for (const id of tourSels) {
    const created = new RegExp(`id="${id}"|id='${id}'|\\.id\\s*=\\s*['"]${id}['"]`).test(app);
    assert.ok(created, `tour step targets #${id}, but nothing in app.js creates it — the step will be silently skipped`);
  }
});

test('no tour still points at the removed home "?" button or its menu', () => {
  assert.ok(!tourSels.includes('btn-tour'), 'the home "?" button was removed; retarget this step');
  assert.ok(!/openTourMenu/.test(app), 'openTourMenu is dead code now that the floating help button owns the guides');
});
