import { test } from 'node:test'; import assert from 'node:assert/strict';
import { fetchSourceStatus, bustUrls } from '../js/sourcestatusio.js';

// The cheap "re-check" drops exactly the two cached reads whose freshness we want GitHub to revalidate:
// the data repo's built.json and the source repo's main HEAD. (The compare read is keyed by the shas, so
// it changes on its own once either moves — nothing to bust.)
test('bustUrls: names the built.json + source HEAD reads, honoring the data prefix', () => {
  assert.deepEqual(bustUrls({ sourceRepo: 'me/src', dataRepo: 'me/data', dataPrefix: '' }), [
    'https://api.github.com/repos/me/data/contents/content/built.json',
    'https://api.github.com/repos/me/src/commits/main',
    'https://api.github.com/repos/me/data/commits?path=content&per_page=1',
  ]);
  assert.deepEqual(bustUrls({ sourceRepo: 'me/src', dataRepo: 'me/ws', dataPrefix: 'p1/' }), [
    'https://api.github.com/repos/me/ws/contents/p1/content/built.json',
    'https://api.github.com/repos/me/src/commits/main',
    'https://api.github.com/repos/me/ws/commits?path=p1/content&per_page=1',
  ]);
});

test('bustUrls: no source repo -> nothing to bust', () => {
  assert.deepEqual(bustUrls({ sourceRepo: '', dataRepo: 'me/data' }), []);
});

// Minimal fake GitHub: routes by URL substring (mirrors tests/debug.test.mjs). Content endpoints return
// base64-wrapped JSON like the real contents API; other endpoints return their own JSON body.
function fakeFetch(routes) {
  return async (url) => {
    for (const [needle, resp] of routes) {
      if (url.includes(needle)) return { ok: true, status: 200, headers: { get: () => null }, json: async () => resp };
    }
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
  };
}
const b64 = obj => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
const DATE = '2026-07-30T09:00:00Z';

test('fetchSourceStatus: built from HEAD -> uptodate', async () => {
  const routes = [
    ['contents/content/built.json', { content: b64({ ch1: { sha: 'HEAD', ts: DATE } }) }],
    ['commits/main', { sha: 'HEAD', commit: { committer: { date: DATE } } }],
  ];
  const s = await fetchSourceStatus({ token: 't', sourceRepo: 'me/src', dataRepo: 'me/data', fetchImpl: fakeFetch(routes) });
  assert.equal(s.state, 'uptodate');
  assert.equal(s.needsRebuild, false);
  assert.equal(s.lastUpdated, DATE);
  assert.equal(s.headSha, 'HEAD');
});

test('fetchSourceStatus: source ahead of the build -> behind with the commit count', async () => {
  const routes = [
    ['contents/content/built.json', { content: b64({ ch1: { sha: 'OLD', ts: DATE } }) }],
    ['commits/main', { sha: 'HEAD', commit: { committer: { date: DATE } } }],
    ['compare/OLD...HEAD', { ahead_by: 2 }],
  ];
  const s = await fetchSourceStatus({ token: 't', sourceRepo: 'me/src', dataRepo: 'me/data', fetchImpl: fakeFetch(routes) });
  assert.equal(s.state, 'behind');
  assert.equal(s.behind, 2);
  assert.equal(s.needsRebuild, true);
});

test('fetchSourceStatus: no built.json but content IS rendered, source newer -> behind (timestamp fallback)', async () => {
  const routes = [
    ['src/commits/main', { sha: 'HEAD', commit: { committer: { date: '2026-07-30T12:00:00Z' } } }],
    ['data/commits?path=', [{ commit: { committer: { date: '2026-07-30T09:00:00Z' } } }]],   // last content render
  ];
  const s = await fetchSourceStatus({ token: 't', sourceRepo: 'me/src', dataRepo: 'me/data', fetchImpl: fakeFetch(routes) });
  assert.equal(s.state, 'behind');
  assert.equal(s.rendered, true);
  assert.equal(s.needsRebuild, true);
});

test('fetchSourceStatus: no built.json but content rendered AFTER the source -> uptodate', async () => {
  const routes = [
    ['src/commits/main', { sha: 'HEAD', commit: { committer: { date: '2026-07-30T09:00:00Z' } } }],
    ['data/commits?path=', [{ commit: { committer: { date: '2026-07-30T12:00:00Z' } } }]],
  ];
  const s = await fetchSourceStatus({ token: 't', sourceRepo: 'me/src', dataRepo: 'me/data', fetchImpl: fakeFetch(routes) });
  assert.equal(s.state, 'uptodate');
  assert.equal(s.rendered, true);
});

test('fetchSourceStatus: no built.json AND no content commits -> notbuilt (genuinely never rendered)', async () => {
  const routes = [
    ['src/commits/main', { sha: 'HEAD', commit: { committer: { date: DATE } } }],
    ['data/commits?path=', []],   // nothing under content/ has ever been committed
  ];
  const s = await fetchSourceStatus({ token: 't', sourceRepo: 'me/src', dataRepo: 'me/data', fetchImpl: fakeFetch(routes) });
  assert.equal(s.state, 'notbuilt');
  assert.equal(s.rendered, false);
  assert.equal(s.needsRebuild, true);
});

test('fetchSourceStatus: unreadable source HEAD -> unknown, never healthy', async () => {
  const routes = [['contents/content/built.json', { content: b64({ ch1: { sha: 'X', ts: DATE } }) }]];
  const s = await fetchSourceStatus({ token: 't', sourceRepo: 'me/src', dataRepo: 'me/data', fetchImpl: fakeFetch(routes) });
  assert.equal(s.state, 'unknown');
  assert.equal(s.needsRebuild, false);
});

test('fetchSourceStatus: no source repo -> nosource, and it does not call the network', async () => {
  let called = 0;
  const spy = async () => { called++; return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) }; };
  const s = await fetchSourceStatus({ token: 't', sourceRepo: '', dataRepo: 'me/data', fetchImpl: spy });
  assert.equal(s.state, 'nosource');
  assert.equal(called, 0);
});

test('fetchSourceStatus: honors a workspace dataPrefix for built.json', async () => {
  const routes = [
    ['contents/proj1/content/built.json', { content: b64({ ch1: { sha: 'HEAD', ts: DATE } }) }],
    ['commits/main', { sha: 'HEAD', commit: { committer: { date: DATE } } }],
  ];
  const s = await fetchSourceStatus({ token: 't', sourceRepo: 'me/src', dataRepo: 'me/ws', dataPrefix: 'proj1/', fetchImpl: fakeFetch(routes) });
  assert.equal(s.state, 'uptodate');
});

test('fetchSourceStatus: carries a ready-to-render label', async () => {
  const routes = [
    ['contents/content/built.json', { content: b64({ ch1: { sha: 'OLD', ts: DATE } }) }],
    ['commits/main', { sha: 'HEAD', commit: { committer: { date: DATE } } }],
    ['compare/OLD...HEAD', { ahead_by: 1 }],
  ];
  const s = await fetchSourceStatus({ token: 't', sourceRepo: 'me/src', dataRepo: 'me/data', fetchImpl: fakeFetch(routes) });
  assert.equal(s.label, '1 commit behind, source updated Jul 30, 2026');
  assert.equal(s.short, '1 behind');   // terse variant for the reading topbar
});
