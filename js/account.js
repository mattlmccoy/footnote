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
    out.add(p.dataRepo || ws);
  }
  return [...out].filter(Boolean);
}

// The repos the account Overleaf token should be saved into when the user saves it from Settings: ALWAYS the
// workspace/registry repo (so it works with zero linked docs and auto-covers shared-repo Overleaf docs), plus
// every overleafSealTargets repo. Deduped, workspace repo first.
export function overleafSaveTargets(projects, appCfg) {
  const ws = (appCfg || {}).workspaceRepo || (appCfg || {}).hubRepo;
  return [...new Set([ws, ...overleafSealTargets(projects, appCfg)])].filter(Boolean);
}

// True iff `repo` is truthy AND not already in the account's sealed-repo list — the guard the auto-connect
// helper uses so linking a doc only seals a repo that hasn't been sealed yet.
export function needsOverleafSeal(repo, account) {
  return !!repo && !normalizeAccount(account).overleaf.sealedRepos.includes(repo);
}

// Return a normalized account with `repo` added to overleaf.sealedRepos (deduped). A falsy repo is a no-op.
export function withSealedRepo(account, repo) {
  const a = normalizeAccount(account);
  if (repo && !a.overleaf.sealedRepos.includes(repo)) a.overleaf.sealedRepos = [...a.overleaf.sealedRepos, repo];
  return a;
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
