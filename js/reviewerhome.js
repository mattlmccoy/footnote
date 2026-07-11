// Reviewer Home — remembered documents. Every invite link a reviewer opens is stored per-browser so
// they never hunt for the email again. Pure logic (the store shape, dedupe, link reconstruction, and the
// "N new" diff); the DOM/render + localStorage I/O live in advisor.js. AI-term-free (advisor.js imports
// this and must stay grep-clean of AI terms).

export function recentsKey() { return 'footnote:reviews'; }

// The author's display name for the "shared by" line, in priority order: their GitHub profile name
// (GET /users/<login> → .name, inherited), then the name they typed into Footnote (persisted to the
// data repo's release.json as author_name), then the login. Never the bare login when a real name exists.
export function pickAuthorName(profileName, typedName, login) {
  return (profileName || '').trim() || (typedName || '').trim() || login;
}

// Identity of a remembered document: the workspace repo + the project subfolder (or just the repo for a
// legacy single-doc link). Two different authors' repos are always distinct.
function entryKey(e) { return `${e && e.data || ''}/${e && e.p || ''}`; }

function valid(e) { return !!(e && e.a && e.data && e.k); }

// Upsert an entry at the front, deduped by (data, p). Newer fields win; older fields fill any gaps.
export function recentsAdd(list, entry) {
  const arr = Array.isArray(list) ? list : [];
  const key = entryKey(entry);
  const prev = arr.find(e => entryKey(e) === key);
  const merged = prev ? { ...prev, ...entry } : { ...entry };
  return [merged, ...arr.filter(e => entryKey(e) !== key)];
}

// Validated, newest-first (by ts). Tolerates a null / non-array / junk-laden input.
export function recentsList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(valid).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

// Reconstruct the reviewer's invite URL for this document (omit &p= for a legacy single-doc link).
// Mirrors config.advisorInviteUrl's encodeURIComponent scheme so remembered links match sent links.
export function linkFor(e) {
  const enc = encodeURIComponent;
  let url = `advisor.html?a=${enc(e.a || '')}`;
  if (e.n) url += `&n=${enc(e.n)}`;
  url += `&data=${enc(e.data || '')}`;
  if (e.p) url += `&p=${enc(e.p)}`;
  if (e.k) url += `&k=${enc(e.k)}`;
  return url;
}

// How many released units are new since the reviewer last opened this doc. 0 when there's no baseline
// snapshot (don't badge on the first-ever open) or nothing new.
export function newCount(entry, currentReleasedIds) {
  const seen = entry && Array.isArray(entry.seenReleased) ? entry.seenReleased : null;
  if (!seen || !Array.isArray(currentReleasedIds)) return 0;
  const seenSet = new Set(seen);
  return currentReleasedIds.filter(id => !seenSet.has(id)).length;
}
