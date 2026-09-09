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
import { BulletList } from './BulletList.js';
import { OrderedList } from './OrderedList.js';
import { ListItem } from './ListItem.js';
import { TaskList } from './TaskList.js';
import { TaskItem } from './TaskItem.js';
import { CodeBlock } from './CodeBlock.js';
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

  it('builds a parse rule for every heading tag, ranking the configured ones first and the rest below priority 1', () => {
    const { editor } = mount('<p></p>', [4, 2]);
    // A tag the levels lack ranks by how near the level it takes is: a deeper level first, then a shallower one.
    expect(editor.schema.nodes['heading']?.spec.parseDOM?.map(rule => [rule.tag, rule.priority ?? 50])).toEqual([
      ['h4', 50], ['h2', 50], ['h1', 0.99], ['h3', 0.99], ['h5', 0.89], ['h6', 0.88],
    ]);
  });

  it('gives a tag the levels lack to the Heading node whose levels hold the nearest level, in any extension order', () => {
    const Title = Heading.extend({ name: 'title' }).configure({ levels: [1] });
    const Subheading = Heading.extend({ name: 'subheading' }).configure({ levels: [5, 6] });
    const nodes = (json: JSONContent): unknown[] => (json.content ?? []).map(node => {
      const level = node.attrs?.['level'] as number | undefined;
      return `${node.type}${level === undefined ? '' : String(level)}`;
    });
    const titled = '<h1>T</h1><h2>a</h2><h4>b</h4><h5>five</h5><h6>six</h6>';
    for (const extensions of [[Title, Heading.configure({ levels: [2, 3, 4] })], [Heading.configure({ levels: [2, 3, 4] }), Title]]) {
      expect(nodes(generateJSON(titled, [Document, Paragraph, Text, ...extensions])))
        .toEqual(['title1', 'heading2', 'heading4', 'heading4', 'heading4']);
    }
    // A deeper level wins over a shallower one, as it does within one configuration.
    const split = '<h1>a</h1><h3>b</h3><h4>c</h4><h6>d</h6>';
    for (const extensions of [[Subheading, Heading.configure({ levels: [1, 2] })], [Heading.configure({ levels: [1, 2] }), Subheading]]) {
      expect(nodes(generateJSON(split, [Document, Paragraph, Text, ...extensions])))
        .toEqual(['heading1', 'subheading5', 'subheading5', 'subheading6']);
    }
  });

  it('parses nothing but h1 to h6 as a heading, and heading tags as paragraphs without Heading', () => {
    const { editor } = mount('<h7>Seven</h7><h0>Zero</h0><H5>Upper</H5>');
    expect(blocks(editor.getJSON())).toEqual(['paragraph', 4]);
    const plain = new Editor({ extensions: [Document, Paragraph, Text], content: HTML });
    editors.push(plain);
    expect(plain.getHTML()).toBe('<p>A</p><p>B</p><p>C</p>');
  });
});

// A details-like pair whose summary holds inline content only, as extension-details does.
const Box = Node.create({
  name: 'box', group: 'block', content: 'boxSummary block*',
  parseHTML: () => [{ tag: 'details' }], renderHTML: () => ['details', 0],
});
const BoxSummary = Node.create({
  name: 'boxSummary', content: 'inline*',
  parseHTML: () => [{ tag: 'summary' }], renderHTML: () => ['summary', 0],
});
const STRUCTURES = [BulletList, OrderedList, ListItem, TaskList, TaskItem, CodeBlock, Box, BoxSummary];

describe('a heading tag the levels lack where a heading cannot stand', () => {
  // 1.2 parsed such a tag as a block without a rule, which a div still is.
  const asBefore = (html: string): string => html.replace(/<(\/?)h[56]>/g, '<$1div>');

  it.each([
    ['at the start of list items', '<ul><li><h5>a</h5></li><li><h5>b</h5></li></ul>'],
    ['before more blocks of the item', '<ol><li><h6>a</h6><p>more</p></li></ol>'],
    ['at the start of nested list items', '<ul><li><h6>a</h6><ul><li><h6>nested</h6></li></ul></li></ul>'],
    ['after only white space in the item', '<ul><li>\n  <h5>a</h5></li></ul>'],
    ['inside a wrapper at the start of the item', '<ul><li><div><h5>a</h5></div><p>b</p></li></ul>'],
    ['at the start of a task item', '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><h5>t</h5></li></ul>'],
    ['after the checkbox of a rendered task item', '<ul data-type="taskList"><li data-type="taskItem"><label><input type="checkbox"></label><div><h5>t</h5></div></li></ul>'],
    ['in a summary', '<details><summary><h5>Sum</h5></summary><p>body</p></details>'],
    ['in a preformatted block', '<pre><h5>x</h5></pre><p>after</p>'],
  ])('keeps the paragraph 1.2 parsed %s instead of moving a heading out', (_name, html) => {
    const { editor } = mount(html, undefined, STRUCTURES);
    const before = mount(asBefore(html), undefined, STRUCTURES);
    expect(editor.getJSON()).toEqual(before.editor.getJSON());
    expect(JSON.stringify(editor.getJSON())).not.toContain('"heading"');
    expect(generateJSON(html, extensionsFor(undefined, STRUCTURES))).toEqual(before.editor.getJSON());
    const pasted = mount('<p></p>', undefined, STRUCTURES);
    paste(pasted.editor, html);
    expect(JSON.stringify(pasted.editor.getJSON())).not.toContain('"heading"');
  });

  it.each([
    ['after the item paragraph', '<ul><li><p>x</p><h5>a</h5></li></ul>', '<ul><li><p>x</p><h4>a</h4></li></ul>'],
    ['after text in the item', '<ul><li>text<h5>a</h5></li></ul>', '<ul><li><p>text</p><h4>a</h4></li></ul>'],
    ['after a checked task label', '<ul data-type="taskList"><li data-type="taskItem"><p>Do</p><h6>t</h6></li></ul>',
      '<ul data-type="taskList"><li data-checked="false" data-type="taskItem"><label contenteditable="false"><input type="checkbox" aria-label="Task status"></label><div><p>Do</p><h4>t</h4></div></li></ul>'],
    ['after the summary', '<details><summary>Sum</summary><h5>body</h5></details>', '<details><summary>Sum</summary><h4>body</h4></details>'],
  ])('parses it as a heading %s, where a heading stands', (_name, html, expected) => {
    const { editor } = mount(html, undefined, STRUCTURES);
    expect(editor.getHTML()).toBe(expected);
  });
});

describe('HTML heading tags under linkedom, the documented server DOM', () => {
  it('parse at the nearest configured level in generateJSON', async () => {
    const { parseHTML } = await import('linkedom');
    const serverDocument = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    expect(blocks(generateJSON(HTML, extensionsFor(), { document: serverDocument }))).toEqual([1, 4, 4]);
    expect(blocks(generateJSON(HTML, extensionsFor([2, 3]), { document: serverDocument }))).toEqual([2, 3, 3]);
  });

  it('keep the paragraph 1.2 parsed at the start of a list item and in a summary', async () => {
    const { parseHTML } = await import('linkedom');
    const serverDocument = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const html = '<ul><li>\n<h5>a</h5></li><li><p>x</p><h6>b</h6></li></ul><details><summary><h5>S</h5></summary></details>';
    const json = generateJSON(html, extensionsFor(undefined, STRUCTURES), { document: serverDocument });
    expect(json).toEqual(generateJSON(html, extensionsFor(undefined, STRUCTURES)));
    expect(JSON.stringify(json).match(/"heading"/g)).toHaveLength(1);
  });
});
