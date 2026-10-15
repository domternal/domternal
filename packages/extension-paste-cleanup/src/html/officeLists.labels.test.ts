// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { toHtml } from 'hast-util-to-html';
import type { Element, Root } from 'hast';
import { parseBoundedHTML } from './parse.js';
import { DEFAULT_PASTE_HTML_LIMITS, normalizeClipboardHTML, normalizePasteHTML } from './normalize.js';
import { reconstructOfficeLists } from './officeLists.js';

// Synthetic Office metadata: these examples do not claim qualification of a native application capture.
const rules = '<style>@list l0:level1 {mso-level-text:"Section %1\\)";mso-level-number-format:alpha-upper;}'
  + '@list l0:level2 {mso-level-text:"✓";mso-level-number-format:bullet;}'
  + '@list l1:level1 {mso-level-text:"(%1)";}'
  + '@list l2:level1 {mso-level-text:"Part %1:";}</style>';
const item = (marker: string, text: string, list = 0, level = 1): string =>
  `<p style="mso-list:l${String(list)} level${String(level)} lfo1"><span style="mso-list:Ignore">${marker}<span>&nbsp;</span></span>${text}</p>`;
const counter = { kind: 'counter', format: 'upper-alpha', prefix: 'Section ', suffix: ') ' };
const bullet = { kind: 'text', text: '✓' };
function lists(tree: Root | Element): Element[] {
  return tree.children.flatMap(node => node.type !== 'element' ? [] : [...(node.tagName === 'ol' || node.tagName === 'ul' ? [node] : []), ...lists(node)]);
}

describe('Word optional list labels', () => {
  it.each(['preserve', 'adapt'] as const)('preserves custom labels, observed starts and nested structure in %s', formatting => {
    const html = rules + item('Section AA)', 'Outer') + item('✓', 'Inner', 0, 2) + item('Section AB)', 'Next');
    const result = normalizeClipboardHTML(html, { formatting }, () => ({ orderedLists: true, bulletLists: true, nestedLists: true, labels: () => true })).result;
    const tree = parseBoundedHTML(result.html, DEFAULT_PASTE_HTML_LIMITS);
    expect(lists(tree).map(node => [node.tagName, node.properties.start ?? null, JSON.parse(String(node.properties['dataDmListLabel']))])).toEqual([
      ['ol', 27, counter], ['ul', null, bullet],
    ]);
    expect(result.html).toContain('<p>Outer</p>');
    expect(result.html).not.toContain('mso-list');
    expect(result.diagnostics).toEqual([]);
    expect(normalizePasteHTML(result.html, { formatting }).html).toBe(result.html);
  });

  it('retains zero starts, explicit counter gaps and separate label identities', () => {
    const html = rules + item('(0)', 'Zero', 1) + item('(1)', 'One', 1) + item('(4)', 'Four', 1) + item('Part 5:', 'Five', 2);
    const result = normalizeClipboardHTML(html, {}, () => ({ labels: () => true })).result;
    expect(lists(parseBoundedHTML(result.html, DEFAULT_PASTE_HTML_LIMITS)).map(node => [node.properties.start, JSON.parse(String(node.properties['dataDmListLabel']))])).toEqual([
      [0, { kind: 'counter', format: 'decimal', prefix: '(', suffix: ') ' }],
      [4, { kind: 'counter', format: 'decimal', prefix: '(', suffix: ') ' }],
      [5, { kind: 'counter', format: 'decimal', prefix: 'Part ', suffix: ': ' }],
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('keeps custom source markers literal without a proved optional destination', () => {
    const html = rules + item('Section AA)', 'Outer') + item('✓', 'Inner', 0, 2);
    for (const capability of [undefined, () => ({ labels: () => false })]) {
      const result = normalizeClipboardHTML(html, {}, capability).result;
      expect(result.html).toContain('Section AA)'); expect(result.html).toContain('✓');
      expect(result.html).not.toContain('<ol'); expect(result.html).not.toContain('<ul');
      expect(result.diagnostics.map(value => value.code)).toContain('office-list-unsupported');
    }
  });

  it('keeps a rejected nested label literal within its supported parent', () => {
    const result = normalizeClipboardHTML(rules + item('Section AA)', 'Outer') + item('✓', 'Inner', 0, 2), {}, () => ({ labels: (_label, level) => level === 1 })).result;
    expect(result.html).toContain('<ol'); expect(result.html).not.toContain('<ul'); expect(result.html).toContain('✓');
    expect(result.diagnostics.map(value => value.code)).toContain('office-list-unsupported');
  });

  it('opens omitted parent profiles with the same label and observed continuation', () => {
    const result = normalizeClipboardHTML(rules + item('✓', 'Inner', 0, 2) + item('Section AB)', 'Next'), {}, () => ({ labels: () => true })).result;
    const found = lists(parseBoundedHTML(result.html, DEFAULT_PASTE_HTML_LIMITS));
    expect(found.map(node => [node.tagName, node.properties.start ?? null])).toEqual([['ol', 27], ['ul', null]]);
    expect(JSON.parse(String(found[0]?.properties['dataDmListLabel']))).toEqual(counter);
  });

  it('retains a rejected item instead of removing its marker or joining the earlier list', () => {
    const tree = parseBoundedHTML(rules + item('Section AA)', 'First') + item('Section AB)', 'Second'), DEFAULT_PASTE_HTML_LIMITS);
    let calls = 0;
    reconstructOfficeLists(tree, { ...DEFAULT_PASTE_HTML_LIMITS, labels: () => ++calls === 1 }, () => undefined);
    expect(lists(tree)).toHaveLength(1);
    expect(toHtml(tree)).toContain('Section AB)');
  });

  it('leaves compound, legal, mismatched and symbol-font labels literal even with the extension', () => {
    for (const [definition, marker] of [
      ['mso-level-text:"%1.%2."', '1.2.'], ['mso-level-text:"Part %1)";mso-level-legal-format:yes', 'Part 1)'],
      ['mso-level-text:"Part %1)"', 'Other 1)'], ['mso-level-number-format:bullet;mso-level-text:x;font-family:Wingdings', 'x'],
    ] as const) {
      const result = normalizeClipboardHTML(`<style>@list l0:level1 {${definition}}</style>${item(marker, 'Body')}`, {}, () => ({ labels: () => true })).result;
      expect(result.html).not.toContain('<ol'); expect(result.html).not.toContain('<ul'); expect(result.html).toContain(marker);
      expect(result.diagnostics.map(value => value.code)).toContain('office-list-unsupported');
    }
  });
});
