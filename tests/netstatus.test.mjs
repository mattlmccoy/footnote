import { test } from 'node:test';
import assert from 'node:assert/strict';
import { netHealth, pushSample, bannerText } from '../js/netstatus.js';

// ---- pushSample: bounded ring buffer of recent request outcomes ----
test('pushSample appends and caps the window to max', () => {
  let r = [];
  for (let i = 0; i < 8; i++) r = pushSample(r, { ok: true, ms: 100 }, 5);
  assert.equal(r.length, 5);
});

test('pushSample does not mutate the input array', () => {
  const a = [{ ok: true, ms: 1 }];
  const b = pushSample(a, { ok: false, ms: 2 }, 5);
  assert.equal(a.length, 1);
  assert.equal(b.length, 2);
});

// ---- netHealth: online flag + recent samples → banner state ----
test('offline when the browser reports offline, regardless of samples', () => {
  assert.equal(netHealth({ online: false, recent: [{ ok: true, ms: 50 }] }), 'offline');
});

test('ok when online with fast, successful requests', () => {
  assert.equal(netHealth({ online: true, recent: [{ ok: true, ms: 120 }, { ok: true, ms: 200 }] }), 'ok');
});

test('ok with no samples yet (fresh load)', () => {
  assert.equal(netHealth({ online: true, recent: [] }), 'ok');
});

test('repeated network failures read as offline even if navigator says online', () => {
  assert.equal(netHealth({ online: true, recent: [{ ok: false, ms: 3000 }, { ok: false, ms: 3000 }] }), 'offline');
});

test('a single recent failure is slow (degraded), not offline', () => {
  assert.equal(netHealth({ online: true, recent: [{ ok: true, ms: 100 }, { ok: false, ms: 2000 }] }), 'slow');
});

test('multiple slow-but-successful requests read as slow', () => {
  assert.equal(netHealth({ online: true, recent: [{ ok: true, ms: 5000 }, { ok: true, ms: 6000 }] }), 'slow');
});

// ---- bannerText: honest per-state copy (empty when healthy) ----
test('bannerText is empty when ok (no banner shown)', () => {
  assert.equal(bannerText('ok'), '');
});

test('bannerText warns clearly for offline and slow', () => {
  assert.match(bannerText('offline'), /offline/i);
  assert.match(bannerText('slow'), /slow|delay/i);
});
