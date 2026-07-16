import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAttachments } from '../js/appattach.js';

const units = [
  { id: 'ch_a', kind: undefined },
  { id: 'ch_b', kind: undefined },
  { id: 'app_x', kind: 'appendix' },   // cited by ch_a then ch_b
  { id: 'app_y', kind: 'appendix' },   // cited only by ch_b
  { id: 'app_z', kind: 'appendix' },   // uncited
];
const base = {
  chapters: units,
  refsByChapter: { ch_a: ['app:x'], ch_b: ['app:x', 'app:y'] },
  labelsByAppendix: { app_x: ['app:x'], app_y: ['app:y'], app_z: ['app:z'] },
  override: {},
};

test('first citer is home; second citer is a non-home citer', () => {
  const r = computeAttachments(base);
  assert.equal(r.homeOf.app_x, 'ch_a');
  assert.deepEqual(r.citersOf.app_x, ['ch_a', 'ch_b']);
});

test('single citer', () => {
  const r = computeAttachments(base);
  assert.equal(r.homeOf.app_y, 'ch_b');
  assert.deepEqual(r.citersOf.app_y, ['ch_b']);
});

test('uncited appendix', () => {
  const r = computeAttachments(base);
  assert.deepEqual(r.uncited, ['app_z']);
  assert.equal(r.homeOf.app_z, undefined);
});

test('byChapter lists appendices a chapter cites, in doc order', () => {
  const r = computeAttachments(base);
  assert.deepEqual(r.byChapter.ch_a, ['app_x']);
  assert.deepEqual(r.byChapter.ch_b, ['app_x', 'app_y']);
});

test('override pins a valid citer as home', () => {
  const r = computeAttachments({ ...base, override: { app_x: 'ch_b' } });
  assert.equal(r.homeOf.app_x, 'ch_b');
});

test('override naming a non-citer is ignored (falls back to first citer)', () => {
  const r = computeAttachments({ ...base, override: { app_x: 'ch_b_nope' } });
  assert.equal(r.homeOf.app_x, 'ch_a');
});

import { annotateAttachments, attachmentsView } from '../js/appattach.js';

const scanUnits = [
  { id: 'ch_a', sourceFile: 'chapters/ch_a.tex' },
  { id: 'ch_b', sourceFile: 'chapters/ch_b.tex' },
  { id: 'app_x', kind: 'appendix', sourceFile: 'appendices/app_x.tex' },
  { id: 'app_z', kind: 'appendix', sourceFile: 'appendices/app_z.tex' },
];
const sourceByFile = {
  'chapters/ch_a': 'intro cites \\cref{app:x}',
  'chapters/ch_b': 'no refs here',
  'appendices/app_x': '\\chapter{X}\\label{app:x}',
  'appendices/app_z': '\\chapter{Z}\\label{app:z}',   // uncited
};

test('annotateAttachments writes home + citedBy onto appendix units (matches sourceFile with/without .tex)', () => {
  const out = annotateAttachments(scanUnits.map(u => ({ ...u })), sourceByFile);
  const x = out.find(u => u.id === 'app_x');
  const z = out.find(u => u.id === 'app_z');
  assert.deepEqual(x.citedBy, ['ch_a']);
  assert.equal(x.home, 'ch_a');
  assert.deepEqual(z.citedBy, []);
  assert.equal(z.home, null);
  assert.equal(out.find(u => u.id === 'ch_a').home, undefined);   // chapters untouched
});

test('attachmentsView reconstructs maps from stored fields (no source needed)', () => {
  const annotated = annotateAttachments(scanUnits.map(u => ({ ...u })), sourceByFile);
  const v = attachmentsView(annotated);
  assert.deepEqual(v.byChapter.ch_a, ['app_x']);
  assert.equal(v.homeOf.app_x, 'ch_a');
  assert.deepEqual(v.citersOf.app_x, ['ch_a']);
  assert.deepEqual(v.uncited, ['app_z']);
});
