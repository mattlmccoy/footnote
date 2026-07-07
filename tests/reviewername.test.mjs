import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveReviewerName } from '../js/reviewername.js';

test('a named reviewer resolves from the config name map', () => {
  assert.equal(resolveReviewerName('rev1', { configNames: { rev1: 'Alice Ng' } }), 'Alice Ng');
});

test('a runtime-added reviewer resolves from the runtime name map (the bug: pill showed the id)', () => {
  assert.equal(
    resolveReviewerName('matt-mccoy-h2uf', { runtimeNames: { 'matt-mccoy-h2uf': 'Matt McCoy' } }),
    'Matt McCoy'
  );
});

test('config names take precedence over runtime names', () => {
  assert.equal(
    resolveReviewerName('rev1', { configNames: { rev1: 'Config Name' }, runtimeNames: { rev1: 'Runtime Name' } }),
    'Config Name'
  );
});

test('a named reviewer with no known name falls back to the id (never crashes)', () => {
  assert.equal(resolveReviewerName('unknown-id'), 'unknown-id');
});

test("a named reviewer's author===id is not shown as a name (falls back to id)", () => {
  assert.equal(resolveReviewerName('rev1', { author: 'rev1' }), 'rev1');
});

test('a general/shared reviewer uses the typed author name', () => {
  assert.equal(resolveReviewerName('general-lab-1', { author: 'Dr. Smith' }), 'Dr. Smith');
});

test('a general reviewer with no author falls back to "Lab reviewer"', () => {
  assert.equal(resolveReviewerName('general-lab-1', {}), 'Lab reviewer');
});

test('handles a missing/blank id without throwing', () => {
  assert.equal(resolveReviewerName('', {}), '');
  assert.equal(resolveReviewerName(undefined, {}), '');
});
