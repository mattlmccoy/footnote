import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The floating help button must be created on BOTH the landing page and the reading view. It regressed
// once because renderHelpFab() was only called from renderTopbar() (the chapter toolbar), so it appeared
// only after opening a document. The landing page builds its own banner in enterHome(), which is therefore
// a required, independent creation site. This guards against the button silently going missing on startup.
const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');

function bodyOf(name){
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `${name} not found`);
  let depth = 0, i = app.indexOf('{', start);
  for (let j = i; j < app.length; j++){
    if (app[j] === '{') depth++;
    else if (app[j] === '}' && --depth === 0) return app.slice(i, j + 1);
  }
  throw new Error(`no closing brace for ${name}`);
}

test('enterHome creates the help button (landing page)', () => {
  assert.match(bodyOf('enterHome'), /renderHelpFab\(\)/, 'landing page must render the help button');
});

test('renderTopbar creates the help button (reading view)', () => {
  assert.match(bodyOf('renderTopbar'), /renderHelpFab\(\)/, 'reading view must render the help button');
});
