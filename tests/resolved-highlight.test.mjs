// Regression guard for the "resolved comment still highlighted" bug.
//
// Bug: in the OWNER reading view (js/app.js paintCommentsIn), the advisor/AI-review
// comment loop wrapped EVERY passed comment in a `mark.cmark` with no status/resolution
// filter, so a resolved AI-review finding (e.g. advisor/ai-review-agents/<ch>.json with
// status 'resolved') kept its anchor highlight even though the comment folds into the
// Resolved group and the open-count shows 0. The reviewer loop already filtered, the
// advisor loop did not. The reviewer portal (js/advisor.js) had the same gap.
//
// Fix: one shared, tested predicate `isResolved` in model.js is the single source of
// truth for "this comment is terminal, don't paint its highlight". Both owner painter
// loops guard on it; the reviewer portal keeps its own consistent `_isArchived` guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isResolved } from '../js/model.js';

// ---- the pure predicate ----------------------------------------------------
test('open / submitted comments are NOT resolved (they must still paint)', () => {
  assert.equal(isResolved({ status: 'open' }), false);
  assert.equal(isResolved({ status: 'submitted' }), false);
  assert.equal(isResolved({ status: 'staged' }), false);
  assert.equal(isResolved({ status: 'queued' }), false);
});

test('terminal statuses are resolved (must not paint)', () => {
  for (const status of ['resolved', 'merged', 'declined', 'answered']) {
    assert.equal(isResolved({ status }), true, `${status} must count as resolved`);
  }
});

test('a resolution object marks a comment resolved regardless of status', () => {
  assert.equal(isResolved({ status: 'submitted', resolution: { text: 'fixed in main' } }), true);
});

test("advisor_state 'resolved' marks a comment resolved", () => {
  assert.equal(isResolved({ status: 'submitted', advisor_state: 'resolved' }), true);
});

test('reopened wins: a reopened comment is NOT resolved even if it was terminal', () => {
  assert.equal(isResolved({ status: 'resolved', reopened: true }), false);
  assert.equal(isResolved({ status: 'submitted', resolution: { text: 'x' }, reopened: true }), false);
  assert.equal(isResolved({ status: 'merged', reopened: true }), false);
});

test('null / undefined comment is safely not resolved', () => {
  assert.equal(isResolved(null), false);
  assert.equal(isResolved(undefined), false);
});

// ---- source-level guard: the owner painter must actually USE the predicate --
// Mirrors advisor-imports.test.mjs: a future refactor that drops the guard from the
// advisor loop would silently reintroduce the exact bug, so pin it here.
const appSrc = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

test('app.js imports isResolved from model.js', () => {
  const importLines = appSrc.split('\n').filter(l => /^\s*import\b/.test(l)).join('\n');
  assert.match(importLines, /\bisResolved\b/, 'app.js must import isResolved to filter the painter');
});

test('app.js paintCommentsIn guards BOTH comment loops with isResolved', () => {
  const body = appSrc.match(/function paintCommentsIn\(root, comments, advComments\)\{[\s\S]*?\n\}/);
  assert.ok(body, 'paintCommentsIn(root, comments, advComments) must exist');
  const guards = body[0].match(/if\s*\(\s*isResolved\(c\)\s*\)\s*return/g) || [];
  assert.ok(guards.length >= 2,
    `paintCommentsIn must guard the reviewer AND advisor loops with isResolved (found ${guards.length})`);
});
