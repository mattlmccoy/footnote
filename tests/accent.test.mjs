import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCENTS, accentPaletteCss, swatchesHtml, nextAccentClassName,
  storedAccent, saveAccent,
} from '../js/accent.js';

test('ACCENTS has default plus the named palette, each named one tuned for light and dark', () => {
  const ids = ACCENTS.map(a => a.id);
  assert.deepEqual(ids, ['default', 'blue', 'purple', 'pink', 'red', 'orange', 'yellow', 'green', 'graphite']);
  assert.equal(ACCENTS[0].id, 'default');
  assert.ok(!ACCENTS[0].light);                       // default carries no colors (sentinel)
  for (const a of ACCENTS.slice(1)) {
    for (const mode of ['light', 'dark']) {
      assert.match(a[mode].accent, /^#[0-9a-f]{6}$/i, `${a.id} ${mode} accent`);
      assert.match(a[mode].bg, /^#[0-9a-f]{6}$/i, `${a.id} ${mode} bg`);
    }
  }
});

test('accentPaletteCss emits a light + dark !important rule for every named accent (not default)', () => {
  const css = accentPaletteCss();
  assert.ok(!css.includes('ac-default'));             // default has no override rule
  for (const a of ACCENTS.slice(1)) {
    assert.ok(css.includes(`:root.ac-${a.id}{`), `light rule for ${a.id}`);
    assert.ok(css.includes(`.dark.ac-${a.id}{`), `dark rule for ${a.id}`);
    assert.ok(css.includes(a.light.accent), `${a.id} light accent value`);
    assert.ok(css.includes(a.dark.accent), `${a.id} dark accent value`);
  }
  assert.ok(css.includes('!important'));              // beats hub.js's inline brand accent
});

test('swatchesHtml renders one swatch per accent with the selected ring on the chosen id', () => {
  const html = swatchesHtml('purple');
  for (const a of ACCENTS) assert.ok(html.includes(`data-accent="${a.id}"`), `swatch ${a.id}`);
  // exactly one selected marker, on purple
  assert.match(html, /data-accent="purple"[^>]*data-on="1"|data-accent="purple"[^>]*aria-pressed="true"/);
  assert.ok(!/data-accent="blue"[^>]*aria-pressed="true"/.test(html));
  // default swatch is the multicolor gradient, not a flat fill
  assert.match(html, /data-accent="default"[^>]*conic-gradient/);
});

test('nextAccentClassName swaps the ac-* class, keeping other classes (e.g. dark)', () => {
  assert.equal(nextAccentClassName('', 'blue'), 'ac-blue');
  assert.equal(nextAccentClassName('dark', 'green'), 'dark ac-green');
  assert.equal(nextAccentClassName('dark ac-blue', 'red'), 'dark ac-red');   // old ac-* removed
  assert.equal(nextAccentClassName('dark ac-blue', 'default'), 'dark');       // default → no ac-* class
  assert.equal(nextAccentClassName('ac-blue', 'nonsense'), '');               // unknown → cleared
});

test('storedAccent / saveAccent round-trip via a fake storage, defaulting when unset', () => {
  const store = (() => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; })();
  assert.equal(storedAccent(store), 'default');       // nothing saved yet
  saveAccent(store, 'green');
  assert.equal(storedAccent(store), 'green');
  saveAccent(store, 'bogus');                          // an unknown id is not persisted as-is
  assert.equal(storedAccent(store), 'default');
});
