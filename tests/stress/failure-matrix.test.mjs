// FAILURE-MATRIX regression guards — pins the code-level gaps Lane E found by reading production source.
// These are RED-documenting guards: they assert the CURRENT (buggy) behavior so Lane C's fix flips them,
// and they fail loudly if someone believes the bug is fixed when it isn't. Each references the finding id
// in the Lane E report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const advSrc = readFileSync(join(here, '..', '..', 'js', 'advisor.js'), 'utf8');
const ghSrc  = readFileSync(join(here, '..', '..', 'js', 'gh.js'), 'utf8');

// F2 — a 403 (rate-limit) is NOT classified as an auth error, and there is no rate-limit branch, so under
// shared-key exhaustion syncUp treats it as a generic failure with no backoff / no honest message.
test('F2: is401 does not catch 403 rate-limit (no dedicated rate-limit handling)', () => {
  const is401 = new Function('e', 'return /\\b401\\b/.test((e && e.message) || "");');
  assert.equal(is401(new Error('GitHub 403')), false, 'a 403 is (wrongly) not classified');
  assert.equal(is401(new Error('GitHub 401')), true);
  // no code path distinguishes 403/429/rate-limit today
  assert.ok(!/\b429\b|rate.?limit|Retry-After/i.test(advSrc), 'advisor.js has no rate-limit branch (F2)');
});

// F3 — no fetch in gh.js/advisor.js has a timeout (AbortController/signal), so a hung GitHub request
// hangs the reviewer portal indefinitely with no error surfaced.
test('F3: no fetch timeout (AbortController/signal) in the network layer', () => {
  assert.ok(!/AbortController|signal\s*:/.test(ghSrc), 'gh.js fetches have no timeout (F3)');
  assert.ok(!/AbortController/.test(advSrc), 'advisor.js fetches have no timeout (F3)');
});

// F4 — the magic-link boot writes localStorage.setItem('ghpat', ...) UNGUARDED, so storage-blocked
// browsers (Safari Private) throw synchronously and boot dies before any UI/message.
test('F4: magic-link ghpat write is not wrapped in try/catch (Safari Private crashes boot)', () => {
  // find the setItem('ghpat', ...) line and confirm it is not inside a try{...}catch guard on that statement
  const m = advSrc.match(/localStorage\.setItem\('ghpat',[^\n]*\n\s*try\s*\{[^\n]*history\.replaceState/);
  assert.ok(m, 'the ghpat write is immediately followed by a SEPARATE try (only replaceState is guarded)');
  // the setItem itself is bare — guard would look like: try { localStorage.setItem('ghpat'
  assert.ok(!/try\s*\{\s*localStorage\.setItem\('ghpat'/.test(advSrc), 'ghpat setItem is unguarded (F4)');
});

// F5 — two divergent merge implementations coexist: gh.js mergeReview(local, remote) [owner] and
// advisor.js mergeReviews(remote, local) [reviewer]. Different arg order AND different field-win rules.
// A convergence bug fixed in one will not be fixed in the other. Documented so Lane C can consolidate.
test('F5: owner and reviewer use two different merge functions with opposite arg order', () => {
  assert.ok(/export const mergeReview\s*=\s*\(local,\s*remote\)/.test(ghSrc), 'gh.js mergeReview(local,remote)');
  assert.ok(/function mergeReviews\(remote,\s*local\)/.test(advSrc), 'advisor.js mergeReviews(remote,local)');
  // sanity: they are genuinely different (owner has no FINAL-state guard; reviewer does)
  assert.ok(/FINAL/.test(advSrc) && !/FINAL/.test(ghSrc), 'only the reviewer merge has the FINAL-state downgrade guard (F5)');
});
