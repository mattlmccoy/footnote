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
    .replace(/\\[a-zA-Z]+\*?\s*\{([^{}]*)\}/g, '$1')   // \cmd{arg} → arg (one level)
    .replace(/\\[a-zA-Z]+\*?/g, '')                    // bare \cmd
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Remove LaTeX line comments (unescaped %), preserving \%.
function stripComments(tex) {
  return String(tex).replace(/(^|[^\\])%.*$/gm, '$1');
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
  return { title: latexTitleText(buf), end: i };
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

// Dedupe ids + number a raw [{title, id, sourceFile}] list into the chapter manifest shape.
function finalizeChapters(raw) {
  const used = new Set();
  return raw.map((c, i) => {
    let id = c.id, k = 2;
    while (used.has(id)) id = `${c.id}-${k++}`;
    used.add(id);
    return { id, n: i + 1, title: c.title, sourceFile: c.sourceFile ?? null };
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

// Parse the reading units from a LaTeX document. resolveFile(path) → the content of an \include/\input'd
// file (path as written, without .tex), or null. The unit is \chapter when the assembled document has any
// \chapter (books, dissertations), else \section (journal articles: elsarticle, IEEEtran, article — which
// have no \chapter). Order follows the includes; a single-file doc parses its own commands. Ids are deduped.
export function parseLatexChapters(mainTex, resolveFile = () => null) {
  const clean = stripComments(mainTex);
  const includeRe = /\\(?:include|input)\s*\{([^}]+)\}/g;
  const includes = [];
  let m;
  while ((m = includeRe.exec(clean))) {
    const path = m[1].trim().replace(/\.tex$/, '');
    const content = resolveFile(path);
    includes.push({ path, content: content == null ? null : stripComments(content) });
  }
  // Pick the unit level once, from the whole assembled document, so a mixed / article doc is consistent.
  const hasChapter = /\\chapter\b/.test(clean) || includes.some(i => i.content && /\\chapter\b/.test(i.content));
  const level = hasChapter ? 'chapter' : 'section';
  const raw = [];
  for (const inc of includes) {
    if (inc.content == null) continue;
    const title = (firstSectioning(inc.content, level) || {}).title;
    if (title) raw.push({ title, id: slugifyId(inc.path.split('/').pop()), sourceFile: `${inc.path}.tex` });
  }
  // Single-file fallback: no includes produced units → parse the level's commands in the main file itself.
  if (raw.length === 0) {
    for (const title of allSectioning(clean, level)) raw.push({ title, id: slugifyId(title), sourceFile: 'main.tex' });
  }
  return finalizeChapters(raw);
}
