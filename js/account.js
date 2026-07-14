// js/account.js
// Pure helpers for the account.json config (workspaces list + Overleaf-seal tracking). NO I/O.

export function normalizeAccount(raw) {
  const a = raw || {};
  const ol = a.overleaf || {};
  return {
    workspaces: Array.isArray(a.workspaces) ? a.workspaces.filter(Boolean) : [],
    defaultWorkspace: (a.defaultWorkspace || 'My documents'),
    overleaf: { sealedRepos: Array.isArray(ol.sealedRepos) ? ol.sealedRepos.filter(Boolean) : [], setAt: ol.setAt || '' },
  };
}

// The repos the account Overleaf token must be sealed into: for each Overleaf-linked doc, the repo that holds
// its source — the shared/workspace repo for a consolidated doc, else the doc's own data repo.
export function overleafSealTargets(projects, appCfg) {
  const ws = appCfg.workspaceRepo || appCfg.hubRepo;
  const out = new Set();
  for (const p of projects || []) {
    if (!(p.overleaf && (p.overleaf.bridgeRepo || p.overleaf.projectId))) continue;
    out.add(p.workspace !== undefined && (p.sourceRepo === '' || p.sourceRepo === ws || !p.sourceRepo) && (p.dataRepo === ws)
      ? ws
      : (p.dataRepo || ws));
  }
  return [...out].filter(Boolean);
}

export function overleafExpiryDue(setAt, now) {
  if (!setAt) return false;
  const set = new Date(setAt); if (isNaN(set)) return false;
  const days = (now - set) / (1000 * 60 * 60 * 24);
  return days >= 365;
}

export function addWorkspace(account, name) {
  const a = normalizeAccount(account); const n = (name || '').trim();
  if (n && !a.workspaces.includes(n)) a.workspaces = [...a.workspaces, n];
  return a;
}
export function removeWorkspace(account, name) {
  const a = normalizeAccount(account);
  a.workspaces = a.workspaces.filter(w => w !== name);
  return a;
}
