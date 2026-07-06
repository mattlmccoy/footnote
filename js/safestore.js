// safestore.js — a localStorage wrapper that NEVER throws.
//
// Safari Private Browsing, disabled cookies, and locked-down browsers make localStorage.setItem throw
// synchronously. The reviewer portal's boot() stores the magic-link access key with an unguarded
// localStorage.setItem('ghpat', key) — so a storage-blocked browser aborts boot before any UI paints,
// leaving the advisor on a blank page from their very first click (Lane E finding F4). This shim catches
// that: it always keeps a session copy in memory, so the access key (and thus reading) still works even
// when persistence is unavailable, and it records blocked() so the caller can show an honest notice.
//
// makeSafeStore(backing, mem) — `backing` is a Storage-like object (getItem/setItem/removeItem). Pass a
// stub in tests; omit it to use the ambient localStorage; pass null to force pure in-memory. Pure logic,
// unit-tested in tests/safestore.test.mjs.

export function makeSafeStore(backing, mem = {}) {
  let blocked = false;
  const back = () => {
    if (backing !== undefined) return backing;                 // explicit backing (incl. null) wins
    try { return typeof localStorage !== 'undefined' ? localStorage : null; }
    catch (e) { blocked = true; return null; }                 // even *touching* localStorage can throw
  };
  return {
    get(key) {
      const s = back();
      if (s) {
        try { const v = s.getItem(key); if (v !== null && v !== undefined) return v; }
        catch (e) { blocked = true; }
      }
      return key in mem ? mem[key] : null;
    },
    set(key, value) {
      const s = back();
      mem[key] = value;                                        // always keep the session copy
      if (s) {
        try { s.setItem(key, value); return true; }            // persisted
        catch (e) { blocked = true; return false; }            // memory-only this session
      }
      blocked = true;
      return false;
    },
    remove(key) {
      const s = back();
      delete mem[key];
      if (s) { try { s.removeItem(key); } catch (e) { blocked = true; } }
    },
    blocked() { return blocked; },
  };
}
