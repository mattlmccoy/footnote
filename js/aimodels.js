// js/aimodels.js — the future-proof Claude model registry for the CLOUD review runs.
//
// The values are Claude Code CLI `--model` ALIASES (opus / sonnet / haiku). The CLI resolves each alias
// to the LATEST model of that tier, so the selector options AND the engine's `--model` calls stay current
// as Anthropic ships new models — with zero code change here. A pinned full id (e.g. 'claude-opus-4-8')
// also works as a `--model` value for anyone who wants to lock a specific version.
//
// This mirrors the Python resolver in ci_review_common.resolve_agent_model (same aliases, same default).
// Pure module (no DOM) — unit-tested in tests/aimodels.test.mjs.

export const MODELS = [
  { value: 'opus',   label: 'Opus — most capable',           tier: 'opus',   blurb: 'Best quality. Recommended for a dissertation or anything intensive.' },
  { value: 'sonnet', label: 'Sonnet — balanced, lower cost', tier: 'sonnet', blurb: 'Strong and cheaper. A good override for lighter, high-volume agents.' },
  { value: 'haiku',  label: 'Haiku — fastest, cheapest',     tier: 'haiku',  blurb: 'Fastest and cheapest. Best for simple, mechanical checks.' },
];

// The global default: the best general tier. Everything (writer + every agent) runs on this unless a
// specific agent is overridden. This is the "use Opus for everything" default.
export const DEFAULT_MODEL = 'opus';

// Per-agent sentinel meaning "inherit the global default" — distinct from any real model value.
export const INHERIT = 'default';

// Resolve one preference against the global default. Empty / INHERIT → the global default; anything else
// (an alias or a pinned claude-* id) passes through unchanged.
export function resolveModel(pref, globalDefault = DEFAULT_MODEL) {
  const p = String(pref == null ? '' : pref).trim();
  const g = String(globalDefault == null ? '' : globalDefault).trim() || DEFAULT_MODEL;
  if (!p || p === INHERIT) return g;
  return p;
}

// A value is a usable --model if it is a known alias or any pinned claude-* id.
export function isKnownModel(v) {
  const s = String(v == null ? '' : v).trim();
  return MODELS.some(m => m.value === s) || /^claude-/.test(s);
}

// Human label for a value: the registry label for an alias, else the raw value (pinned id shown as-is).
export function modelLabel(v) {
  const m = MODELS.find(x => x.value === v);
  return m ? m.label : String(v == null ? '' : v);
}
