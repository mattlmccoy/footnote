// Pure worklist builder: turns loaded review models into an Overleaf-actionable,
// per-source-file worklist and a Markdown payload. No DOM, no network.
// Consumed by the owner portal panel and the Markdown export/download.

const DECLINED = 'declined';

function reviewerName(author, config) {
  if (!author || author === 'matt' || author === 'owner') {
    return (config && config.doc && config.doc.authorName) || 'You';
  }
  const adv = ((config && config.advisors) || []).find(a => a.id === author);
  return adv ? (adv.name || adv.id) : author;
}

function editBeforeAfter(c) {
  if (c.edit && c.edit.op === 'replace') {
    return { before: c.edit.find || '', after: c.edit.replacement || '' };
  }
  if (c.staged_edit) {
    return { before: c.staged_edit.before || '', after: c.staged_edit.after || '' };
  }
  return { before: null, after: null };
}

function locatorOf(c) {
  const a = c.anchor || {};
  const quote = (a.quote || '').trim();
  const line = (a.synctex && a.synctex.line) || null;
  const label = quote ? '' : (a.figure || a.section || '');
  return { quote, line, label };
}

const sectionOf = c => (c.anchor && (c.anchor.section || c.anchor.figure)) || '';

// created_ts may be an ISO string (current writers) or a legacy epoch-ms NUMBER written by
// older app versions. Normalize to a sortable + displayable ISO string; unusable → ''. This
// keeps the downstream .localeCompare sort and .slice(0,10) date rendering string-safe.
export function normTs(ts) {
  if (ts == null || ts === '') return '';
  if (typeof ts === 'number') {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  }
  return String(ts);
}

export function buildWorklist(chapters, reviews, config) {
  const groups = [];
  for (const ch of (chapters || [])) {
    const review = (reviews || {})[ch.id];
    if (!review || !Array.isArray(review.comments)) continue;
    const items = review.comments
      .filter(c => (c.status || 'open') !== DECLINED)
      .map(c => {
        const { before, after } = editBeforeAfter(c);
        return {
          id: c.id, chapterId: ch.id,
          section: sectionOf(c),
          reviewerName: reviewerName(c.author, config),
          ts: normTs(c.created_ts),
          kind: c.kind || 'text',
          locator: locatorOf(c),
          comment: c.body || '',
          before, after,
          actioned: c.actioned === true,
        };
      })
      .sort((a, b) =>
        (a.section || '').localeCompare(b.section || '') ||
        (a.ts || '').localeCompare(b.ts || ''));
    if (!items.length) continue;
    groups.push({
      file: ch.sourceFile || null,
      title: ch.title || ch.id,
      open: items.filter(i => !i.actioned).length,
      items,
    });
  }
  groups.sort((a, b) => {
    if (a.file && b.file) return a.file.localeCompare(b.file);
    if (a.file) return -1;
    if (b.file) return 1;
    return (a.title || '').localeCompare(b.title || '');
  });
  return groups;
}

// Render the worklist groups as the inner HTML of the panel body. `escape` is
// supplied by the caller (the owner portal passes its escapeHtml); pure string building.
export function worklistToHtml(worklist, escape) {
  const e = escape || (s => String(s == null ? '' : s));
  return (worklist || []).map(g => `
    <div class="ovl-grp">
      <div class="ovl-grp-h">${e(g.file || g.title)} <span class="ovl-n">· ${g.open} open</span></div>
      ${g.items.map(it => `
        <label class="ovl-item${it.actioned ? ' done' : ''}" data-cid="${e(it.id)}" data-ch="${e(it.chapterId)}">
          <input type="checkbox" class="ovl-cb"${it.actioned ? ' checked' : ''}>
          <div>
            <div class="ovl-meta">${it.section ? e(it.section) + ' · ' : ''}${e(it.reviewerName)} · ${(it.ts || '').slice(0, 10)}</div>
            <div class="ovl-loc">${it.locator.quote
              ? `Find in Overleaf → <code>search: "${e(it.locator.quote)}"</code>${it.locator.line ? ` · line ${it.locator.line}` : ''}`
              : `Find in Overleaf → ${e(it.locator.label || g.title)}`}</div>
            ${it.comment ? `<div class="ovl-cmt">${e(it.comment)}</div>` : ''}
            ${(it.before != null && it.after != null)
              ? `<div class="ovl-edit">before <span class="ba">"${e(it.before)}"</span> → after <span class="ba">"${e(it.after)}"</span></div>` : ''}
          </div>
        </label>`).join('')}
    </div>`).join('');
}

// Escape for inline Markdown: neutralize backticks, collapse newlines.
const esc = s => String(s == null ? '' : s).replace(/`/g, '‘').replace(/\r?\n/g, ' ');

export function worklistToMarkdown(worklist, meta) {
  const m = meta || {};
  const totalOpen = (worklist || []).reduce((n, g) => n + (g.open || 0), 0);
  const head = [
    `# Review worklist — ${m.docTitle || 'document'}`,
    `Generated ${normTs(m.generatedTs).slice(0, 10)} · ${totalOpen} open item${totalOpen === 1 ? '' : 's'}`,
    '',
  ];
  if (!worklist || !worklist.length) {
    return [...head, "No open comments — you're all caught up.", ''].join('\n');
  }
  const lines = [...head];
  for (const g of worklist) {
    lines.push(`## ${g.file || g.title}`, '');
    for (const it of g.items) {
      const box = it.actioned ? 'x' : ' ';
      const who = `${it.section ? it.section + ' — ' : ''}${it.reviewerName} · ${(it.ts || '').slice(0, 10)}`;
      lines.push(`- [${box}] ${who}`);
      if (it.locator.quote) {
        lines.push(`  Find in Overleaf → search: "${esc(it.locator.quote)}"${it.locator.line ? `  · line ${it.locator.line}` : ''}`);
      } else if (it.locator.label) {
        lines.push(`  Find in Overleaf → ${esc(it.locator.label)}`);
      }
      if (it.comment) lines.push(`  Comment: ${esc(it.comment)}`);
      if (it.before != null && it.after != null) {
        lines.push(`  Suggested edit — before: "${esc(it.before)}"  →  after: "${esc(it.after)}"`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}
