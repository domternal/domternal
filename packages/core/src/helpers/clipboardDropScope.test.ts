import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@domternal/pm/view';
import { Document, Editor, Paragraph, Text } from '../index.js';
import { getClipboardPasteAttemptIdentity, registerClipboardHTMLPreparation } from './clipboardHTMLPreparation.js';
import type { ClipboardPasteAttemptIdentity } from './clipboardHTMLPreparation.js';

const editors: Editor[] = [];
const disposers: (() => void)[] = [];
const reported: string[] = [];
const report = (event: ErrorEvent): void => {
  event.preventDefault();
  reported.push(event.error instanceof Error ? event.error.message : event.message);
};
beforeEach(() => {
  vi.stubGlobal('ClipboardEvent', class extends Event {});
  window.addEventListener('error', report);
});
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  for (const editor of editors.splice(0)) if (!editor.isDestroyed) editor.destroy();
  reported.length = 0;
  window.removeEventListener('error', report);
  vi.unstubAllGlobals();
});

function mount(): Editor {
  const editor = new Editor({ content: '<p>Before</p>', extensions: [Document, Paragraph, Text] });
  editors.push(editor);
  editor.view.setProps({ handleScrollToSelection: () => true });
  editor.view.posAtCoords = () => ({ pos: 1, inside: -1 });
  return editor;
}

function drop(view: EditorView, route: 'native' | 'dispatch', empty = false): void {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: empty ? null : {
    types: ['text/html'], getData: (kind: string) => kind === 'text/html' ? '<p>Dropped</p>' : '',
  } });
  if (route === 'native') view.dom.dispatchEvent(event); else view.dispatchEvent(event);
}

describe('drop scopes cannot borrow an outer clipboard paste attempt', () => {
  it.each(['native', 'dispatch'] as const)('hides the outer identity during a %s drop and restores it synchronously', route => {
    const editor = mount();
    const observed: (ClipboardPasteAttemptIdentity | undefined)[] = [];
    const prepared: string[] = [];
    const transformed: [string, ClipboardPasteAttemptIdentity | undefined][] = [];
    editor.view.setProps({ transformPastedHTML(html, view) {
      transformed.push([html, getClipboardPasteAttemptIdentity(view)]);
      return html;
    } });
    disposers.push(registerClipboardHTMLPreparation(editor.view, html => { prepared.push(html); return undefined; }, context => {
      observed.push(context.attempt);
      drop(editor.view, route);
      expect(editor.state.doc.textContent).toBe('DroppedBefore');
      expect(getClipboardPasteAttemptIdentity(editor.view)).toBe(context.attempt);
    }));
    editor.view.pasteHTML('<p>Outer</p>');
    expect(observed).toHaveLength(1);
    expect(observed[0]).toBeDefined();
    expect(prepared).toEqual(['<p>Outer</p>']);
    expect(transformed).toEqual([['<p>Dropped</p>', undefined], ['<p>Outer</p>', observed[0]]]);
    expect(getClipboardPasteAttemptIdentity(editor.view)).toBeUndefined();
    // A drop selects its inserted text, so the subsequent outer paste replaces that selection.
    expect(editor.state.doc.textContent).toBe('OuterBefore');
    expect(reported).toEqual([]);
  });

  it.each(['native', 'dispatch'] as const)('gives a genuine paste inside a %s drop its own identity above the barrier', route => {
    const editor = mount();
    const observed: (ClipboardPasteAttemptIdentity | undefined)[] = [];
    let innerIdentity: ClipboardPasteAttemptIdentity | undefined;
    editor.view.setProps({ handleDrop(view) {
      expect(getClipboardPasteAttemptIdentity(view)).toBeUndefined();
      view.pasteHTML('<p>Inner</p>');
      expect(getClipboardPasteAttemptIdentity(view)).toBeUndefined();
      return true;
    }, transformPastedHTML(html, view) {
      if (html.includes('Inner')) innerIdentity = getClipboardPasteAttemptIdentity(view);
      return html;
    } });
    disposers.push(registerClipboardHTMLPreparation(editor.view, () => undefined, context => {
      observed.push(context.attempt);
      if (observed.length === 1) {
        drop(editor.view, route);
        expect(getClipboardPasteAttemptIdentity(editor.view)).toBe(context.attempt);
      }
    }));
    editor.view.pasteHTML('<p>Outer</p>');
    expect(observed).toHaveLength(2);
    expect(observed[0]).not.toBe(observed[1]);
    expect(innerIdentity).toBe(observed[1]);
    expect(editor.state.doc.textContent).toContain('Inner');
    expect(editor.state.doc.textContent).not.toContain('Outer');
    expect(getClipboardPasteAttemptIdentity(editor.view)).toBeUndefined();
    expect(reported).toEqual([]);
  });

  it.each(['native', 'dispatch'] as const)('cleans up a thrown %s drop handler before the outer attempt continues', route => {
    const editor = mount();
    const identities: (ClipboardPasteAttemptIdentity | undefined)[] = [];
    editor.view.setProps({ handleDrop: () => { throw new Error('Drop handler failed'); } });
    disposers.push(registerClipboardHTMLPreparation(editor.view, () => undefined, context => {
      identities.push(context.attempt);
      if (route === 'dispatch') expect(() => { drop(editor.view, route); }).toThrow('Drop handler failed');
      else drop(editor.view, route);
      expect(getClipboardPasteAttemptIdentity(editor.view)).toBe(context.attempt);
    }));
    editor.view.pasteHTML('<p>Outer</p>');
    expect(identities).toHaveLength(1);
    expect(getClipboardPasteAttemptIdentity(editor.view)).toBeUndefined();
    expect(editor.state.doc.textContent).toContain('Outer');
    expect(reported).toEqual(route === 'native' ? ['Drop handler failed'] : []);
  });

  it.each(['native', 'dispatch'] as const)('does not observe an empty %s drop or leave a barrier for the next paste', route => {
    const editor = mount();
    const observer = vi.fn();
    disposers.push(registerClipboardHTMLPreparation(editor.view, () => undefined, observer));
    drop(editor.view, route, true);
    expect(observer).not.toHaveBeenCalled();
    expect(getClipboardPasteAttemptIdentity(editor.view)).toBeUndefined();
    editor.view.pasteHTML('<p>After</p>');
    expect(observer).toHaveBeenCalledOnce();
    expect(editor.state.doc.textContent).toContain('After');
  });

  it.each(['native', 'dispatch'] as const)('allows independent repeated %s drops with no active paste stack', route => {
    const editor = mount();
    const gate = vi.fn(() => undefined);
    const observer = vi.fn();
    disposers.push(registerClipboardHTMLPreparation(editor.view, gate, observer));
    drop(editor.view, route);
    drop(editor.view, route);
    expect(gate).not.toHaveBeenCalled();
    expect(observer).not.toHaveBeenCalled();
    expect(editor.state.doc.textContent).toContain('DroppedDropped');
    expect(getClipboardPasteAttemptIdentity(editor.view)).toBeUndefined();
  });

  it('restores both native barriers after nested drops without retaining a stale event', () => {
    const editor = mount();
    let depth = 0;
    const observed: (ClipboardPasteAttemptIdentity | undefined)[] = [];
    editor.view.setProps({ handleDrop(view) {
      expect(getClipboardPasteAttemptIdentity(view)).toBeUndefined();
      if (++depth === 1) drop(view, 'native');
      expect(getClipboardPasteAttemptIdentity(view)).toBeUndefined();
      depth--;
      return true;
    } });
    disposers.push(registerClipboardHTMLPreparation(editor.view, () => undefined, context => {
      observed.push(context.attempt);
      drop(editor.view, 'native');
      expect(getClipboardPasteAttemptIdentity(editor.view)).toBe(context.attempt);
    }));
    editor.view.pasteHTML('<p>Outer</p>');
    expect(observed).toHaveLength(1);
    expect(getClipboardPasteAttemptIdentity(editor.view)).toBeUndefined();
  });
});
