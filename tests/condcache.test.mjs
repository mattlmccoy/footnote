import { test } from 'node:test'; import assert from 'node:assert/strict';
import { condReset, condScope, condGet, condHeaders, condPut, condDrop, condDropAll, condSize } from '../js/condcache.js';

const U = 'https://api.github.com/repos/me/data/contents/reviews/ch1.json';

test('a cached entry round-trips its etag + payload', () => {
  condReset();
  condPut(U, 'W/"abc"', { text: '{"a":1}', sha: 's1' });
  assert.deepEqual(condGet(U), { etag: 'W/"abc"', payload: { text: '{"a":1}', sha: 's1' } });
});

test('no validator means no cache entry (we could never revalidate it)', () => {
  condReset();
  condPut(U, null, { text: '{}' });
  assert.equal(condGet(U), null);
  assert.equal(condSize(), 0);
});

test('a fresh 200 replaces the previous entry', () => {
  condReset();
  condPut(U, 'W/"old"', { text: '{"v":1}' });
  condPut(U, 'W/"new"', { text: '{"v":2}' });
  assert.equal(condGet(U).etag, 'W/"new"');
  assert.equal(condGet(U).payload.text, '{"v":2}');
  assert.equal(condSize(), 1);
});

test('condHeaders sends If-None-Match only when there is something to revalidate', () => {
  condReset();
  assert.equal(condHeaders(U, { Authorization: 'Bearer t' })['If-None-Match'], undefined);
  condPut(U, 'W/"abc"', { text: '{}' });
  const h = condHeaders(U, { Authorization: 'Bearer t' });
  assert.equal(h['If-None-Match'], 'W/"abc"');
  assert.equal(h.Authorization, 'Bearer t');           // base headers preserved
});

test('condHeaders never mutates the caller base headers', () => {
  condReset();
  condPut(U, 'W/"abc"', { text: '{}' });
  const base = { Authorization: 'Bearer t' };
  condHeaders(U, base);
  assert.deepEqual(base, { Authorization: 'Bearer t' });
});

test('a token change empties the cache — never serve one account data cached under another', () => {
  condReset();
  condScope('tok-A');
  condPut(U, 'W/"abc"', { text: '{"secret":1}' });
  condScope('tok-A');                                   // same token: cache survives
  assert.ok(condGet(U));
  condScope('tok-B');                                   // different token: cache gone
  assert.equal(condGet(U), null);
  assert.equal(condSize(), 0);
});

test('condDrop removes one url; condDropAll clears everything', () => {
  condReset();
  condPut(U, 'W/"a"', { text: '{}' });
  condPut('https://api.github.com/repos/me/data/git/trees/main?recursive=1', 'W/"t"', { paths: [] });
  condDrop(U);
  assert.equal(condGet(U), null);
  assert.equal(condSize(), 1);                          // tree entry untouched
  condDropAll();
  assert.equal(condSize(), 0);
});
