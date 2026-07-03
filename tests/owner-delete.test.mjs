// Regression guard for the OWNER portal's delete-through-sync (same class of bug the advisor
// fork had): model.deleteComment had no tombstone and reconcileReview/mergeReview re-added any
// comment present in remote but missing locally, so an owner's delete was resurrected on sync.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { newReview, addComment, deleteComment } from '../js/model.js';
import { mergeReview } from '../js/gh.js';

const here = dirname(fileURLToPath(import.meta.url));

// reconcileReview is the LIVE owner sync merge; it lives inline in app.js (not a module), so
// extract it (+ its FINAL_STATES dependency) and eval, mirroring the advisor-merge test approach.
function loadReconcile() {
  const src = readFileSync(join(here, '..', 'js', 'app.js'), 'utf8');
  const finalStates = src.match(/const FINAL_STATES = .*?;/s)[0];
  const fn = src.match(/function reconcileReview\(local, remote, preferRemote\)\{[\s\S]*?\n\}/)[0];
  return new Function(`${finalStates}\n${fn}\nreturn reconcileReview;`)();
}

test('model.deleteComment records a tombstone', () => {
  let r = newReview('ch_x', 'abc');
  r = addComment(r, { body: 'a' });
  r = addComment(r, { body: 'b' });
  const id = r.comments[0].id;
  r = deleteComment(r, id);
  assert.equal(r.comments.length, 1);
  assert.deepEqual(r.deleted, [id]);
});

test('gh.mergeReview does not resurrect a tombstoned comment (and keeps remote-only ones)', () => {
  const remote = { comments: [{ id: 'c1', status: 'open' }, { id: 'c2', status: 'open' }, { id: 'inj', status: 'open' }] };
  const local = { comments: [{ id: 'c2', status: 'open' }], deleted: ['c1'] };
  const m = mergeReview(local, remote);
  assert.ok(!m.comments.find(c => c.id === 'c1'), 'c1 stays deleted');
  assert.ok(m.comments.find(c => c.id === 'c2'), 'c2 preserved');
  assert.ok(m.comments.find(c => c.id === 'inj'), 'owner-injected remote-only comment still pulled in');
  assert.deepEqual(m.deleted, ['c1']);
});

test('app.reconcileReview does not resurrect a deleted comment on syncUp OR syncDown', () => {
  const reconcile = loadReconcile();
  const remote = { comments: [{ id: 'c1', status: 'open' }, { id: 'c2', status: 'open' }] }; // server still has c1
  const local = { comments: [{ id: 'c2', status: 'open' }], deleted: ['c1'] };               // c1 deleted locally
  for (const preferRemote of [true, false]) {
    const m = reconcile(local, remote, preferRemote);
    assert.ok(!m.comments.find(c => c.id === 'c1'), `c1 stays deleted (preferRemote=${preferRemote})`);
    assert.ok(m.comments.find(c => c.id === 'c2'), 'c2 preserved');
    assert.deepEqual(m.deleted, ['c1'], 'tombstone persisted');
  }
});

test('app.reconcileReview still pulls in a remote-only comment that was NOT deleted', () => {
  const reconcile = loadReconcile();
  const m = reconcile({ comments: [] }, { comments: [{ id: 'inj', status: 'open' }] }, true);
  assert.ok(m.comments.find(c => c.id === 'inj'), 'remote-only comment preserved (no over-delete)');
});
