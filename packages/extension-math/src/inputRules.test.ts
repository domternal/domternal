/**
 * The `$...$` and `$$` input rules, typed one character at a time through
 * handleTextInput as a keyboard does. Dollar amounts stay text while real
 * formulas still convert, and `$$` only turns an otherwise empty line into a
 * block equation: it never deletes the text of the line, and in list and task
 * items the popover opens on the equation, so the typed LaTeX is applied.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { Editor, Node, StarterKit } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import type { Transaction } from '@domternal/pm/state';
import type { Node as PMNode } from '@domternal/pm/model';
import { MathInline } from './MathInline.js';
import { MathBlock } from './MathBlock.js';
import { mathEditPluginKey } from './MathEditing.js';
import type { MathRenderer } from './renderer.js';

const stub: MathRenderer = { renderToString: (latex) => `<em>${latex}</em>` };

beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    globalThis.ResizeObserver = class {
      observe(): void {
        /* no-op stub for jsdom */
      }
      unobserve(): void {
        /* no-op stub for jsdom */
      }
      disconnect(): void {
        /* no-op stub for jsdom */
      }
    };
  }
  if (!('requestAnimationFrame' in globalThis)) {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback): number =>
      setTimeout(() => { cb(0); }, 0));
    globalThis.cancelAnimationFrame = ((id: number): void => { clearTimeout(id); });
  }
});

// Stand-ins with the schema of the table and details extensions, which this
// package does not depend on: a table cell takes any block, while a details
// node takes only its summary line followed by its content.
const Table = Node.create({
  name: 'table',
  group: 'block',
  content: 'tableRow+',
  isolating: true,
  parseHTML() { return [{ tag: 'table' }]; },
  renderHTML() { return ['table', ['tbody', 0]]; },
});
const TableRow = Node.create({
  name: 'tableRow',
  content: 'tableCell+',
  parseHTML() { return [{ tag: 'tr' }]; },
  renderHTML() { return ['tr', 0]; },
});
const TableCell = Node.create({
  name: 'tableCell',
  content: 'block+',
  isolating: true,
  parseHTML() { return [{ tag: 'td' }]; },
  renderHTML() { return ['td', 0]; },
});
const Details = Node.create({
  name: 'details',
  group: 'block',
  content: 'detailsSummary detailsContent',
  defining: true,
  isolating: true,
  parseHTML() { return [{ tag: 'details' }]; },
  renderHTML() { return ['details', 0]; },
});
const DetailsSummary = Node.create({
  name: 'detailsSummary',
  content: 'inline*',
  defining: true,
  isolating: true,
  parseHTML() { return [{ tag: 'summary' }]; },
  renderHTML() { return ['summary', 0]; },
});
const DetailsContent = Node.create({
  name: 'detailsContent',
  content: 'block+',
  defining: true,
  parseHTML() { return [{ tag: 'div[data-type="detailsContent"]' }]; },
  renderHTML() { return ['div', { 'data-type': 'detailsContent' }, 0]; },
});

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

/** Mounts `content` with the caret at `|`, or at the end of the document when it has none. */
function mount(content: string): Editor {
  const ed = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit,
      MathInline.configure({ renderer: stub }),
      MathBlock.configure({ renderer: stub }),
      Table,
      TableRow,
      TableCell,
      Details,
      DetailsSummary,
      DetailsContent,
    ],
    content,
  });
  editor = ed;
  let caret = -1;
  ed.state.doc.descendants((node, pos) => {
    const index = node.isText ? (node.text ?? '').indexOf('|') : -1;
    if (caret < 0 && index >= 0) caret = pos + index;
  });
  const tr = ed.state.tr.setMeta('addToHistory', false);
  if (caret >= 0) tr.delete(caret, caret + 1);
  tr.setSelection(caret >= 0 ? TextSelection.create(tr.doc, caret) : TextSelection.atEnd(tr.doc));
  ed.view.dispatch(tr);
  return ed;
}

/**
 * Types `text` as a keyboard does: each character goes through every
 * handleTextInput prop (the input rules, autolink) and is inserted as plain
 * text when none of them takes it.
 */
function type(ed: Editor, text: string): void {
  const { view } = ed;
  for (const char of text) {
    const { from, to } = view.state.selection;
    const insert = (): Transaction => view.state.tr.insertText(char, from, to);
    const handled = view.someProp('handleTextInput', (handler) => handler(view, from, to, char, insert));
    if (!handled) view.dispatch(insert());
  }
}

/** Runs the input rules as the end of an IME composition does, with the composed text already in. */
async function endComposition(ed: Editor): Promise<void> {
  const plugin = ed.state.plugins.find((p) => (p.spec as { isInputRules?: boolean }).isInputRules)!;
  plugin.props.handleDOMEvents?.compositionend?.call(plugin, ed.view, new CompositionEvent('compositionend'));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Compact structure of a node, such as `paragraph("Let ", mathInline{"x^2"})`. */
function shape(node: PMNode): string {
  if (node.isText) return JSON.stringify(node.text);
  const latex: unknown = node.attrs['latex'];
  const name = typeof latex === 'string' ? `${node.type.name}{${JSON.stringify(latex)}}` : node.type.name;
  const children: string[] = [];
  node.forEach((child) => { children.push(shape(child)); });
  return children.length > 0 ? `${name}(${children.join(', ')})` : name;
}

/** The document's top-level blocks, joined with ` | `. */
function blocks(ed: Editor): string {
  const parts: string[] = [];
  ed.state.doc.forEach((node) => { parts.push(shape(node)); });
  return parts.join(' | ');
}

/** The LaTeX of every node of the given math type, in document order. */
function latexOf(ed: Editor, typeName: string): string[] {
  const found: string[] = [];
  ed.state.doc.descendants((node) => {
    if (node.type.name === typeName) found.push(node.attrs['latex'] as string);
  });
  return found;
}

/** Type name of the node the edit popover was opened on, or null when it was not opened. */
function editTarget(ed: Editor): string | null {
  const edit = mathEditPluginKey.getState(ed.state)?.edit;
  return edit ? ed.state.doc.nodeAt(edit.pos)?.type.name ?? null : null;
}

/** Presses `key` in the open edit popover, after typing `value` into it when given. */
function pressInPopover(key: string, value?: string): void {
  const textarea = document.querySelector<HTMLTextAreaElement>('.dm-math-popover[data-show] textarea');
  expect(textarea).not.toBeNull();
  if (value !== undefined) textarea!.value = value;
  textarea!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

const taskItem = (text: string): string =>
  `<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>${text}</p></li></ul>`;

describe('MathInline input rule', () => {
  it.each([
    'The plan costs $10 to $20 per seat.',
    'Pay $5 and $10 later.',
    'Between $1M and $2M a year.',
    'Costs $5. Next year we pay $6.',
    'Price range $10-$20 today.',
    'Price range $10\u2013$20 today.',
    'Price range $10\u2014$20 today.',
    'Either $5/$10 per month.',
    'Prices $5,$10 and more.',
    'Price $10~$20 today.',
    'Price $10\uff5e$20 today.',
    'Total $10+$20 today.',
    'It is US$5 or US$10.',
    'Escaped \\$10 to \\$20 today.',
    'Escaped $\\$ only.',
    'Notion style $$x^2$$ here.',
    'Spaced $ x $ here.',
  ])('keeps "%s" as text', (input) => {
    const ed = mount('<p></p>');
    type(ed, input);
    expect(latexOf(ed, 'mathInline')).toEqual([]);
    expect(shape(ed.state.doc.firstChild!)).toBe(`paragraph(${JSON.stringify(input)})`);
  });

  it.each([
    ['Let $x^2$ be given.', 'x^2'],
    ['Sum $a+b$ here.', 'a+b'],
    ['Value $5$ only.', '5'],
    ['Pair $(1,2)$ here.', '(1,2)'],
    ['Negative $-1$ here.', '-1'],
    ['Factorial $5!$ here.', '5!'],
    ["Prime $x'$ here.", "x'"],
    ['Set $\\{1,2\\}$ here.', '\\{1,2\\}'],
    ['Escaped $a = \\$5$ here.', 'a = \\$5'],
    ['Line break $a\\\\$ here.', 'a\\\\'],
    ['函数$f(x)$的值', 'f(x)'],
    ['Wrapped ($x$) here.', 'x'],
  ])('converts "%s"', (input, latex) => {
    const ed = mount('<p></p>');
    type(ed, input);
    expect(latexOf(ed, 'mathInline')).toEqual([latex]);
    // An equation reads back as `$latex$`, so nothing typed was lost or added.
    expect(ed.state.doc.textContent).toBe(input);
  });

  it('converts two equations typed back to back', () => {
    const ed = mount('<p></p>');
    type(ed, 'Both $x$$y$ here.');
    expect(latexOf(ed, 'mathInline')).toEqual(['x', 'y']);
  });

  it('converts a span typed in front of existing text', () => {
    const ed = mount('<p>see | now</p>');
    type(ed, '$x$');
    expect(shape(ed.state.doc.firstChild!)).toBe('paragraph("see ", mathInline{"x"}, " now")');
  });

  it('keeps a span as text when a digit already follows the caret', () => {
    const ed = mount('<p>costs |20 later</p>');
    type(ed, '$5$');
    expect(latexOf(ed, 'mathInline')).toEqual([]);
    expect(shape(ed.state.doc.firstChild!)).toBe('paragraph("costs $5$20 later")');
  });

  it.each([
    ['a hard break', '<p>$a<br>b|</p>', 'paragraph("$a", hardBreak, "b$")'],
    [
      'an equation',
      '<p>see $<span data-type="math-inline" data-latex="x^2"></span>|</p>',
      'paragraph("see $", mathInline{"x^2"}, "$")',
    ],
  ])('never takes %s into the equation', (_label, content, expected) => {
    const ed = mount(content);
    type(ed, '$');
    expect(shape(ed.state.doc.firstChild!)).toBe(expected);
  });

  it('stays text inside inline code', () => {
    const ed = mount('<p><code>echo $x| and more</code></p>');
    type(ed, '$');
    expect(latexOf(ed, 'mathInline')).toEqual([]);
    expect(ed.state.doc.textContent).toBe('echo $x$ and more');
  });

  it('Backspace right after a conversion brings the typed text back', () => {
    const ed = mount('<p>Let |</p>');
    type(ed, '$x^2$');
    expect(latexOf(ed, 'mathInline')).toEqual(['x^2']);
    const backspace = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
    expect(ed.view.someProp('handleKeyDown', (handler) => handler(ed.view, backspace))).toBe(true);
    expect(shape(ed.state.doc.firstChild!)).toBe('paragraph("Let $x^2$")');
  });
});

describe('MathBlock input rule', () => {
  it.each([
    ['a paragraph', '<p>First</p><p>|</p>', 'paragraph("First") | mathBlock{""} | paragraph'],
    ['a heading', '<h2>|</h2><p>Body</p>', 'mathBlock{""} | paragraph("Body")'],
    ['a blockquote', '<blockquote><p>|</p></blockquote>', 'blockquote(mathBlock{""}) | paragraph'],
    ['a table cell', '<table><tr><td><p>|</p></td></tr></table>', 'table(tableRow(tableCell(mathBlock{""}))) | paragraph'],
    ['a list item', '<ul><li><p>|</p></li></ul>', 'bulletList(listItem(paragraph, mathBlock{""})) | paragraph'],
    ['a task item', taskItem('|'), 'taskList(taskItem(paragraph, mathBlock{""})) | paragraph'],
  ])('turns $$ on an empty line in %s into an equation that takes the typed LaTeX', (_label, content, expected) => {
    const ed = mount(content);
    type(ed, '$$');
    expect(blocks(ed)).toBe(expected);
    expect(editTarget(ed)).toBe('mathBlock');
    pressInPopover('Enter', 'x^2');
    expect(latexOf(ed, 'mathBlock')).toEqual(['x^2']);
  });

  it.each([
    ['a paragraph', '<p>First</p><p>|</p>', 'paragraph("First") | paragraph'],
    ['a list item', '<ul><li><p>|</p></li></ul>', 'bulletList(listItem(paragraph)) | paragraph'],
    ['a task item', taskItem('|'), 'taskList(taskItem(paragraph)) | paragraph'],
  ])('removes the still-empty equation from %s on Escape', (_label, content, expected) => {
    const ed = mount(content);
    type(ed, '$$');
    pressInPopover('Escape');
    expect(blocks(ed)).toBe(expected);
  });

  it.each([
    ['a paragraph', '<p>|Hello world</p>', 'paragraph("$$Hello world")'],
    ['a heading', '<h2>|Quarterly results</h2>', 'heading("$$Quarterly results") | paragraph'],
    ['a blockquote', '<blockquote><p>|Quoted text</p></blockquote>', 'blockquote(paragraph("$$Quoted text")) | paragraph'],
    [
      'a table cell',
      '<table><tr><td><p>|Cell text</p></td></tr></table>',
      'table(tableRow(tableCell(paragraph("$$Cell text")))) | paragraph',
    ],
    ['a list item', '<ul><li><p>|Item text</p></li></ul>', 'bulletList(listItem(paragraph("$$Item text"))) | paragraph'],
    ['a task item', taskItem('|Task text'), 'taskList(taskItem(paragraph("$$Task text"))) | paragraph'],
  ])('keeps $$ typed in front of the text of %s as text', (_label, content, expected) => {
    const ed = mount(content);
    type(ed, '$$');
    expect(blocks(ed)).toBe(expected);
    expect(editTarget(ed)).toBeNull();
  });

  it('keeps $$ as text in front of a hard break', () => {
    const ed = mount('<p>|<br></p>');
    type(ed, '$$');
    expect(blocks(ed)).toBe('paragraph("$$", hardBreak)');
    expect(editTarget(ed)).toBeNull();
  });

  it('keeps $$ as text where the container takes no block equation', () => {
    const ed = mount('<details><summary>|</summary><div data-type="detailsContent"><p>Body</p></div></details>');
    type(ed, '$$');
    expect(blocks(ed)).toBe('details(detailsSummary("$$"), detailsContent(paragraph("Body"))) | paragraph');
    expect(editTarget(ed)).toBeNull();
  });

  it('types over a selection that runs into the next block as ordinary text', () => {
    const ed = mount('<p>$</p><p>Second para</p>');
    // From after the dollar to after "Second".
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 2, 10)));
    type(ed, '$');
    expect(blocks(ed)).toBe('paragraph("$$ para")');
    expect(editTarget(ed)).toBeNull();
  });

  it('turns the line into an equation when the typed dollar replaces the rest of it', () => {
    const ed = mount('<p>$abc</p>');
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 2, 5)));
    type(ed, '$');
    expect(blocks(ed)).toBe('mathBlock{""} | paragraph');
    expect(editTarget(ed)).toBe('mathBlock');
  });
});

describe('math input rules at the end of an IME composition', () => {
  it.each<[string, string, string, string | null]>([
    ['$$ alone on a line', '<p>$$|</p>', 'mathBlock{""} | paragraph', 'mathBlock'],
    ['$$ in front of text', '<p>$$|Hello</p>', 'paragraph("$$Hello")', null],
    ['$$ in an empty list item', '<ul><li><p>$$|</p></li></ul>', 'bulletList(listItem(paragraph, mathBlock{""})) | paragraph', 'mathBlock'],
    ['an inline equation', '<p>see $x^2$|</p>', 'paragraph("see ", mathInline{"x^2"})', null],
    ['two prices', '<p>pay $5 and $|</p>', 'paragraph("pay $5 and $")', null],
  ])('handles %s', async (_label, content, expected, target) => {
    const ed = mount(content);
    await endComposition(ed);
    expect(blocks(ed)).toBe(expected);
    expect(editTarget(ed)).toBe(target);
  });
});
