# Phase 2 — data-repo seeding (onboarding)

When a project's **comments (data) repo** is created, seed it so the per-user background Actions work.
Everything runs on the user's OWN GitHub (their token, their Actions minutes). The app fetches the
committed `data-template/` files (served by Pages) and PUTs them into the user's data repo.

## Constraint discovered
GitHub Pages does NOT serve `.github/`. So template workflows live at `data-template/workflows/*.yml`
(servable) and the seeder writes them to `.github/workflows/` in the target repo.

## What gets seeded (manifest)
Fetched from `data-template/` and PUT into the user's data repo:
- `ci_invite.py`, `ci_notify_common.py`, `ci_notify_author.py`, `ci_notify_advisors.py` → repo root
- `workflows/invite.yml` → `.github/workflows/invite.yml`
- `workflows/notify.yml` → `.github/workflows/notify.yml`
- `workflows/release-notify.yml` → `.github/workflows/release-notify.yml`

Created fresh (not fetched) — initial state:
- `advisors.json` = `{ "advisors": [], "email_configured": false }`
- `release.json` = `{ "_comment": "per-reviewer chapter gate" }`
- `notify_config.json` = `{ "author_email": "" }`
- `notify_state.json` = `{}`

## Not seeded here
- **Actions variables** `AUTHOR_NAME` / `PORTAL_BASE` and **SMTP secrets** — set by the existing
  connect-email wizard (needs the elevated Secrets/Actions token), owner portal → Reviewers.
- **Export/content CI** (build the reading HTML) — Phase 3, needs Matt's copied-out `export/*` scripts.

## Build
- `js/seed.js` (pure `SEED_FILES` + `seedJsonFiles(cfg)`; I/O `seedDataRepo(dataRepo, token, fetchImpl)`).
- Wire into New Project: after `createRepo(dataRepo)` → `seedDataRepo(dataRepo, token)`.
- TDD the pure manifest; E2E (real repo) verified by Matt (creating repos is a side effect).

## Verify
Manifest test (workflows map to `.github/workflows/`, seed JSON shapes); `seedDataRepo` PUTs each file;
after seeding a real data repo, its Actions tab shows invite/notify workflows and a test invite sends.
