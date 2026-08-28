import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BulletList, Document, Editor, ListItem, OrderedList, Paragraph, Text } from '@domternal/core';
import { Schema } from '@domternal/pm/model';
import { officeListCapabilities } from './listCapabilities.js';

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
