// Paragraph-level diff for rendered branch previews. The reader compares the merged HTML block list
// with the review-branch block list and highlights every preview block that is not part of their
// longest common subsequence. This makes section rewrites visible even when one reviewer comment spans
// several paragraphs or has no staged_edit.before/after payload.
export function normalizeParagraph(text) {
  return String(text || '')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function paragraphChangeDetails(mainParagraphs, previewParagraphs) {
  const original = mainParagraphs || [];
  const preview = previewParagraphs || [];
  const a = original.map(normalizeParagraph);
  const b = preview.map(normalizeParagraph);
  const rows = a.length + 1, cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => new Uint32Array(cols));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const details = [];
  let before = [], afterIndexes = [];
  const flush = () => {
    if (afterIndexes.length) {
      const previousRegion = before.slice();
      afterIndexes.forEach(index => details.push({ index, before: previousRegion.slice() }));
    }
    before = [];
    afterIndexes = [];
  };
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { flush(); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) before.push(original[i++]);
    else afterIndexes.push(j++);
  }
  while (i < a.length) before.push(original[i++]);
  while (j < b.length) afterIndexes.push(j++);
  flush();
  return details;
}

export function changedParagraphIndexes(mainParagraphs, previewParagraphs) {
  return paragraphChangeDetails(mainParagraphs, previewParagraphs).map(change => change.index);
}
