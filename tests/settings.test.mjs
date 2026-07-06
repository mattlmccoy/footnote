// tests/settings.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingsSections, resolveSection } from '../js/settings.js';

const cfg = { reviewAgents: [] };

test('AI off: sections are email, access, ai(last, muted); NO agents', () => {
  const s = settingsSections(cfg, { aiOn:false, claudeConnected:false, emailConfigured:false, hasToken:false });
  assert.deepEqual(s.map(x => x.id), ['email', 'access', 'ai']);
  const ai = s.find(x => x.id === 'ai');
  assert.equal(ai.muted, true);
  assert.equal(ai.glyph, null);
  assert.equal(ai.label, 'AI assistant');
});

test('AI on: agents appears before ai; ai not muted', () => {
  const s = settingsSections(cfg, { aiOn:true, claudeConnected:true, emailConfigured:true, hasToken:true });
  assert.deepEqual(s.map(x => x.id), ['email', 'access', 'agents', 'ai']);
  assert.equal(s.find(x => x.id === 'ai').muted, false);
  assert.equal(s.find(x => x.id === 'ai').label, 'Claude / AI');
});

test('glyphs reflect state: ok when configured, warn when not', () => {
  const s = settingsSections(cfg, { aiOn:true, claudeConnected:false, emailConfigured:false, hasToken:true });
  assert.equal(s.find(x => x.id === 'email').glyph, 'warn');
  assert.equal(s.find(x => x.id === 'access').glyph, 'ok');
  assert.equal(s.find(x => x.id === 'ai').glyph, 'warn');
});

test('agents glyph is ok only when agents configured', () => {
  const on = settingsSections({ reviewAgents:['rigor'] }, { aiOn:true, claudeConnected:true, emailConfigured:true, hasToken:true });
  assert.equal(on.find(x => x.id === 'agents').glyph, 'ok');
  const off = settingsSections({ reviewAgents:[] }, { aiOn:true, claudeConnected:true, emailConfigured:true, hasToken:true });
  assert.equal(off.find(x => x.id === 'agents').glyph, null);
});

test('resolveSection keeps a valid request, else falls back to first', () => {
  const s = settingsSections(cfg, { aiOn:false, claudeConnected:false, emailConfigured:false, hasToken:false });
  assert.equal(resolveSection(s, 'access'), 'access');
  assert.equal(resolveSection(s, 'agents'), 'email');
  assert.equal(resolveSection(s, undefined), 'email');
});
