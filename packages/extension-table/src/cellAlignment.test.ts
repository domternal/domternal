/**
 * A table cell's text and vertical alignment render as data attributes that
 * inline styles, such as getHTML({ styled: true }) and inlineStyles, turn
 * into declarations, so a value renders only when it is a safe CSS value:
 * one that cannot add a declaration or load a resource. The stored value is
 * kept, and setCellAttribute refuses an unsafe one.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { Document, Text, Paragraph, Editor, generateHTML, inlineStyles } from '@domternal/core';
import type { JSONContent } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { Table } from './Table.js';
import { TableRow } from './TableRow.js';
import { TableCell } from './TableCell.js';
import { TableHeader } from './TableHeader.js';
import { cellAttributes } from './helpers/cellAttributes.js';

const extensions = [Document, Text, Paragraph, Table, TableRow, TableCell, TableHeader];
const attrs = cellAttributes();
const ALIGNMENTS = [['textAlign', 'data-text-align', 'text-align'], ['verticalAlign', 'data-vertical-align', 'vertical-align']] as const;

const UNSAFE: unknown[] = [
  'left; position: fixed; inset: 0; z-index: 2147483647; background: url(http://probe.test/table-align)',
  'center;background-image:url(https://probe.test/x)',
  'url(https://probe.test/x)',
  'middle !important',
  '\\3b',
  'top\nposition:fixed',
  'left&#59;position:fixed',
  ['center'],
  42,
];

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; });

const table = (name: string, value: unknown, cell: 'tableCell' | 'tableHeader' = 'tableCell'): JSONContent => ({ type: 'doc', content: [{
  type: 'table', content: [{ type: 'tableRow', content: [
    { type: cell, attrs: { [name]: value as string }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
  ] }],
}] });

/** The cell elements of the editor DOM, getHTML, styled getHTML, generateHTML and inlineStyles of it. */
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
    ...parse(editor.getHTML({ styled: true })),
    ...parse(generateHTML(content, extensions)),
    ...parse(inlineStyles(generateHTML(content, extensions))),
  ];
}

describe.each(ALIGNMENTS)('table cell %s', (name, dataAttribute, property) => {
  it.each(['center', 'right', 'justify', 'middle', 'bottom', '-webkit-center', 'var(--cell-align)'])('renders the safe value %j', (value) => {
    expect(attrs[name]?.renderHTML?.({ [name]: value })).toEqual({ [dataAttribute]: value });
    for (const cellType of ['tableCell', 'tableHeader'] as const) {
      const found = cells(table(name, value, cellType));
      expect(found).toHaveLength(5);
      for (const element of found) expect(element.getAttribute(dataAttribute)).toBe(value);
      const styled = editor!.getHTML({ styled: true });
      expect(styled).toContain(`${property}: ${value};`);
      editor?.destroy();
    }
  });

  it.each(UNSAFE.map(value => [JSON.stringify(value), value]))('does not render %s anywhere, and keeps it stored', (_label, value) => {
    expect(attrs[name]?.renderHTML?.({ [name]: value })).toBeNull();
    const found = cells(table(name, value));
    expect(found).toHaveLength(5);
    for (const element of found) {
      expect(element.hasAttribute(dataAttribute)).toBe(false);
      expect(element.getAttribute('style') ?? '').not.toMatch(/position|probe\.test|url\(|!important/);
    }
    expect(editor!.state.doc.firstChild?.firstChild?.firstChild?.attrs[name]).toEqual(value);
  });

  it('parses a safe value and drops an unsafe one', () => {
    const safe = document.createElement('td');
    safe.setAttribute(dataAttribute, 'center');
    expect(attrs[name]?.parseHTML?.(safe)).toBe('center');
    const unsafe = document.createElement('td');
    unsafe.setAttribute(dataAttribute, 'left;position:fixed;inset:0');
    expect(attrs[name]?.parseHTML?.(unsafe)).toBeNull();
    const absent = document.createElement('td');
    expect(attrs[name]?.parseHTML?.(absent)).toBeNull();
  });

  it('loads pasted HTML with an unsafe value without it', () => {
    editor = new Editor({
      extensions,
      content: `<table><tr><td ${dataAttribute}="left;position:fixed;inset:0;background:url(https://probe.test/x)"><p>A</p></td></tr></table>`,
    });
    expect(editor.state.doc.firstChild?.firstChild?.firstChild?.attrs[name]).toBeNull();
    expect(editor.getHTML({ styled: true })).not.toContain('probe.test');
  });

  it('setCellAttribute refuses an unsafe value and accepts a safe one or none', () => {
    editor = new Editor({ extensions, content: '<table><tr><td><p>A</p></td><td><p>B</p></td></tr></table>' });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4)));
    const stored = (): unknown => editor!.state.doc.firstChild?.firstChild?.firstChild?.attrs[name];
    for (const value of UNSAFE) {
      expect(editor.commands.setCellAttribute(name, value), JSON.stringify(value)).toBe(false);
    }
    expect(stored()).toBeNull();
    expect(editor.commands.setCellAttribute(name, 'center')).toBe(true);
    expect(stored()).toBe('center');
    expect(editor.commands.setCellAttribute(name, null)).toBe(true);
    expect(stored()).toBeNull();
  });
});

describe('inline styles of table cells from any HTML', () => {
  it('turns only safe alignment values into declarations', () => {
    const html = '<table><tbody><tr>'
      + '<td data-text-align="left; position: fixed; inset: 0; background: url(https://probe.test/a)" data-vertical-align="top;background:url(https://probe.test/b)">A</td>'
      + '<th data-text-align="center" data-vertical-align="bottom">B</th>'
      + '</tr></tbody></table>';
    const host = document.createElement('div');
    host.innerHTML = inlineStyles(html);
    const [td, th] = Array.from(host.querySelectorAll('td, th'), cell => cell.getAttribute('style') ?? '');
    expect(td).not.toMatch(/position|probe\.test|text-align|vertical-align/);
    expect(th).toContain('text-align: center;');
    expect(th).toContain('vertical-align: bottom;');
  });
});
