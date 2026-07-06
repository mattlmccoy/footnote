// tests/modal.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modalReducer, topModal } from '../js/modal.js';

test('open pushes, close pops the topmost, closeAll empties', () => {
  let s = [];
  s = modalReducer(s, { type:'open', id:'claude' });
  s = modalReducer(s, { type:'open', id:'email' });
  assert.deepEqual(s, ['claude', 'email']);
  assert.equal(topModal(s), 'email');
  s = modalReducer(s, { type:'close' });
  assert.deepEqual(s, ['claude']);
  s = modalReducer(s, { type:'closeAll' });
  assert.deepEqual(s, []);
  assert.equal(topModal(s), null);
});

test('close on empty stack is a no-op (never throws)', () => {
  assert.deepEqual(modalReducer([], { type:'close' }), []);
});

test('unknown action returns the stack unchanged', () => {
  assert.deepEqual(modalReducer(['a'], { type:'wat' }), ['a']);
});
