import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { Fragment, Slice } from '@domternal/pm/model';
import type { Node as PMNode } from '@domternal/pm/model';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { OrderedList } from '../nodes/OrderedList.js';
import { BulletList } from '../nodes/BulletList.js';

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; });

/** Clipboard HTML whose data-pm-slice context rebuilds list wrappers around the pasted paragraph. */
const sliceHTML = (context: unknown[]): string =>
  `<p data-pm-slice="1 1 ${JSON.stringify(context).replace(/"/g, '&quot;')}">X</p>`;

function paste(context: unknown[]): Editor {
  editor = new Editor({ extensions: [Document, Paragraph, Text, OrderedList, BulletList], content: '<p>first</p><p></p>' });
  const end = editor.state.doc.content.size - 1;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)));
  expect(editor.view.pasteHTML(sliceHTML(context), new Event('paste') as ClipboardEvent)).toBe(true);
  return editor;
}

const lists = (ed: Editor): [string, unknown][] => {
  const found: [string, unknown][] = [];
  ed.state.doc.descendants(node => { if ('listStyleType' in node.attrs) found.push([node.type.name, node.attrs['listStyleType']]); });
  return found;
};

describe('pasted slice context with list markers', () => {
  it('drops unknown markers from rebuilt wrappers so the saved JSON loads again', () => {
    const ed = paste(['orderedList', { listStyleType: 'bogus', start: 1 }, 'listItem', null]);
    expect(lists(ed)).toEqual([['orderedList', null]]);
    expect(ed.getText()).toContain('X');
    expect(() => { ed.state.doc.check(); }).not.toThrow();
    expect(ed.setContent(ed.getJSON())).toBe(true);
  });

  it('drops unknown markers at every depth of a pasted slice', () => {
    editor = new Editor({ extensions: [Document, Paragraph, Text, OrderedList, BulletList], content: '<p></p>' });
    const { schema, view } = editor;
    const transform = (input: Slice): Slice => {
      let output = input;
      view.someProp('transformPasted', f => { output = f(output, view, false); });
      return output;
    };
    const item = (...content: PMNode[]): PMNode => schema.node('listItem', null, content);
    const paragraph = schema.node('paragraph', null, [schema.text('X')]);
    const inner = schema.node('orderedList', { listStyleType: 'weird' }, [item(paragraph)]);
    const kept = schema.node('orderedList', { listStyleType: 'lower-roman' }, [item(paragraph)]);
    const outer = schema.node('bulletList', { listStyleType: 'decimal' }, [item(paragraph, inner), item(paragraph, kept)]);
    const original = new Slice(outer.content, 0, 0);
    const slice = transform(original);
    expect(original.content.firstChild?.lastChild?.attrs['listStyleType']).toBe('weird');
    const found: unknown[] = [];
    slice.content.descendants(node => { if ('listStyleType' in node.attrs) found.push(node.attrs['listStyleType']); });
    expect(found).toEqual([null, 'lower-roman']);
    expect(transform(new Slice(Fragment.from(outer), 0, 0)).content.firstChild?.attrs['listStyleType']).toBeNull();
    const clean = new Slice(Fragment.from(kept), 1, 1);
    expect(transform(clean)).toBe(clean);
  });

  it('keeps known markers', () => {
    const ed = paste(['orderedList', { listStyleType: 'upper-alpha', start: 1 }, 'listItem', null]);
    expect(lists(ed)).toEqual([['orderedList', 'upper-alpha']]);
  });
});
