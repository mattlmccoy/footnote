// tests/aicomment.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AI_REVIEWER_ID, isAiComment } from '../js/aicomment.js';

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
