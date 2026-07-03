// Pure word-level diff used by the advisor "what changed since your last visit" highlighter.
// wordDiff(oldText, newText) returns tokens reconstructing NEW text in order; added:true marks
// words present in new but not matched in old (insertions/changes). LCS-based; deletions are omitted
// (only the new text is returned, since that is what the reader sees). No DOM — unit-tested.
export function wordDiff(oldText, newText) {
  const split = s => (String(s || '').match(/\S+\s*/g) || []);   // word + trailing whitespace
  const oTok = split(oldText), nTok = split(newText);
  const O = oTok.map(w => w.trim()), N = nTok.map(w => w.trim());
  const m = O.length, n = N.length;
  // dp[i][j] = LCS length of O[i..], N[j..]
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = O[i] === N[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (j < n) {
    if (i < m && O[i] === N[j]) { out.push({ text: nTok[j], added: false }); i++; j++; }
    else if (i < m && dp[i + 1][j] >= dp[i][j + 1]) { i++; }        // word deleted from old — skip
    else { out.push({ text: nTok[j], added: true }); j++; }         // word inserted/changed in new
  }
  return out;
}
