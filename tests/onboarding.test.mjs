import { test } from 'node:test';
import assert from 'node:assert';
import { reviewingHeader, releaseView, validateKey, FIRST_RUN_TOUR, commentDraftKey } from '../js/onboarding.js';

// ---- commentDraftKey: a half-written comment survives a refresh, keyed by the passage ----
test('commentDraftKey is stable per passage (whitespace-normalized) and distinct across passages', () => {
  const a = { quote: 'the quick brown fox', section: 'Intro' };
  assert.strictEqual(commentDraftKey('ch1', a), commentDraftKey('ch1', { quote: '  the quick   brown fox ', section: 'Intro' }));
  assert.notStrictEqual(commentDraftKey('ch1', a), commentDraftKey('ch2', a));                       // different chapter
  assert.notStrictEqual(commentDraftKey('ch1', a), commentDraftKey('ch1', { quote: 'other', section: 'Intro' }));  // different passage
  assert.ok(commentDraftKey(null, null).startsWith('footnote:draft:'));                              // safe fallback, no throw
});

// ---- reviewingHeader: "What am I reviewing?" ----
test('reviewingHeader surfaces doc title, author, reviewing-as, chapter count', () => {
  const cfg = { doc: { noun: 'dissertation', unitNoun: 'chapter', title: 'On Radio-Frequency Heating', authorName: 'Matt McCoy' }, deadline: null };
  const h = reviewingHeader(cfg, 'Dr. Allison', 3);
  assert.strictEqual(h.title, 'On Radio-Frequency Heating');
  assert.strictEqual(h.author, 'Matt McCoy');
  assert.strictEqual(h.reviewingAs, 'Dr. Allison');
  assert.strictEqual(h.sharedCount, 3);
  assert.strictEqual(h.unitNoun, 'chapter');
  assert.strictEqual(h.deadline, null);
});

test('reviewingHeader falls back to the document noun when no title is set', () => {
  const cfg = { doc: { noun: 'paper', unitNoun: 'section', title: '', authorName: '' }, deadline: null };
  const h = reviewingHeader(cfg, 'Reviewer', 0);
  assert.strictEqual(h.title, 'Untitled paper');   // capitalized noun fallback
  assert.strictEqual(h.author, '');
  assert.strictEqual(h.sharedCount, 0);
});

test('reviewingHeader includes a human deadline line with days remaining', () => {
  const now = new Date('2027-01-01T00:00:00Z');
  const cfg = { doc: { noun: 'thesis', unitNoun: 'chapter', title: 'T', authorName: 'A' }, deadline: { date: '2027-01-11', label: 'defense' } };
  const h = reviewingHeader(cfg, 'R', 1, now);
  assert.ok(h.deadline, 'deadline present');
  assert.strictEqual(h.deadline.label, 'defense');
  assert.strictEqual(h.deadline.days, 10);
});

// ---- releaseView: honest states ----
test('releaseView flags revoked first', () => {
  assert.strictEqual(releaseView({ revoked: true, keyBad: true, hasKey: true, releasedCount: 4 }), 'revoked');
});
test('releaseView flags an expired key when a key is present but rejected', () => {
  assert.strictEqual(releaseView({ revoked: false, keyBad: true, hasKey: true, releasedCount: 0 }), 'expired');
});
test('releaseView asks for a key when none is stored', () => {
  assert.strictEqual(releaseView({ revoked: false, keyBad: false, hasKey: false, releasedCount: 0 }), 'connect');
});
test('releaseView shows the honest waiting state when nothing is released yet', () => {
  assert.strictEqual(releaseView({ revoked: false, keyBad: false, hasKey: true, releasedCount: 0 }), 'waiting');
});
test('releaseView shows the home when chapters are released', () => {
  assert.strictEqual(releaseView({ revoked: false, keyBad: false, hasKey: true, releasedCount: 2 }), 'ready');
});

// ---- validateKey: paste-friendly key entry (replaces prompt()) ----
test('validateKey trims surrounding whitespace and accepts a plausible token', () => {
  const r = validateKey('  ghp_abcdEFGH1234  ');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value, 'ghp_abcdEFGH1234');
  assert.strictEqual(r.error, null);
});
test('validateKey rejects an empty value with a message', () => {
  const r = validateKey('   ');
  assert.strictEqual(r.ok, false);
  assert.ok(r.error && /paste/i.test(r.error));
});
test('validateKey strips an accidentally-pasted whole URL to just the key', () => {
  const r = validateKey('https://footnotedocs.com/advisor.html?a=REV1&k=ghp_XYZ789abc');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value, 'ghp_XYZ789abc');
});
test('validateKey rejects an obviously-too-short value', () => {
  const r = validateKey('abc');
  assert.strictEqual(r.ok, false);
  assert.ok(r.error);
});

// ---- FIRST_RUN_TOUR: the 3-step guide is data ----
test('FIRST_RUN_TOUR is a 3-step skippable guide', () => {
  assert.strictEqual(FIRST_RUN_TOUR.length, 3);
  for (const s of FIRST_RUN_TOUR){ assert.ok(s.title && s.body, 'each step has title + body'); }
});
