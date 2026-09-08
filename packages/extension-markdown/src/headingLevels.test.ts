/**
 * Markdown heading levels against the Heading configuration: every Markdown entry point parses a
 * level the configuration lacks at the nearest configured level, as HTML and JSON do, and export
 * writes each heading at the level it renders at, so it matches getHTML.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Document, Editor, Heading, Node, Paragraph, Text } from '@domternal/core';
import type { AnyExtension, ContentDiagnosticProps, JSONContent } from '@domternal/core';
import type { Node as PMNode, Schema } from '@domternal/pm/model';
import { TextSelection } from '@domternal/pm/state';
import { getMarkdown, Markdown } from './Markdown.js';
import { createMarkdownParser, parseMarkdown } from './parser/parser.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors) editor.destroy(); editors.length = 0; });

const MARKDOWN = '# A\n\n##### B\n\n###### C';

function mount(levels?: number[], content = '<p></p>', extra: AnyExtension[] = []): { editor: Editor; reports: ContentDiagnosticProps[] } {
  const reports: ContentDiagnosticProps[] = [];
  const editor = new Editor({
    extensions: [Document, Paragraph, Text, levels ? Heading.configure({ levels }) : Heading, Markdown, ...extra],
    content, onContentDiagnostic: props => { reports.push(props); },
  });
  editors.push(editor);
  return { editor, reports };
}

const levelsOf = (doc: PMNode | JSONContent): unknown[] => {
  const json = 'toJSON' in doc && typeof doc.toJSON === 'function' ? doc.toJSON() as JSONContent : doc as JSONContent;
  return (json.content ?? []).map(node => node.type === 'heading' ? node.attrs?.['level'] : node.type);
};

function pastePlain(editor: Editor, text: string): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) => (type === 'text/plain' ? text : '') } });
  editor.view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
}

describe('Markdown heading levels the configuration lacks', () => {
  it.each([[undefined, [1, 4, 4]], [[2, 3], [2, 3, 3]], [[1, 2, 3, 4, 5, 6], [1, 5, 6]]] as const)(
    'parse at the nearest configured level with levels %j', (levels, expected) => {
      const { editor } = mount(levels === undefined ? undefined : [...levels]);
      const schema: Schema = editor.schema;
      expect(levelsOf(parseMarkdown(MARKDOWN, schema))).toEqual(expected);
      expect(levelsOf(createMarkdownParser(schema).parse(MARKDOWN))).toEqual(expected);
    });

  it('parses setext headings the same way', () => {
    const { editor } = mount([2, 3]);
    expect(levelsOf(parseMarkdown('A\n===\n\nB\n---', editor.schema))).toEqual([2, 2]);
  });

  it('inserts and sets Markdown at the nearest configured level without a report', () => {
    const { editor, reports } = mount(undefined, '<p>Start</p><p></p>');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, editor.state.doc.content.size - 1)));
    expect(editor.commands.insertMarkdown(MARKDOWN)).toBe(true);
    expect(levelsOf(editor.getJSON())).toEqual(['paragraph', 1, 4, 4]);
    expect(editor.commands.setMarkdownContent(MARKDOWN)).toBe(true);
    expect(levelsOf(editor.getJSON())).toEqual([1, 4, 4]);
    expect(reports).toEqual([]);
  });

  it('pastes Markdown at the nearest configured level', () => {
    const { editor } = mount([2, 3]);
    pastePlain(editor, MARKDOWN);
    expect(levelsOf(editor.getJSON()).filter(level => level !== 'paragraph')).toEqual([2, 3, 3]);
  });

  it('leaves the level of a heading node the editor does not normalize', () => {
    const Custom = Node.create({
      name: 'heading', group: 'block', content: 'inline*',
      addAttributes: () => ({ level: { default: 1 } }),
      parseHTML: () => [1, 2, 3, 4, 5, 6].map(level => ({ tag: `h${String(level)}` })),
      renderHTML: ({ node }) => [`h${String(node.attrs['level'])}`, 0],
    });
    const editor = new Editor({ extensions: [Document, Paragraph, Text, Custom] });
    editors.push(editor);
    expect(levelsOf(parseMarkdown(MARKDOWN, editor.schema))).toEqual([1, 5, 6]);
  });
});

describe('Markdown export of a stored heading level the configuration lacks', () => {
  it('writes the level the heading renders at, which imports back to that level', () => {
    const { editor } = mount(undefined, '<h1>Five</h1><h2>Two</h2>');
    editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'level', 5));
    expect(editor.getHTML()).toBe('<h4>Five</h4><h2>Two</h2>');
    const { markdown } = getMarkdown(editor);
    expect(markdown).toBe('#### Five\n\n## Two');
    expect(levelsOf(parseMarkdown(markdown, editor.schema))).toEqual([4, 2]);
  });

  it.each([['5', '####'], ['x', '#'], [2, '##']])('writes a stored %j as %s', (stored, hashes) => {
    const { editor } = mount(undefined, '<h1>Stored</h1>');
    editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'level', stored));
    expect(getMarkdown(editor).markdown).toBe(`${hashes} Stored`);
  });

  it('writes a promoted level at the shallowest configured level', () => {
    const { editor } = mount([2, 3], '<h2>One</h2>');
    editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'level', 1));
    expect(getMarkdown(editor).markdown).toBe('## One');
  });
});
