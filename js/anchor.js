const norm = s => s.replace(/\s+/g,' ').trim();
export const anchorFromSelection = ({ text, page, rects, synctex=null }) =>
  ({ quote: norm(text), page, rects: rects||[], synctex, confirmed: !!synctex });
export const locateQuote = (source, quote) => {
  const q = norm(quote); const lines = source.split('\n');
  const hits = [];
  lines.forEach((ln, i) => { if (norm(ln).includes(q)) hits.push(i+1); });
  if (hits.length === 1) return { line: hits[0], ambiguous:false };
  if (hits.length === 0) return { line:null, ambiguous:false };
  return { line: hits[0], ambiguous:true, candidates:hits };
};
