// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Element, Root } from 'hast';
import { toHtml } from 'hast-util-to-html';
import { normalizePasteHTML } from './index.js';
import { normalizeClipboardHTML } from './normalize.js';
import type { ClipboardDestinationCheck } from './normalize.js';
import type { PasteDestinationFeature } from './destinationDemand.js';
import { adaptHeadingLevels, copyHeadingOutline, headingOutline, nearestHeadingLevel, recordHeadingOutline } from './headingLevels.js';

/**
 * Every non-empty set of supported levels, as a bit mask where bit `level - 1` marks a supported
 * level, maps levels 1 to 6 to this row (entry `mask - 1`). Core's copy of the rule in
 * core/src/utils/headingLevel.test.ts asserts the same table, so the two copies cannot drift.
 */
const LEVEL_TABLE = [
  '111111', '222222', '122222', '333333', '133333', '223333', '123333', '444444', '144444',
  '224444', '124444', '333444', '133444', '223444', '123444', '555555', '155555', '225555',
  '125555', '333555', '133555', '223555', '123555', '444455', '144455', '224455', '124455',
  '333455', '133455', '223455', '123455', '666666', '166666', '226666', '126666', '333666',
  '133666', '223666', '123666', '444466', '144466', '224466', '124466', '333466', '133466',
  '223466', '123466', '555556', '155556', '225556', '125556', '333556', '133556', '223556',
  '123556', '444456', '144456', '224456', '124456', '333456', '133456', '223456', '123456',
] as const;
const LEVELS = [1, 2, 3, 4, 5, 6] as const;
const levelSets = LEVEL_TABLE.map((_, index) => LEVELS.filter(level => ((index + 1) & (1 << (level - 1))) !== 0));

function element(tagName: string, children: Element['children'] = [], offset?: number): Element {
  return { type: 'element', tagName, properties: {}, children,
    ...(offset === undefined ? {} : { position: { start: { line: 1, column: offset + 1, offset }, end: { line: 1, column: offset + 2, offset: offset + 1 } } }) };
}

function stub(unsupported: readonly PasteDestinationFeature[]): ClipboardDestinationCheck & { calls: (readonly PasteDestinationFeature[])[] } {
  const calls: (readonly PasteDestinationFeature[])[] = [];
  const check = (features: readonly PasteDestinationFeature[]): readonly PasteDestinationFeature[] => {
    calls.push([...features]);
    return features.filter(feature => unsupported.includes(feature));
  };
  return Object.assign(check, { calls });
}

const levelsFrom = (from: number): PasteDestinationFeature[] =>
  LEVELS.filter(level => level >= from).map(level => `heading-${String(level)}` as PasteDestinationFeature);
const adapted = (offset: number): unknown => ({ code: 'destination-heading-level-adapted', severity: 'warning', offset });
const unconfirmed = { code: 'destination-formatting-unconfirmed', severity: 'warning' };

describe('nearest supported heading level', () => {
  it('maps every level of every supported set by the shared table', () => {
    levelSets.forEach((supported, index) => {
      expect(LEVELS.map(level => String(nearestHeadingLevel(level, supported))).join(''), supported.join(',')).toBe(LEVEL_TABLE[index]);
    });
  });

  it('stays in the set, keeps supported levels, never promotes while a deeper level exists and keeps outline order', () => {
    for (const supported of levelSets) {
      let previous = 0;
      for (const level of LEVELS) {
        const mapped = nearestHeadingLevel(level, supported);
        if (mapped === undefined) throw new Error('Expected a level');
        expect(supported).toContain(mapped);
        if (supported.includes(level)) expect(mapped).toBe(level);
        if (supported.some(candidate => candidate >= level)) expect(mapped).toBeGreaterThanOrEqual(level);
        else expect(mapped).toBe(Math.max(...supported));
        expect(mapped).toBeGreaterThanOrEqual(previous);
        previous = mapped;
      }
    }
  });

  it.each([
    [[1, 2, 3, 4], 5, 4], [[1, 2, 3, 4], 6, 4], [[1, 3], 2, 3], [[1, 3], 4, 3],
    [[2, 3], 1, 2], [[1, 5], 2, 5], [[1, 5], 4, 5], [[1, 5], 6, 5], [[4, 2], 3, 4],
  ])('maps with levels %j: %i to %i', (supported, level, mapped) => {
    expect(nearestHeadingLevel(level, supported)).toBe(mapped);
  });

  it('has no level for an empty set', () => {
    expect(nearestHeadingLevel(3, [])).toBeUndefined();
  });
});

describe('heading level adaptation of a sanitized tree', () => {
  it('rewrites only unsupported heading tags in place, keeping properties and children, and reports each once', () => {
    const text = { type: 'text' as const, value: 'Five' };
    const five = element('h5', [text], 7);
    five.properties = { style: 'text-align:center', dir: 'rtl', lang: 'de', id: 'intro', dataPmSlice: '0 0 []' };
    const two = element('h2', [], 30);
    const six = element('h6', [], 40);
    const tree: Root = { type: 'root', children: [element('div', [five, element('blockquote', [six])]), two] };
    const reported: Element[] = [];

    adaptHeadingLevels(tree, [1, 2, 3, 4], node => { reported.push(node); });

    expect(five.tagName).toBe('h4');
    expect(five.properties).toEqual({ style: 'text-align:center', dir: 'rtl', lang: 'de', id: 'intro', dataPmSlice: '0 0 []' });
    expect(five.children).toEqual([text]);
    expect(six.tagName).toBe('h4');
    expect(two.tagName).toBe('h2');
    expect(reported).toEqual([five, six]);
  });

  it('leaves the tree alone without a supported level', () => {
    const tree: Root = { type: 'root', children: [element('h5'), element('h6')] };
    const before = structuredClone(tree);
    const report = vi.fn();
    adaptHeadingLevels(tree, [], report);
    expect(tree).toEqual(before);
    expect(report).not.toHaveBeenCalled();
  });

  it('ignores elements whose names only resemble heading tags', () => {
    const tree: Root = { type: 'root', children: [element('h7'), element('h0'), element('h55'), element('hr'), element('H5')] };
    const before = structuredClone(tree);
    const report = vi.fn();
    adaptHeadingLevels(tree, [1], report);
    expect(tree).toEqual(before);
    expect(report).not.toHaveBeenCalled();
  });

  it('walks a tree deeper than any call stack iteratively, in document order', () => {
    const innermost = element('h6');
    const root: Root = { type: 'root', children: [] };
    let current: Root | Element = root;
    for (let depth = 0; depth < 50_000; depth++) {
      const next = element(depth === 0 ? 'h5' : 'div');
      current.children.push(next);
      current = next;
    }
    current.children.push(innermost);
    const reported: string[] = [];
    adaptHeadingLevels(root, [1, 2, 3, 4], node => { reported.push(node === innermost ? 'inner' : node.tagName); });
    expect(reported).toEqual(['h4', 'inner']);
    expect(innermost.tagName).toBe('h4');
  });
});

describe('heading levels in clipboard normalization with a destination', () => {
  it('pastes each unsupported heading at its nearest supported level and reports it at its source offset', () => {
    const html = '<h5>Five</h5><h6 style="text-align:center">Six</h6><h2>Two</h2>';
    const destination = stub(levelsFrom(5));
    const { result } = normalizeClipboardHTML(html, {}, undefined, undefined, destination);
    expect(result).toMatchObject({ status: 'cleaned', diagnosticsTruncated: false,
      html: '<h4>Five</h4><h4 style="text-align:center">Six</h4><h2>Two</h2>' });
    expect(result.diagnostics).toEqual([adapted(0), adapted(html.indexOf('<h6'))]);
    expect(destination.calls).toEqual([['heading-2', 'heading-5', 'heading-6', 'text-align'], levelsFrom(1)]);
  });

  it('gives the mapped heading the output a supported heading of that level gets', () => {
    const source = '<h6 id="intro" dir="rtl" lang="de" title="T" style="text-align:right;line-height:1.5;color:red">Text <strong>bold</strong></h6>';
    const mapped = normalizeClipboardHTML(source, {}, undefined, undefined, stub(levelsFrom(5))).result;
    const direct = normalizeClipboardHTML(source.replace(/h6/g, 'h4'), {}, undefined, undefined, stub(levelsFrom(5))).result;
    expect(mapped.html).toBe(direct.html);
    expect(mapped.diagnostics).toEqual([adapted(0)]);
    expect(direct.diagnostics).toEqual([]);
  });

  it('maps an empty heading and a heading inside list, quote and cell structure', () => {
    const html = '<h6></h6><ul><li><p>Lead</p><h6>Item</h6></li></ul><blockquote><h5>Quote</h5></blockquote><table><tr><td><h6>Cell</h6></td></tr></table>';
    const { result } = normalizeClipboardHTML(html, {}, undefined, undefined, stub(levelsFrom(5)));
    expect(result.html).toBe('<h4></h4><ul><li><p>Lead</p><h4>Item</h4></li></ul><blockquote><h4>Quote</h4></blockquote><table><tbody><tr><td><h4>Cell</h4></td></tr></tbody></table>');
    expect(result.diagnostics).toHaveLength(4);
  });

  it.each([
    ['at the start of a list item', '<ul><li><h6>Item</h6><p>b</p></li></ul>'],
    ['at the start of a list item after white space and empty wrappers', '<ul><li> <span></span><div><h5>Item</h5></div></li></ul>'],
    ['at the start of a task item after its checkbox', '<ul><li><label><input type="checkbox"></label><div><h6>Task</h6></div></li></ul>'],
    ['in a summary', '<details><summary><h5>Summary</h5></summary><p>body</p></details>'],
    ['in a summary after its text', '<details><summary>Lead <h6>Summary</h6></summary></details>'],
    ['in a preformatted block', '<pre><h6>code</h6></pre>'],
  ])('leaves a heading %s alone, without a finding or an outline entry, since the editor parses it as text', (_name, html) => {
    const { result } = normalizeClipboardHTML(html, {}, undefined, undefined, stub(levelsFrom(5)));
    expect(result.html).toMatch(/<h[56]>/);
    expect(result.diagnostics.map(item => item.code)).not.toContain('destination-heading-level-adapted');
    expect(headingOutline(result)).toBeUndefined();
  });

  it('leaves a configured heading where one cannot stand out of the outline, next to a renamed one', () => {
    const { result } = normalizeClipboardHTML('<ul><li><h2>Item</h2></li></ul><h6>Six</h6>', {}, undefined, undefined, stub(levelsFrom(5)));
    expect(headingOutline(result)).toEqual([true]);
    expect(result.diagnostics.map(item => item.code)).toEqual(['destination-heading-level-adapted']);
  });

  it.each([
    ['after text in the item', '<ul><li>Lead <h6>Item</h6></li></ul>'],
    ['after marked text', '<ul><li><em>x</em><h6>Item</h6></li></ul>'],
    ['in a blockquote of the item', '<ul><li><blockquote><h6>Item</h6></blockquote></li></ul>'],
    ['in a table cell of the item', '<ul><li><table><tr><td><h6>Item</h6></td></tr></table></li></ul>'],
    ['after the summary, in the details body', '<details><summary>S</summary><h6>Body</h6></details>'],
  ])('maps a heading %s, where one stands', (_name, html) => {
    const { result } = normalizeClipboardHTML(html, {}, undefined, undefined, stub(levelsFrom(5)));
    expect(result.html).toContain('<h4>');
    expect(result.diagnostics.map(item => item.code)).toEqual(['destination-heading-level-adapted']);
  });

  it.each([
    ['after an empty paragraph of its list item, as getHTML writes an empty label', '<ul><li><p></p><h6>Item</h6></li></ul>'],
    ['after a paragraph inside a wrapper of its list item', '<ul><li><div><p></p></div><h6>Item</h6></li></ul>'],
    ['after an empty paragraph of a task item', '<ul><li><label><input type="checkbox"></label><div><p></p><h6>Task</h6></div></li></ul>'],
  ])('maps a heading %s, where Core keeps it', (_name, html) => {
    const { result } = normalizeClipboardHTML(html, {}, undefined, undefined, stub(levelsFrom(5)));
    expect(result.html).toContain('<h4>');
    expect(result.diagnostics.filter(item => item.code === 'destination-heading-level-adapted')).toHaveLength(1);
    expect(headingOutline(result)).toEqual([true]);
  });

  it.each([
    ['at the start of a list item', '<ul><li><h6>Item</h6></li></ul>', 'heading-text-at-list-item-start'],
    ['in a summary', '<details><summary><h6>Summary</h6></summary><p>b</p></details>', 'heading-text-in-summary'],
    ['in a preformatted block', '<pre><h6>code</h6></pre>', 'heading-text-in-preformatted'],
  ] as const)('maps a heading %s when the destination keeps one there, as a schema without that block does', (_name, html, keeps) => {
    const destination = stub([...levelsFrom(5), keeps]);
    const { result } = normalizeClipboardHTML(html, {}, undefined, undefined, destination);
    expect(result.html).toContain('<h4>');
    expect(result.diagnostics.map(item => item.code)).toEqual(['destination-heading-level-adapted']);
    expect(headingOutline(result)).toEqual([true]);
    expect(destination.calls.filter(call => call.includes('heading-text-at-list-item-start'))).toHaveLength(1);
  });

  it('asks the destination where a heading stands only for a heading inside a list item, summary or preformatted block', () => {
    const destination = stub(levelsFrom(5));
    normalizeClipboardHTML('<h6>Six</h6><blockquote><h5>Five</h5></blockquote>', {}, undefined, undefined, destination);
    expect(destination.calls.some(call => call.includes('heading-text-at-list-item-start'))).toBe(false);
  });

  it('uses a deeper supported level before promoting, and the deepest level otherwise', () => {
    const { result } = normalizeClipboardHTML('<h1>One</h1><h2>Two</h2><h4>Four</h4><h6>Six</h6>', {}, undefined, undefined,
      stub(['heading-1', 'heading-4', 'heading-5', 'heading-6']));
    expect(result.html).toBe('<h2>One</h2><h2>Two</h2><h3>Four</h3><h3>Six</h3>');
    expect(result.diagnostics.map(item => item.code)).toEqual(Array(3).fill('destination-heading-level-adapted'));
  });

  it('keeps the general warning for other unconfirmed formatting next to the mapped headings', () => {
    const { result } = normalizeClipboardHTML('<h5><strong>Bold</strong></h5>', {}, undefined, undefined, stub([...levelsFrom(5), 'bold']));
    expect(result.html).toBe(normalizePasteHTML('<h4><strong>Bold</strong></h4>').html);
    expect(result.diagnostics).toEqual([adapted(0), unconfirmed]);
  });

  it('leaves headings for the destination to make paragraphs when it supports no level', () => {
    const destination = stub(levelsFrom(1));
    const { result } = normalizeClipboardHTML('<h5>Five</h5>', {}, undefined, undefined, destination);
    expect(result).toMatchObject({ status: 'cleaned', html: '<h5>Five</h5>' });
    expect(result.diagnostics).toEqual([unconfirmed]);
    expect(destination.calls).toEqual([['heading-5'], levelsFrom(1)]);
  });

  it('asks only once when every requested heading level is supported', () => {
    const destination = stub(['bold']);
    const { result } = normalizeClipboardHTML('<h2><b>Two</b></h2>', {}, undefined, undefined, destination);
    expect(result.html).toBe(normalizePasteHTML('<h2><b>Two</b></h2>').html);
    expect(result.diagnostics).toEqual([unconfirmed]);
    expect(destination.calls).toEqual([['bold', 'heading-2']]);
  });

  it('treats a level as supported only when every destination answer confirmed it', () => {
    let call = 0;
    const destination: ClipboardDestinationCheck = features => call++ === 0 ? features.filter(feature => feature === 'heading-5') : [];
    const { result } = normalizeClipboardHTML('<h5>Five</h5>', {}, undefined, undefined, destination);
    expect(result.html).toBe('<h6>Five</h6>');
    expect(result.diagnostics).toEqual([adapted(0)]);
  });

  it('rejects with parse-failed when the level check throws', () => {
    let call = 0;
    const destination: ClipboardDestinationCheck = features => {
      if (call++ > 0) throw new Error('probe failed');
      return features;
    };
    const { result } = normalizeClipboardHTML('<h5>Five</h5>', {}, undefined, undefined, destination);
    expect(result).toMatchObject({ status: 'rejected', html: '' });
    expect(result.diagnostics).toEqual([{ code: 'parse-failed', severity: 'error' }]);
  });

  it('keeps the adaptation warnings ahead of informational findings when the allowance is full', () => {
    const run = '<p><span style="font-family:Calibri;font-size:11pt">t</span></p>';
    const html = run.repeat(3) + '<h5>Five</h5>';
    const { result } = normalizeClipboardHTML(html, { formatting: 'adapt', limits: { maxDiagnostics: 3 } }, undefined, undefined, stub(levelsFrom(5)));
    expect(result.status).toBe('cleaned');
    expect(result.diagnosticsTruncated).toBe(true);
    expect(result.diagnostics.filter(item => item.severity !== 'info')).toEqual([adapted(html.indexOf('<h5'))]);
  });

  it('hands the mapped tree to image preparation', () => {
    let retained: Root | undefined;
    const { result } = normalizeClipboardHTML('<h5>Five</h5>', {}, undefined, {
      reserveImage: () => undefined, retainTree: tree => { retained = tree; },
    }, stub(levelsFrom(5)));
    expect(result.diagnostics).toEqual([adapted(0)]);
    expect(result.html).toBe('');
    if (retained === undefined) throw new Error('Expected a retained tree');
    expect(toHtml(retained)).toBe('<h4>Five</h4>');
  });

  it('adapts a verified own copy like any other paste', () => {
    const nonce = 'OwnCopyNonceOwnCopy_-A';
    const { result } = normalizeClipboardHTML(`<h6 data-domternal-copy="v1.${nonce}" data-pm-slice="0 0 []">Six</h6>`, {},
      undefined, undefined, stub(levelsFrom(5)), candidate => candidate === nonce);
    expect(result.html).toBe('<h4 data-pm-slice="0 0 []">Six</h4>');
    expect(result.diagnostics).toEqual([adapted(0)]);
  });

  it('leaves the standalone entry schema-less, without the destination code', () => {
    expect(normalizePasteHTML('<h5>Five</h5><h6>Six</h6>')).toEqual({
      status: 'cleaned', html: '<h5>Five</h5><h6>Six</h6>', source: 'html', diagnostics: [], diagnosticsTruncated: false,
    });
  });
});

describe('the heading outline of a cleaned fragment', () => {
  it('marks each heading element, in document order at any depth, as renamed or kept', () => {
    const tree: Root = { type: 'root', children: [
      element('h2'), element('div', [element('h5'), element('blockquote', [element('h1'), element('h6')])]), element('p'), element('h4'),
    ] };
    expect(adaptHeadingLevels(tree, [1, 2, 3, 4], () => undefined)).toEqual([false, true, false, true, false]);
  });

  it('is empty without a heading or without a supported level', () => {
    expect(adaptHeadingLevels({ type: 'root', children: [element('p'), element('h7')] }, [1], () => undefined)).toEqual([]);
    expect(adaptHeadingLevels({ type: 'root', children: [element('h5')] }, [], () => undefined)).toEqual([]);
  });

  it('travels with a normalization result that renamed a heading, and only then', () => {
    const html = '<h2>Two</h2><ul><li><p>Item</p><h6>Six</h6></li></ul><h5>Five</h5>';
    const { result } = normalizeClipboardHTML(html, {}, undefined, undefined, stub(levelsFrom(5)));
    expect(headingOutline(result)).toEqual([false, true, true]);
    expect(Object.isFrozen(headingOutline(result))).toBe(true);
    // The outline is not a property of the public result.
    expect(Object.keys(result)).toEqual(['status', 'html', 'source', 'diagnostics', 'diagnosticsTruncated']);
    expect(headingOutline(normalizeClipboardHTML('<h2>Two</h2>', {}, undefined, undefined, stub(levelsFrom(5))).result)).toBeUndefined();
    expect(headingOutline(normalizeClipboardHTML('<h5>Five</h5>', {}, undefined, undefined, stub(levelsFrom(1))).result)).toBeUndefined();
    expect(headingOutline(normalizePasteHTML(html))).toBeUndefined();
    expect(headingOutline(undefined)).toBeUndefined();
  });

  it('records a copy of an outline only when it renamed a heading', () => {
    const target = {};
    const outline = [false, true];
    recordHeadingOutline(target, outline);
    outline.push(true);
    expect(headingOutline(target)).toEqual([false, true]);
    const untouched = {};
    recordHeadingOutline(untouched, [false, false]);
    expect(headingOutline(untouched)).toBeUndefined();
  });

  it('copies to a result derived from the normalization, and never from one without an outline', () => {
    const { result } = normalizeClipboardHTML('<h5>Five</h5>', {}, undefined, undefined, stub(levelsFrom(5)));
    const derived = { ...result, html: '<h4>Five</h4>' };
    expect(headingOutline(derived)).toBeUndefined();
    copyHeadingOutline(result, derived);
    expect(headingOutline(derived)).toEqual([true]);
    const plain = { ...derived };
    copyHeadingOutline({}, plain);
    expect(headingOutline(plain)).toBeUndefined();
  });
});
