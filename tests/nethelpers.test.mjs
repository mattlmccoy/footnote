import { test } from 'node:test'; import assert from 'node:assert/strict';
import { fetchWithTimeout, isRateLimited, classifyGitHubError, retryAfterMs, TTLCache, orphanComments } from '../js/nethelpers.js';

// ---------- fetchWithTimeout / retry ----------
test('fetchWithTimeout resolves with the response when fetch is fast', async () => {
  const fakeFetch = async () => ({ ok:true, status:200, _tag:'r' });
  const r = await fetchWithTimeout('u', {}, { timeoutMs:50, retries:1, fetchImpl:fakeFetch });
  assert.equal(r._tag, 'r');
});

test('fetchWithTimeout aborts a hung fetch after timeoutMs and rejects', async () => {
  // fetch never resolves until aborted; honor the AbortSignal
  const fakeFetch = (url, opts) => new Promise((_, reject) => {
    opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name:'AbortError' })));
  });
  await assert.rejects(
    () => fetchWithTimeout('u', {}, { timeoutMs:10, retries:0, fetchImpl:fakeFetch }),
    /timed out|aborted/i
  );
});

test('fetchWithTimeout retries once on a network error then succeeds', async () => {
  let calls = 0;
  const fakeFetch = async () => { calls++; if (calls === 1) throw new Error('network down'); return { ok:true, status:200 }; };
  const r = await fetchWithTimeout('u', {}, { timeoutMs:50, retries:1, backoffMs:0, fetchImpl:fakeFetch });
  assert.equal(r.ok, true); assert.equal(calls, 2);
});

test('fetchWithTimeout gives up after exhausting retries and rejects', async () => {
  let calls = 0;
  const fakeFetch = async () => { calls++; throw new Error('network down'); };
  await assert.rejects(() => fetchWithTimeout('u', {}, { timeoutMs:50, retries:2, backoffMs:0, fetchImpl:fakeFetch }));
  assert.equal(calls, 3);   // initial + 2 retries
});

test('fetchWithTimeout does NOT retry a normal non-ok response (e.g. 404/403) — returns it', async () => {
  let calls = 0;
  const fakeFetch = async () => { calls++; return { ok:false, status:403 }; };
  const r = await fetchWithTimeout('u', {}, { timeoutMs:50, retries:2, backoffMs:0, fetchImpl:fakeFetch });
  assert.equal(r.status, 403); assert.equal(calls, 1);   // a real HTTP response is the caller's to classify
});

// ---------- rate-limit classification ----------
const hdrs = obj => ({ get:(k)=> obj[k.toLowerCase()] ?? obj[k] ?? null });

test('isRateLimited: 403 with x-ratelimit-remaining:0 is a rate limit', () => {
  assert.equal(isRateLimited(403, hdrs({ 'x-ratelimit-remaining':'0' })), true);
});
test('isRateLimited: 429 is always a rate limit', () => {
  assert.equal(isRateLimited(429, hdrs({})), true);
});
test('isRateLimited: 403 with a Retry-After header is a rate limit (secondary limit)', () => {
  assert.equal(isRateLimited(403, hdrs({ 'retry-after':'30' })), true);
});
test('isRateLimited: a plain 403 (permissions) with remaining>0 is NOT a rate limit', () => {
  assert.equal(isRateLimited(403, hdrs({ 'x-ratelimit-remaining':'4999' })), false);
});
test('isRateLimited: 401 is not a rate limit', () => {
  assert.equal(isRateLimited(401, hdrs({})), false);
});
test('isRateLimited tolerates a missing headers object', () => {
  assert.equal(isRateLimited(429, null), true);
  assert.equal(isRateLimited(403, null), false);
});

test('classifyGitHubError reads status+headers off a thrown error and tags rate limits', () => {
  const e = Object.assign(new Error('GitHub 403'), { status:403, headers:hdrs({ 'x-ratelimit-remaining':'0' }) });
  const c = classifyGitHubError(e);
  assert.equal(c.rateLimited, true); assert.equal(c.status, 403);
});
test('classifyGitHubError falls back to parsing the status out of the message', () => {
  const c = classifyGitHubError(new Error('GitHub 429'));
  assert.equal(c.status, 429); assert.equal(c.rateLimited, true);
});
test('classifyGitHubError marks 401 as auth, not rate-limited', () => {
  const c = classifyGitHubError(new Error('GitHub 401'));
  assert.equal(c.auth, true); assert.equal(c.rateLimited, false);
});

test('retryAfterMs: honors Retry-After seconds', () => {
  assert.equal(retryAfterMs(hdrs({ 'retry-after':'30' })), 30000);
});
test('retryAfterMs: honors x-ratelimit-reset (epoch seconds) relative to now', () => {
  const reset = Math.floor(Date.now()/1000) + 45;
  const ms = retryAfterMs(hdrs({ 'x-ratelimit-reset':String(reset) }), Date.now());
  assert.ok(ms > 40000 && ms <= 45000, 'about 45s, got '+ms);
});
test('retryAfterMs: default when no headers', () => {
  assert.equal(retryAfterMs(null), 60000);
});

// ---------- short-TTL cache ----------
test('TTLCache returns a cached value inside the TTL and misses after it expires', () => {
  let now = 1000;
  const c = new TTLCache(500, () => now);
  c.set('k', 42);
  assert.equal(c.get('k'), 42);
  now = 1400; assert.equal(c.get('k'), 42);      // still fresh
  now = 1600; assert.equal(c.get('k'), undefined); // expired
});
test('TTLCache.has reflects freshness; delete + clear drop entries', () => {
  let now = 0; const c = new TTLCache(100, () => now);
  c.set('a', 1); assert.equal(c.has('a'), true);
  c.delete('a'); assert.equal(c.has('a'), false);
  c.set('b', 2); c.clear(); assert.equal(c.has('b'), false);
});

// ---------- orphaned-comment detection (F6) ----------
// present: the set of normalized quote-prefixes that ARE anchorable in the rendered doc.
test('orphanComments returns comments whose quote is not present in the rendered blocks', () => {
  const comments = [
    { id:'c1', anchor:{ quote:'the melt pool stays uniform' } },
    { id:'c2', anchor:{ quote:'this sentence was deleted by the author' } },
    { id:'c3', kind:'figure', anchor:{ quote:'Figure 2: the schematic' } },
  ];
  const isPresent = q => q.includes('melt pool');   // only c1's text survives
  const orphans = orphanComments(comments, isPresent);
  assert.deepEqual(orphans.map(c=>c.id), ['c2']);   // c1 anchors; c3 is a figure (skipped)
});
test('orphanComments skips resolved/merged/declined comments (already handled)', () => {
  const comments = [{ id:'x', status:'merged', anchor:{ quote:'gone text' } }];
  assert.deepEqual(orphanComments(comments, () => false), []);
});
test('orphanComments ignores comments with too-short/empty quotes', () => {
  const comments = [{ id:'x', anchor:{ quote:'' } }, { id:'y', anchor:{ quote:'ab' } }];
  assert.deepEqual(orphanComments(comments, () => false), []);
});
