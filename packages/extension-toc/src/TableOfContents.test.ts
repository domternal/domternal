import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Editor,
  Document,
  Text,
  Paragraph,
  Heading,
  BaseKeymap,
  History,
  UniqueID,
} from '@domternal/core';
import { TableOfContents } from './TableOfContents.js';
import type { TocStorage } from './types.js';

// Notion-style setup: TOC requires UniqueID as a peer extension.
// `UniqueID` defaults assign `id` to heading nodes (and other block
// types). TOC reads from `node.attrs.id` instead of writing its own.
const baseExtensions = [
  Document,
  Text,
  Paragraph,
  Heading,
  BaseKeymap,
  History,
  UniqueID,
  TableOfContents,
];

/**
 * Both UniqueID and TOC defer their initial passes to `setTimeout(0)`
 * (avoid dispatching during plugin init). Tests must wait one macrotask
 * before reading `editor.storage.toc`. We wait two to be safe in case
 * the relative ordering of the two timers shifts.
 */
const flushDeferred = (): Promise<void> =>
  new Promise((r) => setTimeout(() => setTimeout(r, 0), 0));

const tocStorage = (editor: Editor): TocStorage => editor.storage['toc'] as TocStorage;

const collectHeadingIds = (editor: Editor): (string | null)[] => {
  const ids: (string | null)[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'heading') {
      const id = node.attrs['id'];
      ids.push(typeof id === 'string' && id.length > 0 ? id : null);
    }
  });
  return ids;
};

describe('TableOfContents - configuration', () => {
  it('registers under the canonical name "toc"', () => {
    expect(TableOfContents.name).toBe('toc');
  });

  it('exposes default options', () => {
    expect(TableOfContents.options.levels).toEqual([1, 2, 3]);
    expect(TableOfContents.options.anchorTypes).toEqual(['heading']);
  });

  it('does not expose generateId — id generation lives in UniqueID', () => {
    expect((TableOfContents.options as { generateId?: unknown }).generateId).toBeUndefined();
  });

  it('initial storage is empty (subscribers Set is fresh)', () => {
    const storage = TableOfContents.config.addStorage?.call({} as never);
    expect(storage).toBeDefined();
    if (!storage) return;
    expect(storage.content).toEqual([]);
    expect(storage.activeId).toBeNull();
    expect(storage.subscribers).toBeInstanceOf(Set);
    expect(storage.subscribers.size).toBe(0);
  });

  it('does NOT declare a tocId schema attribute (id source is UniqueID)', () => {
    // Pre-refactor TOC declared `tocId` via addGlobalAttributes; that
    // is gone. The contract is now that UniqueID owns the schema attr
    // and TOC reads it.
    const globalAttrs = TableOfContents.config.addGlobalAttributes;
    expect(globalAttrs).toBeUndefined();
  });
});

describe('TableOfContents - peer dependency on UniqueID', () => {
  let editor: Editor | undefined;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
    editor = undefined;
    consoleErrorSpy.mockRestore();
  });

  it('logs a clear error when TOC is loaded without UniqueID', async () => {
    // Intentionally exclude UniqueID from extensions to verify the
    // peer-dependency contract.
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Heading, BaseKeymap, History, TableOfContents],
      content: '<h1>Lonely</h1>',
    });
    await flushDeferred();

    expect(consoleErrorSpy).toHaveBeenCalled();
    const message = String(consoleErrorSpy.mock.calls[0]?.[0] ?? '');
    expect(message).toContain('TableOfContents');
    expect(message).toContain('UniqueID');
  });

  it('renders editor cleanly without UniqueID (no crash, just inert TOC)', async () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Heading, BaseKeymap, History, TableOfContents],
      content: '<h1>Lonely</h1>',
    });
    await flushDeferred();

    // Editor itself works (paragraphs, headings render). TOC plugin is
    // a no-op: storage stays empty.
    expect(tocStorage(editor).content).toEqual([]);
    expect(editor.getHTML()).toContain('<h1>');
  });

  it('does not register a scrollToHeading plugin path when UniqueID is absent', async () => {
    // The command is still defined on RawCommands (declared in the
    // extension); but with UniqueID missing, it can't find headings to
    // navigate to. We verify the no-error path here.
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Heading, BaseKeymap, History, TableOfContents],
      content: '<h1>Lonely</h1>',
    });
    await flushDeferred();

    // scrollToHeading is registered (addCommands runs unconditionally),
    // but with no headings carrying ids, it returns false.
    const result = editor.commands.scrollToHeading('any-id');
    expect(result).toBe(false);
  });
});

describe('TableOfContents - peer config validation', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
    editor = undefined;
  });

  it('warns when UniqueID.types omits an anchor type that TOC needs', async () => {
    // Configure UniqueID to only handle paragraphs, not headings. TOC
    // will walk headings (its default anchorTypes) but find no ids on
    // them. We expect a clear console.warn at init.
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const NarrowUniqueID = UniqueID.configure({ types: ['paragraph'] });
      editor = new Editor({
        extensions: [
          Document, Text, Paragraph, Heading, BaseKeymap, History, NarrowUniqueID, TableOfContents,
        ],
        content: '<h1>No id</h1>',
      });
      await flushDeferred();

      expect(consoleWarnSpy).toHaveBeenCalled();
      const message = String(consoleWarnSpy.mock.calls[0]?.[0] ?? '');
      expect(message).toContain('TableOfContents');
      expect(message).toContain('UniqueID.types');
      expect(message).toContain('heading');

      // TOC still functions: storage is populated but ids are empty.
      const entries = tocStorage(editor).content;
      expect(entries).toHaveLength(1);
      expect(entries[0]?.id).toBe('');
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });

  it('does NOT warn when UniqueID.types covers all anchor types', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      // Default UniqueID.types includes 'heading'; default TOC.anchorTypes
      // is ['heading']. No mismatch — no warn.
      editor = new Editor({
        extensions: baseExtensions,
        content: '<h1>OK</h1>',
      });
      await flushDeferred();
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    } finally {
      consoleWarnSpy.mockRestore();
    }
  });
});

describe('TableOfContents - integration with UniqueID', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
    editor = undefined;
  });

  it('populates storage with one entry per heading after initial pass', async () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>Alpha</h1><h2>Beta</h2><h3>Gamma</h3>',
    });
    await flushDeferred();
    const entries = tocStorage(editor).content;
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => ({ level: e.level, text: e.textContent }))).toEqual([
      { level: 1, text: 'Alpha' },
      { level: 2, text: 'Beta' },
      { level: 3, text: 'Gamma' },
    ]);
    // Every entry has a non-empty stable ID sourced from UniqueID
    for (const e of entries) expect(typeof e.id).toBe('string');
    for (const e of entries) expect(e.id.length).toBeGreaterThan(0);
    // Initial isActive / isScrolledOver flags are false
    for (const e of entries) {
      expect(e.isActive).toBe(false);
      expect(e.isScrolledOver).toBe(false);
      expect(e.domNode).toBeNull();
    }
  });

  it('does NOT write data-toc-id to the rendered DOM (only native id remains)', async () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>One</h1>',
    });
    await flushDeferred();
    const heading = editor.view.dom.querySelector('h1');
    expect(heading?.getAttribute('data-toc-id')).toBeNull();
    expect(heading?.getAttribute('id')).toBeTruthy();
    expect(heading?.getAttribute('id')).toMatch(/.+/);
  });

  it('storage entry id mirrors the heading element id in the DOM', async () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>Alpha</h1><h2>Beta</h2>',
    });
    await flushDeferred();
    const headings = Array.from(editor.view.dom.querySelectorAll('h1, h2'));
    const domIds = headings.map((h) => h.getAttribute('id'));
    const storageIds = tocStorage(editor).content.map((e) => e.id);
    expect(storageIds).toEqual(domIds);
  });

  it('preserves the heading id across a level toggle (UniqueID stability)', async () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h2>Section</h2>',
    });
    await flushDeferred();
    const idBefore = collectHeadingIds(editor)[0];
    expect(idBefore).not.toBeNull();

    editor.commands.setHeading({ level: 3 });
    const idAfter = collectHeadingIds(editor)[0];
    expect(idAfter).toBe(idBefore);

    const entries = tocStorage(editor).content;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe(3);
    expect(entries[0]?.id).toBe(idBefore);
  });

  it('populates storage when new headings are added after initial paint', async () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>Original</h1>',
    });
    await flushDeferred();
    expect(tocStorage(editor).content).toHaveLength(1);

    editor.setContent('<h1>Original</h1><h2>Fresh</h2>');
    await flushDeferred();
    const entries = tocStorage(editor).content;
    expect(entries).toHaveLength(2);
    for (const e of entries) expect(e.id.length).toBeGreaterThan(0);
    expect(entries[1]?.textContent).toBe('Fresh');
  });

  it('drops the entry from storage when the heading is deleted', async () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>Keep</h1><h2>Drop</h2>',
    });
    await flushDeferred();
    expect(tocStorage(editor).content).toHaveLength(2);

    const doc = editor.state.doc;
    const secondHeadingPos = doc.child(0).nodeSize;
    const secondHeadingEnd = secondHeadingPos + doc.child(1).nodeSize;
    editor.view.dispatch(editor.state.tr.delete(secondHeadingPos, secondHeadingEnd));

    const entries = tocStorage(editor).content;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.textContent).toBe('Keep');
  });

  it('fires onUpdate when storage content changes', async () => {
    let callbackCount = 0;
    let lastStorageRef: TocStorage | null = null;
    const ConfiguredToc = TableOfContents.configure({
      onUpdate: (storage) => {
        callbackCount += 1;
        lastStorageRef = storage;
      },
    });
    editor = new Editor({
      extensions: [
        Document, Text, Paragraph, Heading, BaseKeymap, History, UniqueID, ConfiguredToc,
      ],
      content: '<h1>One</h1>',
    });
    await flushDeferred();
    const initialCount = callbackCount;
    expect(initialCount).toBeGreaterThanOrEqual(1);
    expect(lastStorageRef).not.toBeNull();
    expect(lastStorageRef!.content).toHaveLength(1);

    editor.setContent('<h1>One</h1><h2>Two</h2>');
    await flushDeferred();
    expect(callbackCount).toBeGreaterThan(initialCount);
    expect(lastStorageRef!.content).toHaveLength(2);
  });

  it('fans out to internal subscribers and stops cleanly on unsubscribe', async () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>One</h1>',
    });
    await flushDeferred();

    let calls = 0;
    const ed = editor;
    const fn = (): void => { calls += 1; };
    tocStorage(ed).subscribers.add(fn);

    editor.setContent('<h1>One</h1><h2>Two</h2>');
    await flushDeferred();
    expect(calls).toBeGreaterThanOrEqual(1);

    const callsBefore = calls;
    tocStorage(ed).subscribers.delete(fn);

    editor.setContent('<h1>One</h1><h2>Two</h2><h3>Three</h3>');
    await flushDeferred();
    expect(calls).toBe(callsBefore);
  });

  it('isolates two concurrent editor instances (storage does not bleed)', async () => {
    const editorA = new Editor({
      extensions: baseExtensions,
      content: '<h1>A</h1>',
    });
    const editorB = new Editor({
      extensions: baseExtensions,
      content: '<h1>B1</h1><h2>B2</h2>',
    });
    await flushDeferred();
    try {
      const aContent = (editorA.storage['toc'] as TocStorage).content;
      const bContent = (editorB.storage['toc'] as TocStorage).content;
      expect(aContent).toHaveLength(1);
      expect(aContent[0]?.textContent).toBe('A');
      expect(bContent).toHaveLength(2);
      expect(bContent.map((e) => e.textContent)).toEqual(['B1', 'B2']);
      expect(aContent).not.toBe(bContent);
      expect((editorA.storage['toc'] as TocStorage).subscribers)
        .not.toBe((editorB.storage['toc'] as TocStorage).subscribers);
    } finally {
      editorA.destroy();
      editorB.destroy();
    }
  });

  it('initializes empty storage for a doc with no headings', async () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<p>Just a paragraph</p><p>Another</p>',
    });
    await flushDeferred();
    expect(tocStorage(editor).content).toEqual([]);
  });

  it('respects a custom levels filter passed via .configure', async () => {
    const ConfiguredToc = TableOfContents.configure({ levels: [1, 2] });
    editor = new Editor({
      extensions: [
        Document, Text, Paragraph, Heading, BaseKeymap, History, UniqueID, ConfiguredToc,
      ],
      content: '<h1>One</h1><h2>Two</h2><h3>Three</h3>',
    });
    await flushDeferred();
    const entries = tocStorage(editor).content;
    expect(entries.map((e) => e.level)).toEqual([1, 2]);
  });

  it('preserves IDs across an HTML export-import roundtrip', async () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>Alpha</h1><h2>Beta</h2>',
    });
    await flushDeferred();
    const idsBefore = collectHeadingIds(editor);
    expect(idsBefore.every((id) => id !== null && id.length > 0)).toBe(true);

    const html = editor.getHTML();
    expect(html).toContain('id=');
    expect(html).not.toContain('data-toc-id');

    editor.setContent(html);
    await flushDeferred();
    const idsAfter = collectHeadingIds(editor);
    expect(idsAfter).toEqual(idsBefore);
  });

  it('honors a custom UniqueID.attributeName via configure', async () => {
    // Consumer wants ids in `data-id` instead of `id`. TOC reads the
    // configured name from UniqueID's options at init.
    const CustomUniqueID = UniqueID.configure({ attributeName: 'data-id' });
    editor = new Editor({
      extensions: [
        Document, Text, Paragraph, Heading, BaseKeymap, History, CustomUniqueID, TableOfContents,
      ],
      content: '<h1>Customized</h1>',
    });
    await flushDeferred();

    const entries = tocStorage(editor).content;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBeTruthy();

    const heading = editor.view.dom.querySelector('h1');
    expect(heading?.getAttribute('data-id')).toBe(entries[0]?.id);
    // Native `id` is NOT present (UniqueID writes its own attr name).
    expect(heading?.getAttribute('id')).toBeNull();
  });
});

describe('TableOfContents - scrollToHeading command', () => {
  let editor: Editor | undefined;
  let scrollIntoViewSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollIntoViewSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewSpy as unknown as typeof Element.prototype.scrollIntoView;
  });

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
    editor = undefined;
  });

  it('returns true and scrolls when called with a known heading id', async () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>One</h1><h2>Two</h2>',
    });
    await flushDeferred();
    const id = collectHeadingIds(editor)[1];
    if (!id) throw new Error('expected second heading to have an id after init');

    const result = editor.commands.scrollToHeading(id);
    expect(result).toBe(true);
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
  });

  it('returns false for an unknown id (no scroll, no exception)', async () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>One</h1>',
    });
    await flushDeferred();
    const result = editor.commands.scrollToHeading('definitely-not-a-real-id');
    expect(result).toBe(false);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  it('is reachable through editor.can() without side effects', async () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>One</h1>',
    });
    await flushDeferred();
    const id = collectHeadingIds(editor)[0];
    if (!id) throw new Error('expected heading id after init');

    const canScroll = editor.can().scrollToHeading(id);
    expect(canScroll).toBe(true);
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  it('works through editor.chain() (composable with other commands)', async () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>One</h1>',
    });
    await flushDeferred();
    const id = collectHeadingIds(editor)[0];
    if (!id) throw new Error('expected heading id after init');

    const ok = editor.chain().scrollToHeading(id).run();
    expect(ok).toBe(true);
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
  });

  it('uses the custom attributeName from UniqueID config when scrolling', async () => {
    const CustomUniqueID = UniqueID.configure({ attributeName: 'data-id' });
    editor = new Editor({
      extensions: [
        Document, Text, Paragraph, Heading, BaseKeymap, History, CustomUniqueID, TableOfContents,
      ],
      content: '<h1>Custom</h1>',
    });
    await flushDeferred();
    const heading = editor.view.dom.querySelector('h1');
    const id = heading?.getAttribute('data-id');
    if (!id) throw new Error('expected data-id on heading');

    const result = editor.commands.scrollToHeading(id);
    expect(result).toBe(true);
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
  });
});

describe('TableOfContents - initial-load hash navigation', () => {
  let editor: Editor | undefined;
  let scrollIntoViewSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollIntoViewSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewSpy as unknown as typeof Element.prototype.scrollIntoView;
    history.replaceState(null, '', window.location.pathname);
  });

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
    editor = undefined;
    history.replaceState(null, '', window.location.pathname);
  });

  const flushInitialLoadCycle = async (): Promise<void> => {
    await new Promise((r) => setTimeout(() => setTimeout(r, 0), 0));
    await new Promise<void>((r) => requestAnimationFrame(() => { r(); }));
  };

  it('scrolls to the heading whose id matches window.location.hash on first paint', async () => {
    history.replaceState(null, '', '#preset-id');
    editor = new Editor({
      extensions: baseExtensions,
      // Pre-seed the heading with the id we will navigate to.
      content: '<h1 id="preset-id">Bookmarked</h1><h2>Other</h2>',
    });
    await flushInitialLoadCycle();
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
  });

  it('does not scroll when the hash does not match any heading', async () => {
    history.replaceState(null, '', '#unknown');
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>One</h1><h2>Two</h2>',
    });
    await flushInitialLoadCycle();
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  it('does not scroll when there is no hash at all', async () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>One</h1>',
    });
    await flushInitialLoadCycle();
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });

  it('cancels the pending hash-scroll rAF when the editor is destroyed before it fires', async () => {
    history.replaceState(null, '', '#preset');
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1 id="preset">Will be torn down</h1>',
    });
    // Run only the macrotasks (timeouts) so the rAF is scheduled.
    // Destroy BEFORE the next animation frame can fire.
    await new Promise((r) => setTimeout(() => setTimeout(r, 0), 0));
    editor.destroy();
    await new Promise<void>((r) => requestAnimationFrame(() => { r(); }));
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
  });
});

describe('TableOfContents - subscribers fan-out resilience', () => {
  let editor: Editor | undefined;

  beforeEach(() => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>Boot</h1>',
    });
  });

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
    editor = undefined;
  });

  it('a misbehaving subscriber does not break the others', async () => {
    await flushDeferred();
    let othersCalled = 0;
    const storage = tocStorage(editor!);
    storage.subscribers.add(() => { throw new Error('boom'); });
    storage.subscribers.add(() => { othersCalled += 1; });

    editor!.setContent('<h1>Boot</h1><h2>After</h2>');
    await flushDeferred();
    expect(othersCalled).toBeGreaterThanOrEqual(1);
  });

  it('subscribers Set is cleared on plugin destroy (no leak across editor recreate)', async () => {
    await flushDeferred();
    const storage = tocStorage(editor!);
    storage.subscribers.add(() => undefined);
    expect(storage.subscribers.size).toBe(1);

    editor!.destroy();
    expect(storage.subscribers.size).toBe(0);
  });
});
