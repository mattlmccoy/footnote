import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLatexOutline, mergeChapters } from '../js/docparse.js';

test('mergeChapters preserves existing ids on sourceFile match and adds new (appendix) units', () => {
  const existing = [
    { id: 'ch_introduction', title: 'Introduction', sourceFile: 'chapters/ch_introduction.tex', n: 1 },
    { id: 'ch_conclusions', title: 'Conclusions', sourceFile: 'chapters/ch_conclusions.tex', n: 2 },
  ];
  const parsed = [
    { id: 'ch-introduction', title: 'Introduction (edited)', sourceFile: 'chapters/ch_introduction.tex', n: 1 },
    { id: 'ch-conclusions', title: 'Conclusions', sourceFile: 'chapters/ch_conclusions.tex', n: 2 },
    { id: 'appb-metrology', title: 'Metrology', sourceFile: 'appendices/appB.tex', kind: 'appendix', n: 1 },
  ];
  const merged = mergeChapters(existing, parsed);
  assert.deepEqual(merged.map(u => u.id), ['ch_introduction', 'ch_conclusions', 'appb-metrology']);
  assert.equal(merged[0].title, 'Introduction (edited)');   // title refreshed from source
  assert.equal(merged[2].kind, 'appendix');                 // appendix added with its parsed id
});
test('mergeChapters: single-file doc (every unit sourceFile "main.tex") matches POSITIONALLY, no collapse', () => {
  const existing = [
    { id: 'ch_intro', title: 'Intro', sourceFile: 'main.tex', n: 1 },
    { id: 'ch_methods', title: 'Methods', sourceFile: 'main.tex', n: 2 },
    { id: 'ch_results', title: 'Results', sourceFile: 'main.tex', n: 3 },
  ];
  const parsed = [
    { id: 'ch-intro', title: 'Intro', sourceFile: 'main.tex', n: 1 },
    { id: 'ch-methods', title: 'Methods', sourceFile: 'main.tex', n: 2 },
    { id: 'ch-results', title: 'Results', sourceFile: 'main.tex', n: 3 },
  ];
  assert.deepEqual(mergeChapters(existing, parsed).map(u => u.id), ['ch_intro', 'ch_methods', 'ch_results']);
});
test('mergeChapters: .docx doc (sourceFile null) matches positionally, no collapse', () => {
  const existing = [
    { id: 'ch_a', title: 'A', sourceFile: null, n: 1 },
    { id: 'ch_b', title: 'B', sourceFile: null, n: 2 },
  ];
  const parsed = [
    { id: 'ch-a', title: 'A', sourceFile: null, n: 1 },
    { id: 'ch-b', title: 'B', sourceFile: null, n: 2 },
  ];
  assert.deepEqual(mergeChapters(existing, parsed).map(u => u.id), ['ch_a', 'ch_b']);
});
test('mergeChapters: no duplicate ids in the merged output (kept-existing vs new collision)', () => {
  const existing = [{ id: 'appx', title: 'Old Appendix', sourceFile: 'appendices/old.tex', n: 1 }];
  const parsed = [{ id: 'appx', title: 'New Appendix', sourceFile: 'appendices/new.tex', kind: 'appendix', n: 1 }];
  const ids = mergeChapters(existing, parsed).map(u => u.id);
  assert.equal(new Set(ids).size, ids.length, 'ids must be unique');
});
test('mergeChapters keeps an existing unit the parse no longer matches (never orphan comments)', () => {
  const existing = [{ id: 'ch_gone', title: 'Removed', sourceFile: 'chapters/ch_gone.tex', n: 1 }];
  const parsed = [{ id: 'ch-new', title: 'New', sourceFile: 'chapters/ch_new.tex', n: 1 }];
  const merged = mergeChapters(existing, parsed);
  assert.ok(merged.some(u => u.id === 'ch_gone'), 'kept the un-matched existing unit');
  assert.ok(merged.some(u => u.id === 'ch-new'), 'added the new unit');
});

test('parseLatexOutline excludes appendices (\\begin{theappendices} boundary)', () => {
  const tex = '\\chapter{Real One}\nText here now.\n\\chapter{Real Two}\nMore text now.\n\\begin{theappendices}\n\\chapter{Appendix A}\nApp text.\n\\end{theappendices}';
  const o = parseLatexOutline(tex);
  assert.equal(o.chapters.length, 2);
  assert.equal(o.chapters.map(c=>c.title).join(','), 'Real One,Real Two');
});
test('parseLatexOutline excludes appendices (\\appendix boundary)', () => {
  const tex = '\\chapter{One}\nx.\n\\appendix\n\\chapter{App}\ny.';
  assert.equal(parseLatexOutline(tex).chapters.length, 1);
});
test('parseLatexOutline resolves NESTED \\input (chapter wrapper -> subfile -> sections)', () => {
  // main \include's a thin chapter WRAPPER file, whose sections live in FURTHER \input'd subfiles
  // (two levels deep: main -> ch_background -> ch_fundamentals). Requires recursive assembly.
  const main = '\\input{ch_background}';
  const files = {
    ch_background: '\\chapter{Background}\n\\input{sub_a}\n\\input{sub_b}',
    sub_a: '\\section{Fundamentals}\nFirst section body here.\n\\subsection{Dielectric Heating}\nDetail.',
    sub_b: '\\section{Prior Work}\nSecond section body here.',
  };
  const o = parseLatexOutline(main, name => (name in files ? files[name] : null));
  assert.equal(o.chapters.length, 1);
  const secs = o.chapters[0].sections.map(s => s.title);
  assert.deepEqual(secs, ['Fundamentals', 'Prior Work']);
  assert.equal(o.chapters[0].sections[0].subsections[0].title, 'Dielectric Heating');
});
test('parseLatexOutline nests chapters > sections > subsections with n', () => {
  const tex = `\\title{My Doc}
\\chapter{Introduction}
Intro body sentence one. More text.
\\section{Motivation}
Why it matters here for readers.
\\subsection{Background}
Some background text follows.
\\chapter{Methods}
We did several things carefully.`;
  const o = parseLatexOutline(tex);
  assert.equal(o.title, 'My Doc');
  assert.equal(o.chapters.length, 2);
  assert.equal(o.chapters[0].title, 'Introduction');
  assert.equal(o.chapters[0].n, 1);
  assert.equal(o.chapters[0].sections[0].title, 'Motivation');
  assert.equal(o.chapters[0].sections[0].subsections[0].title, 'Background');
  assert.equal(o.chapters[1].title, 'Methods');
});
test('parseLatexOutline synopsis = cleaned first sentence after the heading', () => {
  const tex = '\\chapter{Intro}\nThis work builds on RF heating \\cite{smith}. A second sentence.';
  assert.equal(parseLatexOutline(tex).chapters[0].synopsis, 'This work builds on RF heating.');
});
test('parseLatexOutline promotes sections to top level for a journal (no chapters)', () => {
  const tex = '\\title{Paper}\\section{Introduction}\nText here now.\n\\subsection{Prior Work}\nMore text.\n\\section{Methods}\nStuff done.';
  const o = parseLatexOutline(tex);
  assert.equal(o.chapters.length, 2);
  assert.equal(o.chapters[0].title, 'Introduction');
  assert.equal(o.chapters[0].sections[0].title, 'Prior Work');
});
test('parseLatexOutline resolves \\input chapters via resolveFile', () => {
  const resolve = p => p==='ch1' ? '\\chapter{Loaded}\nBody here now.' : null;
  assert.equal(parseLatexOutline('\\title{D}\\input{ch1}', resolve).chapters[0].title, 'Loaded');
});

import { parseLatexChapters, detectUnitLevel, resolveUnitNoun, slugifyId, latexTitleText, parseLatexTitle, parseDocTitle, parseDocxChapters, findZipEntry, docxToXml } from '../js/docparse.js';

// ---- parseDocTitle: robust title extraction across LaTeX conventions ----
test('parseDocTitle: standard \\title', () => {
  assert.equal(parseDocTitle('\\documentclass{article}\n\\title{A Simple Paper}\n\\begin{document}'), 'A Simple Paper');
});
test('parseDocTitle: strips \\thanks (funding note must NOT leak into the title)', () => {
  assert.equal(parseDocTitle('\\title{Deep Nets\\thanks{Funded by NSF grant 12345}}'), 'Deep Nets');
});
test('parseDocTitle: strips \\footnote and \\thanksref and \\tnoteref', () => {
  assert.equal(parseDocTitle('\\title{Metrology\\footnote{corresponding author}\\tnoteref{t1}}'), 'Metrology');
  assert.equal(parseDocTitle('\\title{Scanning Methods\\thanksref{a}}'), 'Scanning Methods');
});
test('parseDocTitle: strips \\textsuperscript / \\inst affiliation marks', () => {
  assert.equal(parseDocTitle('\\title{Rapid Heating\\textsuperscript{1,2}}'), 'Rapid Heating');
});
test('parseDocTitle: resolves a title that is a macro (\\title{\\mytitle})', () => {
  assert.equal(parseDocTitle('\\newcommand{\\mytitle}{Volumetric Manufacturing}\n\\title{\\mytitle}\n\\begin{document}'), 'Volumetric Manufacturing');
});
test('parseDocTitle: resolves \\def-defined title macro', () => {
  assert.equal(parseDocTitle('\\def\\thetitle{Adjoint Design}\n\\title{\\thetitle}'), 'Adjoint Design');
});
test('parseDocTitle: finds \\title in an \\input-ed preamble file via resolveFile', () => {
  const resolve = p => (p === 'preamble' || p === 'preamble.tex') ? '\\title{Title From Preamble}' : null;
  assert.equal(parseDocTitle('\\documentclass{book}\n\\input{preamble}\n\\begin{document}', resolve), 'Title From Preamble');
});
test('parseDocTitle: multiline title + \\& escape, marks stripped together', () => {
  assert.equal(parseDocTitle('\\title{Process Development\\\\ \\& Characterization\\thanks{x}}'), 'Process Development & Characterization');
});
test('parseDocTitle: returns empty string when there is no title anywhere', () => {
  assert.equal(parseDocTitle('\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}'), '');
});

test('parseLatexTitle extracts the \\title argument from a full document', () => {
  const tex = '\\documentclass{article}\n\\title{A Low-Cost Scanner-Based Diagnostic Pipeline}\n\\author[gt]{M. McCoy}\n\\begin{document}';
  assert.equal(parseLatexTitle(tex), 'A Low-Cost Scanner-Based Diagnostic Pipeline');
});
test('parseLatexTitle handles an optional short-title arg and nested formatting', () => {
  assert.equal(parseLatexTitle('\\title[Short]{Full \\textbf{Bold} Title}'), 'Full Bold Title');
});
test('parseLatexTitle ignores commented titles and does not match \\titleformat', () => {
  assert.equal(parseLatexTitle('% \\title{Commented Out}\n\\titleformat{\\section}{}{}{}\n\\title{The Real Title}'), 'The Real Title');
});
test('parseLatexTitle collapses a multi-line title with \\\\ into one line', () => {
  assert.equal(parseLatexTitle('\\title{First Line\\\\ Second Line}'), 'First Line Second Line');
});
test('parseLatexTitle unescapes LaTeX escapes like \\& in the title', () => {
  assert.equal(parseLatexTitle('\\title{Process Development \\& Characterization}'), 'Process Development & Characterization');
  assert.equal(parseLatexTitle('\\title{50\\% Faster \\_ Better}'), '50% Faster _ Better');
});
test('parseLatexTitle returns empty string when there is no title', () => {
  assert.equal(parseLatexTitle('\\section{Intro}\n\\begin{document}'), '');
});

// Build a minimal STORED (uncompressed) zip containing one entry, to test the zip reader without inflate.
function storedZip(name, content) {
  const enc = new TextEncoder();
  const nameB = enc.encode(name), dataB = enc.encode(content);
  const h = new Uint8Array(30 + nameB.length + dataB.length);
  const dv = new DataView(h.buffer);
  dv.setUint32(0, 0x04034b50, true);        // PK\x03\x04
  dv.setUint16(8, 0, true);                 // method 0 (stored)
  dv.setUint32(18, dataB.length, true);     // compressed size
  dv.setUint32(22, dataB.length, true);     // uncompressed size
  dv.setUint16(26, nameB.length, true);     // filename length
  dv.setUint16(28, 0, true);                // extra length
  h.set(nameB, 30); h.set(dataB, 30 + nameB.length);
  return h;
}

test('findZipEntry locates a stored entry by name', () => {
  const zip = storedZip('word/document.xml', '<w:body>hi</w:body>');
  const e = findZipEntry(zip, 'word/document.xml');
  assert.equal(e.method, 0);
  assert.equal(new TextDecoder().decode(e.data), '<w:body>hi</w:body>');
  assert.equal(findZipEntry(zip, 'missing.xml'), null);
});

test('docxToXml returns document.xml for a stored .docx and parseDocxChapters reads it', async () => {
  const xml = `<w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Intro</w:t></w:r></w:p></w:body>`;
  const zip = storedZip('word/document.xml', xml);
  const got = await docxToXml(zip.buffer);
  assert.equal(got, xml);
  assert.deepEqual(parseDocxChapters(got).map(c => c.title), ['Intro']);
});

const wp = (style, ...texts) =>
  `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${texts.map(t => `<w:r><w:t>${t}</w:t></w:r>`).join('')}</w:p>`;

test('parseDocxChapters extracts Heading 1 paragraphs in order', () => {
  const xml = `<w:document><w:body>${wp('Heading1', 'Introduction')}${wp('Normal', 'body text')}${wp('Heading1', 'Methods')}</w:body></w:document>`;
  assert.deepEqual(parseDocxChapters(xml), [
    { id: 'introduction', n: 1, title: 'Introduction', sourceFile: null },
    { id: 'methods', n: 2, title: 'Methods', sourceFile: null },
  ]);
});

test('parseDocxChapters concatenates split runs within a heading', () => {
  const xml = `<w:body>${wp('Heading1', 'Chap', 'ter ', 'One')}</w:body>`;
  assert.equal(parseDocxChapters(xml)[0].title, 'Chapter One');
});

test('parseDocxChapters matches heading-style variants but not Heading 2', () => {
  const xml = `<w:body>${wp('heading1', 'A')}${wp('Heading2', 'sub')}${wp('Heading 1', 'B')}</w:body>`;
  assert.deepEqual(parseDocxChapters(xml).map(c => c.title), ['A', 'B']);
});

test('parseDocxChapters skips empty headings and dedupes ids', () => {
  const xml = `<w:body>${wp('Heading1', '')}${wp('Heading1', 'Intro')}${wp('Heading1', 'Intro')}</w:body>`;
  assert.deepEqual(parseDocxChapters(xml).map(c => c.id), ['intro', 'intro-2']);
});

test('slugifyId makes stable lowercase ids', () => {
  assert.equal(slugifyId('Introduction'), 'introduction');
  assert.equal(slugifyId('The RF Method!'), 'the-rf-method');
  assert.equal(slugifyId('  A/B  C '), 'a-b-c');
});

test('latexTitleText strips formatting commands and collapses space', () => {
  assert.equal(latexTitleText('The \\textbf{RF} Method'), 'The RF Method');
  assert.equal(latexTitleText('A \\emph{b} c'), 'A b c');
});
test('latexTitleText renders -- / --- dash ligatures and control spaces', () => {
  assert.equal(latexTitleText('Electrode--Part Load'), 'Electrode–Part Load');      // en-dash
  assert.equal(latexTitleText('FGM --- Pre-Warp'), 'FGM — Pre-Warp');                // em-dash
  assert.equal(latexTitleText('vs.\\ Spacing'), 'vs. Spacing');                            // control space
  assert.equal(latexTitleText('A\\,B'), 'A B');                                            // thin space
  assert.equal(latexTitleText('A~B'), 'A B');                                              // non-breaking space
});

test('parseLatexChapters follows \\include order across files, one chapter each', () => {
  const main = `\\documentclass{book}
\\begin{document}
\\include{chapters/intro}
\\include{chapters/methods}
\\end{document}`;
  const files = {
    'chapters/intro': '\\chapter{Introduction}\nHello.',
    'chapters/methods': '\\chapter{Methods}\nWorld.',
  };
  const chs = parseLatexChapters(main, p => files[p] ?? null);
  assert.deepEqual(chs, [
    { id: 'intro', n: 1, title: 'Introduction', sourceFile: 'chapters/intro.tex' },
    { id: 'methods', n: 2, title: 'Methods', sourceFile: 'chapters/methods.tex' },
  ]);
});

test('parseLatexChapters treats \\input like \\include', () => {
  const main = '\\input{chapters/a}';
  const chs = parseLatexChapters(main, () => '\\chapter{Alpha}');
  assert.equal(chs.length, 1);
  assert.equal(chs[0].id, 'a');
  assert.equal(chs[0].title, 'Alpha');
});

test('parseLatexChapters ignores commented-out includes', () => {
  const main = '% \\include{chapters/skip}\n\\include{chapters/keep}';
  const chs = parseLatexChapters(main, p => p === 'chapters/keep' ? '\\chapter{Keep}' : null);
  assert.deepEqual(chs.map(c => c.id), ['keep']);
});

test('parseLatexChapters handles a single-file document with multiple \\chapter', () => {
  const main = '\\chapter{Alpha}\nfoo\n\\chapter{Beta}\nbar';
  const chs = parseLatexChapters(main, () => null);
  assert.deepEqual(chs, [
    { id: 'alpha', n: 1, title: 'Alpha', sourceFile: 'main.tex' },
    { id: 'beta', n: 2, title: 'Beta', sourceFile: 'main.tex' },
  ]);
});

test('parseLatexChapters reads the optional short-title form and strips formatting', () => {
  const chs = parseLatexChapters('\\include{ch/x}', () => '\\chapter[Short]{The \\textbf{RF} Method}');
  assert.equal(chs[0].title, 'The RF Method');
});

test('parseLatexChapters skips included files that contain no \\chapter', () => {
  const main = '\\include{chapters/frontmatter}\n\\include{chapters/one}';
  const files = { 'chapters/frontmatter': 'no chapter here', 'chapters/one': '\\chapter{One}' };
  const chs = parseLatexChapters(main, p => files[p] ?? null);
  assert.deepEqual(chs.map(c => c.id), ['one']);
});

test('parseLatexChapters dedupes colliding ids by suffixing', () => {
  const main = '\\chapter{Intro}\n\\chapter{Intro}';
  const chs = parseLatexChapters(main, () => null);
  assert.deepEqual(chs.map(c => c.id), ['intro', 'intro-2']);
});

// ---- \section fallback: articles (elsarticle etc.) have no \chapter — use \section as the unit ----
test('parseLatexChapters falls back to \\section when a single-file doc has no \\chapter', () => {
  const tex = `\\documentclass{elsarticle}
\\begin{document}
\\section{Introduction}\\label{sec:intro}
text
\\subsection{Background}
more text
\\section{Methodology}
\\subsection{Design}
\\section{Conclusions}
\\end{document}`;
  const chs = parseLatexChapters(tex);
  assert.deepEqual(chs.map(c => c.title), ['Introduction', 'Methodology', 'Conclusions']);   // sections only, not subsections
  assert.equal(chs[0].sourceFile, 'main.tex');
  assert.equal(chs.length, 3);
});

test('parseLatexChapters counts starred sections too (e.g. Acknowledgments)', () => {
  const tex = `\\section{Introduction}\n\\section*{Acknowledgments}\n`;
  assert.deepEqual(parseLatexChapters(tex).map(c => c.title), ['Introduction', 'Acknowledgments']);
});

test('parseLatexChapters still prefers \\chapter when both chapters and sections exist', () => {
  const tex = `\\chapter{One}\n\\section{A}\n\\chapter{Two}\n\\section{B}\n`;
  assert.deepEqual(parseLatexChapters(tex).map(c => c.title), ['One', 'Two']);
});

test('parseLatexChapters does not treat \\subsection as a top-level \\section unit', () => {
  const tex = `\\section{Only}\n\\subsection{Nested}\n\\subsubsection{Deeper}\n`;
  assert.deepEqual(parseLatexChapters(tex).map(c => c.title), ['Only']);
});

// ---- detectUnitLevel: expose the reading-unit level so the import flow can set doc.unitNoun ----
test('detectUnitLevel returns "chapter" for a document with \\chapter', () => {
  const tex = `\\documentclass{book}\n\\begin{document}\n\\chapter{Introduction}\ntext\n\\end{document}`;
  assert.equal(detectUnitLevel(tex), 'chapter');
});

test('detectUnitLevel returns "section" for an article with only \\section', () => {
  const tex = `\\documentclass{elsarticle}\n\\begin{document}\n\\section{Introduction}\n\\subsection{Background}\n\\section{Methods}\n\\end{document}`;
  assert.equal(detectUnitLevel(tex), 'section');
});

test('detectUnitLevel is consistent across an \\include-assembled document (chapter in an included file)', () => {
  const main = `\\documentclass{book}\n\\begin{document}\n\\include{chapters/intro}\n\\end{document}`;
  const files = { 'chapters/intro': '\\chapter{Introduction}\n\\section{Background}' };
  assert.equal(detectUnitLevel(main, p => files[p] ?? null), 'chapter');
});

// ---- resolveUnitNoun: the import-flow guard — adopt the detected level, but never clobber a custom noun ----
test('resolveUnitNoun adopts the detected level over an auto-managed default', () => {
  assert.equal(resolveUnitNoun('chapter', 'section'), 'section');
  assert.equal(resolveUnitNoun('section', 'chapter'), 'chapter');
});

test('resolveUnitNoun keeps a default unchanged when detection agrees', () => {
  assert.equal(resolveUnitNoun('chapter', 'chapter'), 'chapter');
});

test('resolveUnitNoun respects a custom (explicitly overridden) noun and never clobbers it', () => {
  assert.equal(resolveUnitNoun('part', 'section'), 'part');
  assert.equal(resolveUnitNoun('essay', 'chapter'), 'essay');
});

test('resolveUnitNoun keeps the current noun when nothing was detected', () => {
  assert.equal(resolveUnitNoun('chapter', null), 'chapter');
  assert.equal(resolveUnitNoun('part', ''), 'part');
});
