import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { undo, ySyncPlugin, yUndoPlugin } from 'y-prosemirror';
import { TextSelection } from '@domternal/pm/state';
import { splitListItem } from '@domternal/pm/schema-list';
import { Editor } from './Editor.js';
import { Extension } from './Extension.js';
import { Document } from './nodes/Document.js';
import { Paragraph } from './nodes/Paragraph.js';
import { Text } from './nodes/Text.js';
import { OrderedList } from './nodes/OrderedList.js';
import { ListLabels } from './extensions/ListLabels.js';

const editors: Editor[] = [];
const documents: Y.Doc[] = [];
afterEach(() => {
  editors.splice(0).forEach(editor => { editor.destroy(); });
  documents.splice(0).forEach(document => { document.destroy(); });
});

function setup(label: unknown, secondLabels = false): { document: Y.Doc; list: Y.XmlElement; current: Editor; older: Editor } {
  const document = new Y.Doc(); documents.push(document);
  const paragraph = new Y.XmlElement('paragraph'); const text = new Y.XmlText(); text.insert(0, 'Item'); paragraph.insert(0, [text]);
  const item = new Y.XmlElement('listItem'); item.insert(0, [paragraph]);
  const list = new Y.XmlElement('orderedList'); list.insert(0, [item]);
  list.setAttribute('start', 1 as unknown as string); list.setAttribute('listStyleType', 'upper-alpha');
  list.setAttribute('listLabel', label as string);
  document.getXmlFragment('default').insert(0, [list]);
  const build = (labels: boolean): Editor => {
    const Sync = Extension.create({ name: 'testListLabelSync', addProseMirrorPlugins: () => [ySyncPlugin(document.getXmlFragment('default')), yUndoPlugin()] });
    const editor = new Editor({ extensions: [Document, Paragraph, Text, OrderedList, ...(labels ? [ListLabels] : []), Sync] });
    editors.push(editor); return editor;
  };
  return { document, list, current: build(true), older: build(secondLabels) };
}

describe('optional list labels in shared documents', () => {
  it('renders an older schema without added text and documents label loss when that schema edits the list', () => {
    const label = { kind: 'counter', format: 'upper-alpha', prefix: 'Section ', suffix: ')' };
    const { document, list, current, older } = setup(label);
    let writes = 0; document.on('update', () => { writes++; });
    expect(current.view.dom.querySelector('ol')?.hasAttribute('data-dm-list-label')).toBe(true);
    expect(older.view.dom.querySelector('ol')?.hasAttribute('data-dm-list-label')).toBe(false);
    expect(older.getHTML()).toContain('list-style-type: upper-alpha');
    expect(current.getText()).toBe('Item'); expect(older.getText()).toBe('Item');
    expect(list.getAttribute('listLabel')).toEqual(label); expect(writes).toBe(0);
    older.view.dispatch(older.state.tr.setSelection(TextSelection.create(older.state.doc, 4)).insertText('!'));
    expect(list.getAttribute('listLabel')).toBeUndefined();
    expect(current.state.doc.firstChild?.attrs['listLabel']).toBeNull();
    expect(current.getText()).toBe('I!tem');
  });

  it('preserves labels through homogeneous edits, item splits and collaborative undo', () => {
    const label = { kind: 'counter', format: 'upper-alpha', prefix: 'Section ', suffix: ')' };
    const { list, current, older: other } = setup(label, true);
    other.view.dispatch(other.state.tr.setSelection(TextSelection.create(other.state.doc, 4)).insertText('!'));
    expect(current.getText()).toBe('I!tem');
    expect(list.getAttribute('listLabel')).toEqual(label);
    const itemType = other.schema.nodes['listItem'];
    if (!itemType) throw new Error('Missing list item');
    expect(splitListItem(itemType)(other.state, other.view.dispatch)).toBe(true);
    expect(current.state.doc.firstChild?.childCount).toBe(2);
    expect(current.state.doc.firstChild?.attrs['listLabel']).toEqual(label);
    expect(undo(other.state)).toBe(true);
    expect(current.getText()).toBe('Item');
    expect(current.state.doc.firstChild?.childCount).toBe(1);
    expect(list.getAttribute('listLabel')).toEqual(label);
    other.view.dispatch(other.state.tr.setNodeAttribute(0, 'listLabel', null));
    expect(current.state.doc.firstChild?.attrs['listLabel']).toBeNull();
    expect(current.getHTML()).not.toContain('data-dm-list-label');
  });

  it('renders a future invalid label as ordinary numbering until explicit normalization', () => {
    const unknown = { kind: 'future', text: 'unchanged' };
    const { document, list, current, older } = setup(unknown);
    let writes = 0; document.on('update', () => { writes++; });
    expect(current.state.doc.firstChild?.attrs['listLabel']).toEqual(unknown);
    expect(current.getHTML()).not.toContain('data-dm-list-label');
    expect(current.getText()).toBe('Item'); expect(older.getText()).toBe('Item');
    expect(list.getAttribute('listLabel')).toEqual(unknown); expect(writes).toBe(0);
    expect(current.commands.normalizeContentAttributes({ codes: ['unsupported-list-label'] })).toBe(true);
    expect(list.getAttribute('listLabel')).toBeUndefined();
    expect(current.state.doc.firstChild?.attrs['listLabel']).toBeNull();
    expect(current.getText()).toBe('Item'); expect(older.getText()).toBe('Item');
  });
});
