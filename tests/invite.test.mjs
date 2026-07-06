import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyFromSearch, searchWithoutKey } from '../js/invite.js';

test('keyFromSearch pulls the access key from the invite link', () => {
  assert.equal(keyFromSearch('?a=CJS&data=alice%2Fws&p=metro&k=ghp_abc123'), 'ghp_abc123');
  assert.equal(keyFromSearch('?a=CJS&data=alice%2Fws'), '');   // no key
  assert.equal(keyFromSearch('?k=%20%20'), '');                // blank → ''
  assert.equal(keyFromSearch(''), '');
});

test('searchWithoutKey scrubs only the key, preserving the rest', () => {
  assert.equal(searchWithoutKey('?a=CJS&data=alice%2Fws&p=metro&k=ghp_abc123'), '?a=CJS&data=alice%2Fws&p=metro');
  assert.equal(searchWithoutKey('?k=ghp_x&a=CJS'), '?a=CJS');
  assert.equal(searchWithoutKey('?k=ghp_x'), '');              // key was the only param
  assert.equal(searchWithoutKey('?a=CJS'), '?a=CJS');          // nothing to strip
});
