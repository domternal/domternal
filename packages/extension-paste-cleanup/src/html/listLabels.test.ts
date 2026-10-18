// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ExtendedListLabel } from '@domternal/core/list-labels';
import { DEFAULT_PASTE_HTML_LIMITS, normalizePasteHTML } from './normalize.js';
import { parseBoundedHTML } from './parse.js';
import { cleanSliceContext } from './metadata.js';
import { listLabelStyleName, readCompanionListStyle, readHTMLListLabel } from './listLabels.js';

const counter = { kind: 'counter', format: 'upper-alpha', prefix: 'Section ', suffix: ') ' } as const;
const bullet = { kind: 'text', text: '✓' } as const;
const compound: ExtendedListLabel = { kind: 'compound', parts: [{ ancestor: 1, format: 'inherit' }, '.', { ancestor: 0, format: 'decimal' }, ' '], fallback: 'decimal' };
const image: ExtendedListLabel = { kind: 'image', src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAwAAAAMCAYAAABWdVznAAAAFklEQVR4nGO4o2zznxTMMKphVAN2DAArDECw1uKo8wAAAABJRU5ErkJggg==', text: '◆' };
function attribute(value: unknown): string { return JSON.stringify(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'); }
function list(tag: string, label: unknown, style = ''): string {
  return `<${tag} data-dm-list-label="${attribute(label)}"${style === '' ? '' : ` style="${style}"`}><li><p>Item</p></li></${tag}>`;
}

describe('bounded list label clipboard metadata', () => {
  it('retains a validated local PNG marker and only its compiler-owned image variable', () => {
    const name = listLabelStyleName(image);
    const style = `list-style-type:var(--${name}, disc);list-style-image:var(--${name}-image, none)`;
    for (const formatting of ['adapt', 'preserve'] as const) {
      const result = normalizePasteHTML(list('ul', image, style), { formatting });
      expect(result.diagnostics).toEqual([]); expect(result.html).toContain('list-style-image:');
      expect(result.html).toContain('data-dm-list-label'); expect(normalizePasteHTML(result.html, { formatting })).toEqual(result);
    }
    for (const value of ['url(https://example.test/remote.png)', `var(--${name}-other, none)`, 'var(--host-image)']) {
      const result = normalizePasteHTML(list('ul', image, `list-style-image:${value}`));
      expect(result.html).not.toContain('list-style-image:');
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'unsupported-formatting' }));
    }
  });
  it.each([['ol', counter, 'upper-alpha'], ['ul', bullet, 'disc'], ['ol', compound, 'decimal']] as const)('retains %s metadata and its exact native companion style in both policies', (tag, label, fallback) => {
    const name = listLabelStyleName(label);
    for (const formatting of ['adapt', 'preserve'] as const) {
      const result = normalizePasteHTML(list(tag, label, `list-style-type:var(--${name}, ${fallback})`), { formatting });
      expect(result.status).toBe('cleaned');
      expect(result.diagnostics).toEqual([]);
      expect(result.html).toContain(`style="list-style-type:var(--${name}, ${fallback})"`);
      expect(result.html).toContain('data-dm-list-label=');
      expect(normalizePasteHTML(result.html, { formatting })).toEqual(result);
    }
  });

  it('retains compound source metadata but discards derived presentation supplied by the clipboard', () => {
    const html = list('ol', compound).replace('<li>', '<li data-dm-compound-marker="spoofed">');
    const result = normalizePasteHTML(html);
    expect(result.diagnostics).toEqual([]);
    expect(result.html).toContain('data-dm-list-label');
    expect(result.html).not.toContain('data-dm-compound-marker');
    expect(result.html).not.toContain('spoofed');
  });

  it('canonicalizes the closed record without deriving an ordinal from its label', () => {
    const result = normalizePasteHTML(list('ol', { suffix: ') ', prefix: 'Section ', format: 'upper-alpha', kind: 'counter' }));
    expect(result.html).toBe(list('ol', counter).replaceAll('&quot;', '&#x22;'));
    expect(result.diagnostics).toEqual([]);
    expect(result.html).not.toContain('start=');
  });

  it('keeps the native marker precedence while reporting unrelated CSS variables', () => {
    const style = `list-style-type:var(--${listLabelStyleName(counter)}, upper-alpha)`;
    const first = normalizePasteHTML(list('ol', counter, `${style};list-style-type:decimal`));
    expect(first.html).toContain('style="list-style-type:decimal"');
    const last = normalizePasteHTML(list('ol', counter, `list-style-type:decimal;${style}`));
    expect(last.html).toContain(`style="${style}"`);
    const foreign = normalizePasteHTML(list('ol', counter, `${style};list-style-type:var(--host-marker)`));
    expect(foreign.html).toContain(`style="${style}"`);
    expect(foreign.diagnostics).toContainEqual(expect.objectContaining({ code: 'unsupported-formatting' }));
    expect(foreign.html).not.toContain('--host-marker');
  });

  it.each([
    ['ol', bullet], ['ul', counter], ['li', bullet], ['p', counter], ['ol', null],
    ['ol', { ...counter, extra: 'ignored' }], ['ol', { ...counter, format: 'decimal-leading-zero' }],
    ['ul', { kind: 'text', text: '\u202ehidden' }], ['ul', { kind: 'text', text: 'x'.repeat(65) }],
  ])('drops unsupported %s metadata %j and reports the lost formatting', (tag, label) => {
    const result = normalizePasteHTML(list(tag, label));
    expect(result.html).not.toContain('data-dm-list-label');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'unsupported-formatting' }));
  });

  it('refuses forged companion names, mismatched fallback kinds and unbounded JSON', () => {
    const name = listLabelStyleName(counter);
    for (const style of [`var(--${name}00, decimal)`, `var(--${name}, square)`, `var(--${name}, url(https://example.test/a))`, `var(--${name}, decimal)!important`]) {
      const result = normalizePasteHTML(list('ol', counter, `list-style-type:${style}`));
      expect(result.html).not.toContain('style=');
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'unsupported-formatting' }));
    }
    expect(readHTMLListLabel({ dataDmListLabel: ' '.repeat(1_025) + JSON.stringify(counter) }, 'ol')).toBeNull();
    expect(readHTMLListLabel({ dataDmListLabel: '{' }, 'ol')).toBeNull();
    expect(readHTMLListLabel({ dataDmListLabel: JSON.stringify(bullet), dataType: 'taskList' }, 'ul')).toBeNull();
    expect(readCompanionListStyle(`var(--${name}, decimal)`, 'ol', undefined)).toBeUndefined();
  });

  it('keeps quote and markup characters as data, never inline CSS or HTML', () => {
    const label: ExtendedListLabel = { kind: 'text', text: '"><script>test()</script>\\' };
    const result = normalizePasteHTML(list('ul', label, `list-style-type:var(--${listLabelStyleName(label)}, disc)`));
    expect(result.diagnostics).toEqual([]);
    const parsed = parseBoundedHTML(result.html, DEFAULT_PASTE_HTML_LIMITS);
    const wrapper = parsed.children[0];
    expect(wrapper?.type).toBe('element');
    if (wrapper?.type !== 'element') throw new Error('Expected list');
    expect(readHTMLListLabel(wrapper.properties, wrapper.tagName)).toEqual(label);
    expect(wrapper.children).toHaveLength(1);
    expect(wrapper.children[0]).toMatchObject({ type: 'element', tagName: 'li' });
    expect(result.html).not.toContain('url(');
    expect(result.html).toContain('data-dm-list-label');
  });

  it('retains labels only on matching slice wrappers, including nullable defaults', () => {
    const source = ['orderedList', { listLabel: counter }, 'listItem', { listLabel: bullet }, 'bulletList', { listLabel: bullet }, 'listItem', null];
    expect(cleanSliceContext(`1 1 ${JSON.stringify(source)}`)).toBe(`1 1 ${JSON.stringify(['orderedList', { listLabel: counter }, 'listItem', {}, 'bulletList', { listLabel: bullet }, 'listItem', null])}`);
    expect(cleanSliceContext('1 1 ["orderedList",{"listLabel":null}]')).toBe('1 1 ["orderedList",{"listLabel":null}]');
    expect(cleanSliceContext(`1 1 ${JSON.stringify(['orderedList', { listLabel: bullet }])}`)).toBe('1 1 ["orderedList",{}]');
  });
});
