import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLatexChapters, slugifyId, latexTitleText, parseDocxChapters } from '../js/docparse.js';

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
