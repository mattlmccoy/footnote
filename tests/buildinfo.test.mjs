import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSha, showBuildTag } from '../js/buildinfo.js';

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
