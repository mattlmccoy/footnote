// sourcestatus.js: PURE helpers for the owner-portal "is the reading view behind the source?" indicator.
// No DOM, no network (the fetch orchestration lives in sourcestatusio.js and calls these). Time/data are
// passed in, exactly like polldelay.js, so the whole verdict + copy is unit-tested.
//
// Provenance note: the review JSON's `built_from_commit` is always '' (nothing writes it), so we do NOT
// use it. The real build point is content/built.json in the DATA repo: { unitId: { sha, ts } }, written by
// ci_render.write_build_manifest and stamp_built.py. builtMarker() reduces that manifest to one build point.

// The project's build ceiling: the reading view is only as current as its STALEST unit, so the build point
// is the rendered unit with the oldest ts. Units without a sha are not built. { sha:'', ts:'', builtCount:0 }
// when nothing is built, so an unknown build point is never mistaken for a real commit.
export function builtMarker(manifest) {
  const entries = Object.values(manifest || {}).filter(e => e && e.sha);
  if (!entries.length) return { sha: '', ts: '', builtCount: 0 };
  let stalest = entries[0];
  for (const e of entries) if (String(e.ts || '') < String(stalest.ts || '')) stalest = e;
  return { sha: stalest.sha, ts: stalest.ts || '', builtCount: entries.length };
}

// Owner-facing project summary from already-fetched inputs:
//   sourceRepo  the LaTeX repo ('' for a doc with no external/workspace source)
//   builtSha    build point from builtMarker ('' when not built)
//   headSha     source main HEAD sha ('' when the read failed)
//   headDate    source HEAD commit date (ISO) or null
//   ahead       commits HEAD is ahead of builtSha (GitHub compare ahead_by), or null when uncomputable
//   rendered    whether the view is built at all (built.json non-empty)
// State precedence keeps the data-contract rule: an unknown source never renders as healthy, and a state
// we cannot verify never claims a rebuild is needed.
export function staleness({ sourceRepo, builtSha, headSha, headDate, ahead, rendered } = {}) {
  const lastUpdated = headDate || null;
  const mk = (state, behind = null, needsRebuild = false) => ({ state, behind, lastUpdated, needsRebuild });
  if (!sourceRepo) return mk('nosource');
  if (!headSha) return mk('unknown');
  if (!rendered || !builtSha) return mk('notbuilt', null, true);
  if (builtSha === headSha || ahead === 0) return mk('uptodate');
  const behind = typeof ahead === 'number' && ahead > 0 ? ahead : null;
  return mk('behind', behind, true);
}

// Owner copy for each state. No em dashes (house style). Honest for every non-healthy state.
export function sourceStatusLabel(status) {
  const s = status || {};
  const when = fmtWhen(s.lastUpdated);
  switch (s.state) {
    case 'nosource': return 'No linked source repo';
    case 'unknown': return 'Source status unavailable';
    case 'notbuilt': return 'Not built yet';
    case 'uptodate': return when ? `Up to date as of ${when}` : 'Up to date';
    case 'behind':
      if (typeof s.behind === 'number' && s.behind > 0) {
        const plural = s.behind === 1 ? 'commit' : 'commits';
        return when ? `${s.behind} ${plural} behind, source updated ${when}` : `${s.behind} ${plural} behind`;
      }
      return when ? `Source updated ${when}, rebuild pending` : 'Source updated, rebuild pending';
    default: return 'Source status unavailable';
  }
}

// Terse label for the space-constrained reading topbar (no dates). Pair with sourceStatusLabel as the
// hover title for the full wording. No em dashes.
export function sourceStatusShort(status) {
  const s = status || {};
  switch (s.state) {
    case 'nosource': return 'no source';
    case 'unknown': return 'source ?';
    case 'notbuilt': return 'not built';
    case 'uptodate': return 'up to date';
    case 'behind': return typeof s.behind === 'number' && s.behind > 0 ? `${s.behind} behind` : 'behind';
    default: return 'source ?';
  }
}

// Deterministic short date ("Jul 30, 2026") so labels are locale-stable and testable. '' for missing/invalid
// input so a broken date never renders as "Invalid Date".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
