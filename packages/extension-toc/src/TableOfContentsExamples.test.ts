import { afterEach, describe, expect, it } from 'vitest';
import { Editor, Document, Text, Paragraph, Heading, UniqueID, History } from '@domternal/core';
import { Fragment, Slice } from '@domternal/pm/model';
import { TableOfContents } from './TableOfContents.js';
import { TableOfContentsBlock } from './TableOfContentsBlock.js';
import type { TocStorage } from './types.js';

const editors: Editor[] = [];
const hosts: HTMLElement[] = [];
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(() => setTimeout(resolve, 0), 0));
const storageOf = (editor: Editor): TocStorage => editor.storage['toc'] as TocStorage;

function createEditor(headingOnly: boolean): Editor {
  const host = document.body.appendChild(document.createElement('div'));
  hosts.push(host);
  const editor = new Editor({
    element: host,
    extensions: [Document, Text, Paragraph, Heading, History,
      headingOnly ? UniqueID.configure({ types: ['heading'] }) : UniqueID,
      TableOfContents, TableOfContentsBlock],
    content: '<h2 id="retained-heading">Repeated title</h2><p>Paragraph body.</p>'
      + '<h2>Repeated title</h2><p></p>',
  });
  // JSDOM has no Range geometry. These examples verify document and history
  // behavior; the browser fixture separately exercises actual scrolling.
  editor.view.setProps({ handleScrollToSelection: () => true });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const host of hosts.splice(0)) host.remove();
});

describe('TOC documentation examples', () => {
  it.each([true, false])('keeps stable heading links with headingOnly=%s through HTML and JSON reloads', async (headingOnly) => {
    const editor = createEditor(headingOnly);
    await flush();
    const ids = storageOf(editor).content.map((entry) => entry.id);
    expect(ids[0]).toBe('retained-heading');
    expect(ids[1]).toBeTruthy();
    expect(new Set(ids).size).toBe(2);

    const expectConfiguredIDs = (): void => {
      expect(storageOf(editor).content.map((entry) => entry.id)).toEqual(ids);
      const paragraphs = Array.from(editor.view.dom.querySelectorAll('p'));
      expect(paragraphs).toHaveLength(2);
      for (const paragraph of paragraphs) {
        expect(paragraph.hasAttribute('id')).toBe(!headingOnly);
      }
      expect(Array.from(editor.view.dom.querySelectorAll('h2'), (heading) => heading.id)).toEqual(ids);
    };
    expectConfiguredIDs();
    editor.setContent(editor.getHTML());
    await flush();
    expectConfiguredIDs();
    editor.setContent(editor.getJSON());
    await flush();
    expectConfiguredIDs();
  });

  it('gives a pasted heading a distinct TOC target while retaining the original heading-only ID', async () => {
    const editor = createEditor(true);
    await flush();
    const previous = storageOf(editor).content.map((entry) => entry.id);
    expect(editor.commands.focus('end')).toBe(true);
    let slice = new Slice(Fragment.from(editor.state.doc.firstChild), 0, 0);
    editor.view.someProp('transformPasted', (transform) => {
      slice = transform(slice, editor.view, false);
    });
    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, slice.content));
    await flush();
    const ids = storageOf(editor).content.map((entry) => entry.id);
    expect(ids.slice(0, 2)).toEqual(previous);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(storageOf(editor).content.map((entry) => entry.textContent)).toEqual([
      'Repeated title', 'Repeated title', 'Repeated title',
    ]);
    expect(editor.view.dom.querySelectorAll('p[id]')).toHaveLength(0);
  });

  it('inserts the documented JSON node in a chain and reloads its canonical name', async () => {
    const editor = createEditor(true);
    await flush();
    const before = editor.state.doc.toJSON();
    let position = 0;
    editor.state.doc.descendants((node, pos) => {
      if (position === 0 && node.type.name === 'paragraph') position = pos + 1;
    });
    const chain = editor.chain().focus(position).insertContent({ type: 'tableOfContents' });
    expect(chain.getFailure()).toBeNull();
    expect(chain.run()).toBe(true);
    const json = editor.getJSON();
    expect(json.content?.filter((node) => node.type === 'tableOfContents')).toHaveLength(1);
    expect(json.content?.some((node) => node.type === 'tableOfContentsBlock')).toBe(false);
    const ids = storageOf(editor).content.map((entry) => entry.id);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.state.doc.toJSON()).toEqual(before);
    editor.setContent(json);
    await flush();
    expect(editor.view.dom.querySelectorAll('.dm-toc-block')).toHaveLength(1);
    expect(Array.from(editor.view.dom.querySelectorAll('.dm-toc-block-link'))
      .map((link) => link.getAttribute('data-toc-anchor'))).toEqual(ids);
  });
});
