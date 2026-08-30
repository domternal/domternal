import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BulletList, Document, Editor, ListItem, OrderedList, Paragraph, Text } from '@domternal/core';
import { Schema } from '@domternal/pm/model';
import { officeListCapabilities } from './listCapabilities.js';
import { PasteCleanup } from './PasteCleanup.js';
import type { NormalizePasteHTMLResult } from './html/types.js';

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
      orderedLists: true, bulletLists: true, nestedLists: true,
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
      orderedLists: false, bulletLists: false, nestedLists: false,
    });
  });

  it('does not trust a declared marker attr when a parser collapses every bullet to disc', () => {
    const nodes = editor.schema.spec.nodes.update('bulletList', {
      ...editor.schema.spec.nodes.get('bulletList'), parseDOM: [{ tag: 'ul', getAttrs: () => ({ listStyleType: 'disc' }) }],
    });
    const schema = new Schema({ nodes });
    expect(officeListCapabilities(schema, document).bulletLists).toBe(true);
    expect(officeListCapabilities(schema, document, { preserveMarkers: true })).toEqual({
      orderedLists: true, bulletLists: false, nestedLists: true,
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
      orderedLists: true, bulletLists: true, nestedLists: false,
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
