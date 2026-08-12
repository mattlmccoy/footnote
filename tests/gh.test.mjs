import { test } from 'node:test'; import assert from 'node:assert/strict';
import { reviewPath, mergeReview, getJson } from '../js/gh.js';
import { setConfig, normalizeConfig } from '../js/config.js?v=f58d6b0';
import { condReset } from '../js/condcache.js?v=f5d7c87';

const b64 = s => btoa(unescape(encodeURIComponent(s)));
const res = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: k => headers[String(k).toLowerCase()] ?? null },
  json: async () => body,
});
// Route a fake fetch by URL: contents URL vs git/blobs URL.
const routed = map => { const calls = []; const f = async (url) => { calls.push(String(url)); for (const [frag, r] of map) if (String(url).includes(frag)) return r; return res(500, {}); }; f.calls = calls; return f; };
const withConfig = () => setConfig(normalizeConfig({ owner: 'me', dataRepo: 'me/data' }));
const withFetch = f => { const prev = globalThis.fetch; globalThis.fetch = f; return () => { globalThis.fetch = prev; }; };

test('reviewPath builds the data-repo path', () => {
  assert.equal(reviewPath('ch_modeling'), 'reviews/ch_modeling.json');
});
test('mergeReview keeps remote claude.* + status, local comment bodies/cursor', () => {
  const local = { comments:[{id:'c1',body:'new body',status:'open',claude:{branch:null}}], cursor:{page:3} };
  const remote = { comments:[{id:'c1',body:'old',status:'staged',claude:{branch:'review-edits/x'}}], cursor:{page:1} };
  const m = mergeReview(local, remote);
  assert.equal(m.comments[0].body, 'new body');          // local owns body
  assert.equal(m.comments[0].status, 'staged');          // remote owns status
  assert.equal(m.comments[0].claude.branch, 'review-edits/x'); // remote owns claude.*
  assert.equal(m.cursor.page, 3);                        // local owns cursor
});

test('getJson: >1MB file (empty inline content, sha present) falls back to the blobs API', async () => {
  condReset(); withConfig();
  const payload = { comments: [{ id: 'x' }] };
  const f = routed([
    ['/contents/reviews/ch1.json', res(200, { content: '', sha: 'abc123', size: 2_000_000 }, { etag: 'W/"e1"' })],
    ['/git/blobs/abc123', res(200, { content: b64(JSON.stringify(payload)), encoding: 'base64', sha: 'abc123' })],
  ]);
  const restore = withFetch(f);
  try {
    const r = await getJson('tok', 'reviews/ch1.json');
    assert.deepEqual(r, { json: payload, sha: 'abc123' });
  } finally { restore(); }
});

test('getJson: fast path (inline content present) decodes inline, never hits the blobs API', async () => {
  condReset(); withConfig();
  const payload = { comments: [{ id: 'y' }] };
  const f = routed([
    ['/contents/reviews/ch1.json', res(200, { content: b64(JSON.stringify(payload)), sha: 's1' }, { etag: 'W/"e1"' })],
  ]);
  const restore = withFetch(f);
  try {
    const r = await getJson('tok', 'reviews/ch1.json');
    assert.deepEqual(r, { json: payload, sha: 's1' });
    assert.equal(f.calls.some(u => u.includes('/git/blobs/')), false, 'must not call the blobs API when content is inline');
  } finally { restore(); }
});

test('getJson: 404 stays {json:null,sha:null}', async () => {
  condReset(); withConfig();
  const f = routed([['/contents/reviews/ch1.json', res(404, {})]]);
  const restore = withFetch(f);
  try {
    assert.deepEqual(await getJson('tok', 'reviews/ch1.json'), { json: null, sha: null });
  } finally { restore(); }
});
