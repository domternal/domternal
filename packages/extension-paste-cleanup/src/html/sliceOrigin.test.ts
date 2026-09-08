// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizePasteHTML } from './index.js';
import { normalizeClipboardHTML } from './normalize.js';
import type { NormalizePasteHTMLOptions, NormalizePasteHTMLResult } from './types.js';

// Authored ProseMirror, Tiptap-like and Word-like clipboard HTML, not native captures.
const NONCE = 'Qz3_-Qz3_-Qz3_-Qz3_-Qz';
const copyMarker = `data-domternal-copy="v1.${NONCE}"`;
const own = (html: string, options: NormalizePasteHTMLOptions = {}, confirm = (nonce: string): boolean => nonce === NONCE): NormalizePasteHTMLResult =>
  normalizeClipboardHTML(html, options, undefined, undefined, undefined, confirm).result;
const slices = (html: string): string[] => [...html.matchAll(/data-pm-slice="([^"]*)"/g)].map(match => (match[1] ?? '').replaceAll('&#x22;', '"'));
const warnings = (result: NormalizePasteHTMLResult): string[] => result.diagnostics.filter(item => item.severity !== 'info').map(item => item.code);
const officeItem = (marker: string, text: string): string =>
  `<p class=MsoListParagraph style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">${marker}<span>&nbsp; </span></span>${text}</p>`;
const styled = '<p data-pm-slice="1 1 []" style="text-align:center"><span style="font-family:Comic Sans MS;font-size:30px;color:red">Styled</span></p>';

describe('foreign data-pm-slice markers', () => {
  it('applies adapt to a Tiptap-like slice and keeps its canonical structural marker', () => {
    const result = normalizePasteHTML(styled, { formatting: 'adapt' });
    expect(result.html).toBe('<p data-pm-slice="1 1 []"><span>Styled</span></p>');
    expect(result.diagnostics.every(item => item.code === 'formatting-adapted')).toBe(true);
    expect(normalizePasteHTML(styled).html).toBe('<p data-pm-slice="1 1 []" style="text-align:center"><span><span style="font-family:Comic Sans MS;font-size:30px;color:red">Styled</span></span></p>');
  });

  it('applies adapt to a Confluence-like table slice', () => {
    const result = normalizePasteHTML('<table data-pm-slice="1 1 []"><tbody><tr><td style="background-color:#ffeeaa"><p><span style="color:#ff0000">Cell</span></p></td></tr></tbody></table>', { formatting: 'adapt' });
    expect(result.html).toBe('<table data-pm-slice="1 1 []"><tbody><tr><td><p><span>Cell</span></p></td></tr></tbody></table>');
    expect(result.source).toBe('html');
  });

  it('removes a nested marker whose descent would drop the other root blocks', () => {
    for (const formatting of ['preserve', 'adapt'] as const) {
      const result = normalizePasteHTML('<p>Keep first</p><div><p>Also keep</p><p><span data-pm-slice="0 0 -1 []">x</span></p></div><p>Last</p>', { formatting });
      expect(result.html).toBe('<p>Keep first</p><div><p>Also keep</p><p><span>x</span></p></div><p>Last</p>');
      expect(result.diagnostics).toEqual([]);
    }
  });

  it.each([
    ['an empty span three containers deep', `${officeItem('1.', 'One')}${officeItem('2.', 'Two')}<div><div><div><span data-pm-slice="0 0 []"></span></div></div></div>`],
    ['an inline element inside the run', `${officeItem('1.', 'One')}${officeItem('2.', 'Two <b data-pm-slice="0 0 []">bold</b>')}`],
  ])('does not let a marker on %s disable Word list reconstruction', (_name, html) => {
    const result = normalizePasteHTML(html);
    expect(result.html).toMatch(/^<ol style="list-style-type:decimal" start="1"><li><p>One<\/p><\/li><li><p>Two/);
    expect(result.html).not.toContain('data-pm-slice');
    expect(warnings(result)).toEqual([]);
  });

  it.each([
    ['two markers', '<p data-pm-slice="0 0 []">A</p><p data-pm-slice="0 0 []">B</p>', '<p>A</p><p>B</p>'],
    ['text before the marked element', 'Loose<p data-pm-slice="0 0 []">A</p>', 'Loose<p>A</p>'],
    ['an element before the marked element', '<p>First</p><p data-pm-slice="0 0 []">A</p>', '<p>First</p><p>A</p>'],
    ['a sibling a wrapper descent would drop', '<table data-pm-slice="1 1 -3 []"><tbody><tr><td>A</td></tr></tbody></table><p>After</p>', '<table><tbody><tr><td>A</td></tr></tbody></table><p>After</p>'],
    ['a second wrapper child a descent would drop', '<table data-pm-slice="1 1 -2 []"><thead><tr><td>H</td></tr></thead><tbody><tr><td>A</td></tr></tbody></table>', '<table><thead><tr><td>H</td></tr></thead><tbody><tr><td>A</td></tr></tbody></table>'],
    ['an invalid context', '<p data-pm-slice=\'1 1 ["unknownNode",{}]\'>A</p>', '<p>A</p>'],
  ])('removes every marker when it is not canonical: %s', (_name, html, expected) => {
    expect(normalizePasteHTML(html).html).toBe(expected);
  });

  it('removes a canonical marker that Office list reconstruction moves away from the root', () => {
    const html = officeItem('1.', 'One').replace('<p ', '<p data-pm-slice="0 0 []" ') + officeItem('2.', 'Two');
    const result = normalizePasteHTML(html);
    expect(result.html).toBe('<ol style="list-style-type:decimal" start="1"><li><p>One</p></li><li><p>Two</p></li></ol>');
  });

  it('keeps a canonical table wrapper marker after a browser charset prefix', () => {
    const html = "<meta charset='utf-8'><table data-pm-slice=\"1 1 -3 []\"><tbody><tr><td>A</td><td>B</td></tr></tbody></table>";
    expect(normalizePasteHTML(html).html).toBe('<table data-pm-slice="1 1 -3 []"><tbody><tr><td>A</td><td>B</td></tr></tbody></table>');
  });

  it('keeps structural context and drops context formatting that adapt removes', () => {
    const context = JSON.stringify(['tableRow', null, 'tableCell', { colspan: 2, background: '#ff0000', verticalAlign: 'top', textAlign: 'center' }]);
    const html = `<p data-pm-slice='2 2 ${context}'>Cell</p>`;
    expect(slices(normalizePasteHTML(html).html)).toEqual([`2 2 ${context}`]);
    const adapted = normalizePasteHTML(html, { formatting: 'adapt' });
    expect(slices(adapted.html)).toEqual([`2 2 ${JSON.stringify(['tableRow', null, 'tableCell', { colspan: 2, verticalAlign: 'top' }])}`]);
    expect(adapted.diagnostics).toEqual([{ code: 'formatting-adapted', severity: 'info', offset: 0 }]);
    expect(slices(normalizePasteHTML(html, { formatting: 'adapt', preserveTextAlignment: true }).html))
      .toEqual([`2 2 ${JSON.stringify(['tableRow', null, 'tableCell', { colspan: 2, verticalAlign: 'top', textAlign: 'center' }])}`]);
  });

  it('treats every fragment as external in the standalone entry, even with a copy marker', () => {
    const result = normalizePasteHTML(styled.replace('<p ', `<p ${copyMarker} `), { formatting: 'adapt' });
    expect(result.html).toBe('<p data-pm-slice="1 1 []"><span>Styled</span></p>');
  });
});

describe('Domternal own copies', () => {
  const copied = `<p ${copyMarker} data-pm-slice="1 1 []" style="text-align:center"><span data-text-color="red" style="font-family:Arial;font-size:18px;color:#123456">Own</span></p>`;

  it('keeps editor formatting of a verified own copy in adapt and never emits the copy marker', () => {
    const result = own(copied, { formatting: 'adapt' });
    expect(result.html).toBe('<p data-pm-slice="1 1 []" style="text-align:center"><span data-text-color="red" style="font-family:Arial;font-size:18px;color:#123456">Own</span></p>');
    expect(result.diagnostics).toEqual([]);
  });

  it('recognizes an own copy behind a browser charset prefix and table wrappers', () => {
    const html = `<meta charset='utf-8'><table data-pm-slice="1 1 -3 []"><tbody><tr><td ${copyMarker} style="background-color:#ffeeaa"><p><span style="color:#123456">A</span></p></td><td><p>B</p></td></tr></tbody></table>`;
    const result = own(html, { formatting: 'adapt' });
    expect(result.html).toContain('#ffeeaa');
    expect(result.html).toContain('color:#123456');
    expect(result.html).not.toContain('data-domternal-copy');
  });

  it.each([
    ['an unknown nonce', copied, (): boolean => false],
    ['a throwing verifier', copied, (): boolean => { throw new Error('registry unavailable'); }],
    ['a malformed marker', copied.replace(`v1.${NONCE}`, `v2.${NONCE}`), undefined],
    ['a short nonce', copied.replace(`v1.${NONCE}`, `v1.${NONCE.slice(1)}`), undefined],
    ['a marker on another element', `<p data-pm-slice="1 1 []" style="text-align:center"><span ${copyMarker} style="color:#123456">Own</span></p>`, undefined],
    ['two markers', `${copied}<p ${copyMarker}>Second</p>`, undefined],
    ['a marker without a canonical anchor', `<p>First</p>${copied}`, undefined],
  ])('treats a fragment with %s as external', (_name, html, confirm) => {
    const result = own(html, { formatting: 'adapt' }, confirm);
    expect(result.html).not.toMatch(/text-align|font-family|#123456|data-text-color|data-domternal-copy/);
  });

  it('keeps comment thread anchors for own copies and external slices in both modes', () => {
    const html = '<p data-pm-slice="1 1 []"><span data-thread-ids="thread-1 thread-2" style="color:#123456">Commented</span> text</p>';
    for (const formatting of ['preserve', 'adapt'] as const) {
      expect(own(html.replace('<p ', `<p ${copyMarker} `), { formatting }).html).toContain('data-thread-ids="thread-1 thread-2"');
      expect(normalizePasteHTML(html, { formatting }).html).toContain('data-thread-ids="thread-1 thread-2"');
    }
  });

  it('keeps Office list reconstruction off for a verified own copy', () => {
    const html = `<div ${copyMarker} data-pm-slice="0 0 []">${officeItem('1.', 'Literal')}</div>`;
    expect(own(html).html).not.toContain('<ol');
    expect(normalizePasteHTML(html).html).toContain('<ol');
  });
});
