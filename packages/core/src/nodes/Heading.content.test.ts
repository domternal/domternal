import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import type { Schema } from '@domternal/pm/model';
import { Editor } from '../Editor.js';
import { Node } from '../Node.js';
import { ExtensionManager } from '../ExtensionManager.js';
import { Document } from './Document.js';
import { Paragraph } from './Paragraph.js';
import { Text } from './Text.js';
import { Heading } from './Heading.js';
import { Blockquote } from './Blockquote.js';
import { ListItem } from './ListItem.js';
import { BulletList } from './BulletList.js';
import { OrderedList } from './OrderedList.js';
import { createDocument } from '../helpers/createDocument.js';
import { normalizeContent } from '../helpers/normalizeContent.js';
import { generateHTML, generateText } from '../helpers/ssr.js';
import type { AnyExtension, ContentDiagnostic, ContentDiagnosticProps, EditorOptions, JSONAttribute, JSONContent } from '../types/index.js';

/** A container like a table cell, holding any blocks. */
const Panel = Node.create({
  name: 'panel',
  group: 'block',
  content: 'block+',
  parseHTML: () => [{ tag: 'section' }],
  renderHTML: () => ['section', 0],
});
/** An application heading under another name, keeping Heading's level attribute. */
const Title = Heading.extend({ name: 'title' });

const base: AnyExtension[] = [Document, Paragraph, Text, Blockquote, ListItem, BulletList, OrderedList, Panel];
const extensions: AnyExtension[] = [...base, Heading];
const build = (list: AnyExtension[]): Schema =>
  new ExtensionManager({ extensions: list }, { state: null, view: null, schema: null, commands: {} } as never).schema;
const schema = build(extensions);

const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const heading = (level: JSONAttribute | undefined, text = 'H', type = 'heading'): JSONContent => ({
  type, ...(level === undefined ? {} : { attrs: { level } }), content: [{ type: 'text', text }],
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });
const unsupported = (path: number[], value?: string | number, nodeType = 'heading'): ContentDiagnostic => ({
  code: 'unsupported-heading-level', nodeType, attribute: 'level', path, ...(value === undefined ? {} : { value }),
});
const collect = (): { diagnostics: ContentDiagnostic[]; onDiagnostic: (diagnostic: ContentDiagnostic) => void } => {
  const diagnostics: ContentDiagnostic[] = [];
  return { diagnostics, onDiagnostic: diagnostic => diagnostics.push(diagnostic) };
};
const levels = (value: JSONContent | JSONContent[]): unknown[] => {
  const found: unknown[] = [];
  const visit = (node: JSONContent): void => {
    if (node.type === 'heading' || node.type === 'title') found.push(node.attrs?.['level']);
    node.content?.forEach(visit);
  };
  (Array.isArray(value) ? value : [value]).forEach(visit);
  return found;
};

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; });

function mount(options: Partial<EditorOptions> = {}): { editor: Editor; reports: ContentDiagnosticProps[] } {
  const reports: ContentDiagnosticProps[] = [];
  editor = new Editor({ extensions, content: '<p>start</p>', onContentDiagnostic: props => { reports.push(props); }, ...options });
  return { editor, reports };
}

describe('normalizeContent with heading levels', () => {
  it('loads a level the configuration lacks at the nearest configured level and reports it', () => {
    const { diagnostics, onDiagnostic } = collect();
    const result = normalizeContent(doc(heading(5), heading(6), heading(2)), schema, { onDiagnostic });
    expect(levels(result)).toEqual([4, 4, 2]);
    expect(diagnostics).toEqual([unsupported([0], 5), unsupported([1], 6)]);
    expect(Object.isFrozen(diagnostics[0])).toBe(true);
    expect(() => schema.nodeFromJSON(result)).not.toThrow();
  });

  it.each([
    [0, 1, 0], [-3, 1, -3], [7, 4, 7], [99, 4, 99], [2.5, 3, 2.5], ['3', 3, '3'], ['5', 4, '5'], ['x', 1, 'x'],
    [null, 1, undefined], [true, 1, undefined], [{}, 1, undefined], ['x'.repeat(65), 1, undefined],
  ])('loads the value %j that is not a configured level as %i', (value, level, reported) => {
    const { diagnostics, onDiagnostic } = collect();
    const result = normalizeContent(doc(heading(value)), schema, { onDiagnostic });
    expect(levels(result)).toEqual([level]);
    expect(diagnostics).toEqual([unsupported([0], reported)]);
  });

  it('does not report a number that is not finite', () => {
    const { diagnostics, onDiagnostic } = collect();
    const result = normalizeContent([heading(Number.NaN as JSONAttribute), heading(Number.POSITIVE_INFINITY as JSONAttribute)], schema, { onDiagnostic });
    expect(levels(result)).toEqual([1, 1]);
    expect(diagnostics).toEqual([unsupported([0]), unsupported([1])]);
  });

  it('keeps configured and absent levels without a report and returns the same content', () => {
    const { diagnostics, onDiagnostic } = collect();
    const content = doc(heading(1), heading(4), heading(undefined), paragraph('x'));
    expect(normalizeContent(content, schema, { onDiagnostic })).toBe(content);
    expect(diagnostics).toEqual([]);
  });

  it('follows the configured levels, and recognizes a renamed Heading', () => {
    const narrow = build([...base, Heading.configure({ levels: [2, 3] }), Title.configure({ levels: [1, 5] })]);
    const { diagnostics, onDiagnostic } = collect();
    const result = normalizeContent(doc(heading(1), heading(4), heading(2, 'T', 'title'), heading(6, 'T', 'title')), narrow, { onDiagnostic });
    expect(levels(result)).toEqual([2, 3, 5, 5]);
    expect(diagnostics).toEqual([unsupported([0], 1), unsupported([1], 4), unsupported([2], 2, 'title'), unsupported([3], 6, 'title')]);
  });

  it('reaches headings inside lists, quotes and containers', () => {
    const { diagnostics, onDiagnostic } = collect();
    const nested = doc(
      { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('label'), heading(5)] }] },
      { type: 'blockquote', content: [heading(6)] },
      { type: 'panel', content: [{ type: 'blockquote', content: [heading(9)] }] },
    );
    const result = normalizeContent(nested, schema, { onDiagnostic });
    expect(levels(result)).toEqual([4, 4, 4]);
    expect(diagnostics.map(({ path, value }) => [path, value])).toEqual([[[0, 0, 1], 5], [[1, 0], 6], [[2, 0, 0], 9]]);
  });

  it('normalizes every heading but reports at most 100 diagnostics per call', () => {
    const { diagnostics, onDiagnostic } = collect();
    const result = normalizeContent(doc(...Array.from({ length: 150 }, () => heading(6))), schema, { onDiagnostic });
    expect(levels(result).every(level => level === 4)).toBe(true);
    expect(diagnostics).toHaveLength(100);
  });
});

describe('editor JSON entry points with heading levels', () => {
  it('loads initial content and reports once with source content', () => {
    const { editor: ed, reports } = mount({ content: doc(heading(5, 'Five'), paragraph('tail')) });
    expect(ed.state.doc.firstChild?.attrs['level']).toBe(4);
    expect(ed.getHTML()).toBe('<h4>Five</h4><p>tail</p>');
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ editor: ed, source: 'content', total: 1, diagnostics: [unsupported([0], 5)] });
  });

  it('reports at most 100 initial diagnostics with the full total', () => {
    const { editor: ed, reports } = mount({ content: doc(...Array.from({ length: 150 }, (_, index) => heading(5 + (index % 2)))) });
    expect(levels(ed.getJSON()).every(level => level === 4)).toBe(true);
    expect(reports[0]?.diagnostics).toHaveLength(100);
    expect(reports[0]?.total).toBe(150);
  });

  it('keeps a level that is not a whole number from 1 to 6 out of the initial document instead of failing it', () => {
    const errors: unknown[] = [];
    const { editor: ed, reports } = mount({ content: doc(heading('bogus'), heading(9)), onContentError: error => { errors.push(error); } });
    expect(errors).toEqual([]);
    expect(levels(ed.getJSON())).toEqual([1, 4]);
    expect(reports[0]?.total).toBe(2);
  });

  it('setContent and insertContent load and report, for single nodes, arrays and nested headings', () => {
    const { editor: ed, reports } = mount();
    expect(ed.setContent(doc(heading(6, 'Six')))).toBe(true);
    expect(ed.commands.insertContent(heading(5, 'Five'))).toBe(true);
    expect(ed.commands.insertContent([paragraph('p'), heading(0, 'Zero')])).toBe(true);
    expect(ed.commands.insertContent({ type: 'blockquote', content: [heading(7, 'Seven')] })).toBe(true);
    expect(levels(ed.getJSON())).toEqual([4, 4, 1, 4]);
    expect(reports.map(({ source, diagnostics }) => [source, diagnostics])).toEqual([
      ['setContent', [unsupported([0], 6)]],
      ['insertContent', [unsupported([], 5)]],
      ['insertContent', [unsupported([1], 0)]],
      ['insertContent', [unsupported([0], 7)]],
    ]);
  });

  it('createDocument, generateHTML and generateText load and report', () => {
    const content = doc(heading(5, 'Five'), heading(2, 'Two'));
    const created = collect();
    expect(createDocument(content, schema, { onDiagnostic: created.onDiagnostic }).firstChild?.attrs['level']).toBe(4);
    expect(created.diagnostics).toEqual([unsupported([0], 5)]);
    const html = collect();
    expect(generateHTML(content, extensions, { onDiagnostic: html.onDiagnostic })).toBe('<h4>Five</h4><h2>Two</h2>');
    expect(html.diagnostics).toEqual([unsupported([0], 5)]);
    const text = collect();
    expect(generateText(doc(heading(99, 'Deep')), extensions, { onDiagnostic: text.onDiagnostic })).toBe('Deep');
    expect(text.diagnostics).toEqual([unsupported([0], 99)]);
  });
});

describe('heading level validation outside the normalizing entry points', () => {
  it('accepts every heading level and rejects other values in nodeFromJSON and Node.check', () => {
    expect(schema.nodeFromJSON(heading(5)).attrs['level']).toBe(5);
    expect(schema.nodeFromJSON(heading(undefined)).attrs['level']).toBe(1);
    for (const value of [9, 0, 2.5, '3', null]) {
      expect(() => schema.nodeFromJSON(heading(value)), String(value)).toThrow('Invalid heading level');
    }
    expect(() => schema.nodes['heading']?.create({ level: 9 }).check()).toThrow('Invalid heading level');
  });

  it('refuses an invalid level in updateAttributes and accepts a valid unconfigured one', () => {
    const { editor: ed } = mount({ content: '<h2>Title</h2>' });
    expect(ed.commands.updateAttributes('heading', { level: 9 })).toBe(false);
    expect(ed.commands.updateAttributes('heading', { level: 'x' })).toBe(false);
    expect(ed.state.doc.firstChild?.attrs['level']).toBe(2);
    expect(ed.commands.updateAttributes('heading', { level: 5 })).toBe(true);
    expect(ed.state.doc.firstChild?.attrs['level']).toBe(5);
    expect(ed.getHTML()).toBe('<h4>Title</h4>');
  });
});

describe('pasted slice context with heading levels', () => {
  const sliceHTML = (context: unknown[]): string =>
    `<span data-pm-slice="1 1 ${JSON.stringify(context).replace(/"/g, '&quot;')}">X</span>`;

  function paste(context: unknown[]): Editor {
    const { editor: ed } = mount({ content: '<p>first</p><p></p>' });
    const end = ed.state.doc.content.size - 1;
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, end)));
    expect(ed.view.pasteHTML(sliceHTML(context), new Event('paste') as ClipboardEvent)).toBe(true);
    return ed;
  }

  it('replaces an invalid level so the saved JSON loads again', () => {
    const ed = paste(['heading', { level: 99 }]);
    expect(levels(ed.getJSON())).toEqual([4]);
    expect(() => { ed.state.doc.check(); }).not.toThrow();
    expect(ed.setContent(ed.getJSON())).toBe(true);
  });

  it('replaces a level written as a decimal string with its nearest configured level', () => {
    const ed = paste(['heading', { level: '5' }]);
    expect(levels(ed.getJSON())).toEqual([4]);
    expect(() => { ed.state.doc.check(); }).not.toThrow();
  });

  it('keeps a valid level the configuration lacks, as another client may have written it', () => {
    const ed = paste(['heading', { level: 6 }]);
    expect(levels(ed.getJSON())).toEqual([6]);
    expect(ed.getHTML()).toBe('<p>first</p><h4>X</h4>');
  });
});
