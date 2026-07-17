// js/debug.js — Hidden owner debug page. Read-only diagnostics. Pure helpers unit-tested;
// DOM + fetch orchestration browser-verified. Owner-side (no AI-clean constraint).

// Per-document drift verdict. `fill` (0..100) drives the little sync bar.
export function classifySync({ rendered, builtFrom, mainSha, ahead, fileTouched } = {}) {
  if (!rendered || !builtFrom) return { state: 'nyr', label: 'not rendered', fill: 0 };
  if (!mainSha) return { state: 'unknown', label: 'unknown', fill: 0 };
  if (builtFrom === mainSha || ahead === 0) return { state: 'insync', label: 'in sync', fill: 100 };
  if (typeof ahead === 'number' && ahead > 0) {
    const fill = Math.max(10, Math.min(90, 100 - ahead * 15));
    return fileTouched
      ? { state: 'behind-touched', label: `${ahead} behind`, fill }
      : { state: 'behind-untouched', label: `${ahead} behind · file untouched`, fill };
  }
  return { state: 'unknown', label: 'unknown', fill: 0 };
}
