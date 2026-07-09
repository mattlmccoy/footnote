// Document parsers: discover the chapter list from the author's own source (LaTeX now; Word next),
// so Footnote never ships a hardcoded document model. Pure functions — unit-tested, no I/O. The import
// UI supplies file contents via a resolver callback (from the source repo or an uploaded file).

// Stable, url-safe, lowercase id from a title or filename.
export function slugifyId(s) {
  return String(s).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

// Turn a LaTeX title argument into plain text: drop formatting commands (\textbf{x}→x, \emph{x}→x, …),
// unwrap remaining braces, collapse whitespace.
export function latexTitleText(tex) {
  return String(tex)
    .replace(/\\\\\s*(\[[^\]]*\])?/g, ' ')             // LaTeX \\ line break (opt [2ex]) → space
    .replace(/\\[a-zA-Z]+\*?\s*\{([^{}]*)\}/g, '$1')   // \cmd{arg} → arg (one level)
    .replace(/\\([&%$#_])/g, '$1')                     // LaTeX escapes \& \% \$ \# \_ → literal char
    .replace(/\\[a-zA-Z]+\*?/g, '')                    // bare \cmd
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Remove LaTeX line comments (unescaped %), preserving \%.
function stripComments(tex) {
  return String(tex).replace(/(^|[^\\])%.*$/gm, '$1');
}

// Title-attached marks: affiliations / funding / footnotes that authors hang on the title but are NOT part
// of the title text. Removed (command + balanced-brace arg) before cleaning, or they leak into the title.
const _TITLE_MARKS = ['thanks', 'footnote', 'tnoteref', 'thanksref', 'fnref', 'textsuperscript', 'inst',
  'orcidlink', 'authormark', 'corref', 'footnotemark', 'IEEEauthorrefmark'];

// Remove every `\name{...}` (balanced braces, one nesting level via depth count) from a string.
function _stripCmdArg(s, name) {
  const re = new RegExp(`\\\\${name}\\b\\s*(\\[[^\\]]*\\])?\\s*\\{`, 'g');
  let out = '', last = 0, m;
  while ((m = re.exec(s))) {
    out += s.slice(last, m.index);
    let i = re.lastIndex, depth = 1;
    for (; i < s.length && depth > 0; i++) { const c = s[i]; if (c === '{') depth++; else if (c === '}') depth--; }
    last = i; re.lastIndex = i;
  }
  return out + s.slice(last);
}
function _stripTitleMarks(s) {
  return _TITLE_MARKS.reduce((acc, n) => _stripCmdArg(acc, n), String(s)).replace(/\\footnotemark\b/g, '');
}

// The raw (un-cleaned) balanced-brace argument of the first \title{...} (opt \title[short]{...}). null if none.
function _rawTitleArg(tex) {
  const re = /\\title\b\*?\s*(\[[^\]]*\])?\s*\{/g;
  const m = re.exec(tex); if (!m) return null;
  let i = re.lastIndex, depth = 1, buf = '';
  for (; i < tex.length && depth > 0; i++) { const c = tex[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) break; } buf += c; }
  return buf;
}

// \input{f} / \include{f} targets.
function _includeTargets(tex) {
  const out = [], re = /\\(?:input|include)\s*\{([^{}]+)\}/g; let m;
  while ((m = re.exec(tex))) out.push(m[1].trim());
  return out;
}
const _resolveInclude = (resolveFile, name) => resolveFile(name) ?? resolveFile(name.replace(/\.tex$/i, ''));

// Body of \newcommand{\name}{...} / \newcommand\name{...} / \def\name{...}, searching src then its includes.
function _macroBody(tex, name, resolveFile) {
  const pat = new RegExp(`\\\\(?:newcommand|renewcommand|providecommand|def)\\s*\\{?\\\\${name}\\}?(?:\\[[^\\]]*\\])?\\s*\\{`);
  const search = src => {
    const m = pat.exec(src); if (!m) return null;
    let i = m.index + m[0].length, depth = 1, buf = '';
    for (; i < src.length && depth > 0; i++) { const c = src[i]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) break; } buf += c; }
    return buf;
  };
  let b = search(tex); if (b != null) return b;
  for (const inc of _includeTargets(tex)) { const f = _resolveInclude(resolveFile, inc); if (f != null && (b = search(String(f))) != null) return b; }
  return null;
}

// The document title from a LaTeX source of truth. Robust across conventions: strips title-attached marks
// (\thanks/\footnote/\tnoteref/\textsuperscript…), resolves a macro title (\title{\mytitle}), and follows
// \input/\include'd preamble files (via resolveFile, keyed WITHOUT .tex like folderTexIndex). '' when absent.
export function parseDocTitle(entryText, resolveFile = () => null) {
  const clean = stripComments(String(entryText || ''));
  let raw = _rawTitleArg(clean);
  if (raw == null) {   // no \title in the entry — look in \input'd preamble files
    for (const inc of _includeTargets(clean)) {
      const f = _resolveInclude(resolveFile, inc);
      if (f != null) { const r = _rawTitleArg(stripComments(String(f))); if (r != null) { raw = r; break; } }
    }
  }
  if (raw == null) return '';
  const macro = raw.trim().match(/^\\([a-zA-Z@]+)$/);   // \title{\mytitle} → resolve the macro body
  if (macro) { const body = _macroBody(clean, macro[1], resolveFile); if (body != null) raw = body; }
  return latexTitleText(_stripTitleMarks(raw));
}

// Back-compat thin wrapper: the entry-only title (no include resolver).
export function parseLatexTitle(tex) {
  return parseDocTitle(tex);
}

// Inline one level of \input/\include content so a chapter's heading and its body text are contiguous.
function _assembleDoc(clean, resolveFile, _seen, _depth) {
  // Recursively inline \input / \include. A chapter wrapper may \input subfiles that themselves
  // \input the files holding the sections, so a single pass loses the nested structure. Guard against
  // include cycles (via _seen) and pathological depth.
  const seen = _seen || new Set();
  const depth = _depth || 0;
  if (depth > 40) return clean;
  return clean.replace(/\\(?:input|include)\s*\{([^{}]+)\}/g, (m, name) => {
    const key = name.trim();
    const f = resolveFile(key) ?? resolveFile(key.replace(/\.tex$/i, ''));
    if (f == null) return m;
    if (seen.has(key)) return '';
    seen.add(key);
    const inlined = _assembleDoc(stripComments(String(f)), resolveFile, seen, depth + 1);
    seen.delete(key);
    return `\n${inlined}\n`;
  });
}

// A short, source-derived synopsis: the first sentence of the body text after a heading, stripped of LaTeX.
function _firstSentence(tex) {
  const s = String(tex || '')
    .replace(/\\(?:begin|end)\s*\{[^{}]*\}/g, ' ')
    .replace(/\$\$?[^$]*\$\$?/g, ' ')                                             // math
    .replace(/\\(?:cite[a-zA-Z]*|ref|cref|Cref|autoref|eqref|label|footnote|thanks)\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}/g, ' ')  // refs/cites first (drop, don't inline)
    .replace(/\\[a-zA-Z@]+\*?\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g, '$1')           // \cmd{arg} → arg
    .replace(/\\[a-zA-Z@]+\*?/g, ' ')                                             // bare \cmd
    .replace(/[{}~]/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')                                             // no space before punctuation
    .replace(/\s+/g, ' ').trim();
  const m = s.match(/^.*?[.!?](?=\s|$)/);
  let out = (m ? m[0] : s).trim();
  if (out.length > 160) out = out.slice(0, 157).trim() + '…';
  return out;
}

// Build a NESTED "Proposed outline" tree from the LaTeX source of truth — the same shape the outline view
// renders ({title, intro, chapters:[{n, title, synopsis, sections:[{title, synopsis, subsections:[…]}]}]}).
// Reuses the firstSectioning level machinery (top 3 heading levels present, e.g. chapter→section→subsection,
// or section→subsection→subsubsection for a journal). Synopses are derived from the source (first sentence
// after each heading), so the outline stays a true extraction — no hand-authored drift.
export function parseLatexOutline(mainTex, resolveFile = () => null) {
  const clean = stripComments(String(mainTex || ''));
  const full = _assembleDoc(clean, resolveFile);
  // Appendices are NOT chapters. Standard LaTeX marks the boundary with \appendix; thesis classes (e.g.
  // GaTech) use a \begin{...appendices} environment. Headings at/after the boundary are appendices — drop
  // them so the outline shows the real chapters, matching an \appendix-aware chapter count.
  const _appM = /\\appendix\b|\\begin\s*\{[a-zA-Z]*appendices\}/.exec(full);
  const _appPos = _appM ? _appM.index : Infinity;
  const ALL = ['chapter', 'section', 'subsection', 'subsubsection'];
  const topIdx = ALL.findIndex(lvl => firstSectioning(full, lvl));
  const root = { title: parseDocTitle(mainTex, resolveFile), intro: '', chapters: [] };
  if (topIdx < 0) return root;
  const LEVELS = ALL.slice(topIdx, topIdx + 3);
  const nodes = [];
  LEVELS.forEach((lvl, li) => {
    let pos = 0, hit;
    while ((hit = firstSectioning(full, lvl, pos))) {
      if (hit.start < _appPos) nodes.push({ level: li, title: hit.title, start: hit.start, bodyStart: hit.end + 1 });
      pos = hit.end + 1;
    }
  });
  nodes.sort((a, b) => a.start - b.start);
  nodes.forEach((n, i) => { const nextStart = i + 1 < nodes.length ? nodes[i + 1].start : full.length; n.synopsis = _firstSentence(full.slice(n.bodyStart, nextStart)); });
  let curCh = null, curSec = null, chN = 0;
  for (const n of nodes) {
    if (n.level === 0) { curCh = { n: ++chN, title: n.title, synopsis: n.synopsis, sections: [] }; root.chapters.push(curCh); curSec = null; }
    else if (n.level === 1) {
      if (!curCh) { curCh = { n: ++chN, title: '', synopsis: '', sections: [] }; root.chapters.push(curCh); }
      curSec = { title: n.title, synopsis: n.synopsis, subsections: [] }; curCh.sections.push(curSec);
    } else {
      const sub = { title: n.title, synopsis: n.synopsis };
      if (curSec) curSec.subsections.push(sub);
      else if (curCh) { curSec = { title: '', synopsis: '', subsections: [sub] }; curCh.sections.push(curSec); }
    }
  }
  return root;
}

// Extract the balanced-brace argument of the first \<level> command (optionally starred / \cmd[short])
// after `from`. `level` is 'chapter' or 'section'. Returns { title, end } or null. Handles one level of
// nested braces in the title. \b after the level name means \section never matches \subsection.
function firstSectioning(tex, level, from = 0) {
  const re = new RegExp(`\\\\${level}\\b\\*?\\s*(\\[[^\\]]*\\])?\\s*\\{`, 'g');
  re.lastIndex = from;
  const m = re.exec(tex);
  if (!m) return null;
  let i = re.lastIndex, depth = 1, buf = '';
  for (; i < tex.length && depth > 0; i++) {
    const ch = tex[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) break; }
    buf += ch;
  }
  return { title: latexTitleText(buf), end: i, start: m.index };
}

function allSectioning(tex, level) {
  const out = [];
  let pos = 0, hit;
  while ((hit = firstSectioning(tex, level, pos))) { out.push(hit.title); pos = hit.end + 1; }
  return out;
}

// ---- .docx unzip: a .docx is a ZIP; find word/document.xml via local file headers and inflate it with
// the built-in DecompressionStream (no dependency). Assumes sizes are in the local headers (true for Word
// and common zippers). Pure zip-header parse (findZipEntry) is unit-tested; the inflate path runs in-browser.
function bytesEq(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }

export function findZipEntry(u8, name) {
  const target = new TextEncoder().encode(name);
  for (let i = 0; i + 30 <= u8.length; i++) {
    if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x03 && u8[i + 3] === 0x04) {
      const dv = new DataView(u8.buffer, u8.byteOffset + i, 30);
      const method = dv.getUint16(8, true);
      const compSize = dv.getUint32(18, true);
      const fnLen = dv.getUint16(26, true);
      const exLen = dv.getUint16(28, true);
      const nameBytes = u8.subarray(i + 30, i + 30 + fnLen);
      const start = i + 30 + fnLen + exLen;
      if (bytesEq(nameBytes, target)) return { method, data: u8.subarray(start, start + compSize) };
      if (compSize > 0) i = start + compSize - 1;   // skip past data to avoid false PK matches
    }
  }
  return null;
}

export async function docxToXml(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  const e = findZipEntry(u8, 'word/document.xml');
  if (!e) throw new Error('not a .docx (word/document.xml missing)');
  if (e.method === 0) return new TextDecoder().decode(e.data);
  if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot inflate .docx');
  const stream = new Blob([e.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

// Dedupe ids + number a raw [{title, id, sourceFile, appendix?}] list into the manifest shape.
// Main units number 1..K; appendix units (kind:'appendix') number 1..M separately (unitLabel renders
// that as A, B, …). Absent kind = a normal chapter/section (back-compatible).
function finalizeChapters(raw) {
  const used = new Set();
  let chN = 0, apN = 0;
  return raw.map((c) => {
    let id = c.id, k = 2;
    while (used.has(id)) id = `${c.id}-${k++}`;
    used.add(id);
    const out = { id, title: c.title, sourceFile: c.sourceFile ?? null };
    if (c.appendix) { out.kind = 'appendix'; out.n = ++apN; }
    else { out.n = ++chN; }
    return out;
  });
}

// Parse chapters from the WordprocessingML `document.xml` (already unzipped from the .docx). Every
// paragraph styled Heading 1 (any casing / "Heading 1" / "Heading1") becomes a chapter; its text is the
// concatenation of its runs. The unzip (bytes → xml) is done by the caller (import UI). sourceFile is null
// (Word docs aren't split into per-chapter source files). Pure + testable.
export function parseDocxChapters(documentXml) {
  const xml = String(documentXml);
  const paras = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || [];
  const raw = [];
  for (const p of paras) {
    const style = (p.match(/<w:pStyle\s+w:val="([^"]*)"/) || [])[1] || '';
    if (!/^heading\s*1$/i.test(style)) continue;
    const text = (p.match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g) || [])
      .map(t => t.replace(/<[^>]+>/g, '')).join('')
      .replace(/\s+/g, ' ').trim();
    if (text) raw.push({ title: text, id: slugifyId(text), sourceFile: null });
  }
  return finalizeChapters(raw);
}

// Resolve a main file's \include/\input'd files into [{ path, content }] (content stripped of comments,
// or null when the resolver has no file). `clean` is the already-comment-stripped main text.
function resolveIncludes(clean, resolveFile) {
  const includeRe = /\\(?:include|input)\s*\{([^}]+)\}/g;
  const includes = [];
  let m;
  while ((m = includeRe.exec(clean))) {
    const path = m[1].trim().replace(/\.tex$/, '');
    const content = resolveFile(path);
    includes.push({ path, content: content == null ? null : stripComments(content), at: m.index });
  }
  return includes;
}

// Pick the unit level once, from the whole assembled document, so a mixed / article doc is consistent:
// 'chapter' when the main file or any resolved include has a \chapter, else 'section'.
function pickLevel(clean, includeContents) {
  const hasChapter = /\\chapter\b/.test(clean) || includeContents.some(c => c && /\\chapter\b/.test(c));
  return hasChapter ? 'chapter' : 'section';
}

// Detect the reading-unit level of a LaTeX document WITHOUT building the chapter manifest, so the import
// flow can set the project's doc.unitNoun. Same rule as parseLatexChapters: 'chapter' when the assembled
// document (main + \include/\input'd files) has any \chapter (books, dissertations), else 'section'
// (journal articles: elsarticle, IEEEtran, article — no \chapter). resolveFile(path) → include content
// (path as written, without .tex) or null. Pure + testable.
export function detectUnitLevel(mainTex, resolveFile = () => null) {
  const clean = stripComments(mainTex);
  const includes = resolveIncludes(clean, resolveFile);
  return pickLevel(clean, includes.map(i => i.content));
}

// The two levels Footnote auto-manages from the document. An adopter who sets doc.unitNoun to anything
// else (e.g. 'part', 'essay') has explicitly overridden the noun, and detection must not touch it.
const AUTO_NOUNS = new Set(['chapter', 'section']);

// Decide the doc.unitNoun to use after an import: adopt the detected level, but only when the current
// noun is still an auto-managed default ('chapter'/'section'). A custom noun is an explicit override and
// is left untouched; a null/empty detected level (e.g. a Word import, or a parse that found nothing) also
// leaves the current noun as-is. Pure + testable — the import flow calls this instead of inlining the guard.
export function resolveUnitNoun(currentNoun, detectedLevel) {
  if (!detectedLevel) return currentNoun;
  if (!AUTO_NOUNS.has(currentNoun)) return currentNoun;
  return detectedLevel;
}

// Parse the reading units from a LaTeX document. resolveFile(path) → the content of an \include/\input'd
// file (path as written, without .tex), or null. The unit is \chapter when the assembled document has any
// \chapter (books, dissertations), else \section (journal articles: elsarticle, IEEEtran, article — which
// have no \chapter). Order follows the includes; a single-file doc parses its own commands. Ids are deduped.
export function parseLatexChapters(mainTex, resolveFile = () => null) {
  const clean = stripComments(mainTex);
  const includes = resolveIncludes(clean, resolveFile);
  const level = pickLevel(clean, includes.map(i => i.content));
  // \appendix marks the boundary: units at/after it are appendices. We look for it in the main file
  // (the common pattern: \appendix sits in main.tex before the appendix \include's / \section's).
  const appM = /\\appendix\b/.exec(clean);
  const appPos = appM ? appM.index : -1;
  const raw = [];
  for (const inc of includes) {
    if (inc.content == null) continue;
    const title = (firstSectioning(inc.content, level) || {}).title;
    if (title) raw.push({ title, id: slugifyId(inc.path.split('/').pop()), sourceFile: `${inc.path}.tex`, appendix: appPos >= 0 && inc.at > appPos });
  }
  // Single-file fallback: no includes produced units → parse the level's commands in the main file,
  // tracking each command's position so the ones after \appendix are marked appendix.
  if (raw.length === 0) {
    let pos = 0, hit;
    while ((hit = firstSectioning(clean, level, pos))) {
      raw.push({ title: hit.title, id: slugifyId(hit.title), sourceFile: 'main.tex', appendix: appPos >= 0 && hit.start > appPos });
      pos = hit.end + 1;
    }
  }
  return finalizeChapters(raw);
}
