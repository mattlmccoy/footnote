import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Regression guard for the reviewer portal. advisor.js mirrors the whole-document reader, so it USES
// several helpers from wholedoc.js (orderedUnits, mergeReviews→flattenReviews, routeWrite, wrapUnit,
// stripSegmentId) on the render + comment paths. A bad merge (PR #4, commit 0df1d50) once dropped the
// `import … from './wholedoc.js'` line while leaving those calls in place → a runtime ReferenceError that
// killed rendering and commenting for reviewers. This test fails the moment advisor.js uses one of those
// helpers without importing it, so the drop can't recur silently.
const advisor = readFileSync(new URL('../js/advisor.js', import.meta.url), 'utf8');

const importLines = advisor.split('\n').filter(l => /^\s*import\b/.test(l)).join('\n');
const body = advisor.replace(importLines, '');

// helper name in the body  →  the local binding that MUST be imported for it (alias-aware)
const WHOLEDOC_HELPERS = ['orderedUnits', 'flattenReviews', 'routeWrite', 'wrapUnit', 'stripSegmentId'];
// Same guard for the Lane C reliability helpers (nethelpers.js): a bad cachebust rebase could drop the
// import while leaving the calls, ReferenceError-ing the reviewer's fetch/backoff/orphan paths.
const NET_HELPERS = ['fetchWithTimeout', 'classifyGitHubError', 'retryAfterMs', 'TTLCache', 'orphanComments'];
// Same guard for the conditional-request readers (condfetch.js). Dropping this import while the calls
// remain would ReferenceError every reviewer read — comments, outline and rendered content alike.
const COND_HELPERS = ['condJson', 'condRaw', 'condInvalidate'];
// And for the shared polling-cadence + budget-guard helpers: dropping these would ReferenceError the
// reviewer's poll scheduler on every tick.
const PACING_HELPERS = ['livePollDelay', 'budgetLevel', 'budgetFactor', 'budgetSnapshot'];

for (const name of [...WHOLEDOC_HELPERS, ...NET_HELPERS, ...COND_HELPERS, ...PACING_HELPERS]) {
  test(`advisor.js imports '${name}' if it uses it (guards a bad-merge import drop)`, () => {
    const usedInBody = new RegExp(`\\b${name}\\b`).test(body);
    if (!usedInBody) return;   // not used → nothing to import
    // must be bound by an import — either `name` directly or `something as name`
    const bound = new RegExp(`\\b(?:${name}\\b|as\\s+${name}\\b)`).test(importLines);
    assert.ok(bound, `advisor.js uses '${name}' but no import binds it — reviewer path will ReferenceError`);
  });
}
