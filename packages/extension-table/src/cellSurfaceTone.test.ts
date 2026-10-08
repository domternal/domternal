/**
 * A cell's own background marks the cell light or dark in the editor view
 * (data-dm-tone, a node decoration), so the theme draws text without a color
 * of its own in black or white on it. getHTML, generateHTML, clipboard HTML
 * and stored JSON never carry it.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Document, Text, Paragraph, Editor, History, Highlight, TextStyle, generateHTML } from '@domternal/core';
import type { JSONContent } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import type { Plugin } from '@domternal/pm/state';
import { Table } from './Table.js';
import { TableRow } from './TableRow.js';
import { TableCell } from './TableCell.js';
import { TableHeader } from './TableHeader.js';
import { cellSurfaceToneKey } from './plugins/cellSurfaceTonePlugin.js';

const extensions = [Document, Text, Paragraph, TextStyle, Highlight, History, Table, TableRow, TableCell, TableHeader];

let editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
});

const cell = (background: string | null, text: string, type: 'tableCell' | 'tableHeader' = 'tableCell', inner?: JSONContent[]): JSONContent => ({
  type,
  attrs: { background },
  content: [{ type: 'paragraph', content: inner ?? [{ type: 'text', text }] }],
});
const table = (...cells: JSONContent[]): JSONContent => ({ type: 'table', content: [{ type: 'tableRow', content: cells }] });
const doc = (...blocks: JSONContent[]): JSONContent => ({ type: 'doc', content: blocks });

function mount(content: JSONContent, list: unknown[] = extensions): Editor {
  const editor = new Editor({ extensions: list as never, content });
  editors.push(editor);
  return editor;
}

const tones = (editor: Editor): string[] =>
  Array.from(editor.view.dom.querySelectorAll('[data-dm-tone]')).map((element) => `${element.tagName.toLowerCase()} ${element.getAttribute('data-dm-tone') ?? ''}:${element.textContent}`);

function cellPosition(editor: Editor, index: number): number {
  const found: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.spec['tableRole'] === 'cell' || node.type.spec['tableRole'] === 'header_cell') found.push(pos);
  });
  return found[index] ?? -1;
}

describe('cell surface tone', () => {
  it('marks td and th light, dark or mid by their own background', () => {
    const editor = mount(doc(table(
      cell('#002060', 'navy', 'tableHeader'),
      cell('rgb(217, 217, 217)', 'gray'),
      cell('#4472C4', 'blue'),
      cell('#FFF2CC', 'cream'),
      cell(null, 'plain'),
    )));
    expect(tones(editor)).toEqual(['th dark:navy', 'td light:gray', 'td dark mid:blue', 'td light:cream']);
  });

  it('gives no tone where the background is not drawn or the surface behind it decides', () => {
    const editor = mount(doc(table(
      cell('url(https://probe.test/x)', 'unsafe'),
      cell('transparent', 'clear'),
      cell('inherit', 'inherited'),
      cell('rgba(0, 0, 255, 0.5)', 'half'),
      cell('rgb(0, 0, 50%)', 'legacy mix'),
      cell('#002060\u00a0', 'no-break space'),
      cell('hsl(240, 100, 20)', 'unitless legacy'),
    )));
    expect(tones(editor)).toEqual([]);
  });

  it('marks a painted background it cannot read unknown, with its value as --dm-tone-surface for the theme, in the view only', () => {
    const editor = mount(doc(table(cell('var(--cell, #fef08a)', 'variable'), cell('oklch(0.25 0.1 265)', 'oklch', 'tableHeader'))));
    expect(tones(editor)).toEqual(['td unknown:variable', 'th unknown:oklch']);
    const td = editor.view.dom.querySelector('td');
    expect(td?.style.getPropertyValue('background-color')).toBe('var(--cell, #fef08a)');
    expect(td?.style.getPropertyValue('--dm-tone-surface').trim()).toBe('var(--cell, #fef08a)');
    expect(editor.view.dom.querySelector('th')?.style.getPropertyValue('--dm-tone-surface').trim()).toBe('oklch(0.25 0.1 265)');
    expect(editor.getHTML()).not.toContain('--dm-tone');
    // A known tone carries no surface value.
    editor.view.dispatch(editor.state.tr.setNodeAttribute(cellPosition(editor, 0), 'background', '#000080'));
    expect(tones(editor)).toEqual(['td dark:variable', 'th unknown:oklch']);
    expect(editor.view.dom.querySelector('td')?.style.getPropertyValue('--dm-tone-surface')).toBe('');
  });

  it('gives no tone to a value the engine does not paint, though it reads one', () => {
    vi.stubGlobal('CSS', { supports: (_property: string, value: string) => value !== '#00205d' && value !== 'var(--unpainted-cell)' });
    try {
      const editor = mount(doc(table(cell('#00205d', 'unpainted'), cell('var(--unpainted-cell)', 'unread'), cell('#00205c', 'painted'))));
      expect(tones(editor)).toEqual(['td dark:painted']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('follows attribute changes, undo and a cell that loses its background', () => {
    const editor = mount(doc(table(cell('#ffff00', 'A'), cell(null, 'B'))));
    expect(tones(editor)).toEqual(['td light:A']);
    editor.view.dispatch(editor.state.tr.setNodeAttribute(cellPosition(editor, 0), 'background', '#000080'));
    expect(tones(editor)).toEqual(['td dark:A']);
    editor.view.dispatch(editor.state.tr.setNodeAttribute(cellPosition(editor, 1), 'background', '#808080'));
    expect(tones(editor)).toEqual(['td dark:A', 'td light mid:B']);
    editor.view.dispatch(editor.state.tr.setNodeAttribute(cellPosition(editor, 0), 'background', null));
    expect(tones(editor)).toEqual(['td light mid:B']);
    editor.commands.undo();
    expect(tones(editor)).toEqual(['td dark:A', 'td light mid:B']);
  });

  it('keeps the tones of nested islands apart: a highlight in a dark cell, a dark highlight in a light cell', () => {
    const highlight = (text: string, backgroundColor: string): JSONContent => ({ type: 'text', text, marks: [{ type: 'textStyle', attrs: { backgroundColor } }] });
    const editor = mount(doc(table(
      cell('#002060', '', 'tableCell', [{ type: 'text', text: 'around ' }, highlight('light', '#fef08a')]),
      cell('#d9d9d9', '', 'tableCell', [highlight('dark', '#000080')]),
    )));
    expect(tones(editor)).toEqual(['td dark:around light', 'span light:light', 'td light:dark', 'span dark:dark']);
    const span = editor.view.dom.querySelector('td[data-dm-tone="dark"] span[data-dm-tone="light"]');
    expect(span?.textContent).toBe('light');
  });

  it('reaches cells of a table inside a cell, and only cells', () => {
    const inner = table(cell('#000000', 'deep'));
    const editor = mount(doc({ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { background: '#ffffff' }, content: [inner] }] }] }));
    expect(tones(editor)).toEqual(['td light:deep', 'td dark:deep']);
  });

  it('changes nothing outside the view', () => {
    const content = doc(table(cell('#002060', 'navy', 'tableHeader'), cell('#d9d9d9', 'gray'), cell('var(--brand)', 'variable')));
    const withTone = mount(content);
    const NoTone = Table.extend({
      addProseMirrorPlugins() {
        return ((this.parent?.() ?? []) as Plugin[]).filter((plugin) => plugin.spec.key !== cellSurfaceToneKey);
      },
    });
    const without = mount(content, extensions.map((extension) => (extension === Table ? NoTone : extension)));
    expect(tones(withTone)).toHaveLength(3);
    expect(tones(without)).toEqual([]);
    expect(withTone.getJSON()).toEqual(without.getJSON());
    expect(withTone.getHTML()).toBe(without.getHTML());
    expect(withTone.getHTML({ styled: true })).toBe(without.getHTML({ styled: true }));
    expect(withTone.getHTML()).not.toContain('data-dm-tone');
    expect(withTone.getHTML({ styled: true })).not.toContain('--dm-tone');
    expect(generateHTML(content, extensions as never)).not.toContain('data-dm-tone');
    expect(generateHTML(content, extensions as never)).not.toContain('--dm-tone');
    withTone.commands.selectAll();
    const copied = withTone.view.serializeForClipboard(withTone.state.selection.content());
    expect(copied.dom.innerHTML).not.toContain('data-dm-tone');
    expect(copied.dom.innerHTML).not.toContain('--dm-tone');
    expect(copied.dom.innerHTML).toContain('background-color');
  });

  it('keeps the decoration set when nothing in the document changes', () => {
    const editor = mount(doc(table(cell('#002060', 'A')), { type: 'paragraph', content: [{ type: 'text', text: 'after' }] }));
    const before = cellSurfaceToneKey.getState(editor.state);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, editor.state.doc.content.size - 2)));
    expect(cellSurfaceToneKey.getState(editor.state)).toBe(before);
  });
});
