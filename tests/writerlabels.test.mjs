import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('comment responses and conversation use the provider-neutral Writer label', async () => {
  const app = (await readFile(new URL('../js/app.js', import.meta.url), 'utf8')).replaceAll('\0', '');
  assert.match(app, /cresp-h[^`]*Writer/);
  assert.match(app, /Reply to Writer \/ request a change/);
  assert.doesNotMatch(app, /cresp-h[^`]*Claude/);
});

test('rendered preview wires paragraph-level change highlighting', async () => {
  const app = (await readFile(new URL('../js/app.js', import.meta.url), 'utf8')).replaceAll('\0', '');
  const owner = await readFile(new URL('../owner.html', import.meta.url), 'utf8');
  assert.match(app, /changedParagraphIndexes/);
  assert.match(app, /paintPreviewParagraphChanges/);
  assert.match(app, /escapeHtml\(_previewBranch\)/);
  assert.match(owner, /\.preview-change/);
});
