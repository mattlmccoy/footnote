// Pure, assistant-free helpers for Overleaf Tier-2 sync (owner UI only; advisor.js never imports this).
// Mirrors the Python core (overleaf_sync.py) so display and CI agree on names.

export function overleafMarker(projectId, branch) {
  return { projectId: String(projectId || '').trim(), branch: (String(branch || '').trim() || 'master') };
}

export function secretName(projectId) {
  const slug = String(projectId || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
  return slug ? `OVERLEAF_TOKEN_${slug}` : 'OVERLEAF_TOKEN';
}

export function bridgeUrlHint(projectId) {
  return `https://git.overleaf.com/${String(projectId || '').trim()}`;
}

export function syncStatusLabel(status) {
  return {
    merged: 'Synced with Overleaf',
    noop: 'Up to date',
    conflict: 'Needs resolution',
    skipped: 'Not connected',
  }[status] || 'Not connected';
}

export function conflictSummary(marker) {
  const files = (marker && marker.files) || [];
  if (!files.length) return '';
  return `${files.length} file${files.length === 1 ? '' : 's'} need${files.length === 1 ? 's' : ''} resolution: ${files.join(', ')}`;
}
