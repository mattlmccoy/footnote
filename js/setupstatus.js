// Pure state for the setup card's "Reading view built" line. Kept separate from the DOM so the
// distinction that matters — a FAILED tree read (can't reach GitHub) vs genuinely-not-built — is
// unit-tested. A blocked/throttled api.github.com must never be reported as "your content is missing".
//   parsed: the manifest has units
//   failed: the repo-tree read (ghTree) threw
//   built:  how many units have content/<id>.html
//   total:  unit count
// → 'unimported' | 'unreachable' | 'built' | 'partial' | 'none'
export function readingViewState({ parsed = false, failed = false, built = 0, total = 0 } = {}) {
  if (!parsed) return 'unimported';
  if (failed) return 'unreachable';          // couldn't verify — don't claim not-built
  if (total > 0 && built >= total) return 'built';
  if (built > 0) return 'partial';
  return 'none';
}
