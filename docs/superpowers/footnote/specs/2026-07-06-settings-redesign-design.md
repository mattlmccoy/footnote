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
- The `⋯` More-menu entries become **deep-links into Settings** (decision Q1): "AI assistant … in Settings" → `openSettingsPage('ai')` (replacing today's "open Reviewers then scrollIntoView" hack); the **"Access token"** item → `openSettingsPage('access')`, and its inline `prompt()` flow (`manageToken`) is **removed** — token management lives only in the Access section now. `openSettingsPage(section)` takes an optional section id for deep-linking.

### Settings page (left-nav, C)
Left column = section list; right column = active section's detail pane. Sections at ship:
1. **Email & notifications** — two rows (§ below). Always shown; leads the list (non-AI, everyone uses it).
2. **Access token** — the browser PAT (`manageToken`) as a section: status ("connected"/"not set") + set/replace/remove. Always shown. Also home of the source-repo token.
3. **Agents** — moves the existing `reviewAgents` list field here from the AI block; Project B fills it in. **Shown only when AI is enabled.**
4. **Claude / AI** — status card + Connect dialog (§ below). Holds the AI master switch. **Understated when off** (see stance below).

Each left-nav item shows a **state glyph**: `✓` configured, `●` needs attention, none = optional/empty. This is the at-a-glance overview that replaces reading the whole page.

**Product-stance visibility (decision Q2 — "the switch must exist but not too obviously"):** Footnote is not AI-forward.
- The **Agents** section is **hidden entirely** while AI is off.
- The **Claude / AI** section stays present (the master switch must always be reachable) but **understated when off**: placed **last** in the left-nav, muted label (no glyph, `--text-3`), and its detail pane is just the one-line "off by default" card + the toggle — no setup, no color, nothing that markets AI. Turning it **on** promotes it (normal weight) and reveals the Agents section above it. This keeps the switch discoverable for those who want it, invisible-ish for those who don't.

### Section pattern: status card + dialog
Every section renders a **status card** (one line + a verb link) at rest. Setup/edit opens a **dialog**. Per decision Q3, introduce a small **shared `modal(title, contentEl, {actions})` helper** (open/close, overlay, ESC/click-out, focus) rather than hand-rolling each dialog — the Connect-Claude and Connect-email dialogs both use it, and Project B's agent-authoring will reuse it. It generalizes the existing `ovl-panel`/`openConnectForm` overlay convention into one tested primitive.

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

### Reviewers page cleanup (decision Q4)
After Settings moves out, lightly reorganize what remains on the Reviewers page (`openReleasePanel`) so it reads as one coherent job — managing reviewers — instead of a leftover scroll. Keep every function; only regroup and de-noise:
- **Group into three clear blocks** with headers: **People** (add-reviewer form + roster), **Access** (the "which units each reviewer can see" gating table + release-responses toggle + portal links), **Inbox** (comments received, per reviewer).
- Remove the now-orphaned `Settings` header + its email/AI/notify block entirely (it lives in the Settings page).
- No behavior/data changes to roster, gating, invites, or inbox — this is regrouping + heading/spacing only. Bounded to avoid scope creep; if a sub-item needs real rework it's flagged, not silently expanded.

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

- **`settingsSections(cfg, {aiOn, claudeConnected, emailConfigured, hasToken})` → ordered section descriptors** with `{id, label, glyph, muted}` — the left-nav model + visibility rules: order = Email, Access, [Agents only when `aiOn`], Claude-last; Claude `muted:true` when `!aiOn`; glyph = ✓/●/none per section. Pure; `node --test`.
- **`modal()` helper** — the open/close/stack/ESC state is testable at the logic level (which element is active, close resolves). DOM wiring browser-gated.
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

## Resolved decisions (owner)

1. **Access token** — keep the `⋯` menu item as a **deep-link** into Settings → Access; **remove** the inline `prompt()` (`manageToken`) flow. Token management lives only in the Access section.
2. **Agents section when AI is off** — **hidden entirely**. The AI master switch still exists but is **understated**: the Claude/AI section sits last, muted, off by default (see Product-stance visibility above).
3. **Dialog mechanism** — **add a shared `modal()` helper**; both new dialogs (and Project B's agent authoring) use it.
4. **Reviewers page** — **reorganize** the leftovers into People / Access / Inbox blocks (regrouping + headings only, no behavior change). See "Reviewers page cleanup" above.
