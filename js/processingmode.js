// Per-project review-processing mode: LOCAL (operator runs process_reviews.py + Claude Code) vs
// CLOUD (GitHub Actions). Pure + unit-tested. MUST mirror the engine's
// ci_review_common.resolve_processing_mode so the front-end and the CI never disagree: 'cloud' ONLY
// when explicitly set; missing/malformed/local resolves to 'local' (default-local = cloud CI inert).

export function processingMode(project) {
  const v = project && String(project.processingMode == null ? '' : project.processingMode).trim().toLowerCase();
  return v === 'cloud' ? 'cloud' : 'local';
}

// The projects.json patch that records the chosen mode (normalized).
export function processingModePatch(mode) {
  return { processingMode: String(mode).toLowerCase() === 'cloud' ? 'cloud' : 'local' };
}

// The committed <prefix>mode.json the engine reads (same shape as the patch value).
export function modeMarker(mode) {
  return { processingMode: String(mode).toLowerCase() === 'cloud' ? 'cloud' : 'local' };
}

// The Send-to-Claude button's mode pill: { label, cls }.
export function modePill(mode) {
  return processingMode({ processingMode: mode }) === 'cloud'
    ? { label: 'Cloud', cls: 'pm-cloud' }
    : { label: 'Local', cls: 'pm-local' };
}
