import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BulletList, Document, Editor, ListItem, OrderedList, Paragraph, Text } from '@domternal/core';
import { Schema } from '@domternal/pm/model';
import { officeListCapabilities } from './listCapabilities.js';
import { PasteCleanup } from './PasteCleanup.js';
import type { NormalizePasteHTMLResult } from './html/types.js';

const allMarkers = ['decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman', 'disc', 'circle', 'square'];

let editor: Editor;
beforeAll(() => {
  editor = new Editor({ extensions: [Document, Paragraph, Text, ListItem, OrderedList, BulletList] });
});
afterAll(() => { editor.destroy(); });

describe('Office list destination capabilities', () => {
  it('accepts the built-in list parsers, starts and mixed nesting', () => {
    expect(officeListCapabilities(editor.schema, document)).toEqual({
      orderedLists: true, bulletLists: true, nestedLists: true,
    });
  });

  it('proves every reconstructed marker class and nested combination in preservation mode', () => {
    expect(officeListCapabilities(editor.schema, document, { preserveMarkers: true })).toEqual({
      orderedLists: true, bulletLists: true, nestedLists: true, markers: new Set(allMarkers),
    });
  });

  it('confirms each marker class separately, so one unsupported class does not disable its list kind', () => {
    const nodes = editor.schema.spec.nodes.update('orderedList', {
      ...editor.schema.spec.nodes.get('orderedList'),
      parseDOM: [{ tag: 'ol', getAttrs: element => ({
        start: Number(element.getAttribute('start') ?? 1),
        listStyleType: element.style.listStyleType === 'lower-roman' ? null : element.style.listStyleType || null,
      }) }],
    });
    expect(officeListCapabilities(new Schema({ nodes }), document, { preserveMarkers: true })).toEqual({
      orderedLists: true, bulletLists: true, nestedLists: true, markers: new Set(allMarkers.filter(marker => marker !== 'lower-roman')),
    });
  });

  it('keeps structural capability separate from a legacy parser without persisted marker attrs', () => {
    const nodes = editor.schema.spec.nodes
      .update('orderedList', {
        ...editor.schema.spec.nodes.get('orderedList'), attrs: { start: { default: 1 } },
        parseDOM: [{ tag: 'ol', getAttrs: element => ({ start: Number(element.getAttribute('start') ?? 1) }) }],
      })
      .update('bulletList', { ...editor.schema.spec.nodes.get('bulletList'), attrs: {}, parseDOM: [{ tag: 'ul' }] });
    const schema = new Schema({ nodes });
    expect(officeListCapabilities(schema, document)).toEqual({ orderedLists: true, bulletLists: true, nestedLists: true });
    expect(officeListCapabilities(schema, document, { preserveMarkers: true })).toEqual({
      orderedLists: false, bulletLists: false, nestedLists: false, markers: new Set(),
    });
  });

  it('does not trust a declared marker attr when a parser collapses every bullet to disc', () => {
    const nodes = editor.schema.spec.nodes.update('bulletList', {
      ...editor.schema.spec.nodes.get('bulletList'), parseDOM: [{ tag: 'ul', getAttrs: () => ({ listStyleType: 'disc' }) }],
    });
    const schema = new Schema({ nodes });
    expect(officeListCapabilities(schema, document).bulletLists).toBe(true);
    expect(officeListCapabilities(schema, document, { preserveMarkers: true })).toEqual({
      orderedLists: true, bulletLists: true, nestedLists: true,
      markers: new Set(['decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman', 'disc']),
    });
  });

  it('proves nested marker retention separately from successful root parsing', () => {
    const nodes = editor.schema.spec.nodes.update('bulletList', {
      ...editor.schema.spec.nodes.get('bulletList'),
      parseDOM: [{ tag: 'ul', getAttrs: element => ({
        listStyleType: element.parentElement?.tagName === 'LI' ? null : element.style.listStyleType || null,
      }) }],
    });
    expect(officeListCapabilities(new Schema({ nodes }), document, { preserveMarkers: true })).toEqual({
      orderedLists: true, bulletLists: true, nestedLists: false, markers: new Set(allMarkers),
    });
  });

  it('keeps visible Office labels with a warning when the actual editor uses legacy list parsers', () => {
    const LegacyOrdered = OrderedList.extend({ addAttributes: () => ({ start: {
      default: 1, parseHTML: (element: HTMLElement) => Number(element.getAttribute('start') ?? 1),
    } }) });
    const LegacyBullet = BulletList.extend({ addAttributes: () => ({}) });
    const results: NormalizePasteHTMLResult[] = [];
    const receiving = new Editor({
      extensions: [Document, Paragraph, Text, ListItem, LegacyOrdered, LegacyBullet,
        PasteCleanup.configure({ onResult: result => { results.push(result); } })],
      content: '<p>Seed</p>',
    });
    try {
      receiving.commands.selectAll();
      const html = '<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">7. </span>Outer</p>'
        + '<p style="mso-list:l0 level2 lfo1"><span style="mso-list:Ignore">◦ </span>Inner</p>';
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { items: [], files: [],
        getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? '7. Outer\n◦ Inner' : '',
      } });
      receiving.view.dom.dispatchEvent(event);
      expect(receiving.state.doc.content.content.map(node => node.type.name)).toEqual(['paragraph', 'paragraph']);
      expect(receiving.state.doc.textContent).toBe('7. Outer◦ Inner');
      expect(results).toHaveLength(1);
      expect(results[0]?.diagnostics).toContainEqual(expect.objectContaining({ code: 'office-list-unsupported' }));
    } finally { receiving.destroy(); }
  });

  it('reconstructs Word default bullet and numbering profiles in a real editor without a warning', () => {
    const results: NormalizePasteHTMLResult[] = [];
    const receiving = new Editor({
      extensions: [Document, Paragraph, Text, ListItem, OrderedList, BulletList,
        PasteCleanup.configure({ onResult: result => { results.push(result); } })],
      content: '<p>Seed</p>',
    });
    try {
      receiving.commands.selectAll();
      // Authored in the shape Word writes, not a native capture.
      const style = '<style><!--\n@list l0:level1 {mso-level-number-format:bullet;mso-level-text:\\F0B7;font-family:Symbol;}\n'
        + '@list l0:level2 {mso-level-number-format:bullet;mso-level-text:o;font-family:"Courier New";}\n'
        + '@list l1:level1 {mso-level-tab-stop:none;}\n@list l1:level2 {mso-level-number-format:alpha-lower;}\n'
        + '@list l1:level3 {mso-level-number-format:roman-lower;}\n--></style>';
      const item = (list: string, level: number, font: string, marker: string, text: string): string =>
        `<p class=MsoListParagraph style="text-indent:-.25in;mso-list:${list} level${String(level)} lfo1"><span style='${font}'>`
        + `<span style="mso-list:Ignore">${marker}<span style='font:7.0pt "Times New Roman"'>&nbsp; </span></span></span>${text}</p>`;
      const html = '<meta charset="utf-8">' + style + item('l0', 1, 'font-family:Symbol', '·', 'Disc')
        + item('l0', 2, 'font-family:"Courier New"', 'o', 'Circle')
        + item('l1', 1, 'mso-bidi-font-family:Calibri', '1.', 'Decimal') + item('l1', 2, 'mso-bidi-font-family:Calibri', 'a.', 'Alpha')
        + item('l1', 3, 'mso-bidi-font-family:Calibri', 'i.', 'Roman');
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { items: [], files: [],
        getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? 'Disc\nCircle\nDecimal\nAlpha\nRoman' : '',
      } });
      receiving.view.dom.dispatchEvent(event);
      const list = (type: string, marker: string, content: unknown[], start?: number): unknown => ({
        type, attrs: { ...(start === undefined ? {} : { start }), listStyleType: marker }, content,
      });
      const entry = (text: string, ...nested: unknown[]): unknown => ({
        type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }, ...nested],
      });
      expect(receiving.getJSON().content).toEqual([
        list('bulletList', 'disc', [entry('Disc', list('bulletList', 'circle', [entry('Circle')]))]),
        list('orderedList', 'decimal', [entry('Decimal', list('orderedList', 'lower-alpha', [
          entry('Alpha', list('orderedList', 'lower-roman', [entry('Roman')], 1)),
        ], 1))], 1),
      ]);
      expect(results).toHaveLength(1);
      expect(results[0]?.diagnostics).toEqual([]);
    } finally { receiving.destroy(); }
  });

  it('keeps literal markers in a schema without list nodes', () => {
    const minimal = new Schema({ nodes: {
      doc: { content: 'paragraph+' },
      paragraph: { content: 'text*', parseDOM: [{ tag: 'p' }] },
      text: {},
    } });
    expect(officeListCapabilities(minimal, document)).toEqual({
      orderedLists: false, bulletLists: false, nestedLists: false,
    });
  });

  it('does not infer capability solely from familiar node names', () => {
    const nodes = editor.schema.spec.nodes.update('orderedList', {
      ...editor.schema.spec.nodes.get('orderedList'),
      parseDOM: [{ tag: 'div.custom-ordered-list' }],
    });
    const schema = new Schema({ nodes });
    expect(officeListCapabilities(schema, document)).toEqual({
      orderedLists: false, bulletLists: true, nestedLists: true,
    });
  });

  it('requires actual preservation of ordered starts', () => {
    const nodes = editor.schema.spec.nodes.update('orderedList', {
      ...editor.schema.spec.nodes.get('orderedList'),
      parseDOM: [{ tag: 'ol', getAttrs: () => ({ start: 1 }) }],
    });
    expect(officeListCapabilities(new Schema({ nodes }), document).orderedLists).toBe(false);
  });

  it('checks content expressions before allowing nested reconstruction', () => {
    const nodes = editor.schema.spec.nodes.update('listItem', {
      ...editor.schema.spec.nodes.get('listItem'), content: 'paragraph',
    });
    expect(officeListCapabilities(new Schema({ nodes }), document)).toEqual({
      orderedLists: true, bulletLists: true, nestedLists: false,
    });
  });

  it('fails closed when a custom parser throws without mutating the receiving editor', () => {
    const before = editor.getJSON();
    const nodes = editor.schema.spec.nodes.update('orderedList', {
      ...editor.schema.spec.nodes.get('orderedList'),
      parseDOM: [{ tag: 'ol', getAttrs: () => { throw new Error('Custom parser failed'); } }],
    });
    expect(officeListCapabilities(new Schema({ nodes }), document).orderedLists).toBe(false);
    expect(editor.getJSON()).toEqual(before);
  });
});
