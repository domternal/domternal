/**
 * A table cell background reaches the style attribute only when it cannot
 * add a declaration or load a resource (G6). The stored value is kept, and
 * setCellAttribute refuses an unsafe one.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Document, Text, Paragraph, Editor, generateHTML } from '@domternal/core';
import type { JSONContent } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { Table } from './Table.js';
import { TableRow } from './TableRow.js';
import { TableCell } from './TableCell.js';
import { TableHeader } from './TableHeader.js';
import { cellAttributes } from './helpers/cellAttributes.js';

const extensions = [Document, Text, Paragraph, Table, TableRow, TableCell, TableHeader];
const attrs = cellAttributes();

const UNSAFE: unknown[] = [
  'red;background-image:url(https://probe.test/x)',
  'url(https://probe.test/x)',
  'red;position:fixed;inset:0',
  'red !important',
  '\\3b',
  'red\nposition:fixed',
  ['red'],
  42,
];

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; });

const table = (background: unknown, cell: 'tableCell' | 'tableHeader' = 'tableCell'): JSONContent => ({ type: 'doc', content: [{
  type: 'table', content: [{ type: 'tableRow', content: [
    { type: cell, attrs: { background: background as string }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
  ] }],
}] });

/** The cell elements the editor DOM, getHTML and generateHTML render. */
function cells(content: JSONContent): Element[] {
  editor = new Editor({ extensions, content });
  const parse = (html: string): Element[] => {
    const host = document.createElement('div');
    host.innerHTML = html;
    return Array.from(host.querySelectorAll('td, th'));
  };
  return [
    ...Array.from(editor.view.dom.querySelectorAll('td, th')),
    ...parse(editor.getHTML()),
    ...parse(generateHTML(content, extensions)),
  ];
}

describe('table cell background (G6)', () => {
  it.each(['#fef08a', 'rgb(1, 2, 3)', 'yellow', 'var(--cell)'])('renders the safe value %j', (value) => {
    expect(attrs['background']?.renderHTML?.({ background: value })).toEqual({ 'data-background': value, style: `background-color: ${value}` });
    for (const cellType of ['tableCell', 'tableHeader'] as const) {
      const found = cells(table(value, cellType));
      expect(found).toHaveLength(3);
      for (const element of found) {
        expect(element.getAttribute('data-background')).toBe(value);
        expect((element as HTMLElement).style.length).toBe(1);
        expect((element as HTMLElement).style.backgroundColor).not.toBe('');
      }
      editor?.destroy();
    }
  });

  it.each(UNSAFE.map(value => [JSON.stringify(value), value]))('does not render %s, and keeps it stored', (_label, value) => {
    expect(attrs['background']?.renderHTML?.({ background: value })).toBeNull();
    const found = cells(table(value));
    expect(found).toHaveLength(3);
    for (const element of found) {
      expect(element.hasAttribute('style')).toBe(false);
      expect(element.hasAttribute('data-background')).toBe(false);
    }
    expect(editor!.state.doc.firstChild?.firstChild?.firstChild?.attrs['background']).toEqual(value);
  });

  it('parses a safe data-background, and falls back to the CSSOM background for an unsafe one', () => {
    const safe = document.createElement('td');
    safe.setAttribute('data-background', '#fef08a');
    expect(attrs['background']?.parseHTML?.(safe)).toBe('#fef08a');

    const unsafe = document.createElement('td');
    unsafe.setAttribute('data-background', 'red;background-image:url(https://probe.test/x)');
    unsafe.style.backgroundColor = 'rgb(255, 0, 0)';
    expect(attrs['background']?.parseHTML?.(unsafe)).toBe('rgb(255, 0, 0)');

    const alone = document.createElement('td');
    alone.setAttribute('data-background', 'url(https://probe.test/x)');
    expect(attrs['background']?.parseHTML?.(alone)).toBeNull();
  });

  it('loads pasted HTML with an unsafe data-background through the CSSOM value', () => {
    editor = new Editor({
      extensions,
      content: '<table><tr><td data-background="red;background-image:url(https://probe.test/x)" style="background-color: rgb(0, 128, 0)"><p>A</p></td></tr></table>',
    });
    expect(editor.state.doc.firstChild?.firstChild?.firstChild?.attrs['background']).toBe('rgb(0, 128, 0)');
    expect(editor.getHTML()).not.toContain('probe.test');
  });

  it('setCellAttribute refuses an unsafe background and accepts a safe one', () => {
    editor = new Editor({ extensions, content: '<table><tr><td><p>A</p></td><td><p>B</p></td></tr></table>' });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4)));
    for (const value of UNSAFE) {
      expect(editor.commands.setCellAttribute('background', value), JSON.stringify(value)).toBe(false);
    }
    expect(editor.state.doc.firstChild?.firstChild?.firstChild?.attrs['background']).toBeNull();
    expect(editor.commands.setCellAttribute('background', '#fef08a')).toBe(true);
    expect(editor.state.doc.firstChild?.firstChild?.firstChild?.attrs['background']).toBe('#fef08a');
    expect(editor.commands.setCellAttribute('background', null)).toBe(true);
    expect(editor.state.doc.firstChild?.firstChild?.firstChild?.attrs['background']).toBeNull();
  });
});
