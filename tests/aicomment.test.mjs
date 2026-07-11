// tests/aicomment.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AI_REVIEWER_ID, isAiComment, buildAdvisorClaudeJob } from '../js/aicomment.js';

test('AI_REVIEWER_ID matches the engine reviewer id', () => {
  assert.equal(AI_REVIEWER_ID, 'ai-review-agents');
});

test('isAiComment: true only for the AI reviewer, safe on missing fields', () => {
  assert.equal(isAiComment({ _advisor: 'ai-review-agents' }), true);
  assert.equal(isAiComment({ _advisor: 'jane-doe' }), false);   // a human reviewer
  assert.equal(isAiComment({ _advisor: '' }), false);
  assert.equal(isAiComment({}), false);                          // no _advisor
  assert.equal(isAiComment(null), false);
  assert.equal(isAiComment(undefined), false);
});

test('buildAdvisorClaudeJob: base shape, no note → no revision (a plain Act on it / Send)', () => {
  const j = buildAdvisorClaudeJob({ id: 'j1', chapter: 'ch1', commentId: 'c9', advisorId: 'ai-review-agents', cid: 'a3', ts: 'T' });
  assert.equal(j.id, 'j1');
  assert.equal(j.type, 'apply-edits');
  assert.deepEqual(j.comment_ids, ['c9']);
  assert.deepEqual(j.from_advisor, { id: 'ai-review-agents', cid: 'a3' });
  assert.equal(j.status, 'queued');
  assert.equal(j.requested_ts, 'T');
  assert.equal('revision' in j, false);       // no guidance → not a revision
  assert.equal('revise_note' in j, false);
});

test('buildAdvisorClaudeJob: a guidance note sets revision:true + revise_note (forces a writer re-run)', () => {
  // Without revision:true the engine reuses an existing staged edit and ignores the note.
  const j = buildAdvisorClaudeJob({ id: 'j2', chapter: 'ch1', commentId: 'c9', advisorId: 'x', cid: 'a3', note: '  go deeper  ', ts: 'T' });
  assert.equal(j.revision, true);
  assert.equal(j.revise_note, 'go deeper');   // trimmed
});

test('buildAdvisorClaudeJob: blank/whitespace note is treated as no note', () => {
  const j = buildAdvisorClaudeJob({ id: 'j3', chapter: 'ch1', commentId: 'c9', advisorId: 'x', cid: 'a3', note: '   ', ts: 'T' });
  assert.equal('revision' in j, false);
  assert.equal('revise_note' in j, false);
});
