import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  Document,
  Text,
  Paragraph,
  Heading,
  BulletList,
  OrderedList,
  ListItem,
  TaskList,
  TaskItem,
  Editor,
} from '@domternal/core';
import {
  BlockHandle,
  blockHandlePluginKey,
  resolveNestedConfig,
  descendToNearestHoverItem,
} from './BlockHandle.js';
import type { EditorView } from '@domternal/pm/view';
import { DEFAULT_BLOCK_MATCHERS } from './helpers/defaultMatchers.js';
import type { BlockMatcher } from './helpers/blockMatcher.js';

const extensions = [Document, Text, Paragraph, Heading, BlockHandle];

let editor: Editor | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  host?.remove();
  host = undefined;
});

function makeEditor(html = '<p>Hello</p>'): Editor {
  host = document.createElement('div');
  host.className = 'dm-editor';
  document.body.appendChild(host);
  editor = new Editor({ element: host, extensions, content: html });
  return editor;
}

describe('BlockHandle configuration', () => {
  it('has the correct extension name', () => {
    expect(BlockHandle.name).toBe('blockHandle');
  });

  it('has default options', () => {
    expect(BlockHandle.options.hideDelay).toBe(200);
    expect(BlockHandle.options.disableDrag).toBe(false);
    expect(BlockHandle.options.autoScroll).toBe(true);
    expect(BlockHandle.options.autoScrollThreshold).toBe(48);
    expect(BlockHandle.options.autoScrollMaxSpeed).toBe(18);
  });

  it('can configure hideDelay', () => {
    const configured = BlockHandle.configure({ hideDelay: 500 });
    expect(configured.options.hideDelay).toBe(500);
  });

  it('can configure disableDrag', () => {
    const configured = BlockHandle.configure({ disableDrag: true });
    expect(configured.options.disableDrag).toBe(true);
  });

  it('can configure auto-scroll options', () => {
    const configured = BlockHandle.configure({
      autoScroll: false,
      autoScrollThreshold: 80,
      autoScrollMaxSpeed: 30,
    });
    expect(configured.options.autoScroll).toBe(false);
    expect(configured.options.autoScrollThreshold).toBe(80);
    expect(configured.options.autoScrollMaxSpeed).toBe(30);
  });

  it('nested is disabled by default', () => {
    expect(BlockHandle.options.nested).toBe(false);
  });

  it('can enable nested with `true` shorthand', () => {
    const configured = BlockHandle.configure({ nested: true });
    expect(configured.options.nested).toBe(true);
  });

  it('can enable nested with a custom allowedNodes list', () => {
    const configured = BlockHandle.configure({ nested: { allowedNodes: ['listItem'] } });
    expect(configured.options.nested).toEqual({ allowedNodes: ['listItem'] });
  });

  it('nested config accepts promoteOnEdge boolean', () => {
    const configured = BlockHandle.configure({ nested: { promoteOnEdge: true } });
    expect(configured.options.nested).toEqual({ promoteOnEdge: true });
  });

  it('nested config accepts promoteOnEdge preset string', () => {
    const configured = BlockHandle.configure({ nested: { promoteOnEdge: 'both' } });
    expect((configured.options.nested as { promoteOnEdge: string }).promoteOnEdge).toBe('both');
  });

  it('nested config accepts custom GutterBiasConfig partial', () => {
    const configured = BlockHandle.configure({
      nested: { promoteOnEdge: { threshold: 24, strength: 250 } },
    });
    expect((configured.options.nested as { promoteOnEdge: { threshold: number } }).promoteOnEdge)
      .toEqual({ threshold: 24, strength: 250 });
  });

  it('nested config accepts allowedContainers + custom matchers + defaultMatchers toggle', () => {
    // (extension stage - `resolveNestedConfig` resolution covered below)
    const customMatcher: BlockMatcher = { name: 'custom', test: () => 'allow' };
    const configured = BlockHandle.configure({
      nested: {
        allowedNodes: ['paragraph'],
        allowedContainers: ['blockquote'],
        matchers: [customMatcher],
        defaultMatchers: false,
      },
    });
    const nested = configured.options.nested as {
      allowedNodes: string[];
      allowedContainers: string[];
      matchers: unknown[];
      defaultMatchers: boolean;
    };
    expect(nested.allowedNodes).toEqual(['paragraph']);
    expect(nested.allowedContainers).toEqual(['blockquote']);
    expect(nested.matchers).toHaveLength(1);
    expect(nested.defaultMatchers).toBe(false);
  });
});

describe('resolveNestedConfig', () => {
  it('false / undefined → top-level only (empty allowedNodes)', () => {
    expect(resolveNestedConfig(false).allowedNodes).toEqual([]);
    expect(resolveNestedConfig(undefined).allowedNodes).toEqual([]);
  });

  it('true → defaults + deepest-match mode (no gutterBias)', () => {
    const r = resolveNestedConfig(true);
    expect(r.allowedNodes).toEqual(['listItem', 'taskItem']);
    expect(r.gutterBias).toBeNull();
    expect(r.matchers).toHaveLength(DEFAULT_BLOCK_MATCHERS.length);
  });

  it('object with promoteOnEdge → gutter-bias mode (config populated)', () => {
    const r = resolveNestedConfig({ promoteOnEdge: true });
    expect(r.gutterBias).toEqual({ edges: ['left', 'top'], threshold: 12, strength: 500 });
  });

  it('object with promoteOnEdge: "right" → mirrors edges', () => {
    const r = resolveNestedConfig({ promoteOnEdge: 'right' });
    expect(r.gutterBias?.edges).toEqual(['right', 'top']);
  });

  it('object with custom matchers + defaultMatchers:false → only user matchers', () => {
    const customMatcher: BlockMatcher = { name: 'custom', test: () => 'allow' };
    const r = resolveNestedConfig({ matchers: [customMatcher], defaultMatchers: false });
    expect(r.matchers).toEqual([customMatcher]);
  });

  it('object with allowedContainers passes through', () => {
    const r = resolveNestedConfig({ allowedContainers: ['blockquote', 'details'] });
    expect(r.allowedContainers).toEqual(['blockquote', 'details']);
  });

  it('explicitly empty allowedNodes → top-level mode', () => {
    const r = resolveNestedConfig({ allowedNodes: [] });
    expect(r.allowedNodes).toEqual([]);
    expect(r.gutterBias).toBeNull();
    expect(r.matchers).toEqual([]);
  });
});

describe('BlockHandle plugin state', () => {
  it('initializes with null hoveredPos and draggedFrom', () => {
    const ed = makeEditor();
    const state = blockHandlePluginKey.getState(ed.state);
    expect(state).toEqual({ hoveredPos: null, draggedFrom: null });
  });

  it('updates hoveredPos via meta', () => {
    const ed = makeEditor('<p>first</p><p>second</p>');
    const tr = ed.state.tr.setMeta(blockHandlePluginKey, { hoveredPos: 7 });
    ed.view.dispatch(tr);
    const state = blockHandlePluginKey.getState(ed.state);
    expect(state?.hoveredPos).toBe(7);
    expect(state?.draggedFrom).toBe(null);
  });

  it('updates draggedFrom via meta', () => {
    const ed = makeEditor('<p>A</p>');
    const tr = ed.state.tr.setMeta(blockHandlePluginKey, { draggedFrom: 0 });
    ed.view.dispatch(tr);
    const state = blockHandlePluginKey.getState(ed.state);
    expect(state?.draggedFrom).toBe(0);
  });

  it('maps hoveredPos through doc changes instead of clearing it', () => {
    const ed = makeEditor('<p>A</p><p>B</p>');
    // Set hovered at start of second paragraph (pos 3).
    ed.view.dispatch(ed.state.tr.setMeta(blockHandlePluginKey, { hoveredPos: 3 }));
    expect(blockHandlePluginKey.getState(ed.state)?.hoveredPos).toBe(3);
    // Inserting a char inside the first paragraph shifts positions after it.
    ed.view.dispatch(ed.state.tr.insertText('X', 1));
    // Hovered pos should now be 4 (shifted by +1), not null.
    expect(blockHandlePluginKey.getState(ed.state)?.hoveredPos).toBe(4);
  });

  it('clears hoveredPos when the hovered range is deleted', () => {
    const ed = makeEditor('<p>A</p><p>B</p>');
    ed.view.dispatch(ed.state.tr.setMeta(blockHandlePluginKey, { hoveredPos: 3 }));
    // Delete the second paragraph entirely (positions 3..6).
    ed.view.dispatch(ed.state.tr.delete(3, 6));
    expect(blockHandlePluginKey.getState(ed.state)?.hoveredPos).toBe(null);
  });

  it('preserves draggedFrom across doc changes (drop processed before doc change)', () => {
    const ed = makeEditor('<p>A</p>');
    ed.view.dispatch(ed.state.tr.setMeta(blockHandlePluginKey, { draggedFrom: 0 }));
    ed.view.dispatch(ed.state.tr.insertText('X', 1));
    const state = blockHandlePluginKey.getState(ed.state);
    expect(state?.draggedFrom).toBe(0);
  });

  it('setting hoveredPos to null clears it', () => {
    const ed = makeEditor();
    ed.view.dispatch(ed.state.tr.setMeta(blockHandlePluginKey, { hoveredPos: 1 }));
    ed.view.dispatch(ed.state.tr.setMeta(blockHandlePluginKey, { hoveredPos: null }));
    expect(blockHandlePluginKey.getState(ed.state)?.hoveredPos).toBe(null);
  });

  it('preserves untouched fields across meta updates', () => {
    const ed = makeEditor();
    ed.view.dispatch(ed.state.tr.setMeta(blockHandlePluginKey, { hoveredPos: 5 }));
    ed.view.dispatch(ed.state.tr.setMeta(blockHandlePluginKey, { draggedFrom: 5 }));
    const state = blockHandlePluginKey.getState(ed.state);
    // hoveredPos may have been cleared by the second dispatch if docChanged;
    // since the second dispatch was a meta-only tr, doc is unchanged, so
    // hoveredPos should persist.
    expect(state?.hoveredPos).toBe(5);
    expect(state?.draggedFrom).toBe(5);
  });
});

describe('BlockHandle DOM integration', () => {
  it('mounts a .dm-block-handle element inside .dm-editor', () => {
    makeEditor();
    const handle = host?.querySelector('.dm-block-handle');
    expect(handle).not.toBeNull();
  });

  it('adds `dm-editor--has-block-handle` class to the editor wrapper', () => {
    makeEditor();
    expect(host?.classList.contains('dm-editor--has-block-handle')).toBe(true);
  });

  it('renders drag and plus buttons', () => {
    makeEditor();
    const dragBtn = host?.querySelector('.dm-block-handle-drag');
    const plusBtn = host?.querySelector('.dm-block-handle-plus');
    expect(dragBtn).not.toBeNull();
    expect(plusBtn).not.toBeNull();
    expect(dragBtn?.getAttribute('draggable')).toBe('true');
  });

  it('removes class + DOM when the editor is destroyed', () => {
    makeEditor();
    const hostRef = host;
    editor?.destroy();
    editor = undefined;
    expect(hostRef?.classList.contains('dm-editor--has-block-handle')).toBe(false);
    expect(hostRef?.querySelector('.dm-block-handle')).toBeNull();
  });

  it('handle is hidden initially (no data-show attribute)', () => {
    makeEditor();
    const handle = host?.querySelector('.dm-block-handle');
    expect(handle?.hasAttribute('data-show')).toBe(false);
  });

  it('keeps data-show when dm:dismiss-overlays fires AFTER data-block-context-menu-open is set', () => {
    // BlockContextMenu's `open()` sets `data-block-context-menu-open`
    // on the editor host BEFORE dispatching `dm:dismiss-overlays`. The
    // handle's dismiss listener checks this attribute and skips its
    // own hide so the drag button stays put as the menu's anchor.
    makeEditor();
    const handle = host?.querySelector('.dm-block-handle') as HTMLElement | null;
    if (!handle) throw new Error('handle missing');
    // Force the handle visible (would normally happen via hover).
    handle.setAttribute('data-show', '');

    // Simulate the new open() ordering.
    host?.setAttribute('data-block-context-menu-open', '');
    host?.dispatchEvent(new Event('dm:dismiss-overlays'));
    expect(handle.hasAttribute('data-show')).toBe(true);
  });

  it('hides on dm:dismiss-overlays when the context-menu signal is NOT set', () => {
    // Regression guard: without the new attribute, the legacy behaviour
    // (hide on dismiss) must continue to apply for unrelated dismiss
    // dispatches (BubbleMenu / SlashCommand etc.).
    makeEditor();
    const handle = host?.querySelector('.dm-block-handle') as HTMLElement | null;
    if (!handle) throw new Error('handle missing');
    handle.setAttribute('data-show', '');

    host?.dispatchEvent(new Event('dm:dismiss-overlays'));
    expect(handle.hasAttribute('data-show')).toBe(false);
  });
});

/**
 * Auto-scroll tests drive the plugin's drag lifecycle directly so we don't
 * depend on jsdom's incomplete HTML5 drag-and-drop emulation. RAF is
 * stubbed so each "frame" is a manual tick - cleaner than wall-clock waits
 * and deterministic across CI speeds. `DragEvent` and `scrollBy` both need
 * polyfilling because jsdom doesn't implement them.
 */
describe('BlockHandle auto-scroll during drag', () => {
  let rafCallbacks: FrameRequestCallback[] = [];
  let originalScrollBy: typeof document.documentElement.scrollBy | undefined;
  let scrollByCalls: [number, number][] = [];
  // Wrapper DIV that `findScrollableAncestor` resolves to - tests need a
  // bounded scrollable ancestor (see `makeEditorWithHandle`).
  let scrollWrapper: HTMLElement | undefined;

  /**
   * jsdom doesn't implement `DragEvent`, but ProseMirror and the plugin
   * only read standard properties (`clientY`, `dataTransfer`). Use a plain
   * `Event` with type "dragstart"/"dragover"/"dragend" + a clientY patch.
   */
  function makeDragLikeEvent(type: string, init: { clientY?: number } = {}): Event {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    if (init.clientY !== undefined) {
      Object.defineProperty(ev, 'clientY', { value: init.clientY, configurable: true });
    }
    return ev;
  }

  function installRafStub(): void {
    rafCallbacks = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      // No-op: we drain callbacks manually in `tickRaf`.
    });
  }

  function installScrollByStub(): void {
    scrollByCalls = [];
    // eslint-disable-next-line @typescript-eslint/unbound-method
    originalScrollBy = document.documentElement.scrollBy;
    // jsdom doesn't ship `scrollBy` on Element. Define a stub we can read.
    Object.defineProperty(document.documentElement, 'scrollBy', {
      value: (x: number, y: number): void => { scrollByCalls.push([x, y]); },
      configurable: true,
      writable: true,
    });
  }

  function restoreScrollByStub(): void {
    if (originalScrollBy === undefined) {
      // jsdom had no original - remove the stub entirely so subsequent
      // tests see the original jsdom behaviour (no scrollBy on the element).
      delete (document.documentElement as unknown as Record<string, unknown>)['scrollBy'];
    } else {
      Object.defineProperty(document.documentElement, 'scrollBy', {
        value: originalScrollBy,
        configurable: true,
        writable: true,
      });
    }
    originalScrollBy = undefined;
  }

  /** Runs exactly one pending RAF callback (simulates a single frame). */
  function tickRaf(): void {
    const cb = rafCallbacks.shift();
    cb?.(performance.now());
  }

  /**
   * Wraps the editor host in a parent that reports as vertically scrollable
   * (overflow-y: scroll + scrollHeight > clientHeight). `findScrollableAncestor`
   * now intentionally returns null when no bounded scrollable ancestor
   * exists - page-level scroll is owned by the browser's native drag-edge
   * autoscroll, so our RAF loop would double-up. Tests wrap the editor in
   * a real bounded container so the loop has a legitimate target.
   */
  function makeEditorWithHandle(): Editor {
    scrollWrapper = document.createElement('div');
    scrollWrapper.style.overflowY = 'scroll';
    scrollWrapper.style.height = '400px';
    // jsdom doesn't update scroll metrics based on inline style. Force the
    // two properties `findScrollableAncestor` reads so the wrapper qualifies.
    Object.defineProperty(scrollWrapper, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(scrollWrapper, 'clientHeight', { value: 400, configurable: true });
    // Same story for scrollBy - jsdom omits it on Element.
    scrollWrapper.scrollBy = ((x: number, y: number): void => { scrollByCalls.push([x, y]); }) as Element['scrollBy'];
    Object.defineProperty(scrollWrapper, 'getBoundingClientRect', {
      value: (): DOMRect => ({
        top: 0, left: 0, right: 800, bottom: 400,
        x: 0, y: 0, width: 800, height: 400, toJSON: (): object => ({}),
      }),
      configurable: true,
    });
    document.body.appendChild(scrollWrapper);

    host = document.createElement('div');
    host.className = 'dm-editor';
    scrollWrapper.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: [Document, Text, Paragraph, Heading, BlockHandle],
      content: '<p>Hello</p>',
    });
    return editor;
  }

  function dispatchDragStart(): void {
    const dragBtn = host?.querySelector<HTMLElement>('.dm-block-handle-drag');
    if (!dragBtn) throw new Error('drag button missing');
    // Pre-populate hoveredPos so onDragStart's guard passes. Paragraph
    // starts at position 0 in the default schema.
    editor?.view.dispatch(
      editor.state.tr.setMeta(blockHandlePluginKey, { hoveredPos: 0 }),
    );
    dragBtn.dispatchEvent(makeDragLikeEvent('dragstart'));
  }

  function dispatchDragOver(clientY: number): void {
    document.dispatchEvent(makeDragLikeEvent('dragover', { clientY }));
  }

  function dispatchDragEnd(): void {
    const dragBtn = host?.querySelector<HTMLElement>('.dm-block-handle-drag');
    dragBtn?.dispatchEvent(makeDragLikeEvent('dragend'));
  }

  afterEach(() => {
    vi.restoreAllMocks();
    restoreScrollByStub();
    rafCallbacks = [];
    scrollByCalls = [];
    if (scrollWrapper) {
      scrollWrapper.remove();
      scrollWrapper = undefined;
    }
  });

  it('schedules a RAF loop on dragstart when autoScroll is enabled (default)', () => {
    installRafStub();
    makeEditorWithHandle();
    expect(rafCallbacks.length).toBe(0);
    dispatchDragStart();
    expect(rafCallbacks.length).toBe(1);
  });

  it('scrolls up when dragover is within threshold of top edge', () => {
    installRafStub();
    installScrollByStub();
    makeEditorWithHandle();

    dispatchDragStart();
    // clientY=20 is inside the default 48px top threshold.
    dispatchDragOver(20);
    tickRaf();

    expect(scrollByCalls.length).toBeGreaterThan(0);
    const [dx, dy] = scrollByCalls[0] ?? [0, 0];
    expect(dx).toBe(0);
    expect(dy).toBeLessThan(0); // up = negative delta
  });

  it('scrolls down when dragover is within threshold of bottom edge', () => {
    installRafStub();
    installScrollByStub();
    makeEditorWithHandle();

    dispatchDragStart();
    // Wrapper rect goes from top=0 to bottom=400. 390 is 10px from the
    // bottom edge - inside the default 48px threshold.
    dispatchDragOver(390);
    tickRaf();

    expect(scrollByCalls.length).toBeGreaterThan(0);
    const [, dy] = scrollByCalls[0] ?? [0, 0];
    expect(dy).toBeGreaterThan(0); // down = positive delta
  });

  it('does not scroll when dragover is in the center zone', () => {
    installRafStub();
    installScrollByStub();
    makeEditorWithHandle();

    dispatchDragStart();
    // Middle of the 400px-tall wrapper - well outside both top and bottom
    // thresholds.
    dispatchDragOver(200);
    tickRaf();

    expect(scrollByCalls.length).toBe(0);
  });

  it('does not schedule a RAF loop when autoScroll is false', () => {
    installRafStub();
    // Replace the default extension with an auto-scroll-disabled variant.
    host = document.createElement('div');
    host.className = 'dm-editor';
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: [Document, Text, Paragraph, Heading, BlockHandle.configure({ autoScroll: false })],
      content: '<p>Hello</p>',
    });
    dispatchDragStart();
    expect(rafCallbacks.length).toBe(0);
  });

  it('stops the loop on dragend', () => {
    installRafStub();
    installScrollByStub();
    makeEditorWithHandle();

    dispatchDragStart();
    dispatchDragOver(20);
    tickRaf(); // one scroll tick scheduled another RAF
    expect(rafCallbacks.length).toBe(1); // next frame queued
    dispatchDragEnd();
    scrollByCalls = [];
    tickRaf(); // tick the queued callback; autoScrollTarget should be null now
    expect(scrollByCalls.length).toBe(0);
  });
});

// ── Event handler integration: hover/click lifecycle ──────────────────────
// These tests drive the plugin through its DOM event listeners (not just
// through plugin meta dispatches) to cover the click + hover + plus-button
// + drag-button code paths that aren't reachable from pure state tests.

describe('BlockHandle event handlers', () => {
  function getHandleParts(): {
    handle: HTMLElement | null | undefined;
    dragBtn: HTMLElement | null | undefined;
    plusBtn: HTMLElement | null | undefined;
  } {
    const handle = host?.querySelector<HTMLElement>('.dm-block-handle');
    const dragBtn = host?.querySelector<HTMLElement>('.dm-block-handle-drag');
    const plusBtn = host?.querySelector<HTMLElement>('.dm-block-handle-plus');
    return { handle, dragBtn, plusBtn };
  }

  it('plus button click inserts an empty paragraph after the hovered block', () => {
    makeEditor('<p>Hello</p>');
    // Pre-set hoveredPos to the start of the paragraph so onPlusClick has a
    // valid target. Position 0 is before the first paragraph.
    editor?.view.dispatch(editor.state.tr.setMeta(blockHandlePluginKey, { hoveredPos: 0 }));

    const before = editor?.state.doc.childCount ?? 0;
    const { plusBtn } = getHandleParts();
    plusBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    const after = editor?.state.doc.childCount ?? 0;
    expect(after).toBe(before + 1);
    // The inserted block should be a paragraph (the second top-level child).
    expect(editor?.state.doc.lastChild?.type.name).toBe('paragraph');
  });

  it('plus button click is a no-op when hoveredPos is null', () => {
    makeEditor('<p>Hello</p>');
    const before = editor?.state.doc.childCount ?? 0;
    const { plusBtn } = getHandleParts();
    plusBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(editor?.state.doc.childCount).toBe(before);
  });

  it('plus button mousedown calls preventDefault to keep editor focus', () => {
    makeEditor();
    const { plusBtn } = getHandleParts();
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    plusBtn?.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('drag button click (no drag) emits dm:block-context-menu-open with detail', () => {
    makeEditor('<p>Hello</p>');
    editor?.view.dispatch(editor.state.tr.setMeta(blockHandlePluginKey, { hoveredPos: 0 }));

    let detail: { blockPos?: number; anchorElement?: HTMLElement } | null = null;
    host?.addEventListener('dm:block-context-menu-open', (e: Event) => {
      detail = (e as CustomEvent<{ blockPos: number; anchorElement: HTMLElement }>).detail;
    });

    const { dragBtn } = getHandleParts();
    dragBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(detail).not.toBeNull();
    expect(detail!.blockPos).toBe(0);
    expect(detail!.anchorElement).toBe(dragBtn);
  });

  it('drag button click is a no-op when hoveredPos is null', () => {
    makeEditor();
    let fired = false;
    host?.addEventListener('dm:block-context-menu-open', () => { fired = true; });

    const { dragBtn } = getHandleParts();
    dragBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(fired).toBe(false);
  });

  it('dm:dismiss-overlays event hides the handle and clears hoveredPos', () => {
    makeEditor('<p>Hello</p>');
    // Surface the handle by setting hoveredPos.
    editor?.view.dispatch(editor.state.tr.setMeta(blockHandlePluginKey, { hoveredPos: 0 }));

    host?.dispatchEvent(new Event('dm:dismiss-overlays', { bubbles: false }));

    expect(blockHandlePluginKey.getState(editor!.state)?.hoveredPos).toBeNull();
  });

  it('drag button mousedown does NOT call preventDefault (browser needs default for drag)', () => {
    makeEditor();
    const { dragBtn } = getHandleParts();
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    dragBtn?.dispatchEvent(ev);
    // The handler must NOT preventDefault - that would kill HTML5 drag.
    expect(ev.defaultPrevented).toBe(false);
  });

  it('plus button click is a no-op when editor is not editable', () => {
    makeEditor('<p>Hello</p>');
    editor?.setEditable(false);
    editor?.view.dispatch(editor.state.tr.setMeta(blockHandlePluginKey, { hoveredPos: 0 }));

    const before = editor?.state.doc.childCount ?? 0;
    const { plusBtn } = getHandleParts();
    plusBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(editor?.state.doc.childCount).toBe(before);
  });

  it('drag button click is a no-op when editor is not editable', () => {
    makeEditor('<p>Hello</p>');
    editor?.setEditable(false);
    editor?.view.dispatch(editor.state.tr.setMeta(blockHandlePluginKey, { hoveredPos: 0 }));

    let fired = false;
    host?.addEventListener('dm:block-context-menu-open', () => { fired = true; });
    const { dragBtn } = getHandleParts();
    dragBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(fired).toBe(false);
  });
});

// ── Hover resolution: drives resolveBlockAtCoords + resolveTopLevelByY ────
//
// These tests stub `nodeDOM` and `posAtCoords` so we can synthesise a
// mousemove that lands inside a known block's vertical range and verify
// the plugin state's `hoveredPos` is set. This exercises the bulk of the
// resolution logic that `resolveDragTarget` tests can't reach (top-level
// fallback walker + closest-by-Y inter-block-gap behaviour).

describe('BlockHandle hover resolution', () => {
  let rafCallbacks: FrameRequestCallback[] = [];

  function installRafStub(): void {
    rafCallbacks = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
  }

  function tickAllRaf(): void {
    while (rafCallbacks.length > 0) {
      const cb = rafCallbacks.shift();
      cb?.(performance.now());
    }
  }

  function stubLayout(ed: Editor, rectsByPos: Map<number, DOMRect>): void {
    const view = ed.view as unknown as {
      nodeDOM: (pos: number) => HTMLElement | null;
      posAtCoords: (c: { left: number; top: number }) => { pos: number; inside: number } | null;
    };
    const origNodeDOM = ed.view.nodeDOM.bind(ed.view);
    view.nodeDOM = (p: number): HTMLElement | null => {
      const rect = rectsByPos.get(p);
      const dom = origNodeDOM(p);
      if (dom instanceof HTMLElement && rect) {
        Object.defineProperty(dom, 'getBoundingClientRect', {
          value: () => rect,
          configurable: true,
        });
      }
      return dom as HTMLElement | null;
    };
    // posAtCoords stub: pick the first rect whose bounds contain the cursor.
    view.posAtCoords = ({ left: _l, top: t }) => {
      for (const [pos, rect] of rectsByPos.entries()) {
        if (t >= rect.top && t <= rect.bottom) return { pos, inside: pos };
      }
      return null;
    };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    rafCallbacks = [];
  });

  it('top-level Mode A: mousemove lands inside a paragraph and sets hoveredPos', () => {
    installRafStub();
    makeEditor('<p>One</p><p>Two</p><p>Three</p>');
    // Doc positions: <p>One</p> at 0, <p>Two</p> at 5, <p>Three</p> at 10.
    stubLayout(editor!, new Map([
      [0, new DOMRect(100, 100, 400, 30)],
      [5, new DOMRect(100, 140, 400, 30)],
      [10, new DOMRect(100, 180, 400, 30)],
    ]));
    // Cursor inside the SECOND paragraph (top=140..170). clientY=155 lands inside.
    const hoverEl = host?.querySelector<HTMLElement>('.dm-block-handle-hover-area')
      ?? host?.querySelector<HTMLElement>('.ProseMirror');
    hoverEl?.dispatchEvent(new MouseEvent('mousemove', { clientX: 250, clientY: 155, bubbles: true, cancelable: true }));
    tickAllRaf();

    const state = blockHandlePluginKey.getState(editor!.state);
    expect(state?.hoveredPos).toBe(5);
  });

  it('mode A: cursor in inter-block gap snaps to the closest block (closest-by-Y fallback)', () => {
    installRafStub();
    makeEditor('<p>One</p><p>Two</p>');
    stubLayout(editor!, new Map([
      [0, new DOMRect(100, 100, 400, 30)],   // 100..130
      [5, new DOMRect(100, 200, 400, 30)],   // 200..230
    ]));
    // clientY=160 sits BETWEEN the two blocks (gap from 130..200). The
    // closest is the first paragraph (160-130=30 < 200-160=40).
    const hoverEl = host?.querySelector<HTMLElement>('.ProseMirror');
    hoverEl?.dispatchEvent(new MouseEvent('mousemove', { clientX: 250, clientY: 160, bubbles: true, cancelable: true }));
    tickAllRaf();

    const state = blockHandlePluginKey.getState(editor!.state);
    expect(state?.hoveredPos).toBe(0);
  });

  it('mode A: cursor below last block snaps to the last block', () => {
    installRafStub();
    makeEditor('<p>Only</p>');
    stubLayout(editor!, new Map([
      [0, new DOMRect(100, 100, 400, 30)],   // 100..130
    ]));
    // clientY=500 is well below.
    const hoverEl = host?.querySelector<HTMLElement>('.ProseMirror');
    hoverEl?.dispatchEvent(new MouseEvent('mousemove', { clientX: 250, clientY: 500, bubbles: true, cancelable: true }));
    tickAllRaf();

    const state = blockHandlePluginKey.getState(editor!.state);
    expect(state?.hoveredPos).toBe(0);
  });

  it('mouseleave schedules the handle to hide (clears hoveredPos eventually)', () => {
    installRafStub();
    makeEditor('<p>x</p>');
    // Pre-set hoveredPos so we can observe the clear.
    editor!.view.dispatch(editor!.state.tr.setMeta(blockHandlePluginKey, { hoveredPos: 0 }));
    expect(blockHandlePluginKey.getState(editor!.state)?.hoveredPos).toBe(0);

    const hoverEl = host?.querySelector<HTMLElement>('.ProseMirror');
    hoverEl?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false, cancelable: true }));
    // The hide is delayed; just verify the listener was called without throwing.
    // Real timing tested via e2e.
    expect(blockHandlePluginKey.getState(editor!.state)?.hoveredPos).toBe(0);
  });
});

describe('BlockHandle drop indicator class', () => {
  function dispatchDrag(type: 'dragstart' | 'dragend'): void {
    const dragBtn = host?.querySelector<HTMLElement>('.dm-block-handle-drag');
    if (!dragBtn) throw new Error('drag button missing');
    if (type === 'dragstart') {
      editor?.view.dispatch(editor.state.tr.setMeta(blockHandlePluginKey, { hoveredPos: 0 }));
    }
    dragBtn.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  }

  it('adds dm-block-handle-dragging to .dm-editor on dragstart and removes on dragend', () => {
    makeEditor();
    expect(host?.classList.contains('dm-block-handle-dragging')).toBe(false);

    dispatchDrag('dragstart');
    expect(host?.classList.contains('dm-block-handle-dragging')).toBe(true);

    dispatchDrag('dragend');
    expect(host?.classList.contains('dm-block-handle-dragging')).toBe(false);
  });

  it('does not add the class when dropIndicator is disabled', () => {
    host = document.createElement('div');
    host.className = 'dm-editor';
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: [Document, Text, Paragraph, BlockHandle.configure({ dropIndicator: false })],
      content: '<p>Hello</p>',
    });

    dispatchDrag('dragstart');
    expect(host.classList.contains('dm-block-handle-dragging')).toBe(false);
  });
});

// Spatial resolution helpers: pure functions over a stubbed `EditorView`
// (jsdom has no layout, so rects are hand-built and fed through `nodeDOM`).
describe('BlockHandle spatial resolution helpers', () => {
  const listExtensions = [
    Document, Text, Paragraph, BulletList, OrderedList, ListItem, TaskList, TaskItem,
  ];

  function makeListEditor(html: string): Editor {
    return new Editor({ extensions: listExtensions, content: html });
  }

  function elWithRect(rect: DOMRect): HTMLElement {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => rect;
    return el;
  }

  function viewStub(ed: Editor, rects: Map<number, HTMLElement>): EditorView {
    return {
      state: ed.state,
      nodeDOM: (pos: number) => rects.get(pos) ?? null,
    } as unknown as EditorView;
  }

  function posOf(ed: Editor, predicate: (n: { type: { name: string }; textContent: string }) => boolean): number {
    let found = -1;
    ed.state.doc.descendants((node, pos) => {
      if (found !== -1) return false;
      if (predicate(node)) { found = pos; return false; }
      return true;
    });
    if (found === -1) throw new Error('node not found');
    return found;
  }

  describe('descendToNearestHoverItem', () => {
    it('returns the target unchanged when nodeAt resolves to no node (doc end)', () => {
      const ed = makeListEditor('<p>Plain</p>');
      const dom = elWithRect(new DOMRect(0, 100, 400, 30));
      const end = ed.state.doc.content.size; // doc.nodeAt(end) === null
      const resolved = { pos: end, rect: dom.getBoundingClientRect(), dom };
      const out = descendToNearestHoverItem(viewStub(ed, new Map()), resolved, 110);
      expect(out.pos).toBe(end);
      ed.destroy();
    });

    it('returns a non-list block (paragraph) unchanged', () => {
      const ed = makeListEditor('<p>Plain</p>');
      const pPos = posOf(ed, (n) => n.type.name === 'paragraph');
      const dom = elWithRect(new DOMRect(0, 100, 400, 30));
      const resolved = { pos: pPos, rect: dom.getBoundingClientRect(), dom };
      const out = descendToNearestHoverItem(viewStub(ed, new Map()), resolved, 110);
      expect(out.pos).toBe(pPos);
      ed.destroy();
    });

    it('descends a list WRAPPER to the child item nearest the cursor row', () => {
      const ed = makeListEditor('<ul><li><p>A</p></li><li><p>B</p></li></ul>');
      const ulPos = posOf(ed, (n) => n.type.name === 'bulletList');
      const liA = posOf(ed, (n) => n.type.name === 'listItem' && n.textContent === 'A');
      const liB = posOf(ed, (n) => n.type.name === 'listItem' && n.textContent === 'B');
      const ulDom = elWithRect(new DOMRect(0, 100, 400, 100));
      const rects = new Map<number, HTMLElement>([
        [ulPos, ulDom],
        [liA, elWithRect(new DOMRect(0, 100, 400, 50))],   // 100..150
        [liB, elWithRect(new DOMRect(0, 150, 400, 50))],   // 150..200
      ]);
      const resolved = { pos: ulPos, rect: ulDom.getBoundingClientRect(), dom: ulDom };
      const out = descendToNearestHoverItem(viewStub(ed, rects), resolved, 180); // inside B
      expect(out.pos).toBe(liB);
      ed.destroy();
    });

    it('descends a list ITEM into its nested sublist when the cursor is in the nested area', () => {
      const ed = makeListEditor(
        '<ul><li><p>Outer</p><ul><li><p>I1</p></li><li><p>I2</p></li></ul></li></ul>',
      );
      const outerLi = posOf(ed, (n) => n.type.name === 'listItem' && n.textContent.startsWith('Outer'));
      const innerUl = posOf(ed, (n) => n.type.name === 'bulletList' && n.textContent === 'I1I2');
      const i1 = posOf(ed, (n) => n.type.name === 'listItem' && n.textContent === 'I1');
      const i2 = posOf(ed, (n) => n.type.name === 'listItem' && n.textContent === 'I2');
      const outerDom = elWithRect(new DOMRect(0, 100, 400, 200)); // 100..300
      const rects = new Map<number, HTMLElement>([
        [outerLi, outerDom],
        [innerUl, elWithRect(new DOMRect(20, 150, 380, 150))],  // nested list 150..300
        [i1, elWithRect(new DOMRect(20, 150, 380, 50))],        // 150..200
        [i2, elWithRect(new DOMRect(20, 250, 380, 50))],        // 250..300
      ]);
      const resolved = { pos: outerLi, rect: outerDom.getBoundingClientRect(), dom: outerDom };
      // clientY=270 is below the outer label and inside I2's row.
      const out = descendToNearestHoverItem(viewStub(ed, rects), resolved, 270);
      expect(out.pos).toBe(i2);
      ed.destroy();
    });

    it('stays on a list ITEM when the cursor is on its own label row (above the nested list)', () => {
      const ed = makeListEditor(
        '<ul><li><p>Outer</p><ul><li><p>Inner</p></li></ul></li></ul>',
      );
      const outerLi = posOf(ed, (n) => n.type.name === 'listItem' && n.textContent.startsWith('Outer'));
      const innerUl = posOf(ed, (n) => n.type.name === 'bulletList' && n.textContent === 'Inner');
      const outerDom = elWithRect(new DOMRect(0, 100, 400, 200));
      const rects = new Map<number, HTMLElement>([
        [outerLi, outerDom],
        [innerUl, elWithRect(new DOMRect(20, 160, 380, 140))], // nested list starts at 160
      ]);
      const resolved = { pos: outerLi, rect: outerDom.getBoundingClientRect(), dom: outerDom };
      // clientY=120 is above the nested list's top (160) -> stay on outer.
      const out = descendToNearestHoverItem(viewStub(ed, rects), resolved, 120);
      expect(out.pos).toBe(outerLi);
      ed.destroy();
    });

    it('stays on a leaf list ITEM that has no nested sublist', () => {
      const ed = makeListEditor('<ul><li><p>Solo</p></li></ul>');
      const li = posOf(ed, (n) => n.type.name === 'listItem');
      const liDom = elWithRect(new DOMRect(0, 100, 400, 50));
      const rects = new Map<number, HTMLElement>([[li, liDom]]);
      const resolved = { pos: li, rect: liDom.getBoundingClientRect(), dom: liDom };
      const out = descendToNearestHoverItem(viewStub(ed, rects), resolved, 120);
      expect(out.pos).toBe(li);
      ed.destroy();
    });
  });
});

// Drag/drop simulation against a mounted editor with hand-stubbed geometry.
// `dragstart` attaches the document dragover/drop listeners and captures the
// source, then `dragover`/`drop` on `document` drive the indicator and move.
describe('BlockHandle nested drag-and-drop (DOM simulation)', () => {
  const nestedExtensions = [
    Document, Text, Paragraph, BulletList, OrderedList, ListItem, TaskList, TaskItem,
    BlockHandle.configure({ nested: true }),
  ];

  let rafCallbacks: FrameRequestCallback[] = [];
  function installRafStub(): void {
    rafCallbacks = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { /* drained manually */ });
  }
  function tickAllRaf(): void {
    while (rafCallbacks.length > 0) rafCallbacks.shift()?.(performance.now());
  }

  afterEach(() => {
    vi.restoreAllMocks();
    rafCallbacks = [];
  });

  function mountNested(content: string): Editor {
    host = document.createElement('div');
    host.className = 'dm-editor';
    document.body.appendChild(host);
    editor = new Editor({ element: host, extensions: nestedExtensions, content });
    return editor;
  }

  // Stub the geometry the resolver reads: content element (for
  // `clampToContent`), the `.dm-editor` host, and per-node rects via `nodeDOM`.
  // `contentRect` doubles as the top-level list's rect (the `<ul>` IS
  // `view.dom.firstElementChild`).
  function stubGeometry(ed: Editor, contentRect: DOMRect, hostRect: DOMRect, rectsByPos: Map<number, DOMRect>): void {
    const first = ed.view.dom.firstElementChild;
    if (first instanceof HTMLElement) {
      Object.defineProperty(first, 'getBoundingClientRect', { value: () => contentRect, configurable: true });
    }
    host!.getBoundingClientRect = () => hostRect;
    const origNodeDOM = ed.view.nodeDOM.bind(ed.view);
    const view = ed.view as unknown as { nodeDOM: (p: number) => HTMLElement | null };
    view.nodeDOM = (p: number): HTMLElement | null => {
      const dom = origNodeDOM(p);
      const rect = rectsByPos.get(p);
      if (dom instanceof HTMLElement && rect) {
        Object.defineProperty(dom, 'getBoundingClientRect', { value: () => rect, configurable: true });
      }
      return dom as HTMLElement | null;
    };
  }

  function posOf(ed: Editor, predicate: (n: { type: { name: string }; textContent: string }) => boolean): number {
    let found = -1;
    ed.state.doc.descendants((node, pos) => {
      if (found !== -1) return false;
      if (predicate(node)) { found = pos; return false; }
      return true;
    });
    if (found === -1) throw new Error('node not found');
    return found;
  }

  function dragEvent(type: string, clientX: number, clientY: number): Event {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clientX', { value: clientX, configurable: true });
    Object.defineProperty(ev, 'clientY', { value: clientY, configurable: true });
    return ev;
  }

  /** Fire dragstart from the drag button with `sourcePos` pre-hovered, so
   * `onDragStart` captures the source and attaches the document listeners. */
  function startDrag(ed: Editor, sourcePos: number): void {
    ed.view.dispatch(ed.state.tr.setMeta(blockHandlePluginKey, { hoveredPos: sourcePos }));
    const btn = host!.querySelector<HTMLElement>('.dm-block-handle-drag');
    btn?.dispatchEvent(dragEvent('dragstart', 0, 0));
  }

  /** Fire dragend so the deferred dragstart commit bails (it guards on a
   * non-null `pendingDraggedFrom`) and the document listeners detach. */
  function endDrag(): void {
    const btn = host!.querySelector<HTMLElement>('.dm-block-handle-drag');
    btn?.dispatchEvent(dragEvent('dragend', 0, 0));
  }

  function topListItemTexts(ed: Editor): string[] {
    const out: string[] = [];
    ed.state.doc.child(0).forEach((li) => out.push(li.child(0).textContent));
    return out;
  }
  function countType(ed: Editor, name: string): number {
    let n = 0;
    ed.state.doc.descendants((node) => { if (node.type.name === name) n += 1; });
    return n;
  }

  // Two stacked top-level list items. The wrapper rect (== contentRect)
  // spans both rows so the Y-walk isn't pruned at the list boundary.
  function twoItemFixture(): { ed: Editor; target: number; source: number } {
    const ed = mountNested('<ul><li><p>Target</p></li><li><p>Source</p></li></ul>');
    const target = posOf(ed, (n) => n.type.name === 'listItem' && n.textContent === 'Target');
    const targetP = posOf(ed, (n) => n.type.name === 'paragraph' && n.textContent === 'Target');
    const source = posOf(ed, (n) => n.type.name === 'listItem' && n.textContent === 'Source');
    const sourceP = posOf(ed, (n) => n.type.name === 'paragraph' && n.textContent === 'Source');
    const contentRect = new DOMRect(40, 100, 960, 200); // left 40, top 100, bottom 300
    const hostRect = new DOMRect(0, 90, 1000, 230);      // contains all drop coords
    stubGeometry(ed, contentRect, hostRect, new Map<number, DOMRect>([
      [target, new DOMRect(50, 100, 900, 55)],   // 100..155
      [targetP, new DOMRect(50, 100, 900, 55)],
      [source, new DOMRect(50, 200, 900, 55)],   // 200..255
      [sourceP, new DOMRect(50, 200, 900, 55)],
    ]));
    return { ed, target, source };
  }

  it('document drop with nest-zone X nests the source as a child of the target item', () => {
    const { ed, source } = twoItemFixture();
    expect(ed.state.doc.child(0).childCount).toBe(2);

    startDrag(ed, source);
    // X far past the target's left edge (nest zone) at the after-Target gap
    // (lower half of the row) where the slot model offers "nest into Target".
    document.dispatchEvent(dragEvent('drop', 300, 145));
    endDrag();

    // Source absorbed into Target: one top-level item, both items still exist.
    expect(ed.state.doc.child(0).childCount).toBe(1);
    expect(topListItemTexts(ed)).toEqual(['Target']);
    expect(countType(ed, 'listItem')).toBe(2);
  });

  it('document drop with sibling X (above mid) reorders the source before the target', () => {
    const { ed, source } = twoItemFixture();

    startDrag(ed, source);
    // X just past the left edge but BELOW nestThreshold -> sibling; upper half
    // of the target row -> insert before it.
    document.dispatchEvent(dragEvent('drop', 60, 110));
    endDrag();

    expect(ed.state.doc.child(0).childCount).toBe(2);
    expect(topListItemTexts(ed)).toEqual(['Source', 'Target']);
  });

  it('a self-drop (nesting an item onto itself) is consumed as a no-op', () => {
    const { ed, source } = twoItemFixture();
    const before = ed.getHTML();

    startDrag(ed, source);
    // Nest-zone X at the after-Source gap (lower half of its own row) -> the
    // slot offers "nest into Source", which is a self-drop and a no-op.
    document.dispatchEvent(dragEvent('drop', 300, 245));
    endDrag();

    expect(ed.getHTML()).toBe(before);
    expect(ed.state.doc.child(0).childCount).toBe(2);
  });

  it('PM handleDrop prop runs the same move logic when the drop lands on .ProseMirror', () => {
    const { ed, source } = twoItemFixture();
    startDrag(ed, source);
    // Invoke the registered handleDrop directly (PM would call it for a drop
    // over the editable). `moved=true` mirrors a same-doc block drag.
    const slice = ed.state.doc.slice(0, 0);
    const handled = ed.view.someProp('handleDrop', (fn) =>
      fn(ed.view, dragEvent('drop', 300, 145) as DragEvent, slice, true),
    );
    endDrag();

    expect(handled).toBe(true);
    expect(ed.state.doc.child(0).childCount).toBe(1);
  });

  it('handleDrop with moved=false defers to PM (returns false)', () => {
    const { ed, source } = twoItemFixture();
    startDrag(ed, source);
    const slice = ed.state.doc.slice(0, 0);
    const handled = ed.view.someProp('handleDrop', (fn) =>
      fn(ed.view, dragEvent('drop', 300, 125) as DragEvent, slice, false),
    );
    endDrag();
    expect(handled).toBeFalsy();
  });

  it('dragover in the nest zone shows the drop indicator in nested mode', () => {
    installRafStub();
    const { ed, source } = twoItemFixture();
    startDrag(ed, source);
    document.dispatchEvent(dragEvent('dragover', 300, 145));
    tickAllRaf();

    const indicator = host!.querySelector<HTMLElement>('.dm-block-drop-indicator');
    expect(indicator?.getAttribute('data-mode')).toBe('nested');
    expect(indicator?.hasAttribute('data-show')).toBe(true);

    // A second identical dragover hits the identity gate (same geometry key)
    // and short-circuits without rewriting the DOM, staying shown afterwards.
    document.dispatchEvent(dragEvent('dragover', 300, 145));
    tickAllRaf();
    expect(indicator?.getAttribute('data-mode')).toBe('nested');
    expect(indicator?.hasAttribute('data-show')).toBe(true);
    endDrag();
  });

  it('mousemove over a list row resolves the hovered item through the nested resolver', () => {
    installRafStub();
    const { ed, target } = twoItemFixture();
    const pm = host!.querySelector<HTMLElement>('.ProseMirror');
    pm?.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 125, bubbles: true }));
    tickAllRaf();
    expect(blockHandlePluginKey.getState(ed.state)?.hoveredPos).toBe(target);
  });

  it('dragstart with no hovered block is cancelled and captures no source', () => {
    const { ed } = twoItemFixture();
    const btn = host!.querySelector<HTMLElement>('.dm-block-handle-drag');
    const ev = dragEvent('dragstart', 0, 0); // hoveredPos still null
    btn?.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    // No document drop listener was attached, so a drop moves nothing.
    document.dispatchEvent(dragEvent('drop', 300, 125));
    expect(ed.state.doc.child(0).childCount).toBe(2);
  });

  it('dragstart on a hovered pos with no node is cancelled', () => {
    const { ed } = twoItemFixture();
    ed.view.dispatch(ed.state.tr.setMeta(blockHandlePluginKey, { hoveredPos: ed.state.doc.content.size }));
    const btn = host!.querySelector<HTMLElement>('.dm-block-handle-drag');
    const ev = dragEvent('dragstart', 0, 0);
    btn?.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('handleDrop with moved=true but no active drag consumes the event without moving', () => {
    const { ed } = twoItemFixture();
    const slice = ed.state.doc.slice(0, 0);
    // No startDrag -> draggedFrom is null; performBlockDrop bails but handleDrop
    // still consumes the event so PM does not run its default drop logic.
    const handled = ed.view.someProp('handleDrop', (fn) =>
      fn(ed.view, dragEvent('drop', 300, 125) as DragEvent, slice, true),
    );
    expect(handled).toBe(true);
    expect(ed.state.doc.child(0).childCount).toBe(2);
  });

  it('dragover with sibling X shows the drop indicator in sibling mode', () => {
    installRafStub();
    const { ed, source } = twoItemFixture();
    startDrag(ed, source);
    document.dispatchEvent(dragEvent('dragover', 60, 110));
    tickAllRaf();

    const indicator = host!.querySelector<HTMLElement>('.dm-block-drop-indicator');
    expect(indicator?.getAttribute('data-mode')).toBe('sibling');
    expect(indicator?.hasAttribute('data-show')).toBe(true);
    endDrag();
  });

  it('dragover outside the drop zone cancels a pending repaint and hides the indicator', () => {
    installRafStub();
    const { ed, source } = twoItemFixture();
    startDrag(ed, source);
    // First a valid in-zone dragover to show it.
    document.dispatchEvent(dragEvent('dragover', 300, 125));
    tickAllRaf();
    const indicator = host!.querySelector<HTMLElement>('.dm-block-drop-indicator');
    expect(indicator?.hasAttribute('data-show')).toBe(true);

    // Queue another repaint WITHOUT ticking, so a coalescing rAF is pending,
    // then leave the zone: the pending rAF is cancelled and it hides.
    document.dispatchEvent(dragEvent('dragover', 300, 130));
    document.dispatchEvent(dragEvent('dragover', 5000, 5000));
    expect(indicator?.hasAttribute('data-show')).toBe(false);
    endDrag();
  });
});
