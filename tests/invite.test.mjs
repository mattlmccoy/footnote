import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  keyFromSearch, searchWithoutKey,
  REVIEWER_KEY, LEGACY_KEY, readReviewerKey, writeReviewerKey, clearReviewerKey, reviewerKeyWarning,
} from '../js/invite.js';

// A tiny in-memory store matching the safestore get/set/remove shape.
function mkStore(init = {}) {
  const m = { ...init };
  return {
    _m: m,
    get: k => (k in m ? m[k] : null),
    set: (k, v) => { m[k] = v; return true; },
    remove: k => { delete m[k]; },
  };
}

test('reviewer key uses its OWN storage slot, not the shared owner ghpat', () => {
  assert.equal(REVIEWER_KEY, 'footnote:reviewerkey');
  assert.equal(LEGACY_KEY, 'ghpat');
  assert.notEqual(REVIEWER_KEY, LEGACY_KEY);
});

test('writeReviewerKey writes the dedicated slot and never touches ghpat (no cross-paste clobber)', () => {
  const s = mkStore({ ghpat: 'OWNER-KEY' });   // owner logged in on this browser
  writeReviewerKey(s, 'REVIEWER-KEY');
  assert.equal(s.get(REVIEWER_KEY), 'REVIEWER-KEY');
  assert.equal(s.get('ghpat'), 'OWNER-KEY');   // owner key untouched
});

test('readReviewerKey prefers the dedicated slot, falls back to legacy ghpat for returning reviewers', () => {
  assert.equal(readReviewerKey(mkStore({ [REVIEWER_KEY]: 'NEW' })), 'NEW');
  assert.equal(readReviewerKey(mkStore({ ghpat: 'LEGACY' })), 'LEGACY');       // migration read
  assert.equal(readReviewerKey(mkStore({ [REVIEWER_KEY]: 'NEW', ghpat: 'OLD' })), 'NEW');  // new wins
  assert.equal(readReviewerKey(mkStore()), '');
});

test('clearReviewerKey removes both the dedicated slot and the legacy ghpat', () => {
  const s = mkStore({ [REVIEWER_KEY]: 'R', ghpat: 'R-legacy' });
  clearReviewerKey(s);
  assert.equal(s.get(REVIEWER_KEY), null);
  assert.equal(s.get('ghpat'), null);
});

test('reviewerKeyWarning flags a broad classic token pasted as the Reviewer key', () => {
  assert.match(reviewerKeyWarning('ghp_broad'), /classic|all your repos|fine-grained/i);
  assert.equal(reviewerKeyWarning('github_pat_ok'), '');   // fine-grained = right shape
  assert.equal(reviewerKeyWarning(''), '');
});

test('keyFromSearch pulls the access key from the invite link', () => {
  assert.equal(keyFromSearch('?a=CJS&data=alice%2Fws&p=metro&k=ghp_abc123'), 'ghp_abc123');
  assert.equal(keyFromSearch('?a=CJS&data=alice%2Fws'), '');   // no key
  assert.equal(keyFromSearch('?k=%20%20'), '');                // blank → ''
  assert.equal(keyFromSearch(''), '');
});

test('searchWithoutKey scrubs only the key, preserving the rest', () => {
  assert.equal(searchWithoutKey('?a=CJS&data=alice%2Fws&p=metro&k=ghp_abc123'), '?a=CJS&data=alice%2Fws&p=metro');
  assert.equal(searchWithoutKey('?k=ghp_x&a=CJS'), '?a=CJS');
  assert.equal(searchWithoutKey('?k=ghp_x'), '');              // key was the only param
  assert.equal(searchWithoutKey('?a=CJS'), '?a=CJS');          // nothing to strip
});
