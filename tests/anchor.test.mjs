import { test } from 'node:test'; import assert from 'node:assert/strict';
import { anchorFromSelection, locateQuote } from '../js/anchor.js';

test('anchorFromSelection captures quote, page, rects', () => {
  const a = anchorFromSelection({ text:'  the heating rate varies  ', page:5,
    rects:[{x:1,y:2,w:3,h:4}] });
  assert.equal(a.quote, 'the heating rate varies'); // trimmed
  assert.equal(a.page, 5); assert.equal(a.rects.length, 1); assert.equal(a.confirmed, false);
});
test('locateQuote finds unique line in source', () => {
  const src = 'line one\nthe heating rate varies by an order\nline three';
  const hit = locateQuote(src, 'the heating rate varies');
  assert.equal(hit.line, 2); assert.equal(hit.ambiguous, false);
});
test('locateQuote flags ambiguous/no match', () => {
  assert.equal(locateQuote('a\nfoo\nfoo', 'foo').ambiguous, true);
  assert.equal(locateQuote('a\nb', 'zzz').line, null);
});
