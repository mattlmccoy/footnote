import { test } from 'node:test'; import assert from 'node:assert/strict';
import { reviewPath, mergeReview } from '../js/gh.js';

test('reviewPath builds the data-repo path', () => {
  assert.equal(reviewPath('ch_modeling'), 'reviews/ch_modeling.json');
});
test('mergeReview keeps remote claude.* + status, local comment bodies/cursor', () => {
  const local = { comments:[{id:'c1',body:'new body',status:'open',claude:{branch:null}}], cursor:{page:3} };
  const remote = { comments:[{id:'c1',body:'old',status:'staged',claude:{branch:'review-edits/x'}}], cursor:{page:1} };
  const m = mergeReview(local, remote);
  assert.equal(m.comments[0].body, 'new body');          // local owns body
  assert.equal(m.comments[0].status, 'staged');          // remote owns status
  assert.equal(m.comments[0].claude.branch, 'review-edits/x'); // remote owns claude.*
  assert.equal(m.cursor.page, 3);                        // local owns cursor
});
