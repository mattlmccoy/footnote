import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSha, showBuildTag, moduleName, formatBuildTime, collapsedLabel, detailLine } from '../js/buildinfo.js';

// Minimal fake window/document so the DOM injection can be exercised without a browser.
function fakeWin() {
  const els = [];
  const mkEl = () => ({
    _kids: [], id: '', style: '', attrs: {}, textContent: '', onclick: null,
    setAttribute(k, v) { this.attrs[k] = v; if (k === 'style') this.style = v; },
    appendChild(c) { this._kids.push(c); },
  });
  const doc = {
    _byId: {},
    body: mkEl(),
    createElement: () => mkEl(),
    getElementById(id) { return this._byId[id] || null; },
  };
  // appendChild on body should register elements that carry an id
  const origAppend = doc.body.appendChild.bind(doc.body);
  doc.body.appendChild = (c) => { origAppend(c); if (c.id) doc._byId[c.id] = c; };
  const win = { document: doc, location: { pathname: '/owner.html', replace(u) { win._replaced = u; } }, _replaced: null };
  return win;
}

test('showBuildTag injects a #fn-build pill showing the sha', () => {
  const w = fakeWin();
  showBuildTag('https://x/js/app.js?v=deadbee', w);
  const tag = w.document.getElementById('fn-build');
  assert.ok(tag, 'pill was appended');
  const text = tag._kids.map(k => k.textContent).join('');
  assert.match(text, /build deadbee/);
});

test('showBuildTag is idempotent (no duplicate pill)', () => {
  const w = fakeWin();
  showBuildTag('https://x/js/app.js?v=abc', w);
  showBuildTag('https://x/js/app.js?v=abc', w);
  assert.equal(w.document.body._kids.length, 1);
});

test('showBuildTag Refresh reloads with a cache-busting ?r=', () => {
  const w = fakeWin();
  showBuildTag('https://x/js/app.js?v=abc', w);
  const tag = w.document.getElementById('fn-build');
  const btn = tag._kids.find(k => k.textContent === 'Refresh');
  assert.ok(btn && typeof btn.onclick === 'function', 'refresh button wired');
  btn.onclick();
  assert.match(w._replaced, /^\/owner\.html\?r=\d+$/);
});

test('showBuildTag is a no-op when there is no window/document', () => {
  assert.doesNotThrow(() => showBuildTag('https://x/js/app.js?v=abc', null));
  assert.doesNotThrow(() => showBuildTag('https://x/js/app.js?v=abc', {}));
});

test('buildSha extracts the v query from a module URL', () => {
  assert.equal(buildSha('https://footnotedocs.com/js/app.js?v=79b46e8'), '79b46e8');
});

test('buildSha returns dev when there is no query', () => {
  assert.equal(buildSha('https://footnotedocs.com/js/app.js'), 'dev');
});

test('buildSha returns dev when v is present but empty', () => {
  assert.equal(buildSha('https://footnotedocs.com/js/app.js?v='), 'dev');
});

test('buildSha returns dev for a non-URL / malformed string without throwing', () => {
  assert.equal(buildSha('not a url'), 'dev');
  assert.equal(buildSha(''), 'dev');
  assert.equal(buildSha(undefined), 'dev');
});

test('buildSha ignores other query params and reads only v', () => {
  assert.equal(buildSha('file:///x/js/advisor.js?a=REV1&v=abc1234'), 'abc1234');
});

test('moduleName extracts the bundle name from a module URL', () => {
  assert.equal(moduleName('https://footnotedocs.com/js/app.js?v=e0d28cc'), 'app');
  assert.equal(moduleName('https://footnotedocs.com/js/hub.js?v=34496dc'), 'hub');
  assert.equal(moduleName('file:///x/js/advisor.js?a=REV1&v=abc'), 'advisor');
});

test('moduleName falls back to "app" for an unparseable value', () => {
  assert.equal(moduleName(''), 'app');
  assert.equal(moduleName(undefined), 'app');
});

test('formatBuildTime renders a local 12-hour stamp in the approved shape', () => {
  assert.match(formatBuildTime('2026-07-09T18:14:00Z'),
    /^[A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2} (AM|PM)$/);
});

test('formatBuildTime returns empty string for missing/invalid input', () => {
  assert.equal(formatBuildTime(''), '');
  assert.equal(formatBuildTime(undefined), '');
  assert.equal(formatBuildTime('not a date'), '');
});

test('collapsedLabel prefers the global sha, falls back to the file hash then dev', () => {
  assert.equal(collapsedLabel({ globalSha: '34496dc', fileHash: 'e0d28cc' }), 'build 34496dc');
  assert.equal(collapsedLabel({ fileHash: 'e0d28cc' }), 'build e0d28cc');
  assert.equal(collapsedLabel({}), 'build dev');
});

test('detailLine composes module + file hash + time, dropping empties', () => {
  assert.equal(detailLine({ module: 'app', fileHash: 'e0d28cc', time: 'Jul 9, 2026 2:14 PM' }),
    'app e0d28cc · Jul 9, 2026 2:14 PM');
  assert.equal(detailLine({ module: 'app', fileHash: 'e0d28cc' }), 'app e0d28cc');
  assert.equal(detailLine({}), '');
});
