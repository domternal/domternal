/**
 * colspan and rowspan: validation accepts any whole number from 1, and loading replaces an
 * invalid span or one above 1,000 by the span a browser draws for it, with an
 * unsupported-table-span diagnostic. Rendering follows the replacement, the document keeps what
 * it stores until normalizeContentAttributes runs, and commands never store an unsupported span.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  Document, Editor, Paragraph, Text, createDocument, generateHTML, isSupportedAttributeValue, normalizeContent,
  resolveAttributeValue,
} from '@domternal/core';
import type { ContentDiagnostic, ContentDiagnosticProps, JSONContent } from '@domternal/core';
import { EditorState, TextSelection } from '@domternal/pm/state';
import { Fragment, Slice } from '@domternal/pm/model';
import type { Node as PMNode, NodeType, Schema } from '@domternal/pm/model';
import { Table, TableRow, TableCell, TableHeader } from './index.js';
import { MAX_SPAN, resolveSpan, validateSpan } from './helpers/cellAttributes.js';

const extensions = [Document, Paragraph, Text, Table, TableRow, TableCell, TableHeader];

const cell = (attrs: Record<string, unknown> = {}, text = 'x', type = 'tableCell'): JSONContent =>
  ({ type, attrs: attrs as Record<string, never>, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const table = (...rows: JSONContent[][]): JSONContent =>
  ({ type: 'doc', content: [{ type: 'table', content: rows.map(cells => ({ type: 'tableRow', content: cells })) }] });
/** One row whose first cell holds the span under test. */
const spanned = (attribute: 'colspan' | 'rowspan', value: unknown, type = 'tableCell'): JSONContent =>
  table([cell({ [attribute]: value }, 'a', type), cell({}, 'b')]);

const firstCell = (doc: PMNode): PMNode => {
  let found: PMNode | undefined;
  doc.descendants(node => { if (!found && String(node.type.spec['tableRole']).includes('cell')) found = node; return !found; });
  if (!found) throw new Error('No cell');
  return found;
};

/** Every row of the span table: stored value, replacement, reported value (undefined when not reported). */
const REPLACED: [string, unknown, number, (string | number)?][] = [
  ['1001', 1001, 1000, 1001], ['5000', 5000, 1000, 5000], ['1e6', 1e6, 1000, 1e6], ['1e21', 1e21, 1000, 1e21],
  ['0', 0, 1, 0], ['-1', -1, 1, -1], ['1.5', 1.5, 1, 1.5], ['2.9', 2.9, 2, 2.9],
  ['NaN', Number.NaN, 1], ['Infinity', Number.POSITIVE_INFINITY, 1], ['-Infinity', Number.NEGATIVE_INFINITY, 1],
  ['null', null, 1], ['true', true, 1], ['{}', {}, 1], ['[]', [], 1],
  ['"2"', '2', 2, '2'], ['" 3px"', ' 3px', 3, ' 3px'], ['"+4"', '+4', 4, '+4'],
  ['"abc"', 'abc', 1, 'abc'], ['""', '', 1, ''], ['"-1"', '-1', 1, '-1'], ['"0x10"', '0x10', 1, '0x10'],
];
const KEPT: [string, number][] = [['1', 1], ['2', 2], ['1000', 1000]];

/** A node type of the schema, which the table extensions always define. */
function nodeType(schema: Schema, name: string): NodeType {
  const type = schema.nodes[name];
  if (!type) throw new Error(`No ${name} node`);
  return type;
}

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); document.body.replaceChildren(); });

function mount(content: JSONContent | string, reports: ContentDiagnosticProps[] = []): Editor {
  const editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    extensions, content, onContentDiagnostic: props => { reports.push(props); },
  });
  editors.push(editor);
  return editor;
}

/** Puts a document into the editor without validation or appended transactions, as a collaborative binding does. */
function hold(editor: Editor, doc: PMNode): void {
  editor.view.updateState(EditorState.create({ schema: editor.schema, doc, plugins: editor.state.plugins }));
}

/** A document holding the stored span, built without validation. */
function storedDocument(schema: Schema, attribute: 'colspan' | 'rowspan', value: unknown): PMNode {
    const paragraph = (text: string): PMNode => nodeType(schema, 'paragraph').create(null, schema.text(text));
  const row = nodeType(schema, 'tableRow').create(null, [
    nodeType(schema, 'tableCell').create({ [attribute]: value }, paragraph('a')),
    nodeType(schema, 'tableCell').create(null, paragraph('b')),
  ]);
  return nodeType(schema, 'doc').create(null, nodeType(schema, 'table').create(null, row));
}

describe('span validation', () => {
  it.each(KEPT)('accepts %s', (_name, value) => {
    expect(() => { validateSpan(value); }).not.toThrow();
    expect(resolveSpan(value)).toBe(value);
  });

  it.each([...REPLACED.filter(([, value]) => !(Number.isSafeInteger(value) && (value as number) >= 1))])('rejects %s', (_name, value) => {
    expect(() => { validateSpan(value); }).toThrow(RangeError);
  });

  it('accepts a whole number above the rendering bound, so JSON older clients stored still loads strictly', () => {
    expect(() => { validateSpan(5000); }).not.toThrow();
    expect(MAX_SPAN).toBe(1000);
  });

  it('makes strict ProseMirror loading reject an invalid span and accept a large whole one', () => {
    const { schema } = mount('<p></p>');
    expect(() => schema.nodeFromJSON(spanned('colspan', -1))).toThrow(RangeError);
    expect(() => schema.nodeFromJSON(spanned('rowspan', '2'))).toThrow(RangeError);
    expect(() => schema.nodeFromJSON(spanned('colspan', 5000))).not.toThrow();
  });
});

describe.each(['colspan', 'rowspan'] as const)('%s loading', attribute => {
  it.each(REPLACED)(`loads %s as the span a browser draws, with a diagnostic`, (_name, value, replacement, reported) => {
    const expected: ContentDiagnostic = {
      code: 'unsupported-table-span', nodeType: 'tableCell', attribute, path: [0, 0, 0],
      ...(reported === undefined ? {} : { value: reported }),
    };
    const reports: ContentDiagnosticProps[] = [];
    const editor = mount(spanned(attribute, value), reports);
    expect(firstCell(editor.state.doc).attrs[attribute]).toBe(replacement);
    expect(reports.map(report => report.diagnostics)).toEqual([[expected]]);

    // A change runs prosemirror-tables' fixTables, which clips a rowspan to the table's one row.
    const changed = attribute === 'rowspan' ? 1 : replacement;
    editor.commands.setContent(spanned(attribute, value));
    expect(firstCell(editor.state.doc).attrs[attribute]).toBe(changed);
    expect(reports.map(report => report.source)).toEqual(['content', 'setContent']);
    expect(reports[1]?.diagnostics).toEqual([expected]);

    editor.commands.setContent('<p>start</p>');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
    expect(editor.commands.insertContent(spanned(attribute, value))).toBe(true);
    expect(firstCell(editor.state.doc).attrs[attribute]).toBe(changed);
    expect(reports.at(-1)?.source).toBe('insertContent');

    const diagnostics: ContentDiagnostic[] = [];
    const normalized = normalizeContent(spanned(attribute, value), editor.schema, { onDiagnostic: diagnostic => { diagnostics.push(diagnostic); } });
    expect(normalized.content?.[0]?.content?.[0]?.content?.[0]?.attrs?.[attribute]).toBe(replacement);
    expect(diagnostics).toEqual([expected]);
    expect(firstCell(createDocument(spanned(attribute, value), editor.schema)).attrs[attribute]).toBe(replacement);

    const html = generateHTML(spanned(attribute, value), extensions);
    expect(html).toContain(replacement === 1 ? '<td><p>a</p></td>' : `<td ${attribute}="${String(replacement)}"><p>a</p></td>`);
  });

  it.each(KEPT)('keeps %s without a diagnostic', (_name, value) => {
    const reports: ContentDiagnosticProps[] = [];
    const editor = mount(spanned(attribute, value), reports);
    expect(firstCell(editor.state.doc).attrs[attribute]).toBe(value);
    expect(reports).toEqual([]);
  });

  it('replaces a span of a header cell too', () => {
    const reports: ContentDiagnosticProps[] = [];
    const editor = mount(spanned(attribute, 0, 'tableHeader'), reports);
    expect(firstCell(editor.state.doc).attrs[attribute]).toBe(1);
    expect(reports[0]?.diagnostics[0]).toMatchObject({ code: 'unsupported-table-span', nodeType: 'tableHeader', attribute });
  });

  it.each(REPLACED)('reads %s as its replacement in the value helpers', (_name, value, replacement) => {
    const { schema } = mount('<p></p>');
    for (const type of ['tableCell', 'tableHeader']) {
      expect(isSupportedAttributeValue(schema, type, attribute, value)).toBe(false);
      expect(resolveAttributeValue(schema, type, attribute, value)).toBe(replacement);
    }
  });

  it.each(KEPT)('reads %s as itself in the value helpers', (_name, value) => {
    const { schema } = mount('<p></p>');
    expect(isSupportedAttributeValue(schema, 'tableCell', attribute, value)).toBe(true);
    expect(resolveAttributeValue(schema, 'tableCell', attribute, value)).toBe(value);
  });
});

describe('a stored span that loading would replace', () => {
  it.each(REPLACED)('renders %s as its replacement and keeps the stored value', (_name, value, replacement) => {
    for (const attribute of ['colspan', 'rowspan'] as const) {
      const editor = mount('<p></p>');
      hold(editor, storedDocument(editor.schema, attribute, value));
      const expected = replacement === 1 ? '<td><p>a</p></td>' : `<td ${attribute}="${String(replacement)}"><p>a</p></td>`;
      expect(editor.getHTML()).toContain(expected);
      const td = editor.view.dom.querySelector('td');
      expect(td?.getAttribute(attribute)).toBe(replacement === 1 ? null : String(replacement));
      expect(firstCell(editor.state.doc).attrs[attribute]).toBe(value);
    }
  });

  it('draws at most 1,000 columns for a huge stored colspan', () => {
    const editor = mount('<p></p>');
    hold(editor, storedDocument(editor.schema, 'colspan', 1e6));
    expect(editor.view.dom.querySelectorAll('col').length).toBe(MAX_SPAN + 1);
  });

  it('draws as many columns as a numeric string span reads as', () => {
    const editor = mount('<p></p>');
    hold(editor, storedDocument(editor.schema, 'colspan', '2'));
    expect(editor.view.dom.querySelectorAll('col').length).toBe(3);
  });

  it('is migrated by normalizeContentAttributes, alone through its code', () => {
    const reports: ContentDiagnosticProps[] = [];
    const editor = mount('<p></p>', reports);
    hold(editor, storedDocument(editor.schema, 'colspan', 5000));

    expect(editor.can().normalizeContentAttributes({ codes: ['unsupported-table-span'] })).toBe(true);
    expect(editor.commands.normalizeContentAttributes({ codes: ['unsupported-table-span'] })).toBe(true);

    expect(firstCell(editor.state.doc).attrs['colspan']).toBe(1000);
    expect(reports.at(-1)).toMatchObject({ source: 'normalizeContentAttributes', total: 1 });
    expect(editor.can().normalizeContentAttributes()).toBe(false);
  });
});

describe('setCellAttribute with a span', () => {
  function inCell(): Editor {
    const editor = mount(table([cell({}, 'a'), cell({}, 'b')], [cell({}, 'c'), cell({}, 'd')]));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));
    return editor;
  }

  it.each([0, -1, 1.5, '2', 1001, Number.NaN, null])('refuses %j', value => {
    const editor = inCell();
    const before = editor.state.doc;
    expect(editor.commands.setCellAttribute('colspan', value)).toBe(false);
    expect(editor.commands.setCellAttribute('rowspan', value)).toBe(false);
    expect(editor.can().setCellAttribute('colspan', value)).toBe(false);
    expect(editor.state.doc).toBe(before);
  });

  it('stores a supported span', () => {
    const editor = inCell();
    expect(editor.commands.setCellAttribute('colspan', 2)).toBe(true);
    expect(firstCell(editor.state.doc).attrs['colspan']).toBe(2);
    expect(editor.commands.setCellAttribute('rowspan', 1000)).toBe(true);
  });
});

describe('a pasted span', () => {
  it('replaces an invalid span in a pasted slice, which prosemirror-view rebuilds without validation, and keeps a valid one', () => {
    const editor = mount('<p></p>');
    const { schema, view } = editor;
    const transform = (input: Slice): Slice => {
      let output = input;
      view.someProp('transformPasted', f => { output = f(output, view, false); });
      return output;
    };
    const paragraph = (): PMNode => schema.node('paragraph', null, [schema.text('X')]);
    const cellWith = (colspan: unknown, rowspan: unknown = 1): PMNode => schema.node('tableCell', { colspan, rowspan }, [paragraph()]);
    const tableOf = (...cells: PMNode[]): PMNode => schema.node('table', null, [schema.node('tableRow', null, cells)]);
    const pasted = transform(new Slice(Fragment.from(tableOf(cellWith(-1), cellWith('3', 0), cellWith(1500))), 0, 0));
    const spans: unknown[] = [];
    pasted.content.descendants(node => { if (node.type.name === 'tableCell') spans.push([node.attrs['colspan'], node.attrs['rowspan']]); });
    expect(spans).toEqual([[1, 1], [3, 1], [1500, 1]]);
    const valid = new Slice(Fragment.from(tableOf(cellWith(2))), 0, 0);
    expect(transform(valid)).toBe(valid);
  });

  it('reads a span attribute of pasted HTML as a browser does', () => {
    const editor = mount('<p></p>');
    editor.view.pasteHTML('<table><tr><td colspan="0" rowspan="NaN">a</td><td colspan="-1">b</td></tr></table>', new Event('paste', { cancelable: true }) as ClipboardEvent);
    const spans: unknown[] = [];
    editor.state.doc.descendants(node => { if (node.type.name === 'tableCell') spans.push([node.attrs['colspan'], node.attrs['rowspan']]); });
    expect(spans).toEqual([[1, 1], [1, 1]]);
  });
});
