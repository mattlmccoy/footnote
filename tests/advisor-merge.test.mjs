// Regression guard for the advisor portal's read-modify-merge sync (js/advisor.js).
// Bug (commit 4b9a39e): mergeReviews kept any comment present in remote but missing
// locally ("owner-only — keep"), so a reviewer's delete was resurrected on the next sync.
// Fix: deletion tombstones. advisor.js is window-coupled (not an ES module), so we extract
// the real deleteComment + mergeReviews definitions from source and eval them here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'js', 'advisor.js'), 'utf8');
const delLine = src.match(/const deleteComment = .*?;/s)[0];
const mergeFn = src.match(/function mergeReviews\(remote, local\)\{[\s\S]*?\n\}/)[0];
const { deleteComment, mergeReviews } =
  new Function(`${delLine}\n${mergeFn}\nreturn { deleteComment, mergeReviews };`)();

test('deleteComment records a tombstone', () => {
  const r = deleteComment({ comments: [{ id: 'c1' }, { id: 'c2' }] }, 'c1');
  assert.equal(r.comments.length, 1);
  assert.deepEqual(r.deleted, ['c1']);
});

test('a deleted comment is NOT resurrected when merging against a remote that still has it', () => {
  const remote = { comments: [{ id: 'c1' }, { id: 'c2' }] };
  const local = deleteComment({ comments: [{ id: 'c1' }, { id: 'c2' }] }, 'c1');
  const merged = mergeReviews(remote, local);
  assert.ok(!merged.comments.find(c => c.id === 'c1'), 'c1 must stay deleted');
  assert.ok(merged.comments.find(c => c.id === 'c2'), 'c2 preserved');
  assert.deepEqual(merged.deleted, ['c1'], 'tombstone persisted into the payload');
});

test('tombstone keeps the comment gone across a subsequent sync', () => {
  const remote = { comments: [{ id: 'c1' }], deleted: ['c1'] };
  const merged = mergeReviews(remote, { comments: [], deleted: [] });
  assert.ok(!merged.comments.find(c => c.id === 'c1'));
});

test('owner-injected comment (remote-only, not deleted) is still preserved', () => {
  const merged = mergeReviews({ comments: [{ id: 'inj', body: 'owner' }] }, { comments: [], deleted: [] });
  assert.ok(merged.comments.find(c => c.id === 'inj'), 'must not over-delete non-tombstoned comments');
});

// C1: a stale local copy must not downgrade an owner-finalized status (mergeReviews(remote, local))
test('a stale local status does NOT downgrade an owner-finalized comment', () => {
  const merged = mergeReviews({ comments: [{ id: 'c1', status: 'merged', body: 'x' }] },
                              { comments: [{ id: 'c1', status: 'open', body: 'x' }] });
  assert.equal(merged.comments.find(c => c.id === 'c1').status, 'merged', 'owner-final status preserved');
});
test('the advisor can still advance status (open -> submitted) on push', () => {
  const merged = mergeReviews({ comments: [{ id: 'c1', status: 'open', body: 'x' }] },
                              { comments: [{ id: 'c1', status: 'submitted', body: 'x' }] });
  assert.equal(merged.comments.find(c => c.id === 'c1').status, 'submitted', 'local advance wins for working states');
});
