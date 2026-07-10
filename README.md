# Footnote

**Google Docs for native-LaTeX writing and reviewing.** Point Footnote at your own LaTeX source repo and
a private data repo, invite reviewers, and get a clean reading surface with click-to-comment, suggested
edits, per-reviewer release gating, threaded resolution with attribution, and export with comments — running
entirely on free GitHub infrastructure (Pages + Actions), no server, no AI required.

Footnote is a document-agnostic generalization of a dissertation-review portal. Everything instance-specific
lives in one file: **`footnote.config.json`**.

## Architecture (three repo roles + the app)
Footnote uses your repos in three roles. In the simple case (upload a `.tex`, or one workspace) they can be
**one physical repo** — the Review repo is also the workspace, and the source lives inside it.
- **Source repo** — the source of truth: your real LaTeX (often Overleaf-linked). Footnote only ever writes
  a `review-edits/<unit>` branch here on approval; `main` is never touched by the tool.
- **Review repo** — the working copy: comments, staged edits, the rendered reading view (HTML), the job
  queue, and release/advisor state. An effective mirror of the source you review against. (This is the repo
  older docs called the "data repo".)
- **Workspace repo** — optional: one private repo that houses several projects' Review repos together. For a
  single paper, the Review repo *is* the workspace.
- **App repo (this one, public):** the static site (GitHub Pages) + config + workflows. Fork via
  *Use this template*.

Credentials (user-facing names; the underlying secret/variable names never change):
- **Owner key** — your GitHub token; full control of your repos + Actions/Secrets. Needs Contents +
  Administration + **Secrets + Actions + Variables** + Workflows (Read and write), or a classic
  `repo` + `workflow` token. Missing Secrets/Actions/Variables breaks AI, email, model/budget, and apply.
- **Reviewer key** — Contents-only, Review-repo-only, no expiration; the `&k=` in every magic link
  (`ADVISOR_KEY`). Emailed to reviewers, so it must stay least-privilege — never an account PAT.
- **Source key** — `SOURCE_TOKEN`; only when the Source repo is a separate repo you point Footnote at.
- **Claude token** — `CLAUDE_CODE_OAUTH_TOKEN` (or an API key); only when the AI assistant is on.

## Setup (manual for now; a guided setup script is Phase 2)
1. **Use this template** → create your app repo. Enable GitHub Pages (Settings → Pages → deploy from `main`).
2. Create a **private data repo** (e.g. `my-review-data`).
3. Copy `footnote.config.example.json` → `footnote.config.json` and edit: `owner`, `dataRepo`, `doc`,
   `deadline`, `advisors`, and your `chapters` manifest (`{id, n, title, sourceFile}`).
4. Run `node scripts/gen-shells.mjs` to generate the per-reviewer shells (`<id>.html`, `review-lab.html`)
   from `config.advisors`. Commit them.
5. Add the reviewer content to your data repo under `content/<id>.html` (Phase 3 automates this from your
   `.tex` via CI).
6. To enable advisor email invites, set the Actions **secrets** (`SMTP_USER`, `SMTP_PASS`, `SMTP_HOST`,
   `SMTP_PORT`, `SMTP_FROM`, `ADVISOR_KEY`) and **variables** (`AUTHOR_NAME`, `PORTAL_BASE`) on your data
   repo. The in-app *Connect email* wizard can do this for you (owner portal → Reviewers).

## `footnote.config.json`
Read by both the browser (`js/config.js`) and the CI (Python). Required: `owner`, `dataRepo`, `chapters`.
See `footnote.config.example.json` for every key and its default. `doc.noun`/`doc.unitNoun` drive all
user-facing copy ("thesis"/"section", "paper"/"part", …). `reviewAgents` is empty by default — the
"Run review agents" AI shortcut only appears if you populate it (Footnote's core is AI-free).

## Take reviewer feedback back to Overleaf
Most authors write in Overleaf. The owner portal's **Take to Overleaf** button turns every open
comment into a worklist grouped by source `.tex` file — each item gives a search string to find the
spot in Overleaf, the reviewer's comment, and (for suggested edits) a literal before→after. Copy it
all as Markdown, download a `.md` checklist, or print it; tick items off as you clear them. The
quoted text is the locator, so it works with zero setup (no SyncTeX required).

## Walkthrough
An animated, self-contained product tour of the full workflow (read → comment → live-on-owner-side →
resolve → what-changed → direct edit → back-to-Overleaf worklist) lives at **[`tutorials/walkthrough.html`](tutorials/walkthrough.html)** —
autoplays with play/pause/replay and jump-to-scene dots. No dependencies; open it directly.

## Setup guide
A self-paced, click-through guide for wiring **Overleaf + GitHub + Footnote** together (token → connect →
workspace → get your `.tex` into GitHub → first project → invite → review loop) lives at
**[`tutorials/setup.html`](tutorials/setup.html)**. It covers both the premium Overleaf GitHub-sync path and
the free fallbacks, with copyable links/commands. Linked from the onboarding **Connect** step so users find
it as soon as they open their account.

## Development
```
npm test        # node --test tests/*.test.mjs  (unit tests)
python3 -m http.server 8199   # then open http://localhost:8199/owner.html
```
The advisor bundle (`advisor.html`, `js/advisor.js`, generated reviewer shells) is **assistant-free by
construction** — grep-clean of assistant references, so external reviewers never see AI wording.

## Security
- The **Reviewer key** (`ADVISOR_KEY`, the `&k=` in the magic link) is emailed to reviewers, so scope it to
  **only** your Review repo, **Contents: Read and write** — never an account PAT or a classic token.
- The **Owner key** is broader by necessity (it seals secrets and dispatches Actions). Keep it in your
  browser only; you can revoke it on GitHub at any time. Do not paste it where the Reviewer key belongs.
- **⚠️ If you migrated from the original dissertation-hub:** rotate any `ADVISOR_KEY` that was a broad
  account PAT to a Review-repo-only fine-grained token.

## Status
v1 (in progress): config extraction / de-branding, onboarding, generic export CI. v1.1: in-app direct
editor (cloud apply/merge). See `docs/superpowers/footnote/` in the planning repo for the roadmap +
655-feature parity contract.
