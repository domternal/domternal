// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Element, ElementContent, Properties, Root, RootContent, Text } from 'hast';
import { collectDestinationDemand } from './destinationDemand.js';
import { DEFAULT_PASTE_HTML_LIMITS, normalizeClipboardHTML, normalizePasteHTML } from './normalize.js';
import type { NormalizePasteHTMLOptions } from './types.js';
import { parseBoundedHTML, StructureLimitError } from './parse.js';

const limits = { maxNodes: 1_000, maxDepth: 32 };
const text = (value = 'Text'): Text => ({ type: 'text', value });
const element = (tagName: string, children: ElementContent[] = [], properties: Properties = {}): Element =>
  ({ type: 'element', tagName, properties, children });
const root = (children: RootContent[] = []): Root => ({ type: 'root', children });
function normalized(html: string, options?: NormalizePasteHTMLOptions): Root {
  const result = normalizePasteHTML(html, options);
  expect(result.status).toBe('cleaned');
  return parseBoundedHTML(result.html, DEFAULT_PASTE_HTML_LIMITS);
}

// A verified own copy: the anchor carries a nonce that the private verifier confirms.
const OWN_NONCE = 'OwnCopyNonceOwnCopy_-A';
function ownCopy(html: string, options: NormalizePasteHTMLOptions = {}): Root {
  const { result } = normalizeClipboardHTML(html.replace('data-pm-slice', `data-domternal-copy="v1.${OWN_NONCE}" data-pm-slice`),
    options, undefined, undefined, undefined, nonce => nonce === OWN_NONCE);
  expect(result.status).toBe('cleaned');
  return parseBoundedHTML(result.html, DEFAULT_PASTE_HTML_LIMITS);
}

describe('bounded sanitized destination feature demand', () => {
  it('returns frozen stable deduplicated features independent of traversal order', () => {
    const nodes = [
      element('ul', [element('li', [element('ol')])]),
      element('table', [element('tbody', [element('tr', [element('th')])])]),
      element('span', [text()], { style: 'font-family:Georgia;font-size:14pt;color:#123456;background-color:yellow;font-weight:700;font-style:italic;text-decoration:underline line-through;vertical-align:super' }),
      element('p', [], { style: 'text-align:center;line-height:1.5' }),
      ...['h6', 'h5', 'h4', 'h3', 'h2', 'h1'].map(tag => element(tag)),
      element('sub', [text()]), element('strong', [text()]), element('mark', [text()]),
    ];
    const expected = ['bold', 'italic', 'underline', 'strike', 'subscript', 'superscript',
      'heading-1', 'heading-2', 'heading-3', 'heading-4', 'heading-5', 'heading-6',
      'font-family', 'font-size', 'text-color', 'highlight', 'text-align', 'line-height',
      'table', 'table-header', 'ordered-list', 'bullet-list', 'nested-list'];
    const forward = collectDestinationDemand(root(nodes), limits);
    expect(forward).toEqual(expected);
    expect(collectDestinationDemand(root([...nodes].reverse()), limits)).toEqual(expected);
    expect(Object.isFrozen(forward)).toBe(true);
    expect(() => Reflect.set(forward, 0, 'unknown')).not.toThrow();
    expect(forward).toEqual(expected);
  });

  it.each([
    ['b', 'bold'], ['strong', 'bold'], ['i', 'italic'], ['em', 'italic'], ['u', 'underline'],
    ['s', 'strike'], ['del', 'strike'], ['sub', 'subscript'], ['sup', 'superscript'], ['mark', 'highlight'],
  ])('requires %s semantics only when a descendant contains text or a hard break', (tag, feature) => {
    expect(collectDestinationDemand(root([element(tag, [element('span', [text()])])]), limits)).toEqual([feature]);
    expect(collectDestinationDemand(root([element(tag, [element('span'), text('')])]), limits)).toEqual([]);
    expect(collectDestinationDemand(root([element(tag, [element('br'), element('img', [], { alt: 'Alternative' })])]), limits)).toEqual([feature]);
    expect(collectDestinationDemand(root([element(tag, [element('img', [], { alt: 'Alternative' })])]), limits)).toEqual([]);
  });

  it.each([' ', '\n\t', '\u00a0', '\u200b'])('treats nonempty whitespace text as content: %j', value => {
    expect(collectDestinationDemand(root([element('strong', [text(value)], { style: 'color:red' })]), limits)).toEqual(['bold', 'text-color']);
  });

  it('does not let sibling text make an empty decorated wrapper meaningful', () => {
    const tree = root([element('p', [element('span', [], { style: 'font-family:Georgia;font-size:14pt;color:red;background-color:yellow' }),
      text(), element('strong', [element('span')])])]);
    expect(collectDestinationDemand(tree, limits)).toEqual([]);
  });

  it('does not let a sibling break make an empty decorated wrapper meaningful', () => {
    const tree = root([element('p', [element('strong'), element('br'),
      element('span', [], { style: 'font-family:Georgia;color:red' })])]);
    expect(collectDestinationDemand(tree, limits)).toEqual([]);
  });

  it('collects break-only marks and typography after preserve or intentional adaptation', () => {
    const html = '<p style="text-align:center;line-height:1.5"><span style="font-family:Georgia;font-size:14pt;color:#123456">'
      + '<strong><em><u><s><sup><br></sup></s></u></em></strong></span></p>';
    expect(collectDestinationDemand(normalized(html), limits)).toEqual(['bold', 'italic', 'underline', 'strike', 'superscript',
      'font-family', 'font-size', 'text-color', 'text-align', 'line-height']);
    expect(collectDestinationDemand(normalized(html, { formatting: 'adapt' }), limits))
      .toEqual(['bold', 'italic', 'underline', 'strike', 'superscript']);
    expect(collectDestinationDemand(normalized(html, { formatting: 'adapt', preserveTextAlignment: true }), limits))
      .toEqual(['bold', 'italic', 'underline', 'strike', 'superscript', 'text-align']);
  });

  it('counts meaningful breaks within the same strict traversal bounds', () => {
    const tree = root([element('strong', [element('br')])]);
    expect(collectDestinationDemand(tree, { maxNodes: 3, maxDepth: 2 })).toEqual(['bold']);
    expect(() => collectDestinationDemand(tree, { maxNodes: 2, maxDepth: 2 })).toThrow(StructureLimitError);
    expect(() => collectDestinationDemand(tree, { maxNodes: 3, maxDepth: 1 })).toThrow(StructureLimitError);
  });

  it('finds retained own-copy inline styles and validated theme tokens', () => {
    const tree = ownCopy('<div data-pm-slice="0 0 []"><p><span style="font-weight:700;font-style:oblique;text-decoration-line:underline line-through;vertical-align:sub;font-family:Georgia;font-size:14pt" data-text-color="accent-1" data-bg-color="highlight-2">Text</span></p></div>', { formatting: 'adapt' });
    expect(collectDestinationDemand(tree, limits)).toEqual(['bold', 'italic', 'underline', 'strike', 'subscript', 'font-family', 'font-size', 'text-color', 'highlight']);
  });

  it('does not treat reset styles or invalid declarations and tokens as requests', () => {
    const tree = root([element('span', [text()], {
      style: 'font-weight:400;font-style:normal;text-decoration:none;vertical-align:baseline;font-size:calc(2px);color:url(x);background-color:url(x)',
      dataTextColor: 'Bad token', dataBgColor: ['red'],
    })]);
    expect(collectDestinationDemand(tree, limits)).toEqual([]);
  });

  it('collects only retained typography after preserve or intentional adapt policy', () => {
    const html = '<h2 style="text-align:center;line-height:1.5"><span style="font-family:Georgia;font-size:14pt;color:#123456;background-color:yellow;font-weight:700;font-style:italic;text-decoration:underline">Text</span></h2>';
    expect(collectDestinationDemand(normalized(html), limits)).toEqual(['bold', 'italic', 'underline', 'heading-2',
      'font-family', 'font-size', 'text-color', 'highlight', 'text-align', 'line-height']);
    expect(collectDestinationDemand(normalized(html, { formatting: 'adapt' }), limits)).toEqual(['bold', 'italic', 'underline', 'heading-2']);
    expect(collectDestinationDemand(normalized(html, { formatting: 'adapt', preserveTextAlignment: true }), limits))
      .toEqual(['bold', 'italic', 'underline', 'heading-2', 'text-align']);
  });

  it('collects effective inherited runs after normalization, including real mark resets', () => {
    const html = '<div style="font-family:Georgia;font-size:14pt;color:#123456"><p><strong><span style="font-weight:400">Plain</span></strong></p></div>';
    expect(collectDestinationDemand(normalized(html), limits)).toEqual(['font-family', 'font-size', 'text-color']);
    expect(collectDestinationDemand(normalized(html, { formatting: 'adapt' }), limits)).toEqual([]);
  });

  it('keeps block and cell backgrounds separate from inline highlights', () => {
    const html = '<div style="background-color:yellow"><p style="background-color:red">Block</p>'
      + '<table><tr><th style="background-color:blue;text-align:center;line-height:2" data-bg-color="accent">Header</th>'
      + '<td data-background="#123456" data-text-align="right" style="background-color:green;text-align:right;line-height:2"><p>Cell</p></td></tr></table></div>';
    expect(collectDestinationDemand(normalized(html), limits)).toEqual(['table', 'table-header']);
    const inline = html.replace('<p>Cell</p>', '<p><span style="background-color:yellow">Cell</span></p>');
    expect(collectDestinationDemand(normalized(inline), limits)).toEqual(['highlight', 'table', 'table-header']);
  });

  it('requires paragraph layout only on actual paragraphs and headings, including empty ones', () => {
    const decorations = { style: 'text-align:right;line-height:2', dataTextAlign: 'center' };
    expect(collectDestinationDemand(root(['div', 'span', 'td', 'th', 'li'].map(tag => element(tag, [text()], decorations))), limits)).toEqual(['table', 'table-header']);
    expect(collectDestinationDemand(root([element('p', [], decorations)]), limits)).toEqual(['text-align', 'line-height']);
    expect(collectDestinationDemand(root([element('h3', [], decorations)]), limits)).toEqual(['heading-3', 'text-align', 'line-height']);
    expect(collectDestinationDemand(root([element('p', [text()], { dataTextAlign: 'center' })]), limits)).toEqual([]);
  });

  it('retains empty structural requests without requiring decorated text', () => {
    expect(collectDestinationDemand(root([element('h1'), element('h6'), element('ol'), element('ul'), element('table')]), limits))
      .toEqual(['heading-1', 'heading-6', 'table', 'ordered-list', 'bullet-list']);
  });

  it('detects list ancestry through real structural nesting without joining siblings', () => {
    expect(collectDestinationDemand(root([element('ol', [element('li', [element('p', [text()])])]), element('ul')]), limits))
      .toEqual(['ordered-list', 'bullet-list']);
    expect(collectDestinationDemand(root([element('ol', [element('li', [element('div', [element('ul')])])])]), limits))
      .toEqual(['ordered-list', 'bullet-list', 'nested-list']);
    expect(collectDestinationDemand(root([element('ul', [element('li', [element('ul')])])]), limits))
      .toEqual(['bullet-list', 'nested-list']);
  });

  it('sees reconstructed Office lists without consulting raw marker metadata', () => {
    const item = (marker: string, level: number): string => `<p style="mso-list:l0 level${String(level)} lfo1"><span style="mso-list:Ignore">${marker}</span>Body</p>`;
    expect(collectDestinationDemand(normalized(item('7.', 1) + item('•', 2) + item('8.', 1) + item('2.', 1)), limits))
      .toEqual(['ordered-list', 'bullet-list', 'nested-list', 'ordered-list-style', 'bullet-list-style']);
  });

  it('never mutates the caller tree or returns mutable feature storage', () => {
    const tree = root([element('p', [element('strong', [text()])], { style: 'text-align:center' })]);
    const before = structuredClone(tree);
    const first = collectDestinationDemand(tree, limits);
    const second = collectDestinationDemand(tree, limits);
    expect(tree).toEqual(before);
    expect(first).toEqual(['bold', 'text-align']);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it('counts the root and every node occurrence, including comments and empty text', () => {
    const tree = root([element('strong', [text('')]), { type: 'comment', value: 'Text is not content' }, text()]);
    expect(collectDestinationDemand(tree, { maxNodes: 5, maxDepth: 2 })).toEqual([]);
    expect(() => collectDestinationDemand(tree, { maxNodes: 4, maxDepth: 2 })).toThrow(StructureLimitError);
    expect(collectDestinationDemand(root(), { maxNodes: 1, maxDepth: 1 })).toEqual([]);
    const shared = element('strong', [text()]);
    expect(() => collectDestinationDemand(root([shared, shared]), { maxNodes: 4, maxDepth: 2 })).toThrow(StructureLimitError);
  });

  it('accepts an exact depth and rejects the next level without recursive traversal', () => {
    const tree = root([element('strong', [element('em', [text()])])]);
    expect(collectDestinationDemand(tree, { maxNodes: 4, maxDepth: 3 })).toEqual(['bold', 'italic']);
    expect(() => collectDestinationDemand(tree, { maxNodes: 4, maxDepth: 2 })).toThrow(StructureLimitError);
    let deep: Element = element('strong', [text()]);
    for (let index = 0; index < 5_000; index++) deep = element('span', [deep]);
    expect(() => collectDestinationDemand(root([deep]), { maxNodes: 10_000, maxDepth: 32 })).toThrow(StructureLimitError);
  });

  it('checks a wide sibling allowance before entering excess nodes', () => {
    const tree = root(Array.from({ length: 1_000 }, () => element('p')));
    expect(collectDestinationDemand(tree, { maxNodes: 1_001, maxDepth: 1 })).toEqual([]);
    expect(() => collectDestinationDemand(tree, { maxNodes: 1_000, maxDepth: 1 })).toThrow(StructureLimitError);
  });

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('refuses invalid finite bounds %s', value => {
    expect(() => collectDestinationDemand(root(), { maxNodes: value, maxDepth: 1 })).toThrow(StructureLimitError);
    expect(() => collectDestinationDemand(root(), { maxNodes: 1, maxDepth: value })).toThrow(StructureLimitError);
  });
});
