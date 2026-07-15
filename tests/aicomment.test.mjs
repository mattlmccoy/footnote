// tests/aicomment.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AI_REVIEWER_ID, isAiComment, buildAdvisorClaudeJob, partitionAdvisorComments, findingCardState } from '../js/aicomment.js';

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

test('partitionAdvisorComments splits AI findings from human reviewer comments', () => {
  const list = [
    { id: 'r1', _advisor: 'jane-smith' },
    { id: 'f1', _advisor: 'ai-review-agents' },
    { id: 'r2', _advisor: 'bob-lee' },
    { id: 'f2', _advisor: 'ai-review-agents' },
  ];
  const { findings, reviewers } = partitionAdvisorComments(list);
  assert.deepEqual(findings.map(c => c.id), ['f1', 'f2']);
  assert.deepEqual(reviewers.map(c => c.id), ['r1', 'r2']);
});

test('partitionAdvisorComments handles empty / missing input', () => {
  assert.deepEqual(partitionAdvisorComments([]), { findings: [], reviewers: [] });
  assert.deepEqual(partitionAdvisorComments(undefined), { findings: [], reviewers: [] });
});

test('findingCardState reads per-comment acted/outcome state', () => {
  assert.deepEqual(
    findingCardState({ sent: false, status: 'open' }),
    { acted: false, staged: false, conflict: false, dismissed: false, status: 'open' });
  assert.deepEqual(
    findingCardState({ sent: true, status: 'staged', staged_edit: { before: 'x', after: 'y' } }),
    { acted: true, staged: true, conflict: false, dismissed: false, status: 'staged' });
  assert.equal(findingCardState({ status: 'queued', claude: { conflict: { reason: 'r' } } }).conflict, true);
  assert.equal(findingCardState({ resolution: { state: 'declined' } }).dismissed, true);
});
