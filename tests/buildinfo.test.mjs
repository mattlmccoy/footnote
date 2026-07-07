import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSha } from '../js/buildinfo.js';

test('buildSha extracts the v query from a module URL', () => {
  assert.equal(buildSha('https://footnotedocs.com/js/app.js?v=79b46e8'), '79b46e8');
});

test('buildSha returns dev when there is no query', () => {
  assert.equal(buildSha('https://footnotedocs.com/js/app.js'), 'dev');
});

test('buildSha returns dev when v is present but empty', () => {
  assert.equal(buildSha('https://footnotedocs.com/js/app.js?v='), 'dev');
});

test('buildSha returns dev for a non-URL / malformed string without throwing', () => {
  assert.equal(buildSha('not a url'), 'dev');
  assert.equal(buildSha(''), 'dev');
  assert.equal(buildSha(undefined), 'dev');
});

test('buildSha ignores other query params and reads only v', () => {
  assert.equal(buildSha('file:///x/js/advisor.js?a=REV1&v=abc1234'), 'abc1234');
});
