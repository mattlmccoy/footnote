import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCount, totalWords, totalChars, countWords } from '../js/wordcount.js';

test('formatCount groups thousands and labels', () => {
  assert.equal(formatCount(0), '0 words');
  assert.equal(formatCount(1), '1 word');
  assert.equal(formatCount(12480), '12,480 words');
});

test('totalWords / totalChars sum a counts map, tolerating gaps', () => {
  const counts = { a: { words: 100, chars: 500 }, b: { words: 20, chars: 90 }, c: null };
  assert.equal(totalWords(counts), 120);
  assert.equal(totalChars(counts), 590);
  assert.equal(totalWords({}), 0);
  assert.equal(totalWords(), 0);
});

test('countWords mirrors the engine: prose minus refs/footnotes/math', () => {
  assert.equal(countWords('<p>one two three</p>').words, 3);
  assert.equal(countWords("<p>real words only</p><section id='refs'>junk junk</section>").words, 3);
  assert.equal(countWords("<p>a b</p><section class='footnotes'>fn fn fn</section>").words, 2);
  assert.equal(countWords("<p>e <span class='math inline'>\\(x\\)</span> m</p>").words, 2);
  assert.equal(countWords('').words, 0);
});

test('countWords: nested reference divs stripped whole + chars with spaces (engine parity)', () => {
  const html = '<p>real prose words here</p><div id="refs" class="references csl-bib-body"><div class="csl-entry">Smith 2020 one entry text</div><div class="csl-entry">Jones 2019 two entry text</div></div>';
  assert.equal(countWords(html).words, 4);                                   // only "real prose words here"
  assert.equal(countWords('<p>Hello brave new world</p>').chars, 'Hello brave new world'.length);   // WITH spaces
});

// ---- filling in counts for units the author hasn't opened (the "0 words" rows) ----
import { missingCountIds, mergeCounts } from '../js/wordcount.js';

test('missingCountIds finds units with no usable count, preserving order', () => {
  const units = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const counts = { a: { words: 100, chars: 500 }, b: { words: 0, chars: 0 }, c: null };
  // 0 is a real possible count for an empty unit, but it is also what an unrendered unit shows;
  // treat only a missing/!=number words as "not counted yet" so a genuine 0 isn't refetched forever
  assert.deepEqual(missingCountIds(units, counts), ['c', 'd']);
  assert.deepEqual(missingCountIds(units, {}), ['a', 'b', 'c', 'd']);
  assert.deepEqual(missingCountIds([], counts), []);
});

test('mergeCounts: the engine file wins, the local cache only fills gaps', () => {
  const engine = { a: { words: 10, chars: 50 } };                 // authoritative (written at render)
  const cached = { a: { words: 999, chars: 999 }, b: { words: 20, chars: 80 } };
  assert.deepEqual(mergeCounts(engine, cached), {
    a: { words: 10, chars: 50 },                                   // engine value survives
    b: { words: 20, chars: 80 },                                   // cache fills the gap
  });
});

test('mergeCounts tolerates missing / malformed sides', () => {
  assert.deepEqual(mergeCounts(null, null), {});
  assert.deepEqual(mergeCounts({ a: { words: 1, chars: 2 } }, null), { a: { words: 1, chars: 2 } });
  assert.deepEqual(mergeCounts(null, { a: { words: 1, chars: 2 } }), { a: { words: 1, chars: 2 } });
  assert.deepEqual(mergeCounts({ a: 'junk' }, { a: { words: 5, chars: 6 } }), { a: { words: 5, chars: 6 } });
});
