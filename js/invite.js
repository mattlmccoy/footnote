// Magic-link helpers for the reviewer portal. The invite email's link carries the access key as ?k=<key>
// so a reviewer just clicks — no token to copy/paste. On boot the portal reads the key, stores it, and
// strips it from the URL (so the token isn't left in the address bar or shared by copying the URL).
// Pure functions — unit-tested; no I/O.

// Extract the access key from a URL query string ('' if absent/blank).
export function keyFromSearch(search) {
  const k = new URLSearchParams(search || '').get('k');
  return (k || '').trim();
}

// Return the query string with the key (?k=) removed, preserving every other param and leading '?'.
// Used to scrub the token out of location after it's been stored.
export function searchWithoutKey(search) {
  const p = new URLSearchParams(search || '');
  if (!p.has('k')) return search || '';
  p.delete('k');
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ---- Reviewer-key storage (its OWN slot, separate from the owner's ghpat) ----
//
// The owner portal (hub.js / app.js) stores the broad Owner key under localStorage['ghpat']. The reviewer
// portal used to store the narrow Reviewer key under the SAME key — so on one browser, opening the owner
// portal and a reviewer magic link clobbered each other (same origin, same slot). The Reviewer key now
// lives in its own slot; writes never touch ghpat, so the two keys can't cross-paste.
//
// These take a safestore-like `store` (get/set/remove) so they stay pure + unit-testable (no ambient
// localStorage). Kept HERE, in the reviewer portal's magic-link module, so advisor.js's import graph does
// not pull in the owner-side tokenscopes.js (which references the AI/Claude credential) — the reviewer
// bundle stays assistant-free by construction. tokenscopes.js carries the owner-side equivalent.
export const REVIEWER_KEY = 'footnote:reviewerkey';
export const LEGACY_KEY = 'ghpat';

// Read the Reviewer key: prefer its dedicated slot; fall back to the legacy shared slot so a reviewer who
// stored their key before this change (and returns without a fresh ?k= link) still gets in.
export function readReviewerKey(store) {
  const v = store.get(REVIEWER_KEY);
  if (v != null && v !== '') return v;
  const legacy = store.get(LEGACY_KEY);
  return legacy != null ? legacy : '';
}

// Write the Reviewer key to its dedicated slot ONLY. Never writes ghpat, so an owner logged in on the same
// browser keeps their Owner key. Returns whatever store.set returns (false when storage is blocked).
export function writeReviewerKey(store, v) {
  return store.set(REVIEWER_KEY, v);
}

// Remove the Reviewer key from BOTH slots — an explicit "remove my access on this device" must also clear
// the legacy slot where an existing reviewer's key still lives.
export function clearReviewerKey(store) {
  store.remove(REVIEWER_KEY);
  store.remove(LEGACY_KEY);
}

// Soft, non-blocking warning when a broad classic token (ghp_…) is pasted where the least-privilege
// Reviewer key belongs. The Reviewer key is emailed to reviewers, so it must be a fine-grained
// (github_pat_…) Contents-only token, not a classic token that grants all your repos. '' = no warning.
// (Self-contained here to keep the reviewer bundle's import graph free of the owner-side module.)
export function reviewerKeyWarning(v) {
  if (/^ghp_/.test(String(v == null ? '' : v).trim())) {
    return 'That looks like a classic token — it grants access to all your repos. The Reviewer key is emailed to your reviewers, so use a fine-grained token scoped to only this Review repo with Contents: Read and write.';
  }
  return '';
}
