// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_PASTE_HTML_LIMITS, normalizePasteHTML } from './normalize.js';
import { parseBoundedHTML } from './parse.js';
import { cleanSliceContext } from './metadata.js';
import { collectDestinationDemand } from './destinationDemand.js';
import { listStyleFromType, validListStyle } from './listStyles.js';

const markers = [
  ['ol', 'decimal'], ['ol', 'lower-alpha'], ['ol', 'upper-alpha'], ['ol', 'lower-roman'], ['ol', 'upper-roman'],
  ['ul', 'disc'], ['ul', 'circle'], ['ul', 'square'],
] as const;
const limits = { ...DEFAULT_PASTE_HTML_LIMITS, maxNodes: 100, maxDepth: 16 };
function demand(html: string): readonly string[] {
  return collectDestinationDemand(parseBoundedHTML(html, limits), limits);
}

describe('bounded explicit list marker preservation', () => {
  it.each(markers)('retains %s %s in preserve and adapt without changing nested defaults', (tag, marker) => {
    for (const formatting of ['preserve', 'adapt'] as const) {
      const result = normalizePasteHTML(`<${tag} style="LIST-STYLE-TYPE: ${marker.toUpperCase()}"><li><p>Outer</p><${tag}><li><p>Inner</p></li></${tag}></li></${tag}>`, { formatting });
      expect(result.status).toBe('cleaned');
      expect(result.diagnostics).toEqual([]);
      expect(result.html).toBe(`<${tag} style="list-style-type:${marker}"><li><p>Outer</p><${tag}><li><p>Inner</p></li></${tag}></li></${tag}>`);
      expect(normalizePasteHTML(result.html, { formatting }).html).toBe(result.html);
      expect(demand(result.html)).toEqual([tag === 'ol' ? 'ordered-list' : 'bullet-list', 'nested-list', tag === 'ol' ? 'ordered-list-style' : 'bullet-list-style']);
    }
  });

  it.each([['1', 'decimal'], ['a', 'lower-alpha'], ['A', 'upper-alpha'], ['i', 'lower-roman'], ['I', 'upper-roman']])('retains the case-sensitive ordered HTML type %s', (type, marker) => {
    const result = normalizePasteHTML(`<ol start="7" type="${type}"><li><p>Item</p></li></ol>`);
    expect(result.html).toBe(`<ol start="7" type="${type}"><li><p>Item</p></li></ol>`);
    expect(listStyleFromType('ol', type)).toBe(marker);
    expect(demand(result.html)).toEqual(['ordered-list', 'ordered-list-style']);
  });

  it.each(['disc', 'circle', 'square'])('canonicalizes the legacy unordered type %s', marker => {
    const result = normalizePasteHTML(`<ul type="${marker.toUpperCase()}"><li><p>Item</p></li></ul>`, { formatting: 'adapt' });
    expect(result.html).toBe(`<ul style="list-style-type:${marker}"><li><p>Item</p></li></ul>`);
    expect(result.diagnostics).toEqual([]);
  });

  it('keeps CSS precedence over HTML type and ignores invalid later declarations', () => {
    const html = '<ol type="I" style="list-style-type:lower-alpha;list-style-type:url(https://example.test/marker)"><li>Item</li></ol>';
    const result = normalizePasteHTML(html);
    expect(result.html).toBe('<ol style="list-style-type:lower-alpha" type="I"><li>Item</li></ol>');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'unsupported-formatting' }));
    expect(normalizePasteHTML('<ul type="circle" style="list-style-type:square"><li>Item</li></ul>').html)
      .toBe('<ul style="list-style-type:square"><li>Item</li></ul>');
  });

  it.each(['none', 'inherit', 'initial', 'unset', 'revert', 'revert-layer', 'decimal-leading-zero', 'custom-counter', 'symbols(a b)', 'var(--marker)', 'url(https://example.test/pixel)', '"custom"', 'decimal!important', 'decimal !important', 'd\\65 cimal'])('removes unsupported CSS marker %s', marker => {
    const result = normalizePasteHTML(`<ol style='list-style-type:${marker}'><li>Item</li></ol>`);
    expect(result.html).toBe('<ol><li>Item</li></ol>');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'unsupported-formatting' }));
    expect(demand(result.html)).toEqual(['ordered-list']);
  });

  it.each([['ol', 'disc'], ['ol', 'square'], ['ul', 'decimal'], ['ul', 'upper-roman'], ['p', 'decimal'], ['li', 'square'], ['span', 'disc']])('removes a marker from an incompatible %s owner: %s', (tag, marker) => {
    const result = normalizePasteHTML(`<${tag} style="list-style-type:${marker}">Text</${tag}>`);
    expect(result.html).not.toContain('list-style');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'unsupported-formatting' }));
  });

  it('does not preserve shorthand, arbitrary CSS, or markers on task lists', () => {
    const result = normalizePasteHTML('<ul data-type="taskList" type="square" style="list-style-type:circle;list-style:disc inside;--marker:square"><li data-type="taskItem" data-checked="true"><p>Task</p></li></ul>');
    expect(result.html).toBe('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Task</p></li></ul>');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'unsupported-formatting' }));
    expect(demand(result.html)).not.toContain('bullet-list-style');
  });

  it('retains list formatting while adapting only paragraph and run cosmetics', () => {
    const result = normalizePasteHTML('<ol style="list-style-type:upper-roman;color:red;font-family:Georgia"><li><p style="text-align:center">Text</p></li></ol>', { formatting: 'adapt' });
    expect(result.html).toBe('<ol style="list-style-type:upper-roman"><li><p>Text</p></li></ol>');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'formatting-adapted' }));
    expect(demand(result.html)).toEqual(['ordered-list', 'ordered-list-style']);
  });

  it.each(markers)('keeps only kind-correct %s %s in an internal partial slice', (tag, marker) => {
    const name = tag === 'ol' ? 'orderedList' : 'bulletList';
    const context = `1 1 ${JSON.stringify([name, { listStyleType: marker }, 'listItem', { listStyleType: marker }])}`;
    const clean = `1 1 ${JSON.stringify([name, { listStyleType: marker }, 'listItem', {}])}`;
    expect(cleanSliceContext(context)).toBe(clean);
    const result = normalizePasteHTML(`<p data-pm-slice='${context}'>Part</p>`, { formatting: 'adapt' });
    expect(result.html).toContain('listStyleType');
    expect(demand(result.html)).toEqual([tag === 'ol' ? 'ordered-list-style' : 'bullet-list-style']);
  });

  it('preserves null defaults without treating them as explicit marker demand', () => {
    const context = `1 1 ${JSON.stringify(['orderedList', { listStyleType: null }, 'listItem', null, 'bulletList', { listStyleType: null },
      'listItem', null, 'taskList', { listStyleType: null }, 'taskItem', null])}`;
    expect(cleanSliceContext(context)).toBe(`1 1 ${JSON.stringify(['orderedList', { listStyleType: null }, 'listItem', null,
      'bulletList', { listStyleType: null }, 'listItem', null, 'taskList', {}, 'taskItem', null])}`);
    expect(demand(normalizePasteHTML(`<p data-pm-slice='${context}'>Part</p>`).html)).toEqual([]);
    expect(demand(normalizePasteHTML('<ol><li>Item</li></ol><ul><li>Other</li></ul>').html)).toEqual(['ordered-list', 'bullet-list']);
  });

  it.each(['disc', 'square', 'UPPER-ROMAN', 'url(x)', '', 7, {}, ['decimal']])('removes invalid ordered slice marker %j', marker => {
    const context = `1 1 ${JSON.stringify(['orderedList', { start: 7, listStyleType: marker }])}`;
    expect(cleanSliceContext(context)).toBe('1 1 ["orderedList",{"start":7}]');
  });

  it('keeps closed marker validation independent of prototypes and diagnostics', () => {
    for (const value of ['constructor', '__proto__', 'prototype', 7, null, {}]) {
      expect(validListStyle('ol', value)).toBe(false);
      expect(listStyleFromType('ol', value)).toBeUndefined();
    }
    expect(listStyleFromType('p', 'square')).toBeUndefined();
    expect(listStyleFromType('ul', 'decimal')).toBeUndefined();
    const result = normalizePasteHTML('<script>bad</script><ol style="list-style-type:url(x)"><li>Item</li></ol>', { limits: { maxDiagnostics: 1 } });
    expect(result.status).toBe('cleaned');
    expect(result.html).toBe('<ol><li>Item</li></ol>');
    expect(result.diagnosticsTruncated).toBe(true);
  });
});
