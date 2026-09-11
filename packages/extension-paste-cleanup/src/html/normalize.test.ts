// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizePasteHTML } from './index.js';

describe('normalizePasteHTML', () => {
  it('runs without a DOM and preserves supported semantic formatting', () => {
    expect(typeof document).toBe('undefined');
    const result = normalizePasteHTML('<p class="MsoNormal"><span style="font-weight:700;font-style:italic;color:#123456;font-size:12pt">Word</span></p>');
    expect(result.status).toBe('cleaned');
    expect(result.source).toBe('word');
    expect(result.html).toBe('<p><span><span style="font-size:12pt;color:#123456"><strong><em>Word</em></strong></span></span></p>');
  });

  it('adapts visual formatting while retaining emphasis and structure', () => {
    const html = '<h2><span style="font-family:Calibri;font-size:24pt;color:red;font-weight:bold">Title</span></h2>';
    const result = normalizePasteHTML(html, { formatting: 'adapt' });
    expect(result.html).toBe('<h2><span><strong>Title</strong></span></h2>');
    expect(result.diagnostics.every(d => d.code === 'formatting-adapted')).toBe(true);
    // Adaptation is reported on the element that declared the discarded typography.
    expect(result.diagnostics.map(d => d.offset)).toEqual([html.indexOf('<span'), html.indexOf('<span'), html.indexOf('<span')]);
  });

  it.each([
    ['<td rowspan="0">a</td><td>b</td>', '<td>a</td><td>b</td>'],
    ['<td colspan="">a</td><td>b</td>', '<td>a</td><td>b</td>'],
    ['<td colspan="abc">a</td><td>b</td>', '<td>a</td><td>b</td>'],
    ['<td colspan="2x">a</td>', '<td colspan="2">a</td>'],
    ['<td colspan=" 3 ">a</td>', '<td colspan="3">a</td>'],
    ['<td rowspan="2.5">a</td><td>b</td>', '<td rowspan="2">a</td><td>b</td>'],
  ])('reads the table span in %s as the Table extension does, instead of blocking the paste', (cells, expected) => {
    const result = normalizePasteHTML(`<table><tr>${cells}</tr><tr><td>c</td></tr></table>`);
    expect(result.status).not.toBe('rejected');
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).not.toContain('structure-limit');
    expect(result.html).toContain(`<tr>${expected}</tr>`);
  });

  it('still blocks a pasted table span above 1,000', () => {
    const result = normalizePasteHTML('<table><tr><td colspan="1001">a</td></tr></table>');
    expect(result.status).toBe('rejected');
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain('structure-limit');
  });

  it('preserves table spans and list starts', () => {
    const result = normalizePasteHTML('<ol start="7"><li><p>Seven</p><ul><li>Nested</li></ul></li></ol><table><tr><td colspan="2" rowspan="3">Merged</td></tr></table>');
    expect(result.html).toContain('<ol start="7">');
    expect(result.html).toContain('<td colspan="2" rowspan="3">Merged</td>');
    expect(result.html).toContain('<ul><li>Nested</li></ul>');
  });

  it.each([
    '<script>alert(1)</script><p onclick="alert(2)">Safe</p>',
    '<svg><foreignObject><p onload="alert(1)">Bad</p></foreignObject></svg><p>Safe</p>',
    '<iframe src="https://evil.test"><p>Bad</p></iframe><p>Safe</p>',
    '<template><img src=x onerror=alert(1)></template><p>Safe</p>',
    '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>"></table></mtext></math><p>Safe</p>',
  ])('removes active markup with located diagnostics: %s', html => {
    const result = normalizePasteHTML(html);
    expect(result.status).toBe('cleaned');
    expect(result.html).not.toMatch(/(?:script|iframe|svg|math|template|onerror|onclick|onload)/i);
    expect(result.html).toContain('Safe');
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.some(d => d.offset !== undefined)).toBe(true);
  });

  it.each(['javascript:alert(1)', 'jav&#x61;script:alert(1)', 'java&#10;script:alert(1)', 'file:///private/document', 'data:text/html;base64,PHNjcmlwdD4=', '/relative', '//example.com/a', '#heading'])('removes unsafe or unresolved links but retains text: %s', href => {
    const result = normalizePasteHTML(`<p><a href="${href}">Read</a></p>`);
    expect(result.html).toBe('<p><a>Read</a></p>');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'link-removed' }));
  });

  it('resolves only an explicit source URL and ignores pasted base tags', () => {
    const html = '<base href="https://evil.test"><a href="guide">Read</a>';
    expect(normalizePasteHTML(html).html).toBe('<a>Read</a>');
    expect(normalizePasteHTML(html, { sourceURL: 'https://source.test/docs/' }).html).toBe('<a href="https://source.test/docs/guide">Read</a>');
  });

  it('never retains resource-loading CSS or uncontrolled styling', () => {
    const result = normalizePasteHTML('<p style="background-image:url(https://evil.test/a);font-family:url(https://evil.test/font);color:expression(alert(1));position:fixed;text-align:center">Safe</p>');
    expect(result.html).toBe('<p style="text-align:center">Safe</p>');
    expect(result.diagnostics[0]?.code).toBe('unsupported-formatting');
  });

  it('drops remote, local, blob, SVG and invalid data images with alt fallback', () => {
    for (const src of ['https://example.test/pixel', 'file:///image.png', 'blob:local', 'cid:image1', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,YWJjZA==']) {
      const result = normalizePasteHTML(`<p>Before<img src="${src}" alt="Diagram">After</p>`);
      expect(result.html).toBe('<p>BeforeDiagramAfter</p>');
      expect(result.diagnostics[0]?.code).toBe('image-removed');
    }
  });

  it('requires explicit opt-in to retain remote image URLs', () => {
    expect(normalizePasteHTML('<img src="https://example.test/a.png" alt="A">', { allowRemoteImages: true }).html).toBe('<img src="https://example.test/a.png" alt="A">');
  });

  it('does not trust data-pm-slice to bypass sanitization', () => {
    const result = normalizePasteHTML('<p data-pm-slice=\'1 1 ["blockquote",{"onclick":"alert(1)"}]\' onclick="alert(2)">Text</p>');
    expect(result.html).toBe('<p data-pm-slice="1 1 [&#x22;blockquote&#x22;,{}]">Text</p>');
  });

  it('rejects excess input before parsing and never returns raw HTML', () => {
    expect(normalizePasteHTML('<p>Too long</p>', { limits: { maxInputLength: 5 } })).toMatchObject({ status: 'rejected', html: '', diagnostics: [{ code: 'input-limit', severity: 'error' }] });
  });

  it('rejects excess nesting and allocations instead of partially inserting', () => {
    for (const options of [{ maxDepth: 8 }, { maxNodes: 10 }]) {
      const result = normalizePasteHTML('<div>'.repeat(30) + 'Keep' + '</div>'.repeat(30), { limits: options });
      expect(result.status).toBe('rejected');
      expect(result.html).toBe('');
      expect(result.diagnostics.at(-1)?.code).toBe('structure-limit');
    }
  });

  it('bounds diagnostics without truncating valid text', () => {
    const result = normalizePasteHTML('<p style="position:fixed">Safe</p>'.repeat(10), { limits: { maxDiagnostics: 2 } });
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnosticsTruncated).toBe(true);
    expect(result.html).toBe('<p>Safe</p>'.repeat(10));
  });

  it.each([{ maxNodes: 6 }, { maxDepth: 5 }])('bounds generated semantic wrappers: %j', limits => {
    const html = '<p><span style="font-weight:700;font-style:italic;text-decoration:underline line-through;vertical-align:super">Text</span></p>';
    const result = normalizePasteHTML(html, { limits });
    expect(result.status).toBe('rejected');
    expect(result.html).toBe('');
    expect(result.diagnostics.at(-1)?.code).toBe('structure-limit');
  });

  it.each([0, -1, NaN, Infinity, 1.5, 10_000_000])('refuses invalid or expanded hard limits: %s', maxDepth => {
    expect(() => normalizePasteHTML('<p>Safe</p>', { limits: { maxDepth } })).toThrow(RangeError);
  });
});
