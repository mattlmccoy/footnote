import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSafeStore } from '../js/safestore.js';

// A localStorage-like stub whose behavior we control.
function fakeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
  };
}
// A storage that throws on every write — models Safari Private / storage-blocked.
function throwingStorage() {
  return {
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => { throw new Error('QuotaExceededError'); },
    removeItem: () => { throw new Error('SecurityError'); },
  };
}

test('round-trips through a working backing and is not marked blocked', () => {
  const s = makeSafeStore(fakeStorage());
  assert.equal(s.set('ghpat', 'abc'), true);
  assert.equal(s.get('ghpat'), 'abc');
  assert.equal(s.blocked(), false);
});

test('set NEVER throws when the backing throws, and the value survives in memory (F4)', () => {
  const s = makeSafeStore(throwingStorage());
  let ok;
  assert.doesNotThrow(() => { ok = s.set('ghpat', 'magic-key'); });
  assert.equal(ok, false);            // reports non-persistence
  assert.equal(s.get('ghpat'), 'magic-key');   // still usable this session
  assert.equal(s.blocked(), true);    // caller can show an honest notice
});

test('get NEVER throws when the backing throws, falls back to memory', () => {
  const s = makeSafeStore(throwingStorage());
  s.set('ghpat', 'k');
  let v;
  assert.doesNotThrow(() => { v = s.get('ghpat'); });
  assert.equal(v, 'k');
});

test('works purely in-memory when there is no backing at all', () => {
  const s = makeSafeStore(null);
  assert.equal(s.set('ghpat', 'k'), false);
  assert.equal(s.get('ghpat'), 'k');
  assert.equal(s.blocked(), true);
});

test('get returns null for a missing key', () => {
  const s = makeSafeStore(fakeStorage());
  assert.equal(s.get('nope'), null);
});

test('remove clears both memory and backing without throwing', () => {
  const s = makeSafeStore(throwingStorage());
  s.set('ghpat', 'k');
  assert.doesNotThrow(() => s.remove('ghpat'));
  assert.equal(s.get('ghpat'), null);
});
