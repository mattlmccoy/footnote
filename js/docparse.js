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

// Extract the balanced-brace argument of the first \chapter (optionally \chapter[short]) after `from`.
// Returns { title, end } or null. Handles one level of nested braces in the title.
function firstChapter(tex, from = 0) {
  const re = /\\chapter\b\s*(\[[^\]]*\])?\s*\{/g;
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

function allChapters(tex) {
  const out = [];
  let pos = 0, hit;
  while ((hit = firstChapter(tex, pos))) { out.push(hit.title); pos = hit.end + 1; }
  return out;
}

// Parse chapters from a LaTeX document. resolveFile(path) → the content of an \include/\input'd file
// (path as written, without .tex), or null. Order follows the includes; a single-file doc falls back to
// its own \chapter commands. Files/None with no \chapter are skipped. Ids are deduped.
export function parseLatexChapters(mainTex, resolveFile = () => null) {
  const clean = stripComments(mainTex);
  const includeRe = /\\(?:include|input)\s*\{([^}]+)\}/g;
  const raw = [];
  let m;
  while ((m = includeRe.exec(clean))) {
    const path = m[1].trim().replace(/\.tex$/, '');
    const content = resolveFile(path);
    if (content == null) continue;
    const title = (firstChapter(stripComments(content)) || {}).title;
    if (title) raw.push({ title, id: slugifyId(path.split('/').pop()), sourceFile: `${path}.tex` });
  }
  // Single-file fallback: no includes produced chapters → parse \chapter in the main file itself.
  if (raw.length === 0) {
    for (const title of allChapters(clean)) raw.push({ title, id: slugifyId(title), sourceFile: 'main.tex' });
  }
  // Number + dedupe ids.
  const seen = new Map();
  return raw.map((c, i) => {
    let id = c.id; const base = id;
    while (seen.has(id)) id = `${base}-${(seen.get(base) || 1) + 1}`;
    seen.set(base, (seen.get(base) || 1) + (base === id ? 1 : 1));
    seen.set(id, 1);
    return { id, n: i + 1, title: c.title, sourceFile: c.sourceFile };
  });
}
