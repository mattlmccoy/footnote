import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitLabel, unitLabelWithTitle } from '../js/unitlabel.js';

test('a normal chapter is "Chapter N"', () => {
  assert.equal(unitLabel({ n: 3, title: 'Methods' }, 'chapter'), 'Chapter 3');
});

test('the unit noun is respected and capitalized (Section)', () => {
  assert.equal(unitLabel({ n: 2, title: 'Results' }, 'section'), 'Section 2');
});

test('an appendix uses a letter, not the noun+number', () => {
  assert.equal(unitLabel({ kind: 'appendix', n: 1, title: 'Derivations' }, 'chapter'), 'Appendix A');
  assert.equal(unitLabel({ kind: 'appendix', n: 2, title: 'Data' }, 'chapter'), 'Appendix B');
});

test('appendix letters continue past Z (27 -> AA)', () => {
  assert.equal(unitLabel({ kind: 'appendix', n: 26 }, 'chapter'), 'Appendix Z');
  assert.equal(unitLabel({ kind: 'appendix', n: 27 }, 'chapter'), 'Appendix AA');
});

test('unitLabelWithTitle appends the title', () => {
  assert.equal(unitLabelWithTitle({ n: 3, title: 'Methods' }, 'chapter'), 'Chapter 3 · Methods');
  assert.equal(unitLabelWithTitle({ kind: 'appendix', n: 1, title: 'Derivations' }, 'chapter'), 'Appendix A · Derivations');
});

test('unitLabelWithTitle omits the separator when there is no title', () => {
  assert.equal(unitLabelWithTitle({ n: 3 }, 'chapter'), 'Chapter 3');
});

test('defaults to chapter noun when none given', () => {
  assert.equal(unitLabel({ n: 5 }), 'Chapter 5');
});
