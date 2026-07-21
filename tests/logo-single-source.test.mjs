import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The logo used to be duplicated (the brandMark component + an inline copy in app.js's home banner), which
// is how the dark-mode toning missed a surface. Guard that every portal renders the logo through the shared
// brandMark component — no hand-inlined mark can drift out of sync again.
const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const advisor = readFileSync(new URL('../js/advisor.js', import.meta.url), 'utf8');
const hub = readFileSync(new URL('../js/hub.js', import.meta.url), 'utf8');

test('app.js renders the logo via the shared brandMark component', () => {
  assert.match(app, /import\s*\{[^}]*brandMark[^}]*\}\s*from\s*'\.\/brandmark\.js/, 'app.js must import brandMark');
  assert.match(app, /brandMark\(/, 'app.js must call brandMark');
});

test('no portal hand-inlines the mark SVG (single source of truth)', () => {
  for (const [name, src] of [['app.js', app], ['advisor.js', advisor], ['hub.js', hub]]) {
    // the mark is the only 0 0 52 52 viewBox in the app; the component owns it, callers must not inline one
    assert.ok(!/viewBox="0 0 52 52"/.test(src), `${name} still hand-inlines the logo SVG — use brandMark()`);
  }
});
