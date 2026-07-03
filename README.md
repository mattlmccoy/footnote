# Footnote

**Google Docs for native-LaTeX writing and reviewing.** Point Footnote at your own LaTeX source repo and
a private data repo, invite reviewers, and get a clean reading surface with click-to-comment, suggested
edits, per-reviewer release gating, threaded resolution with attribution, and export with comments — running
entirely on free GitHub infrastructure (Pages + Actions), no server, no AI required.

Footnote is a document-agnostic generalization of a dissertation-review portal. Everything instance-specific
lives in one file: **`footnote.config.json`**.

## Architecture (two repos + your source)
- **App repo (this one, public):** the static site (GitHub Pages) + config + workflows. Fork via
  *Use this template*.
- **Data repo (private, yours):** review comments, release/advisor state, prebuilt chapter HTML. Holds no
  code; the app reads/writes it with a fine-grained token scoped to *only* that repo.
- **Your LaTeX source repo:** stays entirely yours. Footnote never holds a credential for it except your own
  `SOURCE_TOKEN`, used only by the export/direct-edit CI (v1.1).

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

## Development
```
npm test        # node --test tests/*.test.mjs  (unit tests)
python3 -m http.server 8199   # then open http://localhost:8199/owner.html
```
The advisor bundle (`advisor.html`, `js/advisor.js`, generated reviewer shells) is **assistant-free by
construction** — grep-clean of assistant references, so external reviewers never see AI wording.

## Security
- Scope the data-repo token to **only** your data repo, **Contents: Read and write**. Never use an account
  PAT — the `ADVISOR_KEY` is emailed to reviewers, so it must be least-privilege.
- **⚠️ If you migrated from the original dissertation-hub:** rotate any `ADVISOR_KEY` that was a broad
  account PAT to a data-repo-only fine-grained token.

## Status
v1 (in progress): config extraction / de-branding, onboarding, generic export CI. v1.1: in-app direct
editor (cloud apply/merge). See `docs/superpowers/footnote/` in the planning repo for the roadmap +
655-feature parity contract.
