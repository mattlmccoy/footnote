// js/tokenscopes.js — the single source of truth for the GitHub token scopes Footnote needs.
//
// Standardized credential vocabulary (see the token-repo audit + [[footnote-token-model]]):
//   Owner key    — the owner's GitHub token; full control of THEIR repos + Actions/Secrets.
//   Reviewer key — Contents-only, Review-repo-only; the `&k=` in every magic link. Deliberately minimal.
//   Source key   — SOURCE_TOKEN; only when the Source repo is SEPARATE from the Review repo.
//   Claude token — CLAUDE_CODE_OAUTH_TOKEN (subscription) or an Anthropic API key.
//
// The UNDERLYING secret/variable names never change (ADVISOR_KEY, SOURCE_TOKEN, CLAUDE_MODEL, …); only
// the user-facing labels above do. Pure module (no DOM) — unit-tested in tests/tokenscopes.test.mjs.

// A classic PAT with `repo` + `workflow` is BOTH fully URL-prefillable AND sufficient for every owner
// operation: `repo` grants Contents + Secrets + Actions + Variables (read/write) on your repos, and
// `workflow` lets Footnote install/update the background Actions. So the one-click classic path is the
// correctly-scoped Owner key. (The fine-grained path is least-privilege but must be set by hand — GitHub
// does not let a URL preselect the target repo or permissions on the fine-grained page.)
export const CLASSIC_OWNER_SCOPES = ['repo', 'workflow'];

export function classicTokenUrl(scopes = CLASSIC_OWNER_SCOPES, description = 'Footnote') {
  // Keep the scopes comma LITERAL (not %2C) — GitHub's classic-token page splits ?scopes= on commas, and
  // this matches the proven-working URL. Only the description is percent-encoded (it may contain spaces).
  return `https://github.com/settings/tokens/new?scopes=${scopes.join(',')}&description=${encodeURIComponent(description)}`;
}

// The fine-grained token page. GitHub honors only a `name` hint from the URL — not the repo or the
// permission set — so the caller must also show the exact permission list to set by hand.
export function fineGrainedUrl(name) {
  const base = 'https://github.com/settings/personal-access-tokens/new';
  return name ? `${base}?name=${encodeURIComponent(name)}` : base;
}

// ---- fine-grained permission lists (repository permissions), each item { name, level, why } ----

// Owner key — everything an owner op touches. The three that were MISSING from the old "recommended"
// list (Secrets, Actions, Variables) are why the recommended fine-grained path used to 403 on every
// AI / email-seal / apply / model-budget action. They are restored here.
export const OWNER_KEY_PERMISSIONS = [
  { name: 'Contents',       level: 'Read and write', why: 'read your source, store your review data' },
  { name: 'Administration', level: 'Read and write', why: 'create your private Review repo' },
  { name: 'Secrets',        level: 'Read and write', why: 'store your Claude token + email (SMTP) settings' },
  { name: 'Actions',        level: 'Read and write', why: 'run invites, rendering, and apply-edits' },
  { name: 'Variables',      level: 'Read and write', why: 'set the cloud model + budget caps' },
  { name: 'Workflows',      level: 'Read and write', why: 'install the background Actions Footnote uses' },
  { name: 'Metadata',       level: 'Read-only',      why: 'added automatically' },
];

// Reviewer key — deliberately minimal: it is emailed to every reviewer inside the magic link, so it must
// never carry Secrets/Actions/Admin. Contents-only, Review-repo-only, no expiration (Model A).
export const REVIEWER_KEY_PERMISSIONS = [
  { name: 'Contents', level: 'Read and write', why: 'read the document + post comments and staged edits' },
  { name: 'Metadata', level: 'Read-only',      why: 'added automatically' },
];

// Source key — only when the Source repo is SEPARATE from the Review repo (e.g. a third-party Overleaf
// repo you do not own). Contents R/W = read the source + push review-edits/<unit> branches on approval.
export const SOURCE_KEY_PERMISSIONS = [
  { name: 'Contents', level: 'Read and write', why: 'read the source; push review-edits/<unit> branches on approval' },
  { name: 'Metadata', level: 'Read-only',      why: 'added automatically' },
];

export function permissionNames(perms) {
  return (perms || []).map(p => p.name);
}

// Classify a pasted token by its prefix. We cannot read the actual GitHub scopes from the string alone,
// so this drives only a soft, string-detectable warning (see reviewerKeyWarning), never a hard block.
export function tokenKind(v) {
  const s = String(v == null ? '' : v).trim();
  if (/^github_pat_/.test(s)) return 'fine-grained';
  if (/^ghp_/.test(s))        return 'classic';
  if (/^gh[osru]_/.test(s))   return 'oauth';
  return 'unknown';
}

// Warn (soft) when a broad classic token is pasted where the least-privilege Reviewer key belongs.
// A classic `ghp_` token is inherently broad (repo scope = all your repos) — the reviewer key should be
// a fine-grained Contents-only token, because it gets emailed. Empty string = no warning.
export function reviewerKeyWarning(v) {
  if (tokenKind(v) === 'classic') {
    return 'That looks like a classic token — it grants access to all your repos. The Reviewer key is emailed to your reviewers, so use a fine-grained token scoped to only this Review repo with Contents: Read and write.';
  }
  return '';
}

// Live status for one credential in the Settings "Access & tokens" view, from a probed context. Returns
// { glyph: 'ok'|'warn'|null, text }. Pure so the status copy is unit-tested. glyph maps to the same ✓/●
// markers the rest of Settings uses; null = neutral/not-applicable (no marker).
export function credentialStatus(id, ctx = {}) {
  switch (id) {
    case 'owner':
      if (!ctx.hasOwnerKey) return { glyph: 'warn', text: 'Not set — Footnote can’t read your repo without it.' };
      if (ctx.ownerScopeOk === false) return { glyph: 'warn', text: 'Connected, but missing Secrets/Actions/Variables — AI, email, model/budget, and apply-edits will fail. Re-create it with the full scope (or a classic repo + workflow token).' };
      return { glyph: 'ok', text: 'Connected — stored only in this browser.' };
    case 'reviewer':
      return ctx.reviewerSet
        ? { glyph: 'ok', text: 'Set — carried in every reviewer invite link. Manage on the Reviewers page.' }
        : { glyph: 'warn', text: 'Not set — set it up on the Reviewers page (Connect email seals it as ADVISOR_KEY).' };
    case 'source':
      if (!ctx.sourceExternal) return { glyph: null, text: 'Not needed — your source lives in your Review repo.' };
      return ctx.sourceSet
        ? { glyph: 'ok', text: 'Set — sealed as SOURCE_TOKEN.' }
        : { glyph: 'warn', text: 'Not set — needed because your Source repo is separate.' };
    case 'claude':
      return ctx.claudeConnected
        ? { glyph: 'ok', text: 'Connected.' }
        : { glyph: null, text: 'Not set — only needed when the AI assistant is on.' };
    default:
      return { glyph: null, text: '' };
  }
}

// Credential descriptors for the Settings "Access & tokens" view. `secret`/`storage` are the STABLE
// internal names; `label`/`forWhat`/`repo`/`scope` are the user-facing, standardized-vocabulary copy.
export const CREDENTIALS = [
  {
    id: 'owner', label: 'Owner key', storage: 'ghpat',
    forWhat: 'Your GitHub login for Footnote — reads your source, stores review data, seals secrets, and runs the background Actions.',
    rep: 'Review repo (and your Source repo, when you own it)', repo: 'Review repo',
    scope: 'Fine-grained: Contents + Administration + Secrets + Actions + Variables + Workflows (Read and write). Or a classic repo + workflow token.',
    permissions: OWNER_KEY_PERMISSIONS,
  },
  {
    id: 'reviewer', label: 'Reviewer key', secret: 'ADVISOR_KEY',
    forWhat: 'The shared key carried in every reviewer magic link (the &k=). Lets reviewers read the document and post comments — nothing else.',
    repo: 'Review repo',
    scope: 'Fine-grained: Contents Read and write, Review repo only, No expiration.',
    permissions: REVIEWER_KEY_PERMISSIONS,
  },
  {
    id: 'source', label: 'Source key', secret: 'SOURCE_TOKEN',
    forWhat: 'Only when your Source repo is a SEPARATE repo you point Footnote at. Lets the cloud read it and push review-edits branches on approval.',
    repo: 'Source repo',
    scope: 'Fine-grained: Contents Read and write on the Source repo. Not needed when the source lives in your Review/Workspace repo.',
    permissions: SOURCE_KEY_PERMISSIONS,
  },
  {
    id: 'claude', label: 'Claude token', secret: 'CLAUDE_CODE_OAUTH_TOKEN',
    forWhat: 'Your Claude Code subscription token (from `claude setup-token`) or an Anthropic API key. Only used when the AI assistant is on.',
    repo: 'Review repo (sealed as a secret)',
    scope: 'Sealed into your Review repo’s Actions secrets. Setting it needs the Owner key’s Secrets access.',
    permissions: null,
  },
];
