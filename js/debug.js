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

// Worst-first severity order for a project's overall dot.
const _SEV = ['nyr', 'unknown', 'behind-touched', 'behind-untouched', 'insync'];
export function rollupProject(docVerdicts, openCount) {
  const docs = docVerdicts || [];
  const behind = docs.filter(d => d.state === 'behind-touched' || d.state === 'behind-untouched').length;
  let worst = 'insync';
  for (const d of docs) if (_SEV.indexOf(d.state) < _SEV.indexOf(worst)) worst = d.state;
  return { docCount: docs.length, behind, open: openCount || 0, worst };
}

// The classic owner-login token needs these scopes (fine-grained tokens report no scope header → null).
export const REQUIRED_SCOPES = ['repo', 'workflow'];
export function parseScopes(headerVal) {
  if (headerVal == null) return null;
  return headerVal.split(',').map(s => s.trim()).filter(Boolean);
}
export function diffScopes(present, required) {
  if (present == null) return { ok: null, missing: [] };   // fine-grained token → can't assert from a header
  const missing = (required || []).filter(s => !present.includes(s));
  return { ok: missing.length === 0, missing };
}
