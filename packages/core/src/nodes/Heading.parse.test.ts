/**
 * HTML heading tags the configuration lacks parse at the nearest configured level, as JSON
 * content loads such a level, through every HTML entry point and silently: formats are
 * converted, and only the stored JSON format reports what it replaces.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { Node } from '../Node.js';
import { Document } from './Document.js';
import { Paragraph } from './Paragraph.js';
import { Text } from './Text.js';
import { Heading } from './Heading.js';
import { createDocument } from '../helpers/createDocument.js';
import { generateJSON } from '../helpers/ssr.js';
import type { AnyExtension, ContentDiagnosticProps, JSONContent } from '../types/index.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors) editor.destroy(); editors.length = 0; document.body.replaceChildren(); });

const HTML = '<h1>A</h1><h5>B</h5><h6>C</h6>';

function extensionsFor(levels?: number[], extra: AnyExtension[] = []): AnyExtension[] {
  return [Document, Paragraph, Text, levels ? Heading.configure({ levels }) : Heading, ...extra];
}

function mount(content: string, levels?: number[], extra: AnyExtension[] = []): { editor: Editor; reports: ContentDiagnosticProps[] } {
  const reports: ContentDiagnosticProps[] = [];
  const editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    extensions: extensionsFor(levels, extra), content,
    onContentDiagnostic: props => { reports.push(props); },
  });
  editors.push(editor);
  return { editor, reports };
}

const blocks = (json: JSONContent): unknown[] =>
  (json.content ?? []).map(node => node.type === 'heading' ? node.attrs?.['level'] : node.type);

function paste(editor: Editor, html: string): void {
  const end = editor.state.doc.content.size - 1;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)));
  expect(editor.view.pasteHTML(html, new Event('paste', { cancelable: true }) as ClipboardEvent)).toBe(true);
}

describe('HTML heading tags the configuration lacks', () => {
  it.each([
    [undefined, [1, 4, 4]], [[2, 3], [2, 3, 3]], [[1, 2, 3, 4, 5, 6], [1, 5, 6]], [[6], [6, 6, 6]], [[3, 1], [1, 3, 3]],
  ] as const)('parse at the nearest configured level with levels %j', (levels, expected) => {
    const configured = levels === undefined ? undefined : [...levels];
    const { editor, reports } = mount(HTML, configured);
    expect(blocks(editor.getJSON())).toEqual(expected);

    editor.commands.setContent(HTML);
    expect(blocks(editor.getJSON())).toEqual(expected);

    editor.commands.setContent('<p>Start</p><p></p>');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, editor.state.doc.content.size - 1)));
    expect(editor.commands.insertContent(HTML)).toBe(true);
    expect(blocks(editor.getJSON())).toEqual(['paragraph', ...expected]);

    expect(blocks(createDocument(HTML, editor.schema).toJSON() as JSONContent)).toEqual(expected);
    expect(blocks(generateJSON(HTML, extensionsFor(configured)))).toEqual(expected);
    expect(reports).toEqual([]);
  });

  it('parses a pasted heading tag at the nearest configured level without a report', () => {
    const { editor, reports } = mount('<p></p>');
    paste(editor, HTML);
    expect(blocks(editor.getJSON()).filter(block => block !== 'paragraph')).toEqual([1, 4, 4]);
    expect(reports).toEqual([]);
  });

  it('keeps an equal or deeper place: a shallower tag never outranks a configured deeper level', () => {
    const { editor } = mount('<h2>Two</h2><h3>Three</h3>', [4, 2, 2]);
    expect(editor.getHTML()).toBe('<h2>Two</h2><h4>Three</h4>');
    expect(blocks(editor.getJSON())).toEqual([2, 4]);
  });

  it('round trips a stored level the configuration lacks at the level it renders', () => {
    const { editor } = mount('<h1>Five</h1>');
    editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'level', 5));
    const html = editor.getHTML();
    expect(html).toBe('<h4>Five</h4>');
    editor.commands.setContent(html);
    expect(blocks(editor.getJSON())).toEqual([4]);
  });

  it('leaves a heading tag to an application node that parses it', () => {
    const Kicker = Node.create({
      name: 'kicker', group: 'block', content: 'inline*',
      parseHTML: () => [{ tag: 'h5' }],
      renderHTML: () => ['h5', { class: 'kicker' }, 0],
    });
    const { editor } = mount(HTML, undefined, [Kicker]);
    expect(blocks(editor.getJSON())).toEqual([1, 'kicker', 4]);
    // A configured tag keeps Heading's ordinary priority over the same application rule.
    const Title = Node.create({ name: 'title', group: 'block', content: 'inline*', parseHTML: () => [{ tag: 'h1', priority: 1 }], renderHTML: () => ['h1', 0] });
    const titled = mount('<h1>A</h1>', undefined, [Title]);
    expect(blocks(titled.editor.getJSON())).toEqual([1]);
  });

  it('builds a parse rule for every heading tag, ranking the configured ones first', () => {
    const { editor } = mount('<p></p>', [4, 2]);
    expect(editor.schema.nodes['heading']?.spec.parseDOM?.map(rule => [rule.tag, rule.priority ?? 50])).toEqual([
      ['h4', 50], ['h2', 50], ['h1', 1], ['h3', 1], ['h5', 1], ['h6', 1],
    ]);
  });

  it('parses nothing but h1 to h6 as a heading, and heading tags as paragraphs without Heading', () => {
    const { editor } = mount('<h7>Seven</h7><h0>Zero</h0><H5>Upper</H5>');
    expect(blocks(editor.getJSON())).toEqual(['paragraph', 4]);
    const plain = new Editor({ extensions: [Document, Paragraph, Text], content: HTML });
    editors.push(plain);
    expect(plain.getHTML()).toBe('<p>A</p><p>B</p><p>C</p>');
  });
});

describe('HTML heading tags under linkedom, the documented server DOM', () => {
  it('parse at the nearest configured level in generateJSON', async () => {
    const { parseHTML } = await import('linkedom');
    const serverDocument = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    expect(blocks(generateJSON(HTML, extensionsFor(), { document: serverDocument }))).toEqual([1, 4, 4]);
    expect(blocks(generateJSON(HTML, extensionsFor([2, 3]), { document: serverDocument }))).toEqual([2, 3, 3]);
  });
});
