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
import { Blockquote } from './Blockquote.js';
import { HardBreak } from './HardBreak.js';
import { HorizontalRule } from './HorizontalRule.js';
import { Bold } from '../marks/Bold.js';
import { Italic } from '../marks/Italic.js';
import { TextAlign } from '../extensions/TextAlign.js';
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

describe('a configured heading tag where a heading cannot stand', () => {
  // The paragraph an element without a rule leaves, as a div does, instead of a heading moved out.
  const asText = (html: string): string => html.replace(/<(\/?)h[1-6]>/g, '<$1div>');

  it.each([
    ['at the start of list items, before more blocks', '<ul><li><h2>T</h2><p>b</p></li><li><p>two</p></li></ul>'],
    ['as the only block of a list item', '<ul><li><h2>T</h2></li><li><p>two</p></li></ul>'],
    ['in a numbered list that keeps its start', '<ol start="3"><li><h3>S</h3><p>b</p></li><li><p>two</p></li></ol>'],
    ['inside wrappers at the start of the item', '<ul><li><div><span><h2>A</h2></span></div></li></ul>'],
    ['at the start of a nested item', '<ul><li><p>outer</p><ul><li><h2>I</h2></li></ul></li></ul>'],
    ['at the start of a task item', '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><h2>T</h2></div></li></ul>'],
    ['in a summary', '<details><summary><h2>S</h2></summary><p>body</p></details>'],
    ['in a preformatted block', '<pre><h2>x</h2></pre><p>after</p>'],
    ['with inline marks', '<ul><li><h2><strong>T</strong> <em>u</em></h2></li></ul>'],
    ['with every configured level', '<ul><li><h1>1</h1></li><li><h2>2</h2></li><li><h3>3</h3></li><li><h4>4</h4></li></ul>'],
  ])('parses as the block\'s text %s, as a tag without a rule does', (_name, html) => {
    const { editor, reports } = mount(html, undefined, STRUCTURES);
    const expected = mount(asText(html), undefined, STRUCTURES).editor.getJSON();
    expect(editor.getJSON()).toEqual(expected);
    expect(JSON.stringify(editor.getJSON())).not.toContain('"heading"');
    expect(reports).toEqual([]);

    editor.commands.setContent(html);
    expect(editor.getJSON()).toEqual(expected);
    expect(createDocument(html, editor.schema).toJSON()).toEqual(expected);
    expect(generateJSON(html, extensionsFor(undefined, STRUCTURES))).toEqual(expected);

    const inserted = mount('<p></p>', undefined, STRUCTURES).editor;
    expect(inserted.commands.insertContent(html)).toBe(true);
    expect(JSON.stringify(inserted.getJSON())).not.toContain('"heading"');

    const pasted = mount('<p></p>', undefined, STRUCTURES);
    paste(pasted.editor, html);
    expect(JSON.stringify(pasted.editor.getJSON())).not.toContain('"heading"');
  });

  it('keeps one numbered list with its start and every item', () => {
    const { editor } = mount('<ol start="3"><li><h3>S</h3><p>b</p></li><li><p>two</p></li></ol>', undefined, STRUCTURES);
    expect(editor.getHTML()).toBe('<ol start="3"><li><p>S</p><p>b</p></li><li><p>two</p></li></ol>');
  });

  it('keeps the text and marks of a heading at a list item start in the item paragraph', () => {
    const { editor } = mount('<ul><li><h2><strong>T</strong> <em>u</em></h2><h3>B</h3></li></ul>', undefined, [...STRUCTURES, Bold, Italic]);
    expect(editor.getHTML()).toBe('<ul><li><p><strong>T</strong> <em>u</em></p><h3>B</h3></li></ul>');
  });

  it('gives the item paragraph only the text of a heading at a list item start, not its alignment or id, as a tag without a rule', () => {
    const html = '<ol><li><h1 id="intro" style="text-align: center">Centered</h1><p>b</p></li></ol><h2 style="text-align: center">Kept</h2>';
    const { editor } = mount(html, undefined, [...STRUCTURES, TextAlign]);
    expect(editor.getHTML()).toBe('<ol><li><p>Centered</p><p>b</p></li></ol><h2 style="text-align: center;">Kept</h2>');
    expect(editor.getJSON()).toEqual(mount(html.replace(/<(\/?)h1/g, '<$1div'), undefined, [...STRUCTURES, TextAlign]).editor.getJSON());
  });

  it('keeps a checked task item and its paragraph', () => {
    const { editor } = mount('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><h2>T</h2></div></li></ul>', undefined, STRUCTURES);
    const item = editor.getJSON().content?.[0]?.content?.[0];
    expect(item).toMatchObject({ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'T' }] }] });
  });

  it.each([
    ['after the item paragraph', '<ul><li><p>lead</p><h2>L</h2></li></ul>', '<ul><li><p>lead</p><h2>L</h2></li></ul>'],
    ['after text in the item', '<ul><li>lead<h2>L</h2></li></ul>', '<ul><li><p>lead</p><h2>L</h2></li></ul>'],
    ['as the second heading of the item', '<ul><li><h2>A</h2><h3>B</h3></li></ul>', '<ul><li><p>A</p><h3>B</h3></li></ul>'],
    // A blockquote cannot open an item either, so it moves out of the list, as in 1.2.
    ['in a blockquote at the item start', '<ul><li><blockquote><h2>Q</h2></blockquote></li></ul>', '<ul><li><p></p></li></ul><blockquote><h2>Q</h2></blockquote>'],
    ['in a blockquote', '<blockquote><h2>Q</h2></blockquote>', '<blockquote><h2>Q</h2></blockquote>'],
    ['in the details body', '<details><summary>Sum</summary><h2>body</h2></details>', '<details><summary>Sum</summary><h2>body</h2></details>'],
  ])('stays a heading %s, where a heading stands', (_name, html, expected) => {
    const { editor } = mount(html, undefined, [...STRUCTURES, Blockquote]);
    expect(editor.getHTML()).toBe(expected);
  });

  it('follows the configured levels: a narrow configuration parses h2 and h1 at an item start as text', () => {
    const { editor } = mount('<ul><li><h2>two</h2></li><li><h1>one</h1></li></ul><h2>kept</h2>', [2, 3], STRUCTURES);
    expect(editor.getHTML()).toBe('<ul><li><p>two</p></li><li><p>one</p></li></ul><h2>kept</h2>');
  });

  it('leaves an application node that parses the tag itself alone', () => {
    const Kicker = Node.create({
      name: 'kicker', group: 'block', content: 'inline*',
      parseHTML: () => [{ tag: 'h2', priority: 60 }],
      renderHTML: () => ['h2', { class: 'kicker' }, 0],
    });
    const { editor } = mount('<ul><li><h2>K</h2></li></ul>', undefined, [...STRUCTURES, Kicker]);
    expect(JSON.stringify(editor.getJSON())).toContain('"kicker"');
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

  it('parse a configured tag at the start of a list item or in a summary as its text', async () => {
    const { parseHTML } = await import('linkedom');
    const serverDocument = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
    const html = '<ol start="2"><li><h2>a</h2><p>more</p></li><li><p>x</p><h3>b</h3></li></ol><details><summary><h1>S</h1></summary><p>c</p></details>';
    const json = generateJSON(html, extensionsFor(undefined, STRUCTURES), { document: serverDocument });
    expect(json).toEqual(generateJSON(html, extensionsFor(undefined, STRUCTURES)));
    expect(JSON.stringify(json).match(/"heading"/g)).toHaveLength(1);
    expect(json.content?.[0]).toMatchObject({ type: 'orderedList', attrs: { start: 2 } });
    expect(json.content?.[0]?.content).toHaveLength(2);
  });
});

describe('a heading after an explicit item paragraph, as getHTML writes an empty label', () => {
  it.each([
    ['after an empty paragraph', '<ul><li><p></p><h2>A</h2></li></ul>', '<ul><li><p></p><h2>A</h2></li></ul>'],
    ['after an empty paragraph, before more blocks', '<ol><li><p></p><h3>Step</h3><p>body</p></li></ol>', '<ol><li><p></p><h3>Step</h3><p>body</p></li></ol>'],
    ['after a paragraph of a no-break space', '<ul><li><p>&nbsp;</p><h2>A</h2></li></ul>', '<ul><li><p>\u00a0</p><h2>A</h2></li></ul>'],
    ['after a paragraph inside a wrapper', '<ul><li><div><p></p></div><h2>A</h2></li></ul>', '<ul><li><p></p><h2>A</h2></li></ul>'],
    ['after an empty task item paragraph', '<ul data-type="taskList"><li data-type="taskItem"><label><input type="checkbox"></label><div><p></p><h3>Task heading</h3></div></li></ul>',
      '<ul data-type="taskList"><li data-checked="false" data-type="taskItem"><label contenteditable="false"><input type="checkbox" aria-label="Task status"></label><div><p></p><h3>Task heading</h3></div></li></ul>'],
  ])('stays a heading %s, on load, setContent, insertContent, SSR and paste', (_name, html, expected) => {
    const { editor } = mount(html, undefined, STRUCTURES);
    expect(editor.getHTML().replace(/&nbsp;/g, '\u00a0')).toBe(expected);
    const json = editor.getJSON();

    editor.commands.setContent(html);
    expect(editor.getJSON()).toEqual(json);
    expect(createDocument(html, editor.schema).toJSON()).toEqual(json);
    expect(generateJSON(html, extensionsFor(undefined, STRUCTURES))).toEqual(json);

    const pasted = mount('<p></p>', undefined, STRUCTURES);
    paste(pasted.editor, html);
    expect(JSON.stringify(pasted.editor.getJSON())).toContain('"heading"');
  });

  it('keeps a list item that holds an empty label and a heading through getHTML and back', () => {
    const json: JSONContent = { type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [
      { type: 'paragraph' }, { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Kept heading' }] },
    ] }] }] };
    const { editor } = mount('<p></p>', undefined, STRUCTURES);
    editor.commands.setContent(json);
    const html = editor.getHTML();
    expect(html).toBe('<ul><li><p></p><h2>Kept heading</h2></li></ul>');

    editor.commands.setContent(html);
    expect(editor.getJSON()).toEqual(editor.schema.nodeFromJSON(json).toJSON());
  });

  it('keeps the heading when the item is copied and pasted in the same editor', () => {
    const { editor } = mount('<ul><li><p></p><h2>Section</h2></li></ul><p>end</p>', undefined, STRUCTURES);
    const { dom } = editor.view.serializeForClipboard(editor.state.doc.slice(0, editor.state.doc.child(0).nodeSize));
    paste(editor, dom.innerHTML);
    expect(JSON.stringify(editor.getJSON()).match(/"heading"/g)).toHaveLength(2);
  });

  it('loads a tag the levels lack after an empty paragraph at the nearest level, as its JSON loads', () => {
    const { editor } = mount('<ul><li><p></p><h6>Deep</h6></li></ul>', undefined, STRUCTURES);
    expect(editor.getHTML()).toBe('<ul><li><p></p><h4>Deep</h4></li></ul>');
  });

  it('still parses a heading as the label when only an empty element other than a paragraph comes before it', () => {
    const { editor } = mount('<ul><li><div></div><span> </span><h2>A</h2></li></ul>', undefined, STRUCTURES);
    expect(editor.getHTML()).toBe('<ul><li><p>A</p></li></ul>');
  });
});

// An inline image and a block image, as extension-image configures its node; a chip with no text of its own.
const InlineImage = Node.create({
  name: 'image', group: 'inline', inline: true, atom: true,
  addAttributes: () => ({ src: { default: null, parseHTML: (element: HTMLElement) => element.getAttribute('src') } }),
  parseHTML: () => [{ tag: 'img[src]' }], renderHTML: ({ HTMLAttributes }) => ['img', HTMLAttributes],
});
const BlockImage = InlineImage.extend({ group: 'block', inline: false });
const Chip = Node.create({
  name: 'chip', group: 'inline', inline: true, atom: true,
  parseHTML: () => [{ tag: 'span[data-chip]' }], renderHTML: () => ['span', { 'data-chip': '' }],
});

describe('a heading after content other than a paragraph at a list item start', () => {
  const INLINE = [...STRUCTURES, HardBreak, InlineImage, Chip];

  it.each([
    ['after a line break', '<ul><li><br><h1>A</h1></li></ul>', '<ul><li><p><br></p><h1>A</h1></li></ul>'],
    ['after a line break in a numbered item', '<ol><li><br><h2>A</h2></li><li><p>B</p></li></ol>', '<ol><li><p><br></p><h2>A</h2></li><li><p>B</p></li></ol>'],
    ['after a no-break space', '<ul><li>&nbsp;<h1>A</h1></li></ul>', '<ul><li><p>\u00a0</p><h1>A</h1></li></ul>'],
    ['after a no-break space in a wrapper, before more blocks', '<ul><li><span>&nbsp;</span><h2>A</h2><p>b</p></li></ul>', '<ul><li><p>\u00a0</p><h2>A</h2><p>b</p></li></ul>'],
    ['after an inline image, as a pasted feature list writes an icon', '<ul><li><img src="x.png"><h3>Fast</h3><p>Desc</p></li><li><img src="y.png"><h3>Safe</h3><p>Desc</p></li></ul>',
      '<ul><li><p><img src="x.png"></p><h3>Fast</h3><p>Desc</p></li><li><p><img src="y.png"></p><h3>Safe</h3><p>Desc</p></li></ul>'],
    ['after an inline node with no text of its own', '<ul><li><span data-chip="1"></span><h2>A</h2></li></ul>', '<ul><li><p><span data-chip=""></span></p><h2>A</h2></li></ul>'],
    ['after a line break in a task item', '<ul data-type="taskList"><li data-type="taskItem"><label><input type="checkbox"></label><div><br><h2>T</h2></div></li></ul>',
      '<ul data-type="taskList"><li data-checked="false" data-type="taskItem"><label contenteditable="false"><input type="checkbox" aria-label="Task status"></label><div><p><br></p><h2>T</h2></div></li></ul>'],
  ])('stays a heading %s, which gives the item its paragraph, on load, setContent, SSR and paste', (_name, html, expected) => {
    const { editor } = mount(html, undefined, INLINE);
    expect(editor.getHTML().replace(/&nbsp;/g, '\u00a0')).toBe(expected);
    const json = editor.getJSON();

    editor.commands.setContent(html);
    expect(editor.getJSON()).toEqual(json);
    expect(createDocument(html, editor.schema).toJSON()).toEqual(json);
    expect(generateJSON(html, extensionsFor(undefined, INLINE))).toEqual(json);

    const pasted = mount('<p></p>', undefined, INLINE);
    paste(pasted.editor, html);
    expect(JSON.stringify(pasted.editor.getJSON())).toContain('"heading"');
  });

  it.each([
    ['a horizontal rule', '<ul><li><hr><h1>A</h1></li></ul>', '<ul><li><p></p></li></ul><hr><h1>A</h1>'],
    ['a horizontal rule in a numbered item', '<ol><li><hr><h2>A</h2></li></ol>', '<ol><li><p></p></li></ol><hr><h2>A</h2>'],
    ['a block image', '<ul><li><img src="x.png"><h3>Fast</h3></li></ul>', '<ul><li><p></p></li></ul><img src="x.png"><h3>Fast</h3>'],
  ])('stays a heading after %s, which moves it off the item start, on every path as in 1.2', (_name, html, expected) => {
    const extensions = [...STRUCTURES, HorizontalRule, BlockImage];
    const { editor } = mount(html, undefined, extensions);
    expect(editor.getHTML()).toBe(expected);
    editor.commands.setContent(html);
    expect(editor.getHTML()).toBe(expected);
    expect(generateJSON(html, extensionsFor(undefined, extensions))).toEqual(editor.getJSON());

    // A paste opens the item with an empty label and keeps the block and the heading in it.
    const pasted = mount('<p></p>', undefined, extensions);
    paste(pasted.editor, html);
    expect(JSON.stringify(pasted.editor.getJSON())).toContain('"heading"');
  });

  // Parsing thousands of headings under coverage can exceed 5 s on shared CI runners.
  it('keeps every heading after the first in an item of many headings, without deep recursion', { timeout: 30_000 }, () => {
    const html = `<ul><li>${'<h2>x</h2>'.repeat(5000)}</li></ul>`;
    const json = generateJSON(html, extensionsFor(undefined, STRUCTURES));
    const item = json.content?.[0]?.content?.[0]?.content ?? [];
    expect(item).toHaveLength(5000);
    expect(item[0]?.type).toBe('paragraph');
    expect(item.filter(node => node.type === 'heading')).toHaveLength(4999);
  });
});

describe('heading tags in a schema that lacks the node where a heading cannot stand', () => {
  const NO_STRUCTURES = [Blockquote];

  it.each([
    ['in a list item', '<ul><li><h2>Title</h2></li></ul>', '<h2>Title</h2>'],
    ['at the start of a list item with more blocks', '<ol><li><h1>Chapter</h1><p>body</p></li></ol>', '<h1>Chapter</h1><p>body</p>'],
    ['in a summary', '<details><summary><h3>Sum</h3></summary><p>x</p></details>', '<h3>Sum</h3><p>x</p>'],
    ['in a preformatted block', '<pre><h2>Code?</h2></pre>', '<h2>Code?</h2>'],
    ['of a level the configuration lacks, in a list item', '<ul><li><h5>Deep</h5></li></ul>', '<h4>Deep</h4>'],
  ])('keeps a heading %s, as 1.2 did, on every HTML path', (_name, html, expected) => {
    const { editor } = mount(html, undefined, NO_STRUCTURES);
    expect(editor.getHTML()).toBe(expected);
    editor.commands.setContent(html);
    expect(editor.getHTML()).toBe(expected);
    expect(generateJSON(html, extensionsFor(undefined, NO_STRUCTURES))).toEqual(editor.getJSON());

    const pasted = mount('<p></p>', undefined, NO_STRUCTURES);
    paste(pasted.editor, html);
    expect(JSON.stringify(pasted.editor.getJSON())).toContain('"heading"');
  });

  it('keeps a heading at the start of a list item whose content may start with one', () => {
    const BlockItem = ListItem.extend({ content: 'block+' });
    const html = '<ul><li><h2>Title</h2><p>body</p></li></ul>';
    const { editor } = mount(html, undefined, [BulletList, BlockItem]);
    expect(editor.getHTML()).toBe(html);
    expect(generateJSON(html, extensionsFor(undefined, [BulletList, BlockItem]))).toEqual(editor.getJSON());
  });

  it('still parses the heading as the item text where the list item needs a paragraph first, with lists only', () => {
    const { editor } = mount('<ul><li><h2>Title</h2></li></ul><details><summary><h3>Sum</h3></summary></details>', undefined, [BulletList, ListItem]);
    expect(editor.getHTML()).toBe('<ul><li><p>Title</p></li></ul><h3>Sum</h3>');
  });
});
