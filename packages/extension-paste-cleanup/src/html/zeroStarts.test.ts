// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizePasteHTML } from './index.js';

describe('zero-based list HTML', () => {
  it.each(['preserve', 'adapt'] as const)('retains zero list starts and item values in %s mode', formatting => {
    const html = '<ol start="0"><li value="0"><p>Zero</p></li><li><p>One</p></li></ol>';
    const result = normalizePasteHTML(html, { formatting });
    expect(result.status).toBe('cleaned');
    expect(result.html).toBe(html);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(['', ' ', '-1', 'invalid', '10001', 'Infinity'])('retains the existing list-attribute bounds for %j', value => {
    const result = normalizePasteHTML(`<ol start="${value}"><li value="${value}"><p>Item</p></li></ol>`);
    expect(result.html).toBe('<ol><li><p>Item</p></li></ol>');
  });

  it('reads an encoded zero after HTML character references are decoded', () => {
    const result = normalizePasteHTML('<ol start="&#48;"><li value="&#x30;"><p>Zero</p></li></ol>');
    expect(result.html).toBe('<ol start="0"><li value="0"><p>Zero</p></li></ol>');
  });

  it('does not turn zero dimensions or table spans into list starts', () => {
    const result = normalizePasteHTML('<table><colgroup><col span="0" width="0"></colgroup><tr><td colspan="0" rowspan="0"><p>Cell</p></td></tr></table>');
    expect(result.status).toBe('cleaned');
    expect(result.html).not.toMatch(/(?:span|width|height)="0"/u);
    expect(result.html).toContain('Cell');
  });
});
