import { test } from 'node:test'; import assert from 'node:assert/strict';
import { newReview, addComment, updateComment, deleteComment, setCursor } from '../js/model.js';
import { setDecision, partitionByDecision } from '../js/model.js';
import { queueApproved } from '../js/model.js';

test('newReview seeds empty review for a chapter', () => {
  const r = newReview('ch_modeling', 'abc123');
  assert.equal(r.chapter, 'ch_modeling'); assert.equal(r.built_from_commit, 'abc123');
  assert.deepEqual(r.comments, []);
});
test('addComment appends with id + open status', () => {
  let r = newReview('ch_modeling','abc');
  r = addComment(r, { page:5, kind:'text', anchor:{quote:'x'}, tag:'claim', body:'check' });
  assert.equal(r.comments.length, 1);
  const c = r.comments[0];
  assert.match(c.id, /^c_/); assert.equal(c.status, 'open'); assert.equal(c.tag,'claim');
});
test('updateComment changes body, deleteComment removes', () => {
  let r = addComment(newReview('c','a'), { page:1, tag:'wording', body:'a', anchor:{quote:'q'} });
  const id = r.comments[0].id;
  r = updateComment(r, id, { body:'b' }); assert.equal(r.comments[0].body, 'b');
  r = deleteComment(r, id); assert.equal(r.comments.length, 0);
});
test('setCursor stores resume position', () => {
  const r = setCursor(newReview('c','a'), { page:3, scroll:0.5, last_comment_id:'c_1' });
  assert.equal(r.cursor.page, 3);
});

test('setDecision stamps decision + note + ts on the target comment only', () => {
  let r = addComment(newReview('c','a'), { tag:'wording', body:'b', anchor:{quote:'q'} });
  r = addComment(r, { tag:'wording', body:'b2', anchor:{quote:'q2'} });
  const id = r.comments[0].id;
  r = setDecision(r, id, 'approve');
  assert.equal(r.comments[0].decision, 'approve');
  assert.match(r.comments[0].decision_ts, /^\d{4}-/);
  assert.equal(r.comments[1].decision, undefined);
  r = setDecision(r, id, 'revise', 'please soften');
  assert.equal(r.comments[0].decision, 'revise');
  assert.equal(r.comments[0].decision_note, 'please soften');
});

test('setDecision with null clears the decision', () => {
  let r = addComment(newReview('c','a'), { tag:'x', body:'b', anchor:{quote:'q'} });
  const id = r.comments[0].id;
  r = setDecision(r, id, 'reject');
  r = setDecision(r, id, null);
  assert.equal(r.comments[0].decision, undefined);
  assert.equal(r.comments[0].decision_note, undefined);
});

test('partitionByDecision groups staged comments by decision', () => {
  const comments = [
    { id:'a', status:'staged', decision:'approve' },
    { id:'b', status:'staged', decision:'reject' },
    { id:'c', status:'staged', decision:'revise', decision_note:'n' },
    { id:'d', status:'staged' },
    { id:'e', status:'merged', decision:'approve' },
  ];
  const p = partitionByDecision(comments);
  assert.deepEqual(p.approved, ['a']);
  assert.deepEqual(p.rejected, ['b']);
  assert.deepEqual(p.revise, [{ cid:'c', note:'n' }]);
  assert.deepEqual(p.undecided, ['d']);   // 'e' is not staged -> ignored
});

test('queueApproved promotes by decision and returns the revise list', () => {
  let r = { chapter:'c', comments:[
    { id:'a', status:'staged', decision:'approve', staged_edit:{before:'x',after:'y'} },
    { id:'b', status:'staged', decision:'reject',  staged_edit:{before:'x',after:'y'} },
    { id:'c', status:'staged', decision:'revise', decision_note:'soften', staged_edit:{before:'x',after:'y'} },
    { id:'d', status:'staged' },                                  // undecided -> untouched
    { id:'e', status:'merged', decision:'approve' },              // already done -> untouched
  ]};
  const { review, revise } = queueApproved(r);
  const by = Object.fromEntries(review.comments.map(c => [c.id, c]));
  assert.equal(by.a.status, 'approved'); assert.ok(by.a.staged_edit); assert.equal(by.a.decision, undefined);
  assert.equal(by.b.status, 'declined'); assert.equal(by.b.staged_edit, undefined);
  assert.equal(by.c.status, 'queued');   assert.equal(by.c.staged_edit, undefined);
  assert.equal(by.d.status, 'staged');
  assert.equal(by.e.status, 'merged');
  assert.deepEqual(revise, [{ cid:'c', note:'soften' }]);
});

test('partitionByDecision is staged-only and counts already-queued separately', () => {
  const comments = [
    { id:'a', status:'staged', decision:'approve' },
    { id:'q', status:'approved' },                               // already queued for merge
    { id:'d', status:'staged' },
  ];
  const p = partitionByDecision(comments);
  assert.deepEqual(p.approved, ['a']);
  assert.deepEqual(p.undecided, ['d']);
  assert.deepEqual(p.queued, ['q']);
});

test('addComment defaults to open but honors an explicit status', () => {
  let r = newReview('ch_modeling','abc');
  r = addComment(r, { tag:'wording', body:'draft', anchor:{quote:'q'} });
  assert.equal(r.comments[0].status, 'open');                 // default unchanged
  r = addComment(r, { tag:'wording', body:'live', anchor:{quote:'q2'}, status:'submitted' });
  assert.equal(r.comments[1].status, 'submitted');            // explicit status wins
});
