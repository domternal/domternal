import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor, Document, Paragraph, Text, Heading, UniqueID } from '@domternal/core';
import { TableOfContents } from './TableOfContents.js';
import { FloatingTocOutline } from './FloatingTocOutline.js';
import { TableOfContentsBlock } from './TableOfContentsBlock.js';
import type { TableOfContentsOptions, TocStorage } from './types.js';

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  observed = new Set<Element>();
  constructor(public callback: IntersectionObserverCallback, public options?: IntersectionObserverInit) {
    MockIntersectionObserver.instances.push(this);
  }
  observe(element: Element): void { this.observed.add(element); }
  unobserve(element: Element): void { this.observed.delete(element); }
  disconnect(): void { this.observed.clear(); }
  fire(): void { this.callback([], this as unknown as IntersectionObserver); }
}

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};
const base = [Document, Paragraph, Text, Heading, UniqueID.configure({ types: ['heading'] })];
const editors: Editor[] = [];
const scrollIntoViewSpy = vi.fn();
let tops: Record<string, number>;
const storageOf = (editor: Editor): TocStorage => editor.storage['toc'] as TocStorage;
const activeObservers = (): MockIntersectionObserver[] =>
  MockIntersectionObserver.instances.filter((observer) => observer.options?.rootMargin);

function mount(options: {
  toc?: Partial<TableOfContentsOptions>;
  floating?: boolean;
  block?: boolean;
  detached?: boolean;
} = {}): Editor {
  const host = document.createElement('div');
  host.className = 'dm-editor';
  if (!options.detached) document.body.appendChild(host);
  const editor = new Editor({
    element: host,
    extensions: [
      ...base,
      TableOfContents.configure(options.toc ?? {}),
      ...(options.floating ? [FloatingTocOutline] : []),
      ...(options.block ? [TableOfContentsBlock] : []),
    ],
    content: '<h1 id="one">One</h1><h2 id="two">Two</h2>'
      + (options.block ? '<div data-type="table-of-contents"></div><div data-type="table-of-contents"></div>' : ''),
  });
  editors.push(editor);
  return editor;
}

beforeEach(() => {
  document.body.innerHTML = '';
  history.replaceState(null, '', window.location.pathname);
  tops = { one: 20, two: 200 };
  MockIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  vi.stubGlobal('matchMedia', () => ({
    matches: false, addEventListener: () => undefined, removeEventListener: () => undefined,
  }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = tops[this.getAttribute('data-anchor') ?? this.id];
    return {
      top: top ?? 0, bottom: (top ?? 0) + 24, left: 0, right: 200,
      width: top === undefined ? 0 : 200, height: top === undefined ? 0 : 24,
      x: 0, y: top ?? 0, toJSON: () => undefined,
    };
  });
  scrollIntoViewSpy.mockClear();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true, value: scrollIntoViewSpy,
  });
});

afterEach(() => {
  for (const editor of editors.splice(0)) if (!editor.isDestroyed) editor.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('TableOfContents activity ownership', () => {
  it.each([
    { floating: false, block: false },
    { floating: true, block: false },
    { floating: false, block: true },
    { floating: true, block: true },
  ])('owns one tracker and coherent storage with consumers %j', async (consumers) => {
    const onUpdate = vi.fn();
    const editor = mount({ ...consumers, toc: { onUpdate } });
    await flush();
    const storage = storageOf(editor);
    expect(activeObservers()).toHaveLength(1);
    expect(storage.activeId).toBe('one');
    expect(storage.content.map((entry) => entry.domNode)).toEqual([
      editor.view.dom.querySelector('#one'), editor.view.dom.querySelector('#two'),
    ]);
    expect(storage.content.map((entry) => [entry.isActive, entry.isScrolledOver])).toEqual([
      [true, false], [false, false],
    ]);
    const subscriber = vi.fn();
    storage.subscribers.add(subscriber);
    const before = onUpdate.mock.calls.length;
    tops['one'] = -10;
    activeObservers()[0]!.fire();
    expect(onUpdate).toHaveBeenCalledTimes(before + 1);
    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(storage.content[0]?.isScrolledOver).toBe(true);
    expect(storage.content[0]?.isActive).toBe(true);
    const firstLink = editor.view.dom.querySelector('.dm-toc-block-link');
    tops['two'] = -1;
    activeObservers()[0]!.fire();
    expect(storage.activeId).toBe('two');
    expect(storage.content.map((entry) => entry.isActive)).toEqual([false, true]);
    expect(onUpdate).toHaveBeenLastCalledWith(storage);
    if (consumers.block) {
      expect(editor.view.dom.querySelectorAll('.dm-toc-block-link--active')).toHaveLength(2);
      expect(editor.view.dom.querySelector('.dm-toc-block-link')).toBe(firstLink);
    }
    if (consumers.floating) {
      expect(document.querySelector('.dm-toc--active')?.getAttribute('data-toc-anchor')).toBe('two');
    }
    const currentCount = onUpdate.mock.calls.length;
    activeObservers()[0]!.fire();
    expect(onUpdate).toHaveBeenCalledTimes(currentCount);
  });

  it('replaces DOM references and clears deleted active headings', async () => {
    const editor = mount();
    await flush();
    const oldDom = storageOf(editor).content[0]!.domNode;
    tops['replacement'] = -10;
    editor.setContent('<h2 id="replacement">Replacement</h2>');
    const storage = storageOf(editor);
    expect(storage.content).toHaveLength(1);
    expect(storage.content[0]!.domNode).not.toBe(oldDom);
    expect(storage.activeId).toBe('replacement');
    expect(activeObservers()[0]!.observed.has(oldDom!)).toBe(false);
    editor.setContent('<p>No headings</p>');
    expect(storage.content).toEqual([]);
    expect(storage.activeId).toBeNull();
    expect(activeObservers()[0]!.observed.size).toBe(0);
  });

  it('resolves detached content on adoption without starting a second tracker', async () => {
    const editor = mount({ detached: true, floating: true });
    await flush();
    const storage = storageOf(editor);
    expect(storage.content.every((entry) => entry.domNode === null)).toBe(true);
    const outer = document.body.appendChild(document.createElement('div'));
    const host = outer.appendChild(document.createElement('div'));
    host.className = 'dm-editor';
    editor.adoptDom(host);
    expect(storage.content.every((entry) => entry.domNode?.isConnected)).toBe(true);
    expect(storage.activeId).toBe('one');
    expect(activeObservers()).toHaveLength(1);
    expect(outer.querySelector('.dm-toc-outline')).not.toBeNull();
    const newOuter = document.body.appendChild(document.createElement('div'));
    const newHost = newOuter.appendChild(document.createElement('div'));
    newHost.className = 'dm-editor';
    editor.adoptDom(newHost);
    expect(outer.querySelector('.dm-toc-outline')).toBeNull();
    expect(newOuter.querySelector('.dm-toc-outline')).not.toBeNull();
    expect(activeObservers()).toHaveLength(1);
    expect(storage.subscribers.size).toBe(1);
    editor.destroy();
    expect(storage.content.every((entry) => entry.domNode === null)).toBe(true);
    expect(activeObservers()[0]!.observed.size).toBe(0);
    expect(newOuter.querySelector('.dm-toc-outline')).toBeNull();
  });

  it('isolates matching heading IDs in separate editor views', async () => {
    const first = mount();
    const second = mount();
    await flush();
    expect(activeObservers()).toHaveLength(2);
    expect(storageOf(first).content[0]!.domNode).not.toBe(storageOf(second).content[0]!.domNode);
    first.commands.scrollToHeading('two');
    expect(storageOf(first).activeId).toBe('two');
    expect(storageOf(second).activeId).toBe('one');
  });

  it('retains legacy outline tracking options regardless of extension order', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    tops['root'] = 200;
    tops['one'] = 100;
    tops['two'] = 202;
    const scrollRoot = vi.fn();
    root.scrollTo = scrollRoot;
    document.body.appendChild(root);
    const editor = new Editor({
      element: root,
      extensions: [...base, FloatingTocOutline.configure({
        activeScrollParent: root, activeRootMargin: '0px 0px -50% 0px', clickOverrideMs: 0,
      }), TableOfContents],
      content: '<h1 id="one">One</h1><h2 id="two">Two</h2>',
    });
    editors.push(editor);
    await flush();
    expect(activeObservers()[0]!.options).toEqual({ root, rootMargin: '0px 0px -50% 0px' });
    expect(storageOf(editor).activeId).toBe('one');
    tops['two'] = 200;
    activeObservers()[0]!.fire();
    expect(storageOf(editor).activeId).toBe('two');
    editor.commands.scrollToHeading('one');
    expect(scrollRoot).toHaveBeenCalled();
    expect(storageOf(editor).activeId).toBe('two');
  });

  it('lets explicit observer options override the legacy outline root and margin', async () => {
    const legacyRoot = document.createElement('div');
    const editor = new Editor({
      element: document.body.appendChild(document.createElement('div')),
      extensions: [...base, TableOfContents.configure({
        activeScrollParent: null, activeRootMargin: '0px', activeOffset: 250,
      }), FloatingTocOutline.configure({
        activeScrollParent: legacyRoot, activeRootMargin: '0px 0px -20% 0px',
      })],
      content: '<h1 id="one">One</h1><h2 id="two">Two</h2>',
    });
    editors.push(editor);
    await flush();
    expect(activeObservers()[0]!.options).toEqual({ root: null, rootMargin: '0px' });
    expect(storageOf(editor).activeId).toBe('two');
    expect(document.querySelector('.dm-toc-outline')?.getAttribute('data-scroll-mode')).toBe('page');
  });

  it('shares navigation overrides with inline blocks and restores measured activity afterward', async () => {
    const editor = mount({ block: true, toc: { clickOverrideMs: 20 } });
    await flush();
    const links = editor.view.dom.querySelectorAll<HTMLButtonElement>('.dm-toc-block-link');
    links[1]!.click();
    expect(storageOf(editor).activeId).toBe('two');
    activeObservers()[0]!.fire();
    expect(storageOf(editor).activeId).toBe('two');
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(storageOf(editor).activeId).toBe('one');
  });

  it('recomputes after a layout-only change and isolates errors in onUpdate', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const editor = mount({ toc: { onUpdate: () => { throw new Error('consumer failed'); } } });
    await flush();
    const subscriber = vi.fn();
    storageOf(editor).subscribers.add(subscriber);
    tops['two'] = -1;
    editor.view.dom.dispatchEvent(new Event('toggle'));
    expect(storageOf(editor).activeId).toBe('two');
    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
  });

  it('resolves a custom ID attribute inside a heading NodeView wrapper', async () => {
    const WrappedHeading = Heading.extend({
      addNodeView() {
        return (node) => {
          const dom = document.createElement('div');
          const contentDOM = dom.appendChild(document.createElement('h2'));
          contentDOM.setAttribute('data-anchor', node.attrs['data-anchor'] as string);
          return { dom, contentDOM };
        };
      },
    });
    const editor = new Editor({
      element: document.body.appendChild(document.createElement('div')),
      extensions: [Document, Text, Paragraph, WrappedHeading,
        UniqueID.configure({ types: ['heading'], attributeName: 'data-anchor' }), TableOfContents],
      content: '<h2 data-anchor="one">Wrapped</h2>',
    });
    editors.push(editor);
    await flush();
    const entry = storageOf(editor).content[0]!;
    expect(entry.id).toBe('one');
    expect(entry.domNode).toBe(editor.view.dom.querySelector('[data-anchor="one"]'));
    expect(entry.domNode?.tagName).toBe('H2');
    expect(entry.isActive).toBe(true);
  });

  it('keeps document data and DOM references available without IntersectionObserver', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const editor = mount();
    await flush();
    const storage = storageOf(editor);
    expect(storage.content.map((entry) => entry.id)).toEqual(['one', 'two']);
    expect(storage.content.every((entry) => entry.domNode?.isConnected)).toBe(true);
    expect(storage.activeId).toBeNull();
    expect(storage.content.every((entry) => !entry.isActive && !entry.isScrolledOver)).toBe(true);
  });

  it('updates activity after a window resize without a document transaction', async () => {
    const editor = mount();
    await flush();
    const transaction = vi.fn();
    editor.on('transaction', transaction);
    tops['two'] = -1;
    window.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(storageOf(editor).activeId).toBe('two');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('defers initial hash navigation until the editor has been adopted', async () => {
    history.replaceState(null, '', '#two');
    const editor = mount({ detached: true });
    await flush();
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    editor.adoptDom(document.body.appendChild(document.createElement('div')));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
    expect(storageOf(editor).activeId).toBe('two');
  });
});
