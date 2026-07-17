# Accent color picker (Apple-style, per-viewer)

**Status:** DESIGN (approved 2026-07-08). Branch `feat/accent-color`.

## Goal
Let each viewer choose their UI accent color from a fixed, Apple-style palette (like macOS System Settings → Appearance → Color). The whole UI already flows from two CSS variables (`--accent`, `--accent-bg`); the picker recolors them. Per-viewer, stored in `localStorage` (like the light/dark toggle), on BOTH the owner portal and the reviewer portal.

## Decisions (locked)
- **Accent only** (no separate comment-highlight color; highlights follow the accent).
- **Owner + reviewers** — the same picker on both portals; each person's choice is local to their browser.
- **Fixed palette** — `Default` (follows the instance brand color) + Blue, Purple, Pink, Red, Orange, Yellow, Green, Graphite. No custom color.

## How theming works today (unchanged mechanism)
- `css/reader.css`: `:root{ --accent:#2c64c4; --accent-bg:#eaf1fb }` and `.dark{ --accent:#6aa0ec; --accent-bg:#1b2c44 }`.
- Dark mode = `document.documentElement.classList.toggle('dark')`, persisted as `localStorage.theme`.
- `js/hub.js` sets `--accent` INLINE to `cfg.brand.accent` at boot (the instance default).

## Design
A shared module `js/accent.js`, imported by both boots (`hub.js` owner, `advisor.js` reviewer).

### Palette + CSS (class-based, so the cascade handles light/dark)
Each named accent has tuned light AND dark `{accent, bg}` values. `accentPaletteCss()` emits, per named accent:
```
:root.ac-<id>{--accent:<light.accent>!important;--accent-bg:<light.bg>!important}
.dark.ac-<id>{--accent:<dark.accent>!important;--accent-bg:<dark.bg>!important}
```
`!important` beats `hub.js`'s inline `--accent` (the brand default). Injected once as `<style id="accent-palette">` by `ensurePaletteStyle(document)`.

Picking an accent just sets an `ac-<id>` class on `<html>`; **light/dark is automatic** via the `.dark.ac-<id>` rule, so nothing re-applies on theme toggle. `Default` = no `ac-*` class → the brand blue (hub.js inline) stands.

### Module API (`js/accent.js`)
- `ACCENTS` — ordered list `[{id, name, light:{accent,bg}, dark:{accent,bg}}]`; `default` has no colors (sentinel).
- `accentPaletteCss()` → the palette stylesheet string. **Pure, tested.**
- `swatchesHtml(selectedId)` → the picker row (buttons, `Default` = conic-gradient "multicolor", selected ring). **Pure, tested.**
- `nextAccentClassName(currentClassName, id)` → className with any `ac-*` removed and `ac-<id>` added for a valid named id (default/unknown → none). **Pure, tested.**
- `storedAccent(storage)` / `saveAccent(storage, id)` → read/write `localStorage.accent` (bare key, like `theme`). **Pure (injected storage), tested.**
- `ensurePaletteStyle(doc)` / `applyAccent(id, doc)` — DOM: inject the style once; set the class via `nextAccentClassName`. Browser-verified.

### Boot wiring
- `hub.js`: after theme + brand are applied, `ensurePaletteStyle(document); applyAccent(storedAccent(localStorage), document)`.
- `advisor.js`: same, right after the existing `theme` class line at boot.

### Picker placement
- Owner **Settings → Appearance** section: `swatchesHtml(current)`; a click → `applyAccent(id) + saveAccent(localStorage, id)`.
- Reviewer portal: the same swatch row in its settings/menu surface.

## Palette values (light / dark, accent + tint)
| id | light accent | light tint | dark accent | dark tint |
|---|---|---|---|---|
| blue | #2c64c4 | #eaf1fb | #6aa0ec | #1b2c44 |
| purple | #7c4ddb | #efeafb | #b291f2 | #241d3a |
| pink | #d23c7e | #fbe8f0 | #ef83b1 | #361b28 |
| red | #cf3b34 | #fbe7e6 | #ee8a84 | #371c1a |
| orange | #cf7518 | #fbeee0 | #ef9f4d | #33260f |
| yellow | #a9800a | #f7f0d8 | #e0bd48 | #2f280f |
| green | #3f9142 | #e7f4e7 | #71c274 | #182f19 |
| graphite | #71717a | #eef0f2 | #a1a1aa | #26282c |

(`yellow` is a deep gold so white button text stays legible; `default` carries no colors.)

## Testability (TDD)
Pure/unit-tested (node): `accentPaletteCss` (contains every named id + light/dark rules + !important), `swatchesHtml` (a swatch per accent, selected ring on the chosen id, escaped), `nextAccentClassName` (strips old `ac-*`, adds valid, ignores default/unknown, preserves other classes like `dark`), `storedAccent`/`saveAccent` (round-trip via a fake storage; default when unset). DOM apply + boot wiring + picker placement: browser-verified.

## Out of scope
- Custom/arbitrary color, per-project (config) accent override, separate comment-highlight color, syncing the choice across devices.
