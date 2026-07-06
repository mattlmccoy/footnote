import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  segmentId, segmentSelector, stripSegmentId,
  orderedUnits, mergeReviews, routeWrite, wrapUnit,
} from '../js/wholedoc.js';

const CH = [
  { id: 'ch_intro', n: 1, title: 'Introduction', sourceFile: 'intro.tex' },
  { id: 'ch_methods', n: 2, title: 'Methods', sourceFile: 'methods.tex' },
  { id: 'ch_results', n: 5, title: 'Results', sourceFile: 'results.tex' },
];

test('segmentId / segmentSelector build the wd- wrapper id', () => {
  assert.equal(segmentId('ch_intro'), 'wd-ch_intro');
  assert.equal(segmentSelector('ch_intro'), '#wd-ch_intro');
  // ids containing hyphens must round-trip
  assert.equal(segmentSelector('sec-1'), '#wd-sec-1');
});

test('stripSegmentId reverses segmentId and rejects non-segment ids', () => {
  assert.equal(stripSegmentId('wd-ch_intro'), 'ch_intro');
  assert.equal(stripSegmentId('wd-sec-1'), 'sec-1');   // hyphenated id survives
  assert.equal(stripSegmentId('ch_intro'), null);      // not a segment id
  assert.equal(stripSegmentId(''), null);
  assert.equal(stripSegmentId(null), null);
});

test('orderedUnits returns chapters in chapters.json order, all when no allow-list', () => {
  assert.deepEqual(orderedUnits(CH).map(u => u.id), ['ch_intro', 'ch_methods', 'ch_results']);
});

test('orderedUnits filters to an allow-list preserving chapters.json order', () => {
  // reviewer: only released ids, but order still comes from CHAPTERS not the allow-list
  const allow = ['ch_results', 'ch_intro'];
  assert.deepEqual(orderedUnits(CH, allow).map(u => u.id), ['ch_intro', 'ch_results']);
});

test('orderedUnits handles empty / missing chapters', () => {
  assert.deepEqual(orderedUnits([]), []);
  assert.deepEqual(orderedUnits(null), []);
  assert.deepEqual(orderedUnits(CH, []), []);   // nothing released
});

test('mergeReviews flattens per-chapter reviews into one chapter-tagged, doc-ordered list', () => {
  const reviewMap = {
    ch_methods: { chapter: 'ch_methods', comments: [{ id: 'm1' }, { id: 'm2' }] },
    ch_intro: { chapter: 'ch_intro', comments: [{ id: 'i1' }] },
    ch_results: { chapter: 'ch_results', comments: [] },
  };
  const flat = mergeReviews(reviewMap, orderedUnits(CH));
  // chapters in CHAPTERS order; comments in each review's own array order
  assert.deepEqual(flat.map(x => [x.chapterId, x.comment.id]), [
    ['ch_intro', 'i1'],
    ['ch_methods', 'm1'],
    ['ch_methods', 'm2'],
  ]);
});

test('mergeReviews tolerates a missing review for a unit', () => {
  const reviewMap = { ch_intro: { chapter: 'ch_intro', comments: [{ id: 'i1' }] } };
  const flat = mergeReviews(reviewMap, orderedUnits(CH));
  assert.deepEqual(flat.map(x => x.chapterId), ['ch_intro']);
});

test('routeWrite returns the target chapter review, never a merged blob', () => {
  const reviewMap = {
    ch_intro: { chapter: 'ch_intro', comments: [{ id: 'i1' }] },
    ch_methods: { chapter: 'ch_methods', comments: [{ id: 'm1' }] },
  };
  const target = routeWrite(reviewMap, 'ch_methods');
  assert.equal(target, reviewMap.ch_methods);            // identity: mutate that file's object
  assert.equal(target.chapter, 'ch_methods');
  assert.deepEqual(target.comments.map(c => c.id), ['m1']);   // ONLY ch_methods comments, not ch_intro's
});

test('routeWrite creates a fresh review shell for a chapter with none yet', () => {
  const reviewMap = {};
  const target = routeWrite(reviewMap, 'ch_results');
  assert.equal(target.chapter, 'ch_results');
  assert.deepEqual(target.comments, []);
  assert.equal(reviewMap.ch_results, target);            // stored back into the map
});

test('wrapUnit builds a chapter-scoped section with the head label', () => {
  const html = wrapUnit('ch_intro', 'Chapter 1 · Introduction', '<p>hello</p>');
  assert.match(html, /<section class="wd-chapter" id="wd-ch_intro">/);
  assert.match(html, /Chapter 1 · Introduction/);
  assert.match(html, /<p>hello<\/p>/);
  assert.match(html, /<\/section>/);
});

test('wrapUnit escapes the head label but not the fragment', () => {
  const html = wrapUnit('ch_x', 'A & B <script>', '<p>keep <b>this</b></p>');
  assert.match(html, /A &amp; B &lt;script&gt;/);        // label escaped
  assert.match(html, /<p>keep <b>this<\/b><\/p>/);       // fragment is trusted rendered HTML
});
