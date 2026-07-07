import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeRefs, buildRefsSection } from '../js/wholerefs.js';

test('dedupeRefs keeps first occurrence and preserves order', () => {
  const out = dedupeRefs([
    { key: 'ref-a', html: '<div id="ref-a">A</div>' },
    { key: 'ref-b', html: '<div id="ref-b">B</div>' },
    { key: 'ref-a', html: '<div id="ref-a">A-dup</div>' },
    { key: 'ref-c', html: '<div id="ref-c">C</div>' },
  ]);
  assert.deepEqual(out.map(e => e.key), ['ref-a', 'ref-b', 'ref-c']);
  assert.equal(out[0].html, '<div id="ref-a">A</div>');   // first wins, not the dup
});

test('dedupeRefs on an empty list returns empty', () => {
  assert.deepEqual(dedupeRefs([]), []);
});

test('dedupeRefs drops entries with a blank/missing key', () => {
  const out = dedupeRefs([
    { key: '', html: '<div>x</div>' },
    { key: 'ref-a', html: '<div id="ref-a">A</div>' },
    { html: '<div>y</div>' },
  ]);
  assert.deepEqual(out.map(e => e.key), ['ref-a']);
});

test('buildRefsSection wraps entries in one References section', () => {
  const html = buildRefsSection([
    { key: 'ref-a', html: '<div id="ref-a" class="csl-entry">A</div>' },
    { key: 'ref-b', html: '<div id="ref-b" class="csl-entry">B</div>' },
  ]);
  assert.match(html, /<section class="wd-references">/);
  assert.match(html, /References/);
  assert.match(html, /id="ref-a"/);
  assert.match(html, /id="ref-b"/);
  // both entries present, in order
  assert.ok(html.indexOf('ref-a') < html.indexOf('ref-b'));
});

test('buildRefsSection with no entries returns empty string (no empty section)', () => {
  assert.equal(buildRefsSection([]), '');
});

test('buildRefsSection accepts a custom heading', () => {
  assert.match(buildRefsSection([{ key: 'ref-a', html: '<div id="ref-a">A</div>' }], 'Bibliography'), /Bibliography/);
});
