// js/storagecopy.js
// Single source of truth for storage-mode wording (used by New Project, the card badges, and the ⓘ).
// "workspace" is now the GROUPING; storage is Shared repo vs Individual repo.
const LABEL = { shared: 'Shared repo', individual: 'Individual repo' };
const INFO = {
  shared: 'Lives as a folder inside one repo alongside your other documents. Fewer repos to manage; best when you have several papers.',
  individual: 'Gets its own dedicated GitHub repos, fully self-contained. Pick this to keep a document separate, or when it’s already its own Overleaf/GitHub project.',
};
export function storageLabel(kind) { return LABEL[kind] || LABEL.shared; }
export function storageInfo(kind) { return INFO[kind] || INFO.shared; }
export function storageBadge(kind) {
  return kind === 'individual'
    ? { glyph: '◇', label: 'individual repo', kind: 'individual' }
    : { glyph: '◧', label: 'shared repo', kind: 'shared' };
}
