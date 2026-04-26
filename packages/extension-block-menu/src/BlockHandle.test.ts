import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  Document,
  Text,
  Paragraph,
  Heading,
  Editor,
} from '@domternal/core';
import { BlockHandle, blockHandlePluginKey } from './BlockHandle.js';

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
});

/**
 * Auto-scroll tests drive the plugin's drag lifecycle directly so we don't
 * depend on jsdom's incomplete HTML5 drag-and-drop emulation. RAF is
 * stubbed so each "frame" is a manual tick — cleaner than wall-clock waits
 * and deterministic across CI speeds. `DragEvent` and `scrollBy` both need
 * polyfilling because jsdom doesn't implement them.
 */
describe('BlockHandle auto-scroll during drag', () => {
  let rafCallbacks: FrameRequestCallback[] = [];
  let originalScrollBy: typeof document.documentElement.scrollBy | undefined;
  let scrollByCalls: [number, number][] = [];
  // Wrapper DIV that `findScrollableAncestor` resolves to — tests need a
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
      // jsdom had no original — remove the stub entirely so subsequent
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
   * exists — page-level scroll is owned by the browser's native drag-edge
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
    // Same story for scrollBy — jsdom omits it on Element.
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
    // bottom edge — inside the default 48px threshold.
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
    // Middle of the 400px-tall wrapper — well outside both top and bottom
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
