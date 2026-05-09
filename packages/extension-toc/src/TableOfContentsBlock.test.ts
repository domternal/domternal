/**
 * TableOfContentsBlock - Phase 7 unit tests.
 *
 * Tests run against a real `Editor` with the block + TableOfContents
 * loaded. The NodeView's storage subscription only functions in
 * integration, so we don't try to drive the inner render in
 * isolation - we drive it through the editor surface.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Editor,
  Document,
  Text,
  Paragraph,
  Heading,
  Blockquote,
  BaseKeymap,
  History,
} from '@domternal/core';
import { TableOfContents } from './TableOfContents.js';
import { TableOfContentsBlock } from './TableOfContentsBlock.js';

const baseExtensions = [
  Document,
  Text,
  Paragraph,
  Heading,
  BaseKeymap,
  History,
  TableOfContents,
  TableOfContentsBlock,
];

const flushDeferred = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const queryBlock = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('.dm-toc-block');
const queryBlockLinks = (): HTMLButtonElement[] =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('.dm-toc-block-link'));
const queryBlockEmpty = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('.dm-toc-block-empty');

interface MountOpts { content: string }

describe('TableOfContentsBlock - configuration', () => {
  it('registers under the canonical name "tableOfContents"', () => {
    expect(TableOfContentsBlock.name).toBe('tableOfContents');
  });

  it('declares an atom block-level node', () => {
    const config = TableOfContentsBlock.config;
    expect(config.group).toBe('block');
    expect(config.atom).toBe(true);
    expect(config.selectable).toBe(true);
    expect(config.draggable).toBe(true);
  });

  it('exposes a slash menu item via addFloatingMenuItems', () => {
    const items = TableOfContentsBlock.config.addFloatingMenuItems?.call(TableOfContentsBlock);
    expect(items).toBeDefined();
    expect(items).toHaveLength(1);
    expect(items?.[0]?.name).toBe('table-of-contents');
    expect(items?.[0]?.label).toBe('Table of contents');
    expect(items?.[0]?.keywords).toEqual(['toc', 'outline', 'contents']);
  });
});

describe('TableOfContentsBlock - integration with Editor', () => {
  let editor: Editor | undefined;

  const mount = ({ content }: MountOpts): Editor => {
    document.body.innerHTML = '';
    document.querySelectorAll('.dm-toc-block').forEach((n) => { n.remove(); });
    const host = document.createElement('div');
    document.body.appendChild(host);
    return new Editor({ element: host, extensions: baseExtensions, content });
  };

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
    editor = undefined;
    document.body.innerHTML = '';
  });

  it('renders a block when the doc contains a tableOfContents node', async () => {
    editor = mount({
      content: '<h1>One</h1><div data-type="table-of-contents"></div><h2>Two</h2>',
    });
    await flushDeferred();
    const block = queryBlock();
    expect(block).not.toBeNull();
    expect(block?.getAttribute('data-type')).toBe('table-of-contents');
    expect(block?.getAttribute('contenteditable')).toBe('false');
  });

  it('lists every heading currently in the document', async () => {
    editor = mount({
      content: '<h1>Alpha</h1><h2>Beta</h2><h3>Gamma</h3><div data-type="table-of-contents"></div>',
    });
    await flushDeferred();
    const links = queryBlockLinks();
    expect(links).toHaveLength(3);
    expect(links.map((l) => l.textContent)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(links.map((l) => l.dataset['level'])).toEqual(['1', '2', '3']);
    // Each link has a non-empty stable tocId.
    for (const link of links) expect(link.dataset['tocId']).toMatch(/^.{8}$/);
  });

  it('shows the empty-state placeholder when the document has no headings', async () => {
    editor = mount({ content: '<p>Just a paragraph</p><div data-type="table-of-contents"></div>' });
    await flushDeferred();
    const empty = queryBlockEmpty();
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toMatch(/Add headings/i);
    expect(queryBlockLinks()).toHaveLength(0);
  });

  it('reactively re-renders when a heading is added to the document', async () => {
    editor = mount({ content: '<h1>One</h1><div data-type="table-of-contents"></div>' });
    await flushDeferred();
    expect(queryBlockLinks()).toHaveLength(1);

    editor.setContent('<h1>One</h1><h2>Two</h2><div data-type="table-of-contents"></div>');
    expect(queryBlockLinks()).toHaveLength(2);
    expect(queryBlockLinks()[1]?.textContent).toBe('Two');
  });

  it('reactively re-renders when a heading is removed from the document', async () => {
    editor = mount({
      content: '<h1>One</h1><h2>Two</h2><div data-type="table-of-contents"></div>',
    });
    await flushDeferred();
    expect(queryBlockLinks()).toHaveLength(2);

    editor.setContent('<h1>One</h1><div data-type="table-of-contents"></div>');
    expect(queryBlockLinks()).toHaveLength(1);
  });

  it('clicking a row scrolls to the heading via scrollToHeading', async () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy as unknown as typeof Element.prototype.scrollIntoView;

    editor = mount({
      content: '<h1>One</h1><h2>Target</h2><div data-type="table-of-contents"></div>',
    });
    await flushDeferred();
    const links = queryBlockLinks();
    expect(links).toHaveLength(2);
    links[1]?.click();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  it('mirrors active state from storage.activeId on the matching row', async () => {
    editor = mount({
      content: '<h1>One</h1><h2>Two</h2><div data-type="table-of-contents"></div>',
    });
    await flushDeferred();
    const storage = editor.storage['toc'] as { content: { id: string }[]; activeId: string | null; subscribers: Set<() => void> };
    const target = storage.content[1];
    if (!target) throw new Error('expected second heading');

    // Simulate the floating outline writing storage.activeId. Then
    // fan out so the block re-renders with the new marker.
    storage.activeId = target.id;
    storage.subscribers.forEach((fn) => { fn(); });

    const activeLink = queryBlockLinks().find((l) => l.dataset['tocId'] === target.id);
    expect(activeLink?.classList.contains('dm-toc-block-link--active')).toBe(true);
    expect(activeLink?.getAttribute('aria-current')).toBe('location');
  });

  it('multiple inline blocks in the same document share the same heading list', async () => {
    editor = mount({
      content: '<h1>Top</h1><div data-type="table-of-contents"></div><h2>Mid</h2><div data-type="table-of-contents"></div>',
    });
    await flushDeferred();
    const blocks = document.querySelectorAll('.dm-toc-block');
    expect(blocks).toHaveLength(2);
    // Each block has the same set of heading link tocIds (storage is
    // shared - both NodeViews render from the same source).
    const idsPerBlock = Array.from(blocks).map((b) =>
      Array.from(b.querySelectorAll<HTMLButtonElement>('.dm-toc-block-link'))
        .map((l) => l.dataset['tocId']),
    );
    expect(idsPerBlock[0]).toEqual(idsPerBlock[1]);
    expect(idsPerBlock[0]).toHaveLength(2);
  });

  it('preserves the block across an HTML export-import roundtrip', async () => {
    editor = mount({
      content: '<h1>One</h1><div data-type="table-of-contents"></div>',
    });
    await flushDeferred();
    const html = editor.getHTML();
    expect(html).toContain('data-type="table-of-contents"');

    editor.setContent(html);
    await flushDeferred();
    expect(queryBlock()).not.toBeNull();
  });

  it('NodeView destroy unsubscribes from storage subscribers (no leak)', async () => {
    editor = mount({
      content: '<h1>One</h1><h2>Two</h2><div data-type="table-of-contents"></div>',
    });
    await flushDeferred();
    const storage = editor.storage['toc'] as { subscribers: Set<() => void> };
    const sizeWithBlock = storage.subscribers.size;
    expect(sizeWithBlock).toBeGreaterThan(0);

    // Replacing the doc with one that has no block destroys the
    // NodeView. The subscriber it added to storage must go with it.
    editor.setContent('<p>No block</p>');
    expect(storage.subscribers.size).toBeLessThan(sizeWithBlock);
  });
});

describe('TableOfContentsBlock - empty-state customization', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
    editor = undefined;
    document.body.innerHTML = '';
  });

  it('honors a custom emptyStateText option', async () => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: [
        Document, Text, Paragraph, Heading, BaseKeymap, History,
        TableOfContents,
        TableOfContentsBlock.configure({ emptyStateText: 'No outline yet' }),
      ],
      content: '<p>just text</p><div data-type="table-of-contents"></div>',
    });
    await flushDeferred();
    expect(queryBlockEmpty()?.textContent).toBe('No outline yet');
  });

  it('propagates HTMLAttributes option to the block wrapper', async () => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: [
        Document, Text, Paragraph, Heading, BaseKeymap, History,
        TableOfContents,
        TableOfContentsBlock.configure({
          HTMLAttributes: { 'data-test-attr': 'custom-value', 'data-other': 'x' },
        }),
      ],
      content: '<h1>One</h1><div data-type="table-of-contents"></div>',
    });
    await flushDeferred();
    const block = queryBlock();
    expect(block?.getAttribute('data-test-attr')).toBe('custom-value');
    expect(block?.getAttribute('data-other')).toBe('x');
    // The standard `data-type="table-of-contents"` marker stays put
    // alongside the consumer's custom attributes - we don't strip
    // them.
    expect(block?.getAttribute('data-type')).toBe('table-of-contents');
  });
});

describe('TableOfContentsBlock - schema + serialization', () => {
  it('renderHTML emits a div with data-type="table-of-contents"', () => {
    const renderHTML = TableOfContentsBlock.config.renderHTML;
    expect(renderHTML).toBeDefined();
    if (!renderHTML) return;
    // Mock the call shape the framework uses - node + HTMLAttributes.
    const result = renderHTML.call(
      { options: { HTMLAttributes: {}, emptyStateText: 'x' } } as never,
      { node: { attrs: {} }, HTMLAttributes: {} } as never,
    );
    expect(Array.isArray(result)).toBe(true);
    const tuple = result as unknown as [string, Record<string, unknown>];
    expect(tuple[0]).toBe('div');
    expect(tuple[1]['data-type']).toBe('table-of-contents');
  });

  it('node parses from <div data-type="table-of-contents"> tag', () => {
    // Verify parseDOM sees the tag pattern - this is what makes
    // export/import roundtrips work.
    const parseHTML = TableOfContentsBlock.config.parseHTML;
    expect(parseHTML).toBeDefined();
    const rules = parseHTML?.call(TableOfContentsBlock as never);
    expect(rules).toBeDefined();
    expect(rules?.[0]?.tag).toBe('div[data-type="table-of-contents"]');
  });

  it('schema allows the block inside a blockquote (group: block)', async () => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = new Editor({
      element: host,
      extensions: [
        Document, Text, Paragraph, Heading, Blockquote, BaseKeymap, History,
        TableOfContents,
        TableOfContentsBlock,
      ],
      content: '<h1>One</h1><blockquote><div data-type="table-of-contents"></div></blockquote>',
    });
    try {
      await flushDeferred();
      // The block parses successfully inside <blockquote>; schema's
      // 'block' group is what makes containers accept it.
      const blockInQuote = document.querySelector('blockquote .dm-toc-block');
      expect(blockInQuote).not.toBeNull();
    } finally {
      editor.destroy();
      document.body.innerHTML = '';
    }
  });
});
