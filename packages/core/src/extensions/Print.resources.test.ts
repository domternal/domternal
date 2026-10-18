import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { Print, type PrintOptions, type PrintStorage } from './Print.js';

const editors: Editor[] = [];
const fontDescriptor = Object.getOwnPropertyDescriptor(document, 'fonts');
const mediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');
function fontReady(ready: Promise<FontFaceSet>): void {
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready } });
}
function mount(options: Partial<PrintOptions> = {}): { editor: Editor; wrapper: HTMLElement; storage: PrintStorage } {
  const wrapper = document.createElement('div');
  wrapper.className = 'dm-editor';
  document.body.append(wrapper);
  const editor = new Editor({ element: wrapper, extensions: [Document, Paragraph, Text,
    Print.configure({ prepareResources: true, ...options })], content: '<p>Ready for paper</p>' });
  editors.push(editor);
  const storage = editor.storage['print'] as PrintStorage;
  return { editor, wrapper, storage };
}
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (cause: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function image(wrapper: HTMLElement, ready = false): HTMLImageElement {
  const img = document.createElement('img');
  img.src = '/pending.png';
  Object.defineProperties(img, { complete: { configurable: true, value: ready }, naturalWidth: { configurable: true, value: ready ? 20 : 0 } });
  wrapper.append(img);
  return img;
}
function load(img: HTMLImageElement): void {
  Object.defineProperties(img, { complete: { configurable: true, value: true }, naturalWidth: { configurable: true, value: 20 } });
  img.dispatchEvent(new Event('load'));
}
afterEach(() => {
  for (const editor of editors.splice(0)) if (!editor.isDestroyed) editor.destroy();
  document.body.replaceChildren();
  if (fontDescriptor) Object.defineProperty(document, 'fonts', fontDescriptor);
  else Reflect.deleteProperty(document, 'fonts');
  if (mediaDescriptor) Object.defineProperty(window, 'matchMedia', mediaDescriptor);
  else Reflect.deleteProperty(window, 'matchMedia');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('optional print resource preparation', () => {
  it('preserves immediate printing unless explicitly enabled', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { editor, storage } = mount({ prepareResources: false });
    editor.commands.printDocument();
    expect(print).toHaveBeenCalledOnce();
    expect(storage.preparation).toBeNull();
  });

  it('does not start resource work for a dry run', () => {
    const { editor, storage, wrapper } = mount();
    const img = image(wrapper); img.loading = 'lazy';
    expect(editor.can().printDocument()).toBe(true);
    expect(storage.preparation).toBeNull();
    expect(img.getAttribute('loading')).not.toBe('eager');
  });

  it('waits for loaded fonts and image decoding before one print lifecycle', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const font = deferred<FontFaceSet>();
    fontReady(font.promise);
    const { editor, storage, wrapper } = mount();
    const decode = deferred<undefined>();
    const img = image(wrapper);
    img.decode = vi.fn(() => decode.promise);
    const before = vi.fn(); const after = vi.fn();
    editor.on('beforePrint', before); editor.on('afterPrint', after);
    expect(editor.commands.printDocument()).toBe(true);
    expect(editor.commands.printDocument()).toBe(false);
    expect(editor.can().printDocument()).toBe(false);
    expect(print).not.toHaveBeenCalled();
    load(img); decode.resolve(undefined);
    await Promise.resolve();
    expect(print).not.toHaveBeenCalled();
    font.resolve(document.fonts);
    expect(await storage.preparation).toEqual({ status: 'printed' });
    expect(before).toHaveBeenCalledOnce(); expect(after).toHaveBeenCalledOnce();
    expect(print).toHaveBeenCalledOnce();
    expect(editor.can().printDocument()).toBe(true);
  });

  it('temporarily requests lazy images and restores the original attribute', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { editor, storage, wrapper } = mount();
    const img = image(wrapper); img.setAttribute('loading', 'lazy');
    editor.commands.printDocument();
    expect(img.getAttribute('loading')).toBe('eager');
    load(img);
    expect(await storage.preparation).toEqual({ status: 'printed' });
    expect(img.getAttribute('loading')).toBe('lazy');
  });

  it('waits for a replacement image and stops waiting for removed content', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { editor, storage, wrapper } = mount();
    const old = image(wrapper);
    editor.commands.printDocument();
    old.remove();
    const replacement = image(wrapper);
    await Promise.resolve(); await Promise.resolve();
    expect(print).not.toHaveBeenCalled();
    load(replacement);
    expect(await storage.preparation).toEqual({ status: 'printed' });
    expect(print).toHaveBeenCalledOnce();
  });

  it('does not undo an application loading-attribute change made while waiting', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { editor, storage, wrapper } = mount();
    const img = image(wrapper); img.setAttribute('loading', 'lazy');
    editor.commands.printDocument(); img.removeAttribute('loading'); load(img);
    await storage.preparation;
    expect(img.hasAttribute('loading')).toBe(false);
  });

  for (const failure of ['load', 'decode', 'font', 'listener', 'print'] as const) {
    it(`reports a ${failure} failure and restores the page without rejecting the completion promise`, async () => {
      const print = vi.spyOn(window, 'print').mockImplementation(() => { if (failure === 'print') throw new Error('Blocked print'); });
      if (failure === 'font') fontReady(Promise.reject(new Error('Font failed')));
      const { editor, storage, wrapper } = mount();
      const img = image(wrapper, failure !== 'load');
      if (failure === 'decode') img.decode = () => Promise.reject(new Error('Decode failed'));
      if (failure === 'listener') editor.on('beforePrint', () => { throw new Error('Listener failed'); });
      const error = vi.fn(); editor.on('printPreparationError', error);
      editor.commands.printDocument();
      if (failure === 'load') img.dispatchEvent(new Event('error'));
      expect(await storage.preparation).toMatchObject({ status: 'failed', error: expect.any(Error) });
      expect(error).toHaveBeenCalledOnce();
      expect(print).toHaveBeenCalledTimes(failure === 'print' ? 1 : 0);
      expect(document.querySelectorAll('.dm-print-root, .dm-print-ancestor, .dm-printing')).toHaveLength(0);
    });
  }

  it('bounds the wait and removes image listeners after a timeout', async () => {
    vi.useFakeTimers();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { editor, storage, wrapper } = mount({ prepareResources: { timeoutMs: 25 } });
    const img = image(wrapper); img.setAttribute('loading', 'lazy');
    const remove = vi.spyOn(img, 'removeEventListener');
    editor.commands.printDocument();
    await vi.advanceTimersByTimeAsync(25);
    expect(await storage.preparation).toMatchObject({ status: 'failed', error: expect.any(Error) });
    expect(remove.mock.calls.map(call => call[0])).toContain('load');
    expect(remove.mock.calls.map(call => call[0])).toContain('error');
    expect(img.getAttribute('loading')).toBe('lazy');
    load(img); await Promise.resolve();
    expect(print).not.toHaveBeenCalled();
  });

  it.each([0, -1, NaN, Infinity, 120001])('rejects invalid timeout %s without scheduling printing', async timeoutMs => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { editor, storage } = mount({ prepareResources: { timeoutMs } });
    editor.commands.printDocument();
    expect(await storage.preparation).toMatchObject({ status: 'failed', error: expect.any(RangeError) });
    expect(print).not.toHaveBeenCalled();
  });

  for (const cancel of ['command', 'destroy', 'detach'] as const) {
    it(`does not print after ${cancel}`, async () => {
      const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
      const { editor, storage, wrapper } = mount();
      const img = image(wrapper);
      editor.commands.printDocument();
      expect(editor.can().cancelPrintPreparation()).toBe(true);
      if (cancel === 'command') editor.commands.cancelPrintPreparation();
      if (cancel === 'destroy') editor.destroy();
      if (cancel === 'detach') wrapper.remove();
      load(img);
      expect(await storage.preparation).toEqual({ status: 'cancelled' });
      expect(print).not.toHaveBeenCalled();
    });
  }

  it('settles a resolver failure after preparation without a rejected completion promise', async () => {
    let current: HTMLElement | null = null; let fail = false;
    const { editor, storage, wrapper } = mount({ root: () => {
      if (fail) throw new Error('Root resolver failed');
      return current;
    } });
    current = wrapper;
    const img = image(wrapper);
    editor.commands.printDocument(); fail = true; load(img);
    expect(await storage.preparation).toMatchObject({ status: 'failed', error: expect.any(Error) });
  });

  it('does not print if a beforePrint listener destroys its editor', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { editor, storage } = mount();
    editor.on('beforePrint', () => { editor.destroy(); });
    editor.commands.printDocument();
    expect(await storage.preparation).toEqual({ status: 'cancelled' });
    expect(print).not.toHaveBeenCalled();
    expect(document.body.classList.contains('dm-printing')).toBe(false);
  });

  it('announces afterPrint once when the native event occurs during window.print', () => {
    const { editor } = mount({ prepareResources: false, isolateNativePrint: true });
    const after = vi.fn(); editor.on('afterPrint', after);
    vi.spyOn(window, 'print').mockImplementation(() => {
      window.dispatchEvent(new Event('beforeprint'));
      window.dispatchEvent(new Event('afterprint'));
    });
    editor.commands.printDocument();
    expect(after).toHaveBeenCalledOnce();
  });

  it('ignores a delayed print-media entry after native afterprint, then accepts the next media cycle', () => {
    let change: ((event: MediaQueryListEvent) => void) | undefined;
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => { change = listener; },
      removeEventListener: () => undefined,
    }) });
    mount({ isolateNativePrint: true });
    window.dispatchEvent(new Event('beforeprint'));
    expect(document.body.classList.contains('dm-printing')).toBe(true);
    window.dispatchEvent(new Event('afterprint'));
    change?.({ matches: true } as MediaQueryListEvent);
    expect(document.body.classList.contains('dm-printing')).toBe(false);
    change?.({ matches: false } as MediaQueryListEvent);
    change?.({ matches: true } as MediaQueryListEvent);
    expect(document.body.classList.contains('dm-printing')).toBe(true);
    change?.({ matches: false } as MediaQueryListEvent);
    expect(document.body.classList.contains('dm-printing')).toBe(false);
  });

  it('keeps another editor destruction from clearing the active print marks', () => {
    const { editor: first, wrapper } = mount({ prepareResources: false });
    const { editor: other } = mount({ prepareResources: false });
    vi.spyOn(window, 'print').mockImplementation(() => {
      other.destroy();
      expect(wrapper.classList.contains('dm-print-root')).toBe(true);
      expect(document.body.classList.contains('dm-printing')).toBe(true);
    });
    expect(first.commands.printDocument()).toBe(true);
    expect(document.body.classList.contains('dm-printing')).toBe(false);
  });
});
