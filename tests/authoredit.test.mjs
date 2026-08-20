import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthorSource, serializeAuthorSegments, authorPlainText, authorEditJob } from '../js/authoredit.js';

const segments = model => model.nodes.map(n => n.type === 'text'
  ? { type:'text', text:n.display }
  : { type:'token', id:n.id });

test('source-aware editor protects citations, cross-references, math, units, and labels', () => {
  const src = 'The result in \\cref{sec:solve} is \\SI{6.94}{\\percent} with $J<1$ \\cite{Song2025}.\\label{p:x}';
  const model = parseAuthorSource(src);
  const kinds = model.nodes.filter(n => n.type === 'token').map(n => n.kind);
  assert.deepEqual(kinds, ['reference','quantity','math','citation','label']);
  assert.equal(serializeAuthorSegments(model, segments(model)), src);
});

test('literal section and chapter references are protected even without LaTeX ref commands', () => {
  const src = 'The hardware in section 3.1 supports sections 3.1 and 3.3; chapter 5 gives the result.';
  const model = parseAuthorSource(src);
  const refs = model.nodes.filter(n => n.kind === 'reference');
  assert.deepEqual(refs.map(n => n.raw), ['section 3.1', 'sections 3.1 and 3.3', 'chapter 5']);
  assert.equal(serializeAuthorSegments(model, segments(model)), src);
});

test('literal figure, equation, and appendix reference lists and ranges are protected', () => {
  const src = 'See Figures 5.1--5.3, equations (2) and (3), and Appendix A.';
  const model = parseAuthorSource(src);
  const refs = model.nodes.filter(n => n.kind === 'reference');
  assert.deepEqual(refs.map(n => n.raw), ['Figures 5.1--5.3', 'equations (2) and (3)', 'Appendix A']);
  assert.equal(serializeAuthorSegments(model, segments(model)), src);
});

test('reference words embedded in ordinary words are not falsely locked', () => {
  const src = 'This subsection contains three equations but no numbered reference; the appendix then closes.';
  const model = parseAuthorSource(src);
  assert.equal(model.nodes.some(n => n.kind === 'reference'), false);
});

test('formatting wrappers keep their delimiters while exposing their prose', () => {
  const src = 'This is \\emph{important language} in the chapter.';
  const model = parseAuthorSource(src);
  const textNodes = model.nodes.filter(n => n.type === 'text');
  assert.ok(textNodes.some(n => n.display === 'important language'));
  assert.equal(serializeAuthorSegments(model, segments(model)), src);
});

test('only changed human text is escaped; protected source remains byte-identical', () => {
  const src = 'See \\cref{sec:x} for the old result.';
  const model = parseAuthorSource(src);
  const parts = segments(model);
  const tail = parts.findLast(p => p.type === 'text');
  tail.text = ' for the new 50% result.';
  assert.equal(serializeAuthorSegments(model, parts), 'See \\cref{sec:x} for the new 50\\% result.');
});

test('serialization refuses missing or reordered protected objects', () => {
  const model = parseAuthorSource('See \\cref{a} and \\cite{b}.');
  const parts = segments(model);
  assert.throws(() => serializeAuthorSegments(model, parts.filter(p => p.id !== 't0')), /protected/);
  const swapped = [...parts];
  const indexes = swapped.map((p,i) => p.type === 'token' ? i : -1).filter(i => i >= 0);
  [swapped[indexes[0]], swapped[indexes[1]]] = [swapped[indexes[1]], swapped[indexes[0]]];
  assert.throws(() => serializeAuthorSegments(model, swapped), /protected/);
});

test('plain-text summary names protected objects without exposing raw LaTeX', () => {
  const model = parseAuthorSource('See \\cref{sec:x}.');
  assert.equal(authorPlainText(model, segments(model)), 'See [ref: sec:x].');
});

test('author edit job carries literal source replacement without a reviewer comment', () => {
  const job = authorEditJob({ id:'j1', chapter:'ch5', find:'old', replacement:'new', requestedTs:'now' });
  assert.equal(job.type, 'author-edit');
  assert.equal(job.edits[0].find, 'old');
  assert.equal(job.edits[0].replacement, 'new');
  assert.ok(job.edits[0].source_hash);
  assert.equal('comment_ids' in job, false);
});
