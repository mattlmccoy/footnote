# Workspaces, account Settings, and clearer storage — design

**Date:** 2026-07-14
**Status:** design — awaiting author review before the implementation plan
**Repo:** `mattlmccoy/footnote`
**Relates to:** the storage-model reconciliation (projectStorage, shared-vs-independent), the Overleaf
Tier-2 work (B1/B2 + the F3 branch-default fix), [[footnote-settings-architecture]], [[mockups-are-the-contract]].

## Problem

Two gaps in the launcher (home / `index.html` + `js/hub.js`):

1. **No account-level Settings.** The Overleaf Git token is account-scoped (one token works across all your
   Overleaf projects — confirmed vs Overleaf's docs) and tokens expire after 1 year, but today it's sealed
   **per-project** in each project's Edit sheet. There's no place to set an account-wide credential once.
2. **One workspace only.** The launcher shows a single flat shelf from one hub repo (`localStorage
   footnote:hub`). A user with several bodies of work (a PhD, consulting, side projects) can't see them as
   distinct groups; documents that live in different repos aren't organized.
3. **Storage wording is opaque.** New Project's "Keep it in my workspace" vs "Its own repos" doesn't explain
   the difference, and it overloads the word "workspace" (which we now want to mean a *grouping*, not a repo).

## Model (approved)

```
GitHub account
 └─ Workspaces        ← labels/collections the user defines (purely organizational)
     └─ Documents     ← each stored EITHER in a shared repo (<id>/ subfolder) OR its own repos
```

- **Workspace = an abstract label**, decoupled from where a document physically lives. A document belongs to
  exactly one workspace (default when unset). Docs in a workspace may be scattered across different repos —
  all under one GitHub account.
- **Storage axis is orthogonal and unchanged in the data model** — a document is `shared repo` (consolidated,
  `workspaceRepo/<id>/`) or `individual repo` (independent, dedicated repos). Only the *UI wording* changes.
- **Terminology fix (load-bearing):** the word "workspace" now means the **grouping**. The storage mode is
  renamed in the UI to **"Shared repo"** (was "Keep it in my workspace") vs **"Individual repo"** (was "Its own
  repos"), each with a plain-language `ⓘ`. Internal code identifiers for the storage mode (`project.workspace`
  boolean, `workspaceRepo`, `resolveProject`) stay as-is for data compatibility — only display strings change.

## Data model

- **Per-document label:** add **`workspaceLabel: "<name>"`** to each entry in the registry `projects.json`
  (the hub repo's project list — already the account-wide index of every doc, shared or independent).
  Absent/empty = the **default workspace**. **CRITICAL:** this is a NEW, distinct field — it must NOT reuse
  the existing `project.workspace` **boolean** (the storage-mode flag read by `projectStorage`/`resolveProject`/
  the migrator, `true`=shared repo / `false`=individual). Overloading `workspace` would crash grouping on
  legacy `workspace:true` docs and silently repoint a doc's data repo/prefix (comment data corruption). The
  grouping label and the storage boolean are orthogonal and live in separate fields.
- **Account config file** `account.json` in the registry repo:
  ```json
  {
    "workspaces": ["PhD Dissertation", "Consulting"],   // display order; the default workspace is implicit
    "defaultWorkspace": "My documents",                  // label for unlabeled docs (seeded from the hub name)
    "overleaf": { "sealedRepos": ["mattlmccoy/footnote-projects"], "setAt": "2026-07-14" }
  }
  ```
  `overleaf.sealedRepos` tracks which repos the account Overleaf token was sealed into (so Settings can show
  status + re-seal when a new Overleaf-linked repo appears); the token itself is never stored here — it is a
  sealed Actions secret (`OVERLEAF_TOKEN`) in each of those repos.
- **Backward-compatible:** existing users have no `workspace` labels and no `account.json` → the launcher
  renders exactly today's flat shelf under one default workspace. `account.json` is created lazily on first
  use of a workspace/Settings feature.

## Surfaces

### 1. Home shelf grouped by workspace (`js/hub.js`)
- Documents grouped under workspace headers, **only when there is more than one workspace**; with one
  workspace it is byte-for-byte today's flat shelf (no grouping chrome). Each group: name + doc count + a
  `⋯` (rename / delete-group / etc.); a `＋ New document` in each; a `＋ New workspace` at the bottom.
- **Book cards gain small badges:** `◧ shared repo` vs `◇ individual repo` (from the existing `projectStorage`
  descriptor) and `🔗 Overleaf` when the doc is Overleaf-linked. Everything else on the card is unchanged.
- **Move a document between workspaces** from the card's `⋯` (writes the `workspace` label via the existing
  `writeProjectPatch`).

### 2. Settings page (new, launcher-level; opened by a `⚙` in the top bar)
- **GitHub access** — surfaces the existing owner key (`ghpat`) status (read-only display + change link).
- **Overleaf (account-wide)** — one input for the Overleaf Git token + "Seal for my workspaces": seals
  `OVERLEAF_TOKEN` into every registry/shared repo that holds an Overleaf-linked doc (reuses `ghsecrets`
  `getPublicKey`/`putSecret` + `vendor/seal.js`), records them in `account.json.overleaf.sealedRepos`. Shows
  the **1-year-expiry reminder** and a "re-seal" affordance. Never displays the token.
- **Workspaces** — list with rename / reorder / create / delete (delete reassigns its docs to the default).
- Deliberately account-level; the per-project Overleaf link (project id + Pull) stays on the project Edit
  sheet (the token just no longer has to be pasted there — it's already sealed account-wide).

### 3. New document sheet (`js/hub.js`)
- A **Workspace ▾ picker** at the top (which group this doc joins; defaults to the current/most-recent group).
- The storage segmented control relabeled **◧ Shared repo** / **◇ Individual repo**, each with an `ⓘ` that
  reveals plain-language copy:
  - *Shared repo* — "Lives as a folder inside one repo alongside your other documents. Fewer repos to manage;
    best when you have several papers."
  - *Individual repo* — "Gets its own dedicated GitHub repos, fully self-contained. Pick this to keep a
    document separate, or when it's already its own Overleaf/GitHub project." (no em-dash in the product copy)

## Components (small, testable units)

New pure modules (no I/O; `node --test`):
- `js/workspaces.js` — `groupByWorkspace(projects, accountCfg)` → ordered `[{name, docs}]` (default-workspace
  handling, single-workspace = one implicit group / flat); `workspaceNames(projects, accountCfg)`;
  `moveDocPatch(name)` → the projects.json patch; `defaultWorkspaceName(cfg, hubRepo)`.
- `js/account.js` — `normalizeAccount(raw)` / `withWorkspace(cfg, name)` / `overleafSealTargets(projects,
  accountCfg)` (which repos need the token) / `overleafExpiryDue(setAt, now)`.
- `js/storagecopy.js` (or extend `js/repoexplainer.js`) — the two `ⓘ` strings + labels, single source of truth.

Wiring (DOM, browser-gated): `js/hub.js` grouped render + Settings page + New Project picker/labels; reuse
`config.writeProjectPatch`, `ghsecrets`, `vendor/seal.js`, `projectStorage`. `advisor.js` untouched (AI-clean;
none of this is reviewer-facing).

## Testing

- **TDD red-green (pure):** `groupByWorkspace` (0/1/many workspaces, default bucket, order), `moveDocPatch`,
  `overleafSealTargets`, `overleafExpiryDue`, `normalizeAccount`, storage-copy strings.
- **Browser gate (DOM, stated):** single-workspace renders today's flat shelf (no grouping chrome); two
  workspaces render grouped; Settings seals a token (stub) into the right repos; New Project writes the
  `workspace` label + `ⓘ` reveals copy; move-between-workspaces patches projects.json. `advisor.js` re-grep
  AI-clean.

## Backward-compatibility / migration
No migration job. Absent `workspace` labels + absent `account.json` ⇒ one default workspace ⇒ current flat
shelf. The default workspace name is seeded from the hub repo (or "My documents"). Users opt in by creating a
second workspace; nothing breaks for anyone who never does.

## Non-goals (YAGNI)
- No cross-account / shared-with-others workspaces. No nested workspaces. No per-workspace permissions.
- No change to how documents render, get reviewed, or round-trip. No change to the storage data model (only
  UI wording + a label field). The reviewer portal is untouched.

## Constraints honored
Document-agnostic; adopter-owned credentials (the account Overleaf token is the user's own, sealed into their
own repos); `advisor.js` stays AI-clean & untouched; deterministic/AI-off paths unaffected; work on a branch
off `origin/main`; per-file `?v=` cache-bust handled on rebase; TDD for the pure core, stated browser gate for DOM.
