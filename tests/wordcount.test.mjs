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
