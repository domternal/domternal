import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Editor,
  Document,
  Text,
  Paragraph,
  Heading,
  BaseKeymap,
  History,
} from '@domternal/core';
import { TableOfContents } from './TableOfContents.js';
import type { TocStorage } from './types.js';

const baseExtensions = [Document, Text, Paragraph, Heading, BaseKeymap, History, TableOfContents];

/**
 * The plugin's `view().init` defers initial ID assignment / storage
 * population to `setTimeout(0)` (matches UniqueID; avoids dispatching
 * during plugin init). Tests must wait one macrotask before reading
 * `editor.storage.toc`.
 */
const flushDeferred = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const tocStorage = (editor: Editor): TocStorage => editor.storage['toc'] as TocStorage;

const collectTocIds = (editor: Editor): (string | null)[] => {
  const ids: (string | null)[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'heading') {
      const id = node.attrs['tocId'];
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
    expect(typeof TableOfContents.options.generateId).toBe('function');
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

  it('declares tocId via addGlobalAttributes scoped to anchorTypes', () => {
    const globalAttrs = TableOfContents.config.addGlobalAttributes?.call(TableOfContents);
    expect(globalAttrs).toHaveLength(1);
    expect(globalAttrs?.[0]?.types).toEqual(['heading']);
    expect(globalAttrs?.[0]?.attributes).toHaveProperty('tocId');
  });
});

describe('TableOfContents - integration with Editor', () => {
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
    // Every entry has a non-empty stable ID
    for (const e of entries) expect(e.id).toMatch(/^.{8}$/);
    // Initial isActive / isScrolledOver flags are false (Phase 5 fills these in)
    for (const e of entries) {
      expect(e.isActive).toBe(false);
      expect(e.isScrolledOver).toBe(false);
      expect(e.domNode).toBeNull();
    }
  });

  it('writes data-toc-id to the rendered DOM', async () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>One</h1>',
    });
    await flushDeferred();
    const heading = editor.view.dom.querySelector('h1');
    expect(heading?.getAttribute('data-toc-id')).toMatch(/^.{8}$/);
  });

  it('preserves an existing ID stamped by appendTransaction across a level toggle', async () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h2>Section</h2>',
    });
    await flushDeferred();
    const idBefore = collectTocIds(editor)[0];
    expect(idBefore).not.toBeNull();

    // Toggle the heading from H2 to H3 via the framework command.
    // The level attr changes; tocId must NOT be regenerated (this is
    // the whole point of D4 - own attribute decoupled from UniqueID).
    editor.commands.setHeading({ level: 3 });
    const idAfter = collectTocIds(editor)[0];
    expect(idAfter).toBe(idBefore);

    const entries = tocStorage(editor).content;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe(3);
    expect(entries[0]?.id).toBe(idBefore);
  });

  it('assigns IDs to newly added headings on the same transaction', async () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>Original</h1>',
    });
    await flushDeferred();
    expect(tocStorage(editor).content).toHaveLength(1);

    // Replace the doc to add a second heading. setContent is the
    // deterministic way to land at a known doc state, vs insertContent
    // whose insertion point depends on cursor selection. The plugin's
    // appendTransaction fires on the dispatched replacement, then
    // `view().update` re-syncs storage.
    editor.setContent('<h1>Original</h1><h2>Fresh</h2>');
    const entries = tocStorage(editor).content;
    expect(entries).toHaveLength(2);
    for (const e of entries) expect(e.id).toMatch(/^.{8}$/);
    expect(entries[1]?.textContent).toBe('Fresh');
  });

  it('drops the entry from storage when the heading is deleted', async () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>Keep</h1><h2>Drop</h2>',
    });
    await flushDeferred();
    expect(tocStorage(editor).content).toHaveLength(2);

    // Delete the second heading by selecting it and replacing with empty.
    const doc = editor.state.doc;
    const secondHeadingPos = doc.child(0).nodeSize;
    const secondHeadingEnd = secondHeadingPos + doc.child(1).nodeSize;
    editor.view.dispatch(editor.state.tr.delete(secondHeadingPos, secondHeadingEnd));

    const entries = tocStorage(editor).content;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.textContent).toBe('Keep');
  });

  it('renames duplicate IDs that arrive via paste (collision rename)', async () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1 data-toc-id="dup">Loaded first</h1><h2 data-toc-id="dup">Loaded second</h2>',
    });
    await flushDeferred();

    const ids = collectTocIds(editor);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe('dup');
    expect(ids[1]).not.toBe('dup');
    expect(ids[1]).toMatch(/^.{8}$/);
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
      extensions: [Document, Text, Paragraph, Heading, BaseKeymap, History, ConfiguredToc],
      content: '<h1>One</h1>',
    });
    await flushDeferred();
    const initialCount = callbackCount;
    expect(initialCount).toBeGreaterThanOrEqual(1);
    expect(lastStorageRef).not.toBeNull();
    expect(lastStorageRef!.content).toHaveLength(1);

    editor.setContent('<h1>One</h1><h2>Two</h2>');
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
    const unsubscribe = (): void => { tocStorage(ed).subscribers.delete(fn); };

    editor.setContent('<h1>One</h1><h2>Two</h2>');
    expect(calls).toBe(1);

    unsubscribe();

    editor.setContent('<h1>One</h1><h2>Two</h2><h3>Three</h3>');
    expect(calls).toBe(1);
  });

  it('isolates two concurrent editor instances - storage does not bleed between them', async () => {
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
      // The Set instances must be distinct - same-reference would cross-fire.
      expect(aContent).not.toBe(bContent);
      expect((editorA.storage['toc'] as TocStorage).subscribers)
        .not.toBe((editorB.storage['toc'] as TocStorage).subscribers);
    } finally {
      editorA.destroy();
      editorB.destroy();
    }
  });

  it('does not reassign IDs when the same heading is re-rendered (idempotency under repeated transactions)', async () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>Stable</h1>',
    });
    await flushDeferred();
    const idBefore = collectTocIds(editor)[0];

    // Trigger several no-op-ish transactions that touch other parts of
    // the doc but never the heading. The plugin should not regenerate
    // the heading's ID on any of them.
    for (let i = 0; i < 3; i++) {
      editor.commands.insertContent('<p>text</p>');
    }
    const idAfter = collectTocIds(editor)[0];
    expect(idAfter).toBe(idBefore);
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
      extensions: [Document, Text, Paragraph, Heading, BaseKeymap, History, ConfiguredToc],
      content: '<h1>One</h1><h2>Two</h2><h3>Three</h3>',
    });
    await flushDeferred();
    const entries = tocStorage(editor).content;
    // H3 is filtered out by levels: [1, 2], so storage shows only H1+H2.
    expect(entries.map((e) => e.level)).toEqual([1, 2]);
  });

  it('preserves IDs across an HTML export-import roundtrip', async () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>Alpha</h1><h2>Beta</h2>',
    });
    await flushDeferred();
    const idsBefore = collectTocIds(editor);
    expect(idsBefore.every((id) => id?.length === 8)).toBe(true);

    // Export to HTML, then re-import. parseHTML must read data-toc-id
    // back into the schema attr; appendTransaction must NOT regenerate
    // the IDs because they are present and unique.
    const html = editor.getHTML();
    expect(html).toContain('data-toc-id');

    editor.setContent(html);
    await flushDeferred();
    const idsAfter = collectTocIds(editor);
    expect(idsAfter).toEqual(idsBefore);
  });

  it('preserves the original heading ID when an unrelated heading is added then removed', async () => {
    // Verifies tocId stability across add/remove cycles. We avoid the
    // PM undo/redo path here on purpose: undo interleaves the user
    // transaction with the plugin's appendTransaction step in ways
    // that depend on subtle History extension grouping. Direct insert
    // + delete via raw transactions exercise the same "plugin assigns,
    // doc shrinks back" contract without that fragility.
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>Original</h1>',
    });
    await flushDeferred();
    const idBefore = collectTocIds(editor)[0];

    const headingType = editor.state.schema.nodes['heading'];
    if (!headingType) throw new Error('heading schema missing');
    const newH2 = headingType.create({ level: 2 }, editor.state.schema.text('Added'));
    const insertTr = editor.state.tr.insert(editor.state.doc.content.size, newH2);
    editor.view.dispatch(insertTr);
    expect(tocStorage(editor).content).toHaveLength(2);

    // Delete the new heading. Storage should drop back to the original
    // entry only, with the same ID it had at the start.
    const docAfterInsert = editor.state.doc;
    const newH2Pos = docAfterInsert.firstChild!.nodeSize;
    const deleteTr = editor.state.tr.delete(newH2Pos, docAfterInsert.content.size);
    editor.view.dispatch(deleteTr);

    expect(tocStorage(editor).content).toHaveLength(1);
    expect(collectTocIds(editor)[0]).toBe(idBefore);
  });
});

describe('TableOfContents - scrollToHeading command', () => {
  let editor: Editor | undefined;
  let scrollIntoViewSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // jsdom does not implement scrollIntoView; stub it so the command
    // can run end-to-end without throwing. We only assert call count
    // and arguments here, not actual scroll position.
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
    const id = collectTocIds(editor)[1];
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
    const id = collectTocIds(editor)[0];
    if (!id) throw new Error('expected heading id after init');

    // can() runs the command in dry-run mode (dispatch undefined). Our
    // wrapper short-circuits to `true` without invoking the helper, so
    // no scrollIntoView call should land.
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
    const id = collectTocIds(editor)[0];
    if (!id) throw new Error('expected heading id after init');

    // Chain returns true if all commands in the chain succeed. The
    // `.run()` call commits the chain. scrollToHeading inside a chain
    // should still fire its DOM side effect via the dispatch path.
    const ok = editor.chain().scrollToHeading(id).run();
    expect(ok).toBe(true);
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
  });
});

describe('TableOfContents - initial-load hash navigation', () => {
  let editor: Editor | undefined;
  let scrollIntoViewSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollIntoViewSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewSpy as unknown as typeof Element.prototype.scrollIntoView;
    // Reset hash to a known clean state before each test.
    history.replaceState(null, '', window.location.pathname);
  });

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
    editor = undefined;
    history.replaceState(null, '', window.location.pathname);
  });

  /**
   * Wait for both:
   *   1. the `setTimeout(0)` that runs the initial ID assignment
   *   2. the `requestAnimationFrame` that defers the hash scroll until
   *      after the dispatch above has committed
   */
  const flushInitialLoadCycle = async (): Promise<void> => {
    await flushDeferred();
    await new Promise<void>((r) => requestAnimationFrame(() => { r(); }));
  };

  it('scrolls to the heading whose id matches window.location.hash on first paint', async () => {
    history.replaceState(null, '', '#preset-id');
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1 data-toc-id="preset-id">Bookmarked</h1><h2>Other</h2>',
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
      content: '<h1 data-toc-id="preset">Will be torn down</h1>',
    });
    // Run the setTimeout(0) so the rAF is scheduled, then destroy
    // BEFORE the next animation frame can fire.
    await flushDeferred();
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
    expect(othersCalled).toBe(1);
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
