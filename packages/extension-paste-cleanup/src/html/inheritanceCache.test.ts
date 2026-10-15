import { afterEach, describe, expect, it, vi } from 'vitest';
import { toHtml } from 'hast-util-to-html';
import type { Element } from 'hast';
import * as styles from './styles.js';
import { parseBoundedHTML } from './parse.js';
import { resolveInlineInheritance } from './inheritance.js';
import type { InlineInheritanceOptions } from './inheritance.js';
import { listLabelStyleName } from './listLabels.js';

const limits = { maxInputLength: 2_000_000, maxNodes: 30_000, maxDepth: 128, maxDiagnostics: 100,
  maxTableCells: 20_000, maxImages: 200, maxImagePixels: 50_000_000 };
afterEach(() => { vi.restoreAllMocks(); });
function resolve(html: string, options: Partial<InlineInheritanceOptions> = {}): { html: string; unsupported: Element[] } {
  const tree = parseBoundedHTML(html, limits);
  const unsupported: Element[] = [];
  resolveInlineInheritance(tree, { ...limits, ...options }, node => { unsupported.push(node); });
  return { html: toHtml(tree), unsupported };
}

describe('per-pass inheritance parse reuse', () => {
  it('parses repeated declarations once while retaining a separate warning and position for each source element', () => {
    const read = vi.spyOn(styles, 'readSafeStyles');
    const input = '<p>' + Array.from({ length: 40 }, (_, i) => `<span style="color:red;font-size:12pt;unknown:value">Text ${String(i)}</span>`).join('') + '</p>';
    const result = resolve(input);
    expect(read).toHaveBeenCalledTimes(3);
    expect(result.unsupported).toHaveLength(40);
    expect(new Set(result.unsupported.map(node => node.position?.start.offset)).size).toBe(40);
    expect(result.html.match(/color:red/g)).toHaveLength(40);
    expect(result.html.match(/font-size:12pt/g)).toHaveLength(40);
  });

  it('resolves identical relative declarations against each independent parent and retains sibling resets', () => {
    const result = resolve('<div style="font-size:10pt;color:red"><span style="font-size:2em">First</span></div>'
      + '<div style="font-size:15pt;color:blue"><span style="font-size:2em">Second</span></div>'
      + '<p><span style="color:green">Third</span><span style="color:green">Fourth</span></p>');
    expect(result.html).toContain('font-size:20pt;color:red">First');
    expect(result.html).toContain('font-size:30pt;color:blue">Second');
    expect(result.html.match(/color:green/g)).toHaveLength(2);
    expect(result.unsupported).toEqual([]);
  });

  it('keeps element-specific rules distinct for the same attribute', () => {
    const result = resolve('<p><img src="image.png" style="float:right;color:blue">'
      + '<span style="float:right;color:blue">Text</span><img src="other.png" style="float:right;color:blue"></p>');
    expect(result.html.match(/float:right/g)).toHaveLength(2);
    expect(result.unsupported).toHaveLength(1);
    expect(result.unsupported[0]?.tagName).toBe('span');
  });

  it('does not retain parse facts between calls with different source color policies', () => {
    const input = '<p><span style="color:#123456;caret-color:#123456">A</span><span style="color:#123456;caret-color:#123456">B</span></p>';
    expect(resolve(input, { wordSource: true }).html).not.toContain('color:');
    expect(resolve(input).html.match(/color:#123456/g)).toHaveLength(2);
    expect(resolve(input, { defaultTextColor: '#123456' }).html).not.toContain('color:');
  });

  it('does not share a compiled marker allowance with another list using the same style text', () => {
    const label = { kind: 'counter', format: 'decimal', prefix: 'Part ', suffix: ') ' } as const;
    const name = listLabelStyleName(label);
    const metadata = JSON.stringify(label).replaceAll('"', '&quot;');
    const list = (valid: boolean): string => `<ol${valid ? ` data-dm-list-label="${metadata}"` : ''} style="list-style-type:var(--${name}, decimal)"><li><p>Item</p></li></ol>`;
    const result = resolve(list(true) + list(false) + list(true));
    expect(result.html.split(`var(--${name}, decimal)`).length - 1).toBe(2);
    expect(result.unsupported).toHaveLength(1);
    expect(result.unsupported[0]?.properties['dataDmListLabel']).toBeUndefined();
  });

  it('keeps many distinct styles and long uncached attributes correct', () => {
    const unique = Array.from({ length: 260 }, (_, i) => `<span style="font-size:${String(i + 1)}px">T${String(i)}</span>`).join('');
    const large = 'mso-private:'.padEnd(2100, 'x') + ';color:red';
    const result = resolve(`<p>${unique}<span style="${large}">Last</span><span style="${large}">Again</span></p>`);
    for (let i = 0; i < 260; i++) expect(result.html).toContain(`font-size:${String(i + 1)}px">T${String(i)}`);
    expect(result.html.match(/color:red/g)).toHaveLength(2);
    expect(result.unsupported).toEqual([]);
  });
});
