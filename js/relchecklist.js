// Per-project dismissal state for the Reviewers-page deploy checklist. Once a project is set up,
// the checklist shouldn't nag, so the operator can dismiss it and it stays hidden for that project.
// Storage is injected (localStorage-shaped) and every access is guarded so a blocked browser can't
// crash the panel. AI-term-free — no bearing on advisor.js, but keeps the module family consistent.

export function checklistKey(projectId) {
  return 'fn:relchecklist:dismissed:' + (projectId || 'default');
}

export function isChecklistDismissed(store, projectId) {
  try {
    return store.getItem(checklistKey(projectId)) === '1';
  } catch {
    return false;
  }
}

export function dismissChecklist(store, projectId) {
  try {
    store.setItem(checklistKey(projectId), '1');
  } catch { /* storage blocked — nothing to persist */ }
}

export function restoreChecklist(store, projectId) {
  try {
    store.setItem(checklistKey(projectId), '0');
  } catch { /* storage blocked */ }
}
