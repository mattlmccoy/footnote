// js/workspaces.js
// Pure grouping helpers for the launcher shelf. A "workspace" is a grouping label on a document
// (project.workspaceLabel — a STRING, DISTINCT from project.workspace, which is the storage boolean read by
// projectStorage). Documents with no label fall into the default workspace. NO I/O — hub.js supplies
// projects + accountCfg.

export function defaultWorkspaceName(accountCfg, hubRepo) {
  const name = ((accountCfg || {}).defaultWorkspace || '').trim();
  return name || 'My documents';
}

// Ordered, deduped workspace names to OFFER (config order first, then any labels actually present),
// excluding the default (which is implicit).
export function workspaceNames(projects, accountCfg) {
  const cfg = (accountCfg || {}).workspaces || [];
  const def = defaultWorkspaceName(accountCfg, '');
  const out = [];
  const push = n => { const v = (typeof n === 'string' ? n : '').trim(); if (v && v !== def && !out.includes(v)) out.push(v); };
  cfg.forEach(push);
  (projects || []).forEach(p => push(p.workspaceLabel));
  return out;
}

// Group projects into [{name, docs, isOnlyGroup}] for rendering. Config order first, the default group last;
// empty groups are omitted EXCEPT the default when it is the only group (so a fresh account renders one flat
// shelf). isOnlyGroup=true tells the caller to render without group chrome (today's flat shelf).
export function groupByWorkspace(projects, accountCfg) {
  const def = defaultWorkspaceName(accountCfg, '');
  const order = workspaceNames(projects, accountCfg);
  const buckets = new Map(order.map(n => [n, []]));
  const defaultDocs = [];
  for (const p of projects || []) {
    const w = (typeof p.workspaceLabel === 'string' ? p.workspaceLabel : '').trim();
    if (w && buckets.has(w)) buckets.get(w).push(p);
    else defaultDocs.push(p);
  }
  const groups = [];
  for (const n of order) if (buckets.get(n).length) groups.push({ name: n, docs: buckets.get(n) });
  if (defaultDocs.length || groups.length === 0) groups.push({ name: def, docs: defaultDocs });
  const only = groups.length === 1;
  return groups.map(g => ({ ...g, isOnlyGroup: only }));
}

export function moveDocPatch(workspaceName) {
  return { workspaceLabel: (workspaceName || '').trim() };
}
