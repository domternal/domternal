// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizePasteHTML } from './index.js';

const adapted = (offset: number): unknown => ({ code: 'formatting-adapted', severity: 'info', offset });

describe('adapt through the public normalizer', () => {
  it('keeps inherited emphasis and resets without generating typography carriers', () => {
    const html = '<div style="font-family:Calibri;font-size:16px;color:#123456"><p><strong>Bold<span style="font-weight:400;color:#654321">Plain</span>Again</strong>'
      + '<em>Italic<span style="font-style:normal">Roman</span></em></p></div>';
    const result = normalizePasteHTML(html, { formatting: 'adapt' });
    expect(result.status).toBe('cleaned');
    expect(result.html).toBe('<div><p><span><strong>Bold</strong><span>Plain</span><strong>Again</strong></span>'
      + '<span><em>Italic</em><span>Roman</span></span></p></div>');
    const plain = html.indexOf('<span style="font-weight:400');
    expect(result.diagnostics).toEqual([adapted(0), adapted(0), adapted(0), adapted(plain)]);
  });

  it('keeps semantic marks on styled breaks and scripts while dropping highlights', () => {
    const html = '<p><span style="color:red;background-color:yellow"><b>A<br>B</b></span><sub>2</sub><mark>M</mark>'
      + '<mark style="background-color:transparent">T</mark></p>';
    const result = normalizePasteHTML(html, { formatting: 'adapt' });
    expect(result.html).toBe('<p><span><span><strong>A</strong><strong><br></strong><strong>B</strong></span></span>'
      + '<span><sub>2</sub></span><span>M</span><span>T</span></p>');
    expect(result.diagnostics).toEqual([adapted(3), adapted(3), adapted(html.indexOf('<mark>'))]);
  });

  it('drops inline color tokens as intentional adaptation', () => {
    const result = normalizePasteHTML('<p><span data-text-color="red" data-bg-color="blue">T</span></p>', { formatting: 'adapt' });
    expect(result.html).toBe('<p><span>T</span></p>');
    expect(result.diagnostics).toEqual([adapted(3), adapted(3)]);
  });

  it('counts a mark default highlight only when no highlight token replaces it', () => {
    expect(normalizePasteHTML('<p><mark data-bg-color="red">M</mark></p>', { formatting: 'adapt' }).diagnostics).toEqual([adapted(3)]);
    expect(normalizePasteHTML('<p><mark data-text-color="red">M</mark></p>', { formatting: 'adapt' }).diagnostics).toEqual([adapted(3), adapted(3)]);
  });

  it('reports a declaration once when the parser duplicates a misnested formatting element', () => {
    const result = normalizePasteHTML('<p><font style="color:red">A</p><p>B</p><p>C</font></p>', { formatting: 'adapt' });
    expect(result.html).toBe('<p>A</p><p>B</p><p>C</p>');
    expect(result.diagnostics.filter(item => item.code === 'formatting-adapted')).toEqual([adapted(3)]);
  });

  it('treats an unknown relative size as adaptation, not as a preserved-typography loss', () => {
    const html = '<p style="font-size:2em">Unknown</p>';
    expect(normalizePasteHTML(html, { formatting: 'adapt' })).toMatchObject({ html: '<p>Unknown</p>', diagnostics: [adapted(0)] });
    expect(normalizePasteHTML(html)).toMatchObject({
      html: '<p>Unknown</p>', diagnostics: [{ code: 'unsupported-formatting', severity: 'warning', offset: 0 }],
    });
  });

  it('still reports malformed style values in adapt mode', () => {
    const result = normalizePasteHTML('<p><span style="color:url(x)">T</span></p>', { formatting: 'adapt' });
    expect(result).toMatchObject({ status: 'cleaned', html: '<p><span>T</span></p>' });
    expect(result.diagnostics).toEqual([{ code: 'unsupported-formatting', severity: 'warning', offset: 3 }]);
  });

  describe('resource boundaries', () => {
    const paragraphs = '<p>x</p>'.repeat(20);

    it('generates no typography carriers against the node budget', () => {
      const html = `<div style="color:red">${paragraphs}</div>`;
      const accepted = normalizePasteHTML(html, { formatting: 'adapt', limits: { maxNodes: 44 } });
      expect(accepted).toMatchObject({ status: 'cleaned', html: `<div>${paragraphs}</div>`, diagnostics: [adapted(0)] });
      expect(normalizePasteHTML(html, { formatting: 'adapt', limits: { maxNodes: 43 } })).toMatchObject({
        status: 'rejected', html: '', diagnostics: [{ code: 'structure-limit', severity: 'error' }],
      });
      // Preserve materializes one typography carrier per text leaf, so the same budget cannot hold it.
      expect(normalizePasteHTML(html, { limits: { maxNodes: 61 } })).toMatchObject({ status: 'rejected' });
      expect(normalizePasteHTML(html, { limits: { maxNodes: 62 } })).toMatchObject({ status: 'cleaned' });
    });

    it('generates no inherited style text against the shared input budget', () => {
      const html = `<div style="color:#123456">${paragraphs}</div>`;
      const limits = { maxInputLength: html.length };
      expect(normalizePasteHTML(html, { formatting: 'adapt', limits })).toMatchObject({
        status: 'cleaned', html: `<div>${paragraphs}</div>`, diagnostics: [adapted(0)],
      });
      expect(normalizePasteHTML(html, { limits })).toMatchObject({
        status: 'rejected', html: '', diagnostics: [{ code: 'structure-limit', severity: 'error' }],
      });
    });
  });
});
