// sourcestatusio.js: network side of the owner-portal source-freshness indicator. Fetches the three
// signals the pure sourcestatus.js verdict needs, then returns { ...staleness, headSha, builtSha, ahead,
// label, builtCount }. Owner-only (both surfaces import it); it never runs on the reviewer portal.
//
// Reads are conditional (condApi): this indicator refreshes on every owner-portal load, and an unchanged
// read answered 304 costs no rate limit (the REST limit is per USER and shared with every reviewer's key).
// Self-contained on purpose: it does NOT import js/debug.js, whose module boot() would run the whole debug
// collector when imported into a page that has a document.
import { condApi, condInvalidate } from './condfetch.js?v=acd31f3';
import { fetchWithTimeout } from './nethelpers.js?v=a764ebc';
import { builtMarker, staleness, sourceStatusLabel, sourceStatusShort } from './sourcestatus.js?v=44f468a';

const API = 'https://api.github.com';

// The two cached reads a cheap "re-check" drops so the next read revalidates against GitHub: the data
// repo's build manifest and the source repo's HEAD. Pure so the URL construction is unit-tested; the
// compare read is keyed by the shas, so it self-invalidates and needs no explicit bust. [] when no source.
export function bustUrls({ sourceRepo, dataRepo, dataPrefix = '' } = {}) {
  if (!sourceRepo) return [];
  return [
    `${API}/repos/${dataRepo}/contents/${dataPrefix}content/built.json`,
    `${API}/repos/${sourceRepo}/commits/main`,
  ];
}
const _b64json = content => JSON.parse(decodeURIComponent(escape(atob(String(content).replace(/\s/g, '')))));

// One authenticated, conditional GET. Never throws (a transport failure -> { ok:false }). Mirrors
// debug.dbgGet without the /rate_limit special-case (this helper never reads that endpoint).
async function _get(token, url, fetchImpl) {
  try {
    const r = await condApi(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      token, fetchImpl: (u, o) => fetchWithTimeout(u, o, { fetchImpl }),
    });
    return { ok: r.ok, status: r.status, json: r.json };
  } catch { return { ok: false, status: 0, json: null }; }
}

async function _contentJson(token, repo, path, fetchImpl) {
  const r = await _get(token, `${API}/repos/${repo}/contents/${path}`, fetchImpl);
  if (!r.ok || !r.json || typeof r.json.content !== 'string') return null;
  try { return _b64json(r.json.content); } catch { return null; }
}

// Assemble the owner-portal source-freshness status for one project. `dataPrefix` is '' (legacy root repo)
// or '<id>/' (workspace repo). No sourceRepo -> nosource, computed without any network call.
export async function fetchSourceStatus({ token, sourceRepo, dataRepo, dataPrefix = '', bust = false, fetchImpl } = {}) {
  if (!sourceRepo) {
    const s = staleness({ sourceRepo: '' });
    return { ...s, headSha: '', builtSha: '', ahead: null, builtCount: 0, label: sourceStatusLabel(s), short: sourceStatusShort(s) };
  }
  // Cheap re-check: drop the cached built.json + HEAD reads so the next read revalidates (no rebuild).
  if (bust) for (const u of bustUrls({ sourceRepo, dataRepo, dataPrefix })) condInvalidate(u);
  // build point (data repo) + source HEAD (source repo) in parallel (independent reads)
  const [manifest, mainR] = await Promise.all([
    _contentJson(token, dataRepo, `${dataPrefix}content/built.json`, fetchImpl),
    _get(token, `${API}/repos/${sourceRepo}/commits/main`, fetchImpl),
  ]);
  const { sha: builtSha, builtCount } = builtMarker(manifest || {});
  const headSha = mainR.json?.sha || '';
  const headDate = mainR.json?.commit?.committer?.date || null;

  // Only ask GitHub how far behind when there IS a gap to measure (both shas known and different).
  let ahead = null;
  if (builtSha && headSha && builtSha !== headSha) {
    const cmp = await _get(token, `${API}/repos/${sourceRepo}/compare/${builtSha}...${headSha}`, fetchImpl);
    ahead = typeof cmp.json?.ahead_by === 'number' ? cmp.json.ahead_by : null;
  }

  const rendered = builtCount > 0;
  const s = staleness({ sourceRepo, builtSha, headSha, headDate, ahead, rendered });
  return { ...s, headSha, builtSha, ahead, builtCount, label: sourceStatusLabel(s), short: sourceStatusShort(s) };
}
