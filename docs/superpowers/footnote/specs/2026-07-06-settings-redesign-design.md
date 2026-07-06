# Footnote — Settings Redesign (Project A)

**Date:** 2026-07-06
**Branch:** `feat/settings-redesign`
**Status:** Design approved (visual companion), pending written-spec review → implementation plan

## Problem

All owner configuration lives crammed at the bottom of the **Reviewers** page (`openReleasePanel`, `js/app.js`). It mixes six unrelated concerns in one long scroll, and the config block is a wall of instructional text — the "hideous, ton of text, eyesore" the owner called out. The code itself already flags the intent: *"Email, notifications, and access — … (Will move to its own page.)"*

The densest offenders:
- **Claude/AI setup** (`aiSettingHtml`): connection-status line + a 3-step guide + two credential fields + a source-token explainer paragraph + an API-key `<details>` + the agent-list field + a "Run apply now" row + a staging note. ~15+ lines of prose visible at once.
- **Email/invites** (`renderEmailBanner` + the notify row): a "notify me" digest row tangled together with the reviewer-invite SMTP server config, whose "Set it up manually" guide is a multi-paragraph SMTP tutorial (Gmail / institutional / transactional + `gh secret set` snippets).

With the **Agent Network** (Project B) about to add a catalog, an agent-authoring surface, and a local-runner control, this page cannot absorb more. Settings needs its own home.

## Goals

1. Move **all configuration** off the Reviewers page into a dedicated **Settings page**, reachable as a first-class destination — without losing a single existing function or piece of information.
2. Replace walls of text with **progressive disclosure**: each concern is a calm **status card** at rest; dense setup happens in a focused **dialog**.
3. Leave clean seams for Project B to add **Agents**, **Agent authoring**, and **Local runner** as Settings sections later.
4. Keep Footnote's product stance intact: **not AI-forward**. AI/Claude stays off by default and hidden until enabled; the deterministic comment → stage → approve → merge flow works with AI off. `advisor.js` (reviewer surface) never references AI.

## Non-goals

- No change to the reviewer/advisor portal or `advisor.js`.
- No change to the deterministic review engine, the apply/merge backend, or the CI.
- Not building the Agents sections themselves (that's Project B) — only reserving their place in the left-nav and moving the *existing* bare-name agent-list field into the AI section for now.

## Approved design decisions (from visual companion)

| Decision | Choice |
|---|---|
| App navigation | **A** — keep the topbar; add a **gear** icon that opens a dedicated Settings page. Settings is NOT a tenant of Reviewers. |
| Settings internal structure | **C** — left-nav: a vertical section list on the left, detail pane on the right. |
| Claude/AI section | **B** — the section is a **status card**; all setup happens in a focused **"Connect Claude" dialog**. |
| Email & notifications | **A layout + C dialog** — two separate rows ("Notify me" digest; "Invite email" status card), and the "Connect email" dialog leads with a **provider picker** (Gmail / Outlook / Other) showing only that provider's steps + prefilled host/port. |

## Architecture

### Navigation shell
- Add a **gear button** (`btn-settings`, `ti-settings`) to both topbars:
  - chapter/reading topbar (`renderTopbar`, ~app.js:231 group), and
  - home topbar (`enterHome`, ~app.js:1843 group, next to `btn-releases`).
- Gear → `openSettingsPage()` — a new in-place view that mirrors how `openReleasePanel` swaps `#topbar` + `#read` (hide `#nav`/`#comments`, set a "Settings" topbar with a "Back" button, render the page into `#read`). No new route/file; same SPA-panel pattern already used for Reviewers.
- The `⋯` More-menu "AI assistant … in Settings" entry and any `⋯ → Settings` references now point at `openSettingsPage()` (deep-linking to a section via an argument, e.g. `openSettingsPage('ai')`), replacing today's "open Reviewers then scrollIntoView" hack.

### Settings page (left-nav, C)
Left column = section list; right column = active section's detail pane. Sections at ship:
1. **Claude / AI** — status card + Connect dialog (§ below).
2. **Agents** — placeholder now (moves the existing `reviewAgents` list field here from the AI block); Project B fills it in. Shown only when AI is on.
3. **Email & notifications** — two rows (§ below).
4. **Access token** — the browser PAT (`manageToken`) as a section instead of a `⋯` menu item: status ("connected"/"not set") + set/replace/remove.

Each left-nav item shows a **state glyph**: `✓` configured, `●` needs attention, none = optional/empty. This is the at-a-glance overview that replaces reading the whole page.

Section visibility respects the product stance: **Claude/AI** always shows (with its OFF state); **Agents** appears only when AI is enabled.

### Section pattern: status card + dialog
Every section renders a **status card** (one line + a verb link) at rest. Setup/edit opens a **dialog** (reuse the app's existing modal/overlay convention — the Overleaf panel `ovl-panel` and the existing `openConnectForm` show the pattern). The dialog owns the dense fields and instructions; the page stays calm.

#### Claude / AI section (decision B)
- **OFF (default):** card with the master toggle + one honest line ("Off by default. The core review flow works without AI."). Unchanged copy from today's header, minus the setup body.
- **ON, not connected:** amber status ("Not connected") + primary **"Connect Claude"** button → dialog.
- **ON, connected:** green one-liner — "Claude connected · via `CLAUDE_CODE_OAUTH_TOKEN`" + "Manage ▸". Driven by the existing pure `claudeConnectionStatus(listSecretNames(...))` — no new probe.
- **Connect Claude dialog** contains today's setup, reorganized: (1) the primary path — paste the `claude setup-token` value (→ `CLAUDE_CODE_OAUTH_TOKEN`); (2) an **Advanced** disclosure — Anthropic API key fallback (→ `ANTHROPIC_API_KEY`). **Save** seals via the existing `setAiSecrets` + self-heals the engine via `ensureApplyEngine` (unchanged logic, just relocated). The connection-status refresh + "Run apply now" live in the section (status area), not buried.
- **Moved OUT of this section:** the **source-repo token** field (it's about where the document's source lives, not Claude) → relocated to the **Access** section as "Source repo token (only for external source)", keeping its existing PAT how-to. The **agent list** field → **Agents** section.

#### Email & notifications section (decision A+C)
- **Row 1 — "Notify me":** the digest email + frequency (`notify-email`, `notify-freq`, `notify-save`) exactly as today, presented as its own labeled row.
- **Row 2 — "Invite email":** a status card — green "Invite email set up · Change ▸" (when `advReg.email_configured === true`) or amber "Not set up · Connect email ▸". "Connect email" opens the dialog.
- **Connect email dialog (C):** leads with a **provider picker** — Gmail / Outlook / Other SMTP — backed by the existing `PROVIDERS` table + `detectProvider()` in `ghsecrets.js`. Selecting a provider shows only that provider's steps + its prefilled `host`/`port` and app-password deep-link (`keyUrl`), plus the fields. "Set up manually" (the full `gh secret set …` guide) becomes a secondary disclosure inside the dialog, not the page. Reuses `openConnectForm`/`openTestSend` where possible.

## No-function-loss mapping (audit)

Every current element gets a home. Nothing is dropped.

| Today (Reviewers page) | New home |
|---|---|
| AI master toggle + "off by default" copy | Settings → Claude/AI (card) |
| Connection-status line | Settings → Claude/AI (status) |
| 3-step setup prose | Connect Claude dialog |
| Claude Code token field | Connect Claude dialog (primary) |
| Anthropic API key `<details>` | Connect Claude dialog → Advanced |
| Source-repo token field + PAT how-to | Settings → **Access** |
| Review-agents list field | Settings → **Agents** |
| "Run apply now" + status | Settings → Claude/AI (status area) |
| "edits stage on review-edits/…" note | Settings → Claude/AI (card footnote) |
| Notify-me email + frequency | Settings → Email (Row 1) |
| Invite-email banner (set up / not) | Settings → Email (Row 2 status) |
| Manual SMTP guide + `gh secret set` | Connect email dialog → "Set up manually" |
| Access token (`⋯` menu) | Settings → **Access** |
| Reviewer roster / gating / portal links / inbox | **Stays on Reviewers page** (untouched) |

## Testing (TDD)

Most of this is DOM/layout (not unit-testable) — those get a **browser-verification gate** (preview server + click-through of every state), stated explicitly rather than skipped. The genuinely testable logic is pure and gets red-green tests first:

- **`settingsSections(cfg, {claudeConnected, emailConfigured, hasToken})` → ordered section descriptors** with `{id, label, glyph}` — the left-nav model + visibility rules (Agents hidden when AI off; glyph = ✓/●/none per section). Pure; `node --test`.
- **`claudeConnectionStatus`** (exists) — reused as-is; add a test if missing for the "connected line" mapping.
- **`detectProvider` / `PROVIDERS`** (exist, tested) — reused by the provider picker.
- **Deep-link routing:** `openSettingsPage(section)` selects the right section — extract the pure "which section id is valid/active" resolver and test it.
- No backend/CI changes → no Python test changes expected.

Browser-verified states (gate, enumerated): AI off; AI on/not-connected; AI on/connected; Connect Claude dialog (primary + Advanced); Email both rows; Connect email dialog per provider (Gmail/Outlook/Other) + manual disclosure; Access set/unset; deep-link from `⋯` menu; back-to-document.

## Constraints (carried from the project)

- **Document-agnostic**; no dissertation/RFAM specifics.
- **`advisor.js` stays AI-clean**: `grep -aiE "claude|anthropic|\bAI\b|\bagent\b|gpt|llm|copilot" js/advisor.js` returns nothing after changes.
- **Adopter-owned credentials**; never hardcode personal repos/tokens.
- **TDD red-green** for pure logic; browser gate for DOM.
- Do not touch the manual dissertation systems (phd-dissertation, dissertation-tracker*).
- Cache-bust bot bumps `?v=<sha>` on JS imports; expect/resolve those in rebases. `app.js` has emoji/binary — use `grep -a`.

## Open questions

1. **Access section — remove the `⋯ → Access token` menu item** once it's a Settings section, or keep both entries? (Proposed: keep the `⋯` item as a deep-link to Settings→Access, remove the inline `prompt()` flow.)
2. **Agents section when AI is off** — hide entirely (proposed) or show disabled with "enable AI to configure agents"?
3. **Dialog mechanism** — reuse the existing overlay/panel styling (`ovl-panel`) for the two new dialogs, or introduce a small shared `modal()` helper? (Proposed: shared helper, since B's agent-authoring will want modals too.)
4. **Reviewers page** — after Settings moves out, do we also lightly reorganize what remains (roster/gating/inbox), or leave it exactly as-is this pass? (Proposed: leave as-is; scope creep otherwise.)
