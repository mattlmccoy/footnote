// Regression guard for the reviewer→author comment hand-off (js/advisor.js).
// Bug: advisor.js's inline addComment hardcoded status:'open' and ignored the
// caller's status. The owner page (app.js loadAdvisorComments) HIDES every
// comment whose status === 'open' as an "unsubmitted draft", so a freshly-left
// reviewer comment never reached the author. The reviewer portal has no submit
// step ("shared the moment you add it"), so a new comment must be 'submitted'.
// advisor.js is window-coupled (not an ES module), so we extract the real inline
// nid + addComment definitions from source and eval them here (mirrors advisor-merge.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'js', 'advisor.js'), 'utf8');
const seqLine = src.match(/let _seq = 0;.*/)[0];                       // includes nid()
const addFn = src.match(/const addComment = \(r, c\) =>[\s\S]*?\}\] \}\);/)[0];
const { addComment } =
  new Function(`${seqLine}\n${addFn}\nreturn { addComment };`)();

// The owner page's visibility rule (js/app.js loadAdvisorComments): the author
// sees a reviewer comment only when its status is NOT the hidden 'open' draft.
const authorSees = c => c.status !== 'open';

test('a new reviewer comment is shared with the author by default (not a hidden draft)', () => {
  const r = addComment({ comments: [] }, { anchor: { quote: 'x' }, tag: 'wording', body: 'please clarify' });
  const c = r.comments[0];
  assert.equal(c.status, 'submitted', "default status must be 'submitted', not the author-hidden 'open'");
  assert.equal(authorSees(c), true, 'the author page must not filter out a freshly-left comment');
});

test('addComment honors an explicit status (e.g. resolved)', () => {
  const r = addComment({ comments: [] }, { anchor: { quote: 'x' }, tag: 'wording', body: 'ok', status: 'resolved' });
  assert.equal(r.comments[0].status, 'resolved');
});
