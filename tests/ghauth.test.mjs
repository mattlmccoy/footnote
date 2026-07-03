import { test } from 'node:test';
import assert from 'node:assert';
import { classifyPoll, isConfigured } from '../js/ghauth.js';

test('classifyPoll maps GitHub device-flow responses to states', () => {
  assert.deepStrictEqual(classifyPoll({ access_token: 'ghu_x' }), { state: 'ok', token: 'ghu_x' });
  assert.strictEqual(classifyPoll({ error: 'authorization_pending' }).state, 'pending');
  assert.deepStrictEqual(classifyPoll({ error: 'slow_down', interval: 10 }), { state: 'slow', interval: 10 });
  assert.strictEqual(classifyPoll({ error: 'expired_token' }).state, 'expired');
  assert.strictEqual(classifyPoll({ error: 'access_denied' }).state, 'denied');
  assert.strictEqual(classifyPoll({ error: 'something_else' }).state, 'error');
  assert.strictEqual(classifyPoll({}).state, 'error');
});

test('isConfigured is false until CLIENT_ID + RELAY_URL are filled', () => {
  // Ships disabled so the UI keeps the manual-token fallback until provisioning is done.
  assert.strictEqual(isConfigured(), false);
});
