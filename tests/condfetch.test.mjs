// Shared conditional readers used by the reviewer portal (and available to the owner portal).
// A 304 must be indistinguishable from a 200 to callers, and errors must stay classifiable.
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { condJson, condRaw, condInvalidate } from '../js/condfetch.js';
import { condReset } from '../js/condcache.js';
import { classifyGitHubError } from '../js/nethelpers.js';

const U = 'https://api.github.com/repos/me/data/contents/reviews/ch1.json';
const b64 = s => btoa(unescape(encodeURIComponent(s)));
const res = (status, body, headers = {}, text) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: k => headers[String(k).toLowerCase()] ?? null },
  json: async () => body, text: async () => text ?? '',
});
const contentRes = (obj, sha, etag) => res(200, { content: b64(JSON.stringify(obj)), sha }, { etag });

let calls;
const stub = (...rs) => { calls = []; return async (url, opts) => { calls.push({ url, opts }); return rs.shift() ?? res(500, {}); }; };
const sentMatch = i => calls[i].opts.headers['If-None-Match'];

test('condJson: 200 returns json+sha and caches the validator', async () => {
  condReset();
  const f = stub(contentRes({ comments: [1] }, 'sha1', 'W/"e1"'));
  const r = await condJson(U, { token: 't', fetchImpl: f });
  assert.deepEqual(r, { json: { comments: [1] }, sha: 'sha1' });
  assert.equal(sentMatch(0), undefined);
});

test('condJson: 304 returns exactly what the 200 returned', async () => {
  condReset();
  const f = stub(contentRes({ c: [{ id: 'x' }] }, 'sha1', 'W/"e1"'), res(304, null));
  const first = await condJson(U, { token: 't', fetchImpl: f });
  const second = await condJson(U, { token: 't', fetchImpl: f });
  assert.equal(sentMatch(1), 'W/"e1"');
  assert.deepEqual(second, first);
});

test('condJson: a caller mutating the result cannot corrupt the next hit', async () => {
  condReset();
  const f = stub(contentRes({ c: [{ id: 'x' }] }, 'sha1', 'W/"e1"'), res(304, null));
  const first = await condJson(U, { token: 't', fetchImpl: f });
  first.json.c.push({ id: 'INJECTED' });
  const second = await condJson(U, { token: 't', fetchImpl: f });
  assert.deepEqual(second.json, { c: [{ id: 'x' }] });
});

test('condJson: 404 stays {json:null,sha:null} and is not cached', async () => {
  condReset();
  const f = stub(res(404, {}), contentRes({ v: 1 }, 's', 'W/"e"'));
  assert.deepEqual(await condJson(U, { token: 't', fetchImpl: f }), { json: null, sha: null });
  assert.deepEqual((await condJson(U, { token: 't', fetchImpl: f })).json, { v: 1 });
});

test('condJson: errors stay classifiable — status, headers, and the code in the message', async () => {
  condReset();
  const f = stub(res(401, {}, { 'x-ratelimit-remaining': '10' }));
  await assert.rejects(() => condJson(U, { token: 't', fetchImpl: f }), e => {
    assert.equal(e.status, 401);
    assert.match(e.message, /\b401\b/);                       // advisor's is401 regex-matches the message
    assert.equal(classifyGitHubError(e).auth, true);
    return true;
  });
});

test('condJson: a rate-limit error still classifies as rateLimited', async () => {
  condReset();
  const f = stub(res(403, {}, { 'x-ratelimit-remaining': '0' }));
  await assert.rejects(() => condJson(U, { token: 't', fetchImpl: f }),
    e => classifyGitHubError(e).rateLimited === true);
});

test('condJson: empty content is rejected, not cached as valid', async () => {
  condReset();
  const f = stub(res(200, { content: '   ', sha: 's' }, { etag: 'W/"e"' }));
  await assert.rejects(() => condJson(U, { token: 't', fetchImpl: f }), /empty content/);
});

test('condRaw: 200 returns text; 304 replays the cached text', async () => {
  condReset();
  const f = stub(res(200, null, { etag: 'W/"r1"' }, '<p>hello</p>'), res(304, null));
  const a = await condRaw(U, { token: 't', fetchImpl: f });
  const b = await condRaw(U, { token: 't', fetchImpl: f });
  assert.deepEqual([a.ok, a.text], [true, '<p>hello</p>']);
  assert.deepEqual([b.ok, b.text, b.fromCache], [true, '<p>hello</p>', true]);
  assert.equal(sentMatch(1), 'W/"r1"');
});

test('condRaw: a failure reports ok:false with the status instead of throwing', async () => {
  condReset();
  const f = stub(res(404, {}));
  assert.deepEqual(await condRaw(U, { token: 't', fetchImpl: f }), { ok: false, status: 404, text: null });
});

test('condInvalidate forces the next read to be unconditional (used after a write)', async () => {
  condReset();
  const f = stub(contentRes({ v: 1 }, 's1', 'W/"e1"'), contentRes({ v: 2 }, 's2', 'W/"e2"'));
  await condJson(U, { token: 't', fetchImpl: f });
  condInvalidate(U);
  const after = await condJson(U, { token: 't', fetchImpl: f });
  assert.equal(sentMatch(1), undefined);
  assert.equal(after.sha, 's2');
});
