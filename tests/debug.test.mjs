// tests/debug.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySync } from '../js/debug.js';

test('classifySync: not rendered → nyr', () => {
  assert.deepEqual(classifySync({ rendered: false, builtFrom: '', mainSha: 'abc', ahead: null, fileTouched: null }),
    { state: 'nyr', label: 'not rendered', fill: 0 });
  assert.equal(classifySync({ rendered: true, builtFrom: '', mainSha: 'abc', ahead: null, fileTouched: null }).state, 'nyr');
});

test('classifySync: built_from equals main HEAD → insync', () => {
  assert.deepEqual(classifySync({ rendered: true, builtFrom: 'abc123', mainSha: 'abc123', ahead: null, fileTouched: null }),
    { state: 'insync', label: 'in sync', fill: 100 });
});

test('classifySync: ahead 0 → insync even if shas differ', () => {
  assert.equal(classifySync({ rendered: true, builtFrom: 'aaa', mainSha: 'bbb', ahead: 0, fileTouched: false }).state, 'insync');
});

test('classifySync: behind and the doc file changed → behind-touched', () => {
  const v = classifySync({ rendered: true, builtFrom: 'aaa', mainSha: 'bbb', ahead: 3, fileTouched: true });
  assert.equal(v.state, 'behind-touched');
  assert.equal(v.label, '3 behind');
  assert.ok(v.fill > 0 && v.fill < 100);
});

test('classifySync: behind but the doc file was untouched → behind-untouched', () => {
  const v = classifySync({ rendered: true, builtFrom: 'aaa', mainSha: 'bbb', ahead: 2, fileTouched: false });
  assert.equal(v.state, 'behind-untouched');
  assert.equal(v.label, '2 behind · file untouched');
});

test('classifySync: main HEAD unknown → unknown', () => {
  assert.equal(classifySync({ rendered: true, builtFrom: 'aaa', mainSha: '', ahead: null, fileTouched: null }).state, 'unknown');
});
