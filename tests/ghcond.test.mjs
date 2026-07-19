// Conditional-request behaviour of the two hot readers (getJson + ghTree). A 304 must return exactly what
// an unconditional 200 would have, and must never leak a mutated or cross-account payload.
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ghTree, getJson, putJson } from '../js/gh.js';
import { condReset } from '../js/condcache.js';

// gh.js imports './config.js?v=<hash>', which is a DIFFERENT module instance than '../js/config.js'.
// Resolve the exact specifier gh.js uses so we configure the instance it actually reads (and so the
// cache-bust bot rewriting that hash can't silently break this test).
const cfgSpec = readFileSync(new URL('../js/gh.js', import.meta.url), 'utf8').match(/from '\.\/(config\.js[^']*)'/)[1];
const { setConfig, normalizeConfig } = await import('../js/' + cfgSpec);
setConfig(normalizeConfig({ owner: 'me', dataRepo: 'me/data' }));

const b64 = s => btoa(unescape(encodeURIComponent(s)));
const res = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: k => headers[String(k).toLowerCase()] ?? null },
  json: async () => body,
});
const contentRes = (obj, sha, etag) => res(200, { content: b64(JSON.stringify(obj)), sha }, { etag });

let calls;
function stub(...responses){
  calls = [];
  globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return responses.shift() ?? res(500, {}); };
}
const sentMatch = i => calls[i].opts.headers['If-None-Match'];

test('getJson: first read is unconditional, stable-URL (no cache-buster), and caches the validator', async () => {
  condReset();
  stub(contentRes({ comments: [1] }, 'sha1', 'W/"e1"'));
  const r = await getJson('tok', 'reviews/ch1.json');
  assert.deepEqual(r.json, { comments: [1] });
  assert.equal(r.sha, 'sha1');
  assert.ok(!calls[0].url.includes('?t='), 'URL must be stable so the ETag keys it: ' + calls[0].url);
  assert.equal(sentMatch(0), undefined);
});

test('getJson: a 304 returns the same json + sha as the 200 did (free, and identically fresh)', async () => {
  condReset();
  stub(contentRes({ comments: [{ id: 'c1', body: 'keep me' }] }, 'sha1', 'W/"e1"'),
       res(304, null, { etag: 'W/"e1"' }));
  const first = await getJson('tok', 'reviews/ch1.json');
  const second = await getJson('tok', 'reviews/ch1.json');
  assert.equal(sentMatch(1), 'W/"e1"', 'second read must revalidate');
  assert.deepEqual(second.json, first.json);
  assert.equal(second.sha, 'sha1', 'sha must survive a 304 — writes depend on it');
});

test('getJson: mutating a returned payload cannot corrupt the next cache hit', async () => {
  condReset();
  stub(contentRes({ comments: [{ id: 'c1' }] }, 'sha1', 'W/"e1"'), res(304, null, {}));
  const first = await getJson('tok', 'reviews/ch1.json');
  first.json.comments.length = 0;                       // caller mutates (mergeReview-style)
  first.json.wrecked = true;
  const second = await getJson('tok', 'reviews/ch1.json');
  assert.deepEqual(second.json, { comments: [{ id: 'c1' }] });
});

test('getJson: changed content returns the NEW body, not the cached one', async () => {
  condReset();
  stub(contentRes({ v: 1 }, 'sha1', 'W/"e1"'), contentRes({ v: 2 }, 'sha2', 'W/"e2"'));
  await getJson('tok', 'reviews/ch1.json');
  const second = await getJson('tok', 'reviews/ch1.json');
  assert.deepEqual(second.json, { v: 2 });
  assert.equal(second.sha, 'sha2');
});

test('getJson: a 404 stays a 404 and does not poison the cache', async () => {
  condReset();
  stub(res(404, {}), contentRes({ v: 1 }, 'sha1', 'W/"e1"'));
  assert.deepEqual(await getJson('tok', 'reviews/new.json'), { json: null, sha: null });
  assert.deepEqual((await getJson('tok', 'reviews/new.json')).json, { v: 1 });   // created later: seen
});

test('getJson: a token change refetches instead of serving the other account cached data', async () => {
  condReset();
  stub(contentRes({ v: 1 }, 'sha1', 'W/"e1"'), contentRes({ v: 9 }, 'sha9', 'W/"e9"'));
  await getJson('tok-A', 'reviews/ch1.json');
  const other = await getJson('tok-B', 'reviews/ch1.json');
  assert.equal(sentMatch(1), undefined, 'must not revalidate another account cache entry');
  assert.deepEqual(other.json, { v: 9 });
});

test('ghTree: a 304 returns the same path list (the heaviest call, made free)', async () => {
  condReset();
  const tree = { tree: [{ type: 'blob', path: 'reviews/ch1.json' }, { type: 'tree', path: 'reviews' },
                        { type: 'blob', path: 'jobs.json' }] };
  stub(res(200, tree, { etag: 'W/"t1"' }), res(304, null, {}));
  const first = await ghTree('tok');
  const second = await ghTree('tok');
  assert.deepEqual(first, ['reviews/ch1.json', 'jobs.json']);       // blobs only
  assert.equal(sentMatch(1), 'W/"t1"');
  assert.deepEqual(second, first);
  assert.notEqual(second, first, 'must hand back a fresh array, not the cached one');
});

test('a write drops the cached entry so the next read is unconditional (fresh sha for the 409 retry)', async () => {
  condReset();
  stub(contentRes({ v: 1 }, 'sha1', 'W/"e1"'),
       res(200, { content: { sha: 'sha2' } }),                       // the PUT
       contentRes({ v: 2 }, 'sha2', 'W/"e2"'));
  await getJson('tok', 'reviews/ch1.json');
  await putJson('tok', 'reviews/ch1.json', { v: 2 }, 'sha1', 'msg');
  const after = await getJson('tok', 'reviews/ch1.json');
  assert.equal(sentMatch(2), undefined, 'post-write read must not revalidate a known-stale entry');
  assert.equal(after.sha, 'sha2');
});
