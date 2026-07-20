// Guard: a module can call a helper it never imported. That is valid JavaScript syntax, so
// `node --check` passes and unit tests (which import the helper module directly) stay green, while
// the real page throws ReferenceError on click. This actually happened: a cachebust ?v= bump made an
// unasserted string-replace of an import line silently no-op, leaving the swatch handlers calling
// chooseAccent() with no import, so colour selection stopped working. This test statically checks
// that every helper a consumer CALLS is actually IMPORTED.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CONSUMERS = ['js/app.js', 'js/advisor.js', 'js/hub.js'];
const PROVIDERS = ['accent.js', 'cardstats.js'];

function importedFrom(src, provider) {
  const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*'\\./${provider.replace('.', '\\.')}[^']*'`);
  const m = src.match(re);
  if (!m) return null;                                   // this consumer doesn't import the module at all
  return m[1].split(',').map(s => s.trim().split(/\s+as\s+/).pop().trim()).filter(Boolean);
}

function exportsOf(provider) {
  const src = readFileSync(`js/${provider}`, 'utf8');
  return [...src.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)].map(m => m[1]);
}

for (const consumer of CONSUMERS) {
  test(`${consumer} imports every accent/cardstats helper it calls`, () => {
    const src = readFileSync(consumer, 'utf8');
    for (const provider of PROVIDERS) {
      const imported = importedFrom(src, provider);
      if (imported === null) continue;
      for (const fn of exportsOf(provider)) {
        const called = new RegExp(`(?<![.\\w])${fn}\\s*\\(`).test(src);
        if (called) {
          assert.ok(imported.includes(fn),
            `${consumer} calls ${fn}() from ${provider} but does not import it`);
        }
      }
    }
  });
}
