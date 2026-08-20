// Source-aware paragraph editing for the owner portal.
//
// Human prose is exposed as editable text spans. LaTeX commands, citations, cross-references,
// math, labels, units, formatting delimiters, and other structural characters are represented as
// immutable tokens. Serialization therefore changes only text the author typed; protected source is
// copied back byte-for-byte and in its original order.

const WRAPPERS = new Set([
  'emph', 'textbf', 'textit', 'textsc', 'textrm', 'textsf', 'texttt', 'underline',
]);

const REF_COMMANDS = new Set(['ref', 'pageref', 'eqref', 'cref', 'Cref', 'crefrange', 'Crefrange', 'autoref']);
const CITE_COMMANDS = new Set(['cite', 'citep', 'citet', 'parencite', 'textcite', 'autocite', 'footcite']);
const TERM_COMMANDS = new Set(['gls', 'Gls', 'glspl', 'Glspl', 'acrshort', 'acrlong', 'acrfull']);
const QUANTITY_COMMANDS = new Set(['SI', 'SIrange', 'num', 'qty', 'qtyrange', 'ang']);

// This dissertation also contains intentionally literal cross-references such as "section 3.1",
// "sections 3.1 and 3.3", and "equations (2) and (3)". They have no LaTeX command for the parser to
// recognize, but the reading view turns them into links. Treat the complete numbered phrase as one
// protected object so Author Edit Mode cannot silently break or renumber the link text.
const REF_NUMBER = String.raw`(?:\(\d+(?:\.\d+)*\)|\d+(?:\.\d+)*)`;
const REF_SEPARATOR = String.raw`(?:,\s*(?:(?:and|or)\s+)?|\s+(?:and|or|to|through)\s+|\s*(?:--|[–—-])\s*)`;
const TEXTUAL_REFERENCE = new RegExp(
  String.raw`^(?:sections?|chapters?|figures?|fig\.?|tables?|equations?|eqs?\.?)[\s~]+${REF_NUMBER}(?:${REF_SEPARATOR}${REF_NUMBER})*`,
  'i',
);
const TEXTUAL_APPENDIX_REFERENCE = /^(?:[Aa]ppendix|[Aa]ppendices)[\s~]+[A-Z](?:(?:,\s*(?:(?:and|or)\s+)?|\s+(?:and|or|to|through)\s+|\s*(?:--|[–—-])\s*)[A-Z])*/;

function balancedEnd(source, start, open, close) {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue; }
    if (source[i] === open) depth++;
    else if (source[i] === close && --depth === 0) return i + 1;
  }
  return source.length;
}

function mathEnd(source, start) {
  const doubled = source.slice(start, start + 2) === '$$';
  const mark = doubled ? '$$' : '$';
  for (let i = start + mark.length; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue; }
    if (source.slice(i, i + mark.length) === mark) return i + mark.length;
  }
  return source.length;
}

function commandInfo(raw) {
  const m = raw.match(/^\\([A-Za-z@]+)\*?/);
  const name = m ? m[1] : '';
  const args = [...raw.matchAll(/\{([^{}]*)\}/g)].map(x => x[1]);
  if (CITE_COMMANDS.has(name)) return { kind: 'citation', label: `cite: ${args[0] || 'source'}` };
  if (REF_COMMANDS.has(name)) return { kind: 'reference', label: `ref: ${args.join('–') || 'target'}` };
  if (TERM_COMMANDS.has(name)) return { kind: 'term', label: `term: ${args[0] || name}` };
  if (QUANTITY_COMMANDS.has(name)) return { kind: 'quantity', label: 'quantity' };
  if (name === 'label') return { kind: 'label', label: `label: ${args[0] || ''}` };
  if (name === 'footnote') return { kind: 'footnote', label: 'footnote' };
  if (name === 'includegraphics') return { kind: 'figure', label: 'figure' };
  return { kind: 'command', label: name ? `\\${name}` : 'LaTeX' };
}

function tokenLabel(raw, kindHint = '') {
  if (kindHint === 'math') return { kind: 'math', label: 'math' };
  if (kindHint === 'comment') return { kind: 'comment', label: 'comment' };
  if (kindHint === 'space') return { kind: 'space', label: 'fixed space' };
  if (kindHint === 'brace') return { kind: 'structure', label: raw === '}' ? 'end format' : 'group' };
  if (kindHint === 'wrapper') {
    const name = (raw.match(/^\\([A-Za-z@]+)/) || [,'format'])[1];
    return { kind: 'format', label: name.replace(/^text/, '') || 'format' };
  }
  if (kindHint === 'text-reference') return { kind: 'reference', label: raw.replace(/~/g, ' ').replace(/\s+/g, ' ').trim() };
  return commandInfo(raw);
}

export function parseAuthorSource(source = '') {
  const nodes = [];
  let tokenNo = 0;
  const text = raw => {
    if (!raw) return;
    nodes.push({ type: 'text', raw, display: raw.replace(/\s+/g, ' ') });
  };
  const token = (raw, hint = '') => {
    if (!raw) return;
    const meta = tokenLabel(raw, hint);
    nodes.push({ type: 'token', id: `t${tokenNo++}`, raw, ...meta });
  };

  let i = 0, start = 0;
  const flush = () => { text(source.slice(start, i)); };
  while (i < source.length) {
    const ch = source[i];
    if ((i === 0 || !/[A-Za-z]/.test(source[i - 1])) && /[A-Za-z]/.test(ch)) {
      const tail = source.slice(i);
      const ref = tail.match(TEXTUAL_REFERENCE) || tail.match(TEXTUAL_APPENDIX_REFERENCE);
      if (ref) {
        flush(); token(ref[0], 'text-reference'); i += ref[0].length; start = i; continue;
      }
    }
    if (ch === '%' && (i === 0 || source[i - 1] !== '\\')) {
      flush();
      const end = source.indexOf('\n', i);
      const j = end < 0 ? source.length : end;
      token(source.slice(i, j), 'comment'); i = j; start = i; continue;
    }
    if (ch === '$') {
      flush(); const j = mathEnd(source, i); token(source.slice(i, j), 'math'); i = j; start = i; continue;
    }
    if (ch === '\\') {
      flush();
      if (source[i + 1] === '(' || source[i + 1] === '[') {
        const close = source[i + 1] === '(' ? '\\)' : '\\]';
        const at = source.indexOf(close, i + 2);
        const j = at < 0 ? source.length : at + 2;
        token(source.slice(i, j), 'math'); i = j; start = i; continue;
      }
      const m = source.slice(i).match(/^\\([A-Za-z@]+)\*?/);
      if (!m) { token(source.slice(i, Math.min(source.length, i + 2))); i += 2; start = i; continue; }
      const name = m[1];
      let j = i + m[0].length;
      while (j < source.length && /[ \t]/.test(source[j])) j++;
      if (WRAPPERS.has(name) && source[j] === '{') {
        token(source.slice(i, j + 1), 'wrapper'); i = j + 1; start = i; continue;
      }
      // A command and all of its immediately-following []/{} arguments are one atomic object.
      while (j < source.length) {
        let probe = j;
        while (probe < source.length && /[ \t]/.test(source[probe])) probe++;
        if (source[probe] === '{') j = balancedEnd(source, probe, '{', '}');
        else if (source[probe] === '[') j = balancedEnd(source, probe, '[', ']');
        else break;
      }
      token(source.slice(i, j)); i = j; start = i; continue;
    }
    if (ch === '{' || ch === '}') {
      flush(); token(ch, 'brace'); i++; start = i; continue;
    }
    if (ch === '~') {
      flush(); token(ch, 'space'); i++; start = i; continue;
    }
    i++;
  }
  flush();
  return { source, nodes, tokenIds: nodes.filter(n => n.type === 'token').map(n => n.id) };
}

export function escapeLatexText(value = '') {
  return String(value)
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([%&#_$])/g, '\\$1')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}');
}

export function serializeAuthorSegments(model, segments) {
  const expected = model.tokenIds || [];
  const actual = (segments || []).filter(s => s.type === 'token').map(s => s.id);
  if (expected.length !== actual.length || expected.some((id, i) => id !== actual[i]))
    throw new Error('A protected LaTeX object was removed or moved. Restore it, then save again.');
  const byId = Object.fromEntries(model.nodes.filter(n => n.type === 'token').map(n => [n.id, n]));
  let textIndex = 0;
  const originals = model.nodes.filter(n => n.type === 'text');
  return (segments || []).map(seg => {
    if (seg.type === 'token') return byId[seg.id]?.raw || '';
    const original = originals[textIndex++] || { raw: '', display: '' };
    const value = String(seg.text ?? '').replace(/\u00a0/g, ' ');
    return value === original.display ? original.raw : escapeLatexText(value);
  }).join('');
}

export function authorPlainText(model, segments) {
  const byId = Object.fromEntries(model.nodes.filter(n => n.type === 'token').map(n => [n.id, n]));
  return (segments || []).map(s => s.type === 'text' ? s.text : `[${byId[s.id]?.label || 'LaTeX'}]`)
    .join('').replace(/\s+/g, ' ').trim();
}

export function authorEditJob({ id, chapter, find, replacement, proseBefore = '', proseAfter = '', requestedTs = '' }) {
  return {
    id, type: 'author-edit', chapter, status: 'queued', requested_ts: requestedTs,
    edits: [{ id: `${id}_edit`, op: 'replace', find, replacement, prose_before: proseBefore,
      prose_after: proseAfter, source_hash: simpleHash(find) }],
  };
}

// A lightweight stale-source fingerprint for the queue contract. Exact literal matching remains the
// authoritative backend conflict gate; this hash makes source-map/debug state human-readable.
export function simpleHash(text = '') {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
