// js/settings.js
// Pure model for the Settings page left-nav (Project A). No DOM, no app state — the view in app.js
// maps glyph ('ok'|'warn'|null) to a ✓/●/none marker and renders the muted flag. Footnote is not
// AI-forward: the AI section is present but understated (last, muted, soft label, no glyph) while AI
// is off, and the Agents section is hidden entirely until AI is on.
export function settingsSections(cfg, state) {
  const agents = (cfg && cfg.reviewAgents) || [];
  const secs = [
    { id: 'document', label: 'Document',            glyph: state.hasTitle ? 'ok' : null,          muted: false },
    { id: 'email',  label: 'Email & notifications', glyph: state.emailConfigured ? 'ok' : 'warn', muted: false },
    { id: 'access', label: 'Access & tokens',        glyph: state.hasToken ? 'ok' : 'warn',        muted: false },
    { id: 'appearance', label: 'Appearance',         glyph: null,                                   muted: false },
  ];
  if (state.aiOn) {
    secs.push({ id: 'agents', label: 'Agents', glyph: agents.length ? 'ok' : null, muted: false });
  }
  secs.push(state.aiOn
    ? { id: 'ai', label: 'Claude / AI',  glyph: state.claudeConnected ? 'ok' : 'warn', muted: false }
    : { id: 'ai', label: 'AI assistant', glyph: null,                                  muted: true  });
  return secs;
}

// The active section id: honor a valid deep-link request, else the first (visible) section.
export function resolveSection(sections, requested) {
  const ids = sections.map(s => s.id);
  return requested && ids.includes(requested) ? requested : ids[0];
}
