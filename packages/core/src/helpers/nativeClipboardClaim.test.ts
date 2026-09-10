/**
 * Once ProseMirror starts parsing a native paste or drop, Core claims the event,
 * so an exception later in the paste pipeline can never let the browser insert
 * the clipboard HTML itself. The browser rows are in e2e/paste-slice-context.browser.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Plugin } from '@domternal/pm/state';
import type { EditorProps } from '@domternal/pm/view';
import { Document, Editor, Extension, Paragraph, Text } from '../index.js';

const editors: Editor[] = [];
const reported: string[] = [];
// jsdom reports a listener's exception to the window, as a browser does.
const report = (event: ErrorEvent): void => {
  event.preventDefault();
  reported.push(event.error instanceof Error ? event.error.message : event.message);
};
beforeEach(() => { window.addEventListener('error', report); });
afterEach(() => {
  window.removeEventListener('error', report);
  for (const editor of editors) editor.destroy();
  editors.length = 0;
  reported.length = 0;
  document.body.replaceChildren();
});

function mount(props: EditorProps = {}, options: { editable?: boolean } = {}): Editor {
  const Probe = Extension.create({ name: 'claimProbe', addProseMirrorPlugins: () => [new Plugin({ props })] });
  const editor = new Editor({
    element: document.body.appendChild(document.createElement('div')),
    content: '<p>Keep</p>', extensions: [Document, Paragraph, Text, Probe], ...options,
  });
  editors.push(editor);
  return editor;
}

function clipboard(type: 'paste' | 'drop', data: Record<string, string> | null): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const transfer = data === null ? null : { getData: (format: string): string => data[format] ?? '', types: Object.keys(data) };
  Object.defineProperty(event, type === 'paste' ? 'clipboardData' : 'dataTransfer', { value: transfer });
  return event;
}

const HTML = { 'text/html': '<p>Pasted <b>bold</b></p>', 'text/plain': 'Pasted bold' };
const fail = (): never => { throw new Error('Synthetic paste handler failure'); };

describe('claiming a native paste once ProseMirror parses it', () => {
  it.each([
    ['transformPastedHTML', { transformPastedHTML: fail }],
    ['transformPasted', { transformPasted: fail }],
    ['handlePaste', { handlePaste: fail }],
    ['clipboardParser', { clipboardParser: { parseSlice: fail } as unknown as EditorProps['clipboardParser'] }],
  ] as const)('prevents the browser paste when %s throws', (_name, props) => {
    const editor = mount(props as EditorProps);
    const event = clipboard('paste', HTML);
    editor.view.dom.dispatchEvent(event);
    expect(reported).toEqual(['Synthetic paste handler failure']);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getHTML()).toBe('<p>Keep</p>');
  });

  it('prevents a plain text paste when transformPastedText throws', () => {
    const editor = mount({ transformPastedText: fail });
    const event = clipboard('paste', { 'text/plain': 'Plain words' });
    editor.view.dom.dispatchEvent(event);
    expect(reported).toEqual(['Synthetic paste handler failure']);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getHTML()).toBe('<p>Keep</p>');
  });

  it('prevents a drop when parsing its HTML throws', () => {
    const editor = mount({ transformPastedHTML: fail });
    // jsdom has no layout, so the drop position is supplied.
    editor.view.posAtCoords = () => ({ pos: 1, inside: -1 });
    const event = clipboard('drop', HTML);
    editor.view.dom.dispatchEvent(event);
    expect(reported).toEqual(['Synthetic paste handler failure']);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.getHTML()).toBe('<p>Keep</p>');
  });

  it('prevents a paste ProseMirror inserts, as it always did', () => {
    const editor = mount();
    const event = clipboard('paste', HTML);
    editor.view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(reported).toEqual([]);
    expect(editor.state.doc.textContent).toContain('Pasted bold');
  });

  it('leaves a paste ProseMirror does not parse to the browser', async () => {
    // Composing: ProseMirror lets the browser paste into the composition.
    const composing = mount({ transformPastedHTML: fail });
    Object.defineProperty(composing.view, 'composing', { value: true });
    const during = clipboard('paste', HTML);
    composing.view.dom.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(false);

    // Read-only: ProseMirror runs no editing handler.
    const readOnly = mount({ transformPastedHTML: fail }, { editable: false });
    const locked = clipboard('paste', HTML);
    readOnly.view.dom.dispatchEvent(locked);
    expect(locked.defaultPrevented).toBe(false);

    // No clipboard data: ProseMirror captures the browser paste in a hidden element instead.
    const capture = mount({ transformPastedHTML: fail });
    const empty = clipboard('paste', null);
    capture.view.dom.dispatchEvent(empty);
    expect(empty.defaultPrevented).toBe(false);
    // ProseMirror reads the captured paste 50 ms later. Waiting for it keeps its timer from running
    // after the test file ends, when the DOM environment is gone and it would throw.
    await new Promise(resolve => { setTimeout(resolve, 80); });
    expect(reported).toEqual([]);
  });

  it('leaves an event a plugin claims to that plugin', () => {
    const editor = mount({ handleDOMEvents: { paste: () => true } });
    const event = clipboard('paste', HTML);
    editor.view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('never prevents an event outside its dispatch', () => {
    const editor = mount({ handleDOMEvents: { paste: () => true } });
    const earlier = clipboard('paste', HTML);
    editor.view.dom.dispatchEvent(earlier);
    // A later programmatic paste parses while the earlier event is no longer being dispatched.
    const fresh = clipboard('paste', HTML);
    expect(editor.view.pasteHTML('<p>Later</p>', fresh as ClipboardEvent)).toBe(true);
    expect(earlier.defaultPrevented).toBe(false);
    expect(fresh.defaultPrevented).toBe(false);
    expect(editor.state.doc.textContent).toContain('Later');
  });

  it('claims the event once, before any paste transform runs', () => {
    const event = clipboard('paste', HTML);
    const seen: boolean[] = [];
    const editor = mount({ transformPastedHTML: html => { seen.push(event.defaultPrevented); return html; } });
    let calls = 0;
    const prevent = event.preventDefault.bind(event);
    event.preventDefault = () => { calls++; prevent(); };
    editor.view.dom.dispatchEvent(event);
    expect(seen).toEqual([true]);
    // Core claims it before parsing and ProseMirror prevents it again after pasting.
    expect(calls).toBe(2);
  });

  it('leaves a drop an outer listener already prevented, which ProseMirror skips with or without a drop handler', () => {
    // prosemirror-view ignores a bubbling event that is already prevented before it looks for handlers,
    // so Core's drop record changes nothing for an editor without any other drop handler.
    const editor = mount();
    editor.view.posAtCoords = () => ({ pos: 1, inside: -1 });
    const outer = (event: Event): void => { event.preventDefault(); };
    document.body.addEventListener('drop', outer, { capture: true });
    const event = clipboard('drop', HTML);
    editor.view.dom.dispatchEvent(event);
    document.body.removeEventListener('drop', outer, { capture: true });
    expect(reported).toEqual([]);
    expect(editor.getHTML()).toBe('<p>Keep</p>');
    const unprevented = clipboard('drop', HTML);
    editor.view.dom.dispatchEvent(unprevented);
    expect(editor.state.doc.textContent).toContain('Pasted bold');
  });

  it('leaves an event an outer listener already prevented, which ProseMirror treats as handled', () => {
    const editor = mount({ transformPastedHTML: fail });
    const outer = (event: Event): void => { event.preventDefault(); };
    document.body.addEventListener('paste', outer, { capture: true });
    const event = clipboard('paste', HTML);
    editor.view.dom.dispatchEvent(event);
    document.body.removeEventListener('paste', outer, { capture: true });
    expect(reported).toEqual([]);
    expect(editor.getHTML()).toBe('<p>Keep</p>');
  });
});
