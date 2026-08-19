// tests/aimodels.test.mjs
// Future-proof Claude model registry for the cloud review runs. Values are Claude Code CLI --model
// ALIASES (opus/sonnet/haiku) that always resolve to the LATEST model of that tier, so selectors and
// engine calls stay current as new models ship — no code change. A pinned claude-* id also works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MODELS, DEFAULT_MODEL, INHERIT, resolveModel, isKnownModel, modelLabel } from '../js/aimodels.js';

test('registry lists Claude aliases and Codex specs with explicit providers', () => {
  const values = MODELS.map(m => m.value);
  for (const tier of ['opus', 'sonnet', 'haiku']) assert.ok(values.includes(tier), `missing ${tier}`);
  for (const model of ['codex:gpt-5.6-sol', 'codex:gpt-5.6-terra', 'codex:gpt-5.6-luna']) {
    assert.ok(values.includes(model), `missing ${model}`);
  }
  for (const m of MODELS) {
    assert.ok(m.value && m.label && m.tier && ['claude', 'codex'].includes(m.provider), `incomplete ${m.value}`);
  }
});

test('DEFAULT_MODEL is the best general tier (Opus) — "Opus for everything" default', () => {
  assert.equal(DEFAULT_MODEL, 'opus');
});

test('resolveModel: a per-agent pref wins; empty or INHERIT falls back to the global default', () => {
  assert.equal(resolveModel('sonnet', 'opus'), 'sonnet');          // explicit override
  assert.equal(resolveModel(INHERIT, 'opus'), 'opus');             // inherit sentinel → global
  assert.equal(resolveModel('', 'sonnet'), 'sonnet');              // empty → global
  assert.equal(resolveModel(undefined, undefined), 'opus');        // nothing → DEFAULT_MODEL
  assert.equal(resolveModel('claude-fable-5', 'opus'), 'claude-fable-5');  // pinned id passes through
});

test('INHERIT sentinel is distinct from any real model value', () => {
  assert.equal(INHERIT, 'default');
  assert.ok(!MODELS.some(m => m.value === INHERIT));
});

test('isKnownModel accepts registry aliases and any pinned claude-* id', () => {
  assert.ok(isKnownModel('opus'));
  assert.ok(isKnownModel('claude-opus-4-8'));
  assert.ok(isKnownModel('claude-fable-5'));
  assert.ok(isKnownModel('codex:gpt-5.6-terra'));
  assert.ok(isKnownModel('anthropic.claude-3-5-sonnet-20241022-v2:0'));
  assert.ok(!isKnownModel('gpt-4'));
  assert.ok(!isKnownModel(''));
});

test('modelLabel gives a human label for aliases, falls back to the raw value', () => {
  assert.match(modelLabel('opus'), /Opus/);
  assert.equal(modelLabel('claude-opus-4-8'), 'claude-opus-4-8');
});

test('Settings makes Writer/Editor a prominent model override', async () => {
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const writer = app.indexOf('id="mb-writer"');
  const optional = app.indexOf('Per-agent overrides');
  assert.ok(writer >= 0, 'missing dedicated Writer/Editor model control');
  assert.ok(optional < 0 || writer < optional, 'Writer/Editor control must precede optional overrides');
  assert.match(app, /map\.writer\s*=/, 'Writer/Editor selection must persist in AGENT_MODELS');
});

test('writer actions use a provider-neutral label', async () => {
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, />Send to Writer</);
  assert.doesNotMatch(app, />Send to Claude</);
});
