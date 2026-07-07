// Resolve a reviewer's display NAME from their id, for owner-facing labels (comment pills, etc.).
// Named reviewers added at runtime aren't in the config name map, so a runtime map (from advisors.json)
// is consulted too — otherwise the label falls back to the raw id (the "matt-mccoy-h2uf" pill bug).
// A shared/"general-" pool uses the per-comment typed author name. AI-term-free.

export function resolveReviewerName(id, { configNames = {}, runtimeNames = {}, author = null } = {}) {
  if (!id) return id || '';
  if (/^general-/.test(id)) return author || 'Lab reviewer';   // shared pool: author is the typed name
  // Named reviewer: prefer known names; author is usually the id itself, so only use it if it's a real name.
  return configNames[id] || runtimeNames[id] || (author && author !== id ? author : id);
}
