import { afterEach, describe, expect, it } from 'vitest';
import { Document, Editor, Paragraph, Text, generateHTML } from '@domternal/core';
import type { ContentDiagnosticProps, JSONContent } from '@domternal/core';
import { EditorState, TextSelection } from '@domternal/pm/state';
import type { Node as PMNode } from '@domternal/pm/model';
import { Table, TableRow, TableCell, TableHeader } from './index.js';

const extensions = [Document, Paragraph, Text, Table, TableRow, TableCell, TableHeader];
const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach(editor => { editor.destroy(); }); document.body.replaceChildren(); });

const content = (colwidth: unknown, type = 'tableCell'): JSONContent => ({
  type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [{
    type, attrs: { colwidth: colwidth as never }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'kept' }] }],
  }] }] }],
});

function mount(value: string | JSONContent, reports: ContentDiagnosticProps[] = []): Editor {
  const editor = new Editor({ element: document.body.appendChild(document.createElement('div')), extensions, content: value,
    onContentDiagnostic: report => { reports.push(report); } });
  editors.push(editor);
  return editor;
}

const cell = (editor: Editor): PMNode => editor.state.doc.child(0).child(0).child(0);
const bad: [string, unknown][] = [
  ['NaN and negative', [NaN, -5]], ['infinity', [Infinity]], ['negative', [-5]], ['string entries', ['120']],
  ['object', {}], ['non-array', '120'], ['too many columns', Array.from({ length: 1001 }, () => 1)],
  ['unbounded finite number', [Number.MAX_VALUE]],
];

describe('table column widths', () => {
  it.each(bad)('normalizes %s without losing cell text and reports the repair', (_name, value) => {
    const reports: ContentDiagnosticProps[] = [];
    const editor = mount(content(value), reports);
    expect(cell(editor).attrs['colwidth']).toBeNull();
    expect(editor.getText()).toBe('kept');
    expect(reports[0]?.diagnostics).toEqual([{ code: 'unsupported-table-width', nodeType: 'tableCell', attribute: 'colwidth', path: [0, 0, 0],
      ...(typeof value === 'string' ? { value } : {}) }]);
  });

  it.each([null, [], [0], [125], [125.5]])('keeps supported widths %j', value => {
    const reports: ContentDiagnosticProps[] = [];
    const editor = mount(content(value), reports);
    expect(cell(editor).attrs['colwidth']).toEqual(value);
    expect(reports).toEqual([]);
  });

  it.each(['NaN,-5', 'Infinity', '-1', 'text', '1e309'])('discards malformed HTML widths %s', value => {
    const editor = mount(`<table><tr><th data-colwidth="${value}"><p>kept</p></th></tr></table>`);
    expect(cell(editor).attrs['colwidth']).toBeNull();
    expect(editor.getHTML()).not.toContain('data-colwidth');
    expect(editor.getText()).toBe('kept');
  });

  it.each(bad)('renders a stored %s safely until an explicit migration changes it', (_name, value) => {
    const editor = mount('<p></p>');
    const paragraph = editor.schema.nodes['paragraph']!.create(null, editor.schema.text('kept'));
    const unsafe = editor.schema.nodes['tableCell']!.create({ colwidth: value }, paragraph);
    const table = editor.schema.nodes['table']!.create(null, editor.schema.nodes['tableRow']!.create(null, unsafe));
    const doc = editor.schema.nodes['doc']!.create(null, table);
    editor.view.updateState(EditorState.create({ schema: editor.schema, doc, plugins: editor.state.plugins }));
    expect(editor.getHTML()).not.toContain('data-colwidth');
    expect(editor.view.dom.querySelector('table')?.getAttribute('style') ?? '').not.toMatch(/NaN|Infinity|undefined/);
    expect(cell(editor).attrs['colwidth']).toBe(value);
    expect(editor.commands.normalizeContentAttributes({ codes: ['unsupported-table-width'] })).toBe(true);
    expect(cell(editor).attrs['colwidth']).toBeNull();
    expect(editor.getText()).toBe('kept');
  });

  it('guards commands, strict loading and standalone serialization for both cell types', () => {
    const editor = mount(content([100]));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4)));
    expect(editor.commands.setCellAttribute('colwidth', [-2])).toBe(false);
    expect(cell(editor).attrs['colwidth']).toEqual([100]);
    expect(editor.commands.setCellAttribute('colwidth', [0])).toBe(true);
    expect(cell(editor).attrs['colwidth']).toEqual([0]);
    for (const type of ['tableCell', 'tableHeader']) {
      expect(() => editor.schema.nodeFromJSON(content([NaN], type))).toThrow();
      expect(generateHTML(content([Infinity], type), extensions)).not.toContain('data-colwidth');
    }
  });
});
