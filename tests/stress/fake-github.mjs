// fake-github.mjs — an in-memory model of the GitHub Contents API, sized to Footnote's usage.
// Used by the Lane E stress harnesses. It is deliberately faithful to the seams the app depends on:
//   * ONE shared rate-limit budget (5000 req/hr) — the "shared ADVISOR_KEY" sleeper. Every request
//     from any client through the same token draws down the SAME bucket.
//   * sha-based optimistic concurrency: a PUT with a stale sha returns 403? no — GitHub returns 409.
//   * injectable chaos: force offline, inject 500/403/rate-limit responses, add latency.
//
// It is NOT a general GitHub mock; it models exactly getJson/putJson/getSha/ghTree/raw-content reads.
//
// Everything here is pure/deterministic given a seeded clock + rng, so harness assertions are stable.

import { Buffer } from 'node:buffer';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const unb64 = (s) => Buffer.from(String(s).replace(/\s/g, ''), 'base64').toString('utf8');
const sha = (s) => 'sha_' + Buffer.from(String(s)).toString('base64').slice(0, 16).replace(/[^a-zA-Z0-9]/g, '');

export class FakeGitHub {
  constructor(opts = {}) {
    // path -> { content:<string>, sha:<string> }
    this.files = new Map();
    this.rateLimit = opts.rateLimit ?? 5000;   // requests per hour, per token bucket
    this.remaining = this.rateLimit;
    this.reqCount = 0;                          // total requests served (any status)
    this.putCount = 0;
    this.getCount = 0;
    this.conflicts = 0;                         // 409s returned
    this.rateLimited = 0;                       // 403 rate-limit responses
    this.injected500 = 0;
    // chaos knobs
    this.offline = false;
    this.forceStatus = null;                    // e.g. 500 or 403 for the next N responses
    this.forceCount = 0;
    this.latencyMs = 0;
  }

  // ---- chaos controls ----
  goOffline() { this.offline = true; }
  goOnline() { this.offline = false; }
  injectStatus(status, count = 1) { this.forceStatus = status; this.forceCount = count; }

  _seed(path, obj) {
    const content = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
    this.files.set(path, { content, sha: sha(path + ':' + content + ':' + Math.random()) });
  }

  // Build a fetch(url, init) implementation bound to this server + a given token.
  // The token is only used to draw down the shared bucket keyed by the token string.
  fetchFor(tokenBucket) {
    tokenBucket.remaining = tokenBucket.remaining ?? this.rateLimit;
    return async (url, init = {}) => {
      this.reqCount++;
      if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));

      // network offline: reject like a real fetch would
      if (this.offline) throw new TypeError('Failed to fetch');

      // injected transient failures
      if (this.forceStatus && this.forceCount > 0) {
        this.forceCount--;
        const st = this.forceStatus;
        if (st === 500) this.injected500++;
        if (st === 403) this.rateLimited++;
        return this._resp(st, st === 403 ? { message: 'API rate limit exceeded' } : { message: 'Server Error' });
      }

      // shared rate-limit bucket
      tokenBucket.remaining--;
      if (tokenBucket.remaining < 0) {
        this.rateLimited++;
        return this._resp(403, { message: 'API rate limit exceeded for token.' },
          { 'x-ratelimit-remaining': '0' });
      }

      const method = (init.method || 'GET').toUpperCase();
      const path = this._pathOf(url);
      const isRaw = (init.headers && /raw/.test(JSON.stringify(init.headers)));

      if (method === 'GET') {
        this.getCount++;
        const f = this.files.get(path);
        if (!f) return this._resp(404, { message: 'Not Found' });
        if (isRaw) return this._rawResp(f.content);
        return this._resp(200, { content: b64(f.content), sha: f.sha });
      }

      if (method === 'PUT') {
        this.putCount++;
        const body = JSON.parse(init.body || '{}');
        const cur = this.files.get(path);
        // optimistic concurrency: if file exists, the client MUST pass the current sha
        if (cur && body.sha !== cur.sha) {
          this.conflicts++;
          return this._resp(409, { message: 'is at ' + cur.sha + ' but expected ' + body.sha });
        }
        if (!cur && body.sha) {
          // client thinks it exists but it doesn't — treat as create
        }
        const content = unb64(body.content);
        const newSha = sha(path + ':' + content + ':' + (this.putCount));
        this.files.set(path, { content, sha: newSha });
        return this._resp(200, { content: { sha: newSha } });
      }

      if (method === 'DELETE') {
        this.files.delete(path);
        return this._resp(200, {});
      }
      return this._resp(400, { message: 'bad method' });
    };
  }

  _pathOf(url) {
    // .../contents/<path>?t=... OR .../git/trees/main?...
    const m = String(url).match(/\/contents\/([^?]+)/);
    if (m) return decodeURIComponent(m[1]);
    if (/\/git\/trees\//.test(url)) return '__tree__';
    return url;
  }

  _resp(status, json, extraHeaders = {}) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => extraHeaders[k.toLowerCase()] ?? null },
      json: async () => json,
      text: async () => (typeof json === 'string' ? json : JSON.stringify(json)),
    };
  }
  _rawResp(content) {
    return {
      ok: true, status: 200,
      headers: { get: () => null },
      json: async () => { throw new Error('raw response has no json'); },
      text: async () => content,
    };
  }
}

export const helpers = { b64, unb64, sha };
