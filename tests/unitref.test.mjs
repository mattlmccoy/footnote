import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refTargetUnit } from '../js/unitref.js';

const units = [
  { id: 'ch_intro', n: 1 },
  { id: 'ch_platform', n: 3 },
  { id: 'ch_modeling', n: 4 },
  { id: 'app_a', kind: 'appendix', n: 1 },   // n collides with ch_intro on purpose
  { id: 'app_c', kind: 'appendix', n: 3 },   // n collides with ch_platform on purpose
];

test('a digit ref resolves to the CHAPTER with that number, never an appendix', () => {
  assert.equal(refTargetUnit(units, '3')?.id, 'ch_platform');       // not app_c (also n=3)
  assert.equal(refTargetUnit(units, '3.3.1')?.id, 'ch_platform');   // leading number wins
  assert.equal(refTargetUnit(units, '1.2')?.id, 'ch_intro');        // not app_a (also n=1)
});

test('a letter ref resolves to the APPENDIX with that letter', () => {
  assert.equal(refTargetUnit(units, 'A')?.id, 'app_a');
  assert.equal(refTargetUnit(units, 'C.2')?.id, 'app_c');
});

test('unknown / out-of-range refs resolve to nothing (no false link)', () => {
  assert.equal(refTargetUnit(units, '10.1'), null);   // appendix floats number by position — no chapter 10
  assert.equal(refTargetUnit(units, 'Z'), null);
  assert.equal(refTargetUnit(units, ''), null);
  assert.equal(refTargetUnit(), null);
});
