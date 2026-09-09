/**
 * The table of contents lists each heading at the level it renders at, and the block and the
 * floating outline label it so: a stored level the Heading configuration lacks, such as one a
 * collaborator configured with more levels wrote, reads as the nearest configured level, as
 * rendering, isActive and getAttributes read it. The stored level is never changed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BaseKeymap, Document, Editor, Heading, History, Node, Paragraph, Text, UniqueID } from '@domternal/core';
import type { AnyExtension } from '@domternal/core';
import { TableOfContents } from './TableOfContents.js';
import { TableOfContentsBlock } from './TableOfContentsBlock.js';
import { FloatingTocOutline } from './FloatingTocOutline.js';
import { walkHeadings } from './helpers/headingWalk.js';
import type { TocStorage } from './types.js';

const editors: Editor[] = [];
let restoreMatchMedia: (() => void) | undefined;

afterEach(() => {
  for (const editor of editors.splice(0)) if (!editor.isDestroyed) editor.destroy();
  restoreMatchMedia?.();
  restoreMatchMedia = undefined;
  document.body.innerHTML = '';
});

const flushDeferred = (): Promise<void> => new Promise(resolve => setTimeout(() => setTimeout(resolve, 0), 0));

function mount(extensions: AnyExtension[], content: string): Editor {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = new Editor({ element: host, extensions, content });
  editors.push(editor);
  return editor;
}

/** An editor with Heading `levels`, whose heading at each document index then stores the given value, as a remote step would write it. */
function withStored(levels: readonly number[] | undefined, stored: readonly unknown[], extra: AnyExtension[] = []): Editor {
  const heading = levels ? Heading.configure({ levels: [...levels] }) : Heading;
  const content = stored.map((_, index) => `<h1>H${String(index)}</h1>`).join('');
  const editor = mount([Document, Text, Paragraph, heading, ...extra], content);
  const tr = editor.state.tr;
  editor.state.doc.forEach((node, offset, index) => {
    if (node.type.name === 'heading') tr.setNodeAttribute(offset, 'level', stored[index]);
  });
  editor.view.dispatch(tr);
  return editor;
}

/** The level digit of each heading element the editor renders. */
const renderedTags = (editor: Editor): number[] =>
  Array.from(editor.view.dom.querySelectorAll('h1, h2, h3, h4, h5, h6'), element => Number(element.tagName.slice(1)));

const walkLevels = (editor: Editor, levels: number[], anchorTypes = ['heading']): number[] =>
  walkHeadings(editor.state.doc, { levels, anchorTypes }).map(entry => entry.level);

describe('walkHeadings reads the level a heading renders at', () => {
  it('lists a stored 5 in a four-level editor at level 4, and keeps the stored 5', () => {
    const editor = withStored(undefined, [5]);
    expect(walkLevels(editor, [1, 2, 3, 4])).toEqual([4]);
    expect(renderedTags(editor)).toEqual([4]);
    expect(editor.getJSON().content?.[0]?.attrs?.['level']).toBe(5);
  });

  it('leaves out a stored 5 rendered as h4 when the filter lacks 4, as a visible h4 would be', () => {
    const editor = withStored(undefined, [5]);
    expect(walkLevels(editor, [1, 2, 3])).toEqual([]);
    expect(walkLevels(editor, [5, 6])).toEqual([]);
  });

  it('lists a stored 1 in a [2, 3] editor at level 2', () => {
    const editor = withStored([2, 3], [1, 3]);
    expect(walkLevels(editor, [1, 2, 3])).toEqual([2, 3]);
    expect(walkLevels(editor, [1])).toEqual([]);
  });

  it.each([
    [undefined, ['5', 'x', 9, 4.5, 0, -2], [1, 2, 3, 4, 5, 6]],
    [[2, 3], ['5', 'x', 9, 1, '2'], [1, 2, 3, 4, 5, 6]],
    [[4, 2], [1, 3, 5, 'x'], [1, 2, 3, 4, 5, 6]],
  ] as const)('matches the rendered tag for every stored value with levels %j', (levels, stored, filter) => {
    const editor = withStored(levels === undefined ? undefined : [...levels], [...stored]);
    const walked = walkLevels(editor, [...filter]);
    expect(walked).toEqual(renderedTags(editor));
    expect(walked).toHaveLength(stored.length);
  });

  it('reads a decimal string at the level of its number and other invalid values at the level they render', () => {
    const editor = withStored(undefined, ['5', 'x', 9]);
    expect(walkLevels(editor, [1, 2, 3, 4, 5, 6])).toEqual([4, 1, 4]);
  });

  it('keeps every stored level when the configuration has all six', () => {
    const editor = withStored([1, 2, 3, 4, 5, 6], [6, 5, 1]);
    expect(walkLevels(editor, [1, 2, 3, 4, 5, 6])).toEqual([6, 5, 1]);
  });

  it('keeps the stored level of an anchor node whose level the editor does not normalize', () => {
    const Title = Node.create({
      name: 'title', group: 'block', content: 'inline*',
      addAttributes: () => ({ level: { default: 1 } }),
      parseHTML: () => [{ tag: 'div[data-title]' }],
      renderHTML: () => ['div', { 'data-title': '' }, 0],
    });
    const editor = mount([Document, Text, Paragraph, Heading, Title], '<div data-title>T</div><div data-title>S</div>');
    editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'level', 5).setNodeAttribute(3, 'level', '5'));
    // A string level of a node the editor does not normalize still counts as level 1, as before.
    expect(walkLevels(editor, [1, 2, 3, 4, 5, 6], ['title'])).toEqual([5, 1]);
  });

  it('keeps the stored level of a custom heading node without the Heading level rules', () => {
    const Custom = Node.create({
      name: 'heading', group: 'block', content: 'inline*',
      addAttributes: () => ({ level: { default: 1, parseHTML: (element: HTMLElement) => Number(element.tagName.slice(1)) } }),
      parseHTML: () => [1, 2, 3, 4, 5, 6].map(level => ({ tag: `h${String(level)}` })),
      renderHTML: ({ node }) => [`h${String(node.attrs['level'])}`, 0],
    });
    const editor = mount([Document, Text, Paragraph, Custom], '<h5>Five</h5><h6>Six</h6>');
    expect(walkLevels(editor, [1, 2, 3, 4, 5, 6])).toEqual([5, 6]);
  });
});

describe('the table of contents surfaces label the rendered level', () => {
  const toc = TableOfContents.configure({ levels: [1, 2, 3, 4] });

  it('stores the entry, and renders the block link, at the level the heading renders at', async () => {
    const editor = mount([Document, Text, Paragraph, Heading, BaseKeymap, History, UniqueID, toc, TableOfContentsBlock],
      '<h1>Five</h1><h2>Two</h2><div data-type="table-of-contents"></div>');
    editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'level', 5));
    await flushDeferred();
    const storage = editor.storage['toc'] as TocStorage;
    expect(storage.content.map(entry => entry.level)).toEqual([4, 2]);
    const links = Array.from(document.querySelectorAll<HTMLElement>('.dm-toc-block-link'));
    expect(links.map(link => link.dataset['level'])).toEqual(['4', '2']);
    expect(Array.from(document.querySelectorAll<HTMLElement>('.dm-toc-block-item'), item => item.dataset['level'])).toEqual(['4', '2']);
    expect(editor.getJSON().content?.[0]?.attrs?.['level']).toBe(5);
  });

  it('labels the outline tick and row at the rendered level, and names an empty heading by it', async () => {
    const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    window.matchMedia = (query: string) => ({
      matches: false, media: query, onchange: null, dispatchEvent: () => false,
      addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined,
    });
    restoreMatchMedia = () => {
      if (original) Object.defineProperty(window, 'matchMedia', original);
      else Reflect.deleteProperty(window, 'matchMedia');
    };
    const editor = withStored(undefined, [5, 6], [BaseKeymap, History, UniqueID, toc, FloatingTocOutline]);
    // The second heading is emptied, so the outline names it by its level.
    const second = editor.state.doc.child(0).nodeSize;
    editor.view.dispatch(editor.state.tr.delete(second + 1, second + 1 + editor.state.doc.child(1).content.size));
    await flushDeferred();
    const ticks = Array.from(document.querySelectorAll<HTMLElement>('.dm-toc-outline-tick'));
    expect(ticks.map(tick => tick.dataset['level'])).toEqual(['4', '4']);
    expect(ticks.map(tick => tick.getAttribute('aria-label'))).toEqual(['H0 (heading 4)', 'Heading level 4 (heading 4)']);
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.dm-toc-outline-row'));
    expect(rows.map(row => row.dataset['level'])).toEqual(['4', '4']);
    expect(rows[1]?.textContent).toBe('Heading level 4');
  });
});
