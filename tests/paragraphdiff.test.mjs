import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedParagraphIndexes, normalizeParagraph } from '../js/paragraphdiff.js';

test('normalizeParagraph ignores rendering whitespace and typographic punctuation', () => {
  assert.equal(normalizeParagraph('  RF–mediated\n  processing ’works’  '),
               "rf-mediated processing 'works'");
});

test('changedParagraphIndexes marks inserted and rewritten preview paragraphs', () => {
  const main = ['same opening', 'old task paragraph', 'same ending'];
  const preview = ['same opening', 'new task paragraph', 'new limitation paragraph', 'same ending'];
  assert.deepEqual(changedParagraphIndexes(main, preview), [1, 2]);
});

test('changedParagraphIndexes leaves unchanged paragraphs unmarked', () => {
  const paras = ['one', 'two', 'three'];
  assert.deepEqual(changedParagraphIndexes(paras, paras), []);
});

test('changedParagraphIndexes marks a moved paragraph because its context changed', () => {
  const changed = changedParagraphIndexes(['a', 'b', 'c'], ['b', 'a', 'c']);
  assert.equal(changed.length, 1);
  assert.ok(changed[0] === 0 || changed[0] === 1);
});
