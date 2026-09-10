/**
 * Image files pasted over a cell selection. The table's cell paste handler runs ahead of the
 * image node's when Table is listed first, as it often is. It must hand a paste whose files are
 * the paste, one without text of its own, to the view's image destination, as Core's rule
 * decides for every handler, instead of clearing the selected cells and taking the paste.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, Editor, Extension, Paragraph, Text } from '@domternal/core';
import { registerClipboardImageDestination } from '@domternal/core/clipboard';
import type { ClipboardImageFileInsertion } from '@domternal/core/clipboard';
import { Plugin } from '@domternal/pm/state';
import { CellSelection } from '@domternal/pm/tables';
import { Table, TableRow, TableCell, TableHeader } from './index.js';

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => { editor.destroy(); }); document.body.replaceChildren(); });

const TABLE = '<table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr><tr><td><p>c</p></td><td><p>d</p></td></tr></tbody></table>';

/** An image destination listed after Table, which records the files it is handed. */
function mount(insertions: ClipboardImageFileInsertion[]): Editor {
  const Destination = Extension.create({
    name: 'fileDestination',
    addProseMirrorPlugins: () => [new Plugin({
      view: view => ({
        destroy: registerClipboardImageDestination(view, () => ({
          nodeTypeName: 'image', sourceAttribute: 'src', inline: false, allowEmbedded: true,
          allowedMimeTypes: ['image/png'], maxFileBytes: 1_000_000, policyVersion: 'test:1',
        }), insertion => { insertions.push(insertion); return true; }),
      }),
    })],
  });
  const editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    extensions: [Document, Paragraph, Text, Table, TableRow, TableCell, TableHeader, Destination],
    content: TABLE,
  });
  editors.push(editor);
  return editor;
}

function selectFirstRow(editor: Editor): void {
  const cells: number[] = [];
  editor.state.doc.descendants((node, pos) => { if (node.type.name === 'tableCell') cells.push(pos); });
  editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, cells[0] ?? 0, cells[1] ?? 0)));
}

function paste(editor: Editor, files: File[], html = '', text = ''): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, 'clipboardData', {
    value: {
      types: [...(html ? ['text/html'] : []), ...(text ? ['text/plain'] : []), 'Files'], files,
      items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })),
      getData: (type: string) => (type === 'text/html' ? html : type === 'text/plain' ? text : ''),
    },
  });
  editor.view.dom.dispatchEvent(event);
  return event;
}

const png = (name: string): File => new File([new Uint8Array(8)], name, { type: 'image/png' });

describe('image files pasted over a cell selection, with Table listed before the image node', () => {
  it('hands files without text of their own to the image destination instead of clearing the cells', () => {
    const insertions: ClipboardImageFileInsertion[] = [];
    const editor = mount(insertions);
    selectFirstRow(editor);
    const file = png('shot.png');

    const event = paste(editor, [file]);

    expect(event.defaultPrevented).toBe(true);
    expect(insertions).toHaveLength(1);
    expect(insertions[0]?.files).toEqual([file]);
    // The destination replaces the selection itself; this one records only.
    expect(editor.getHTML()).toBe(TABLE);
  });

  it('pastes text that comes with a file into the cells, without the file', () => {
    const insertions: ClipboardImageFileInsertion[] = [];
    const editor = mount(insertions);
    selectFirstRow(editor);

    paste(editor, [png('picture-of-the-selection.png')], '<table><tbody><tr><td><p>X</p></td><td><p>Y</p></td></tr></tbody></table>');

    expect(insertions).toEqual([]);
    expect(editor.getHTML()).toBe('<table><tbody><tr><td><p>X</p></td><td><p>Y</p></td></tr><tr><td><p>c</p></td><td><p>d</p></td></tr></tbody></table>');
  });

  it('fills the cells as before when no image destination takes the files', () => {
    const editor = new Editor({
      element: document.body.appendChild(document.createElement('div')),
      extensions: [Document, Paragraph, Text, Table, TableRow, TableCell, TableHeader],
      content: TABLE,
    });
    editors.push(editor);
    selectFirstRow(editor);
    const handled = vi.fn();
    editor.view.dom.addEventListener('paste', handled);

    paste(editor, [png('shot.png')]);

    expect(handled).toHaveBeenCalled();
    expect(editor.getHTML()).toBe('<table><tbody><tr><td><p></p></td><td><p></p></td></tr><tr><td><p>c</p></td><td><p>d</p></td></tr></tbody></table>');
  });
});
