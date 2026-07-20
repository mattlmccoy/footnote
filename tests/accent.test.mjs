import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCENTS, accentPaletteCss, swatchesHtml, nextAccentClassName,
  storedAccent, saveAccent,
} from '../js/accent.js';

test('ACCENTS has multicolor plus the named palette, each named one tuned for light and dark', () => {
  const ids = ACCENTS.map(a => a.id);
  assert.deepEqual(ids, ['multicolor', 'blue', 'purple', 'pink', 'red', 'orange', 'yellow', 'green', 'graphite']);
  assert.equal(ACCENTS[0].id, 'multicolor');
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
  assert.match(html, /data-accent="multicolor"[^>]*conic-gradient/);
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

// --------------------------------------------------------------- Multicolor (cycling accent)
import { accentForSlot, hexToHsl, hslToHex, rainbowSweep, CYCLE_MS, NAMED_IDS } from '../js/accent.js';

test('the first swatch is Multicolor (dynamic, no fixed colors)', () => {
  assert.equal(ACCENTS[0].id, 'multicolor');
  assert.ok(!ACCENTS[0].light);              // it has no fixed value; it cycles
  assert.ok(NAMED_IDS.length === 8);         // the 8 pickable static colors it cycles through
});

test('hexToHsl / hslToHex round-trip a color', () => {
  const { h, s, l } = hexToHsl('#2c64c4');
  const back = hslToHex(h, s, l);
  assert.equal(back.toLowerCase(), '#2c64c4');
});

test('accentForSlot is stable within a 30-minute slot and varies across slots', () => {
  const ids = NAMED_IDS;
  const t0 = 1_800_000_000_000;
  const a = accentForSlot(t0, ids, CYCLE_MS);
  assert.equal(accentForSlot(t0 + 60_000, ids, CYCLE_MS), a);        // same slot → same color
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(accentForSlot(t0 + i * CYCLE_MS, ids, CYCLE_MS));
  assert.ok(seen.size > 3, 'cycles through several colors across slots');
  for (const id of seen) assert.ok(ids.includes(id));                 // always a real palette color
  assert.equal(CYCLE_MS, 30 * 60 * 1000);
});

test('rainbowSweep starts at from, ends at to, and takes the long way round the hue wheel', () => {
  const from = '#cf3b34', to = '#cf7518';                             // red → orange (close hues)
  assert.equal(rainbowSweep(from, to, 0).toLowerCase(), from);
  assert.equal(rainbowSweep(from, to, 1).toLowerCase(), to);
  const midHue = hexToHsl(rainbowSweep(from, to, 0.5)).h;
  const directMid = (hexToHsl(from).h + hexToHsl(to).h) / 2;
  assert.ok(Math.abs(midHue - directMid) > 60, 'sweeps through other hues, not a direct blend');
});
