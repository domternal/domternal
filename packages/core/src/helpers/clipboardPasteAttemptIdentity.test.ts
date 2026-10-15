import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Document, Editor, History, Paragraph, Text } from '../index.js';
import { getClipboardPasteAttemptIdentity, registerClipboardHTMLPreparation } from './clipboardHTMLPreparation.js';
import type { ClipboardHTMLPreparationContext, ClipboardHTMLReplay, ClipboardPasteAttemptIdentity } from './clipboardHTMLPreparation.js';

const editors: Editor[] = [];
const disposers: (() => void)[] = [];
beforeEach(() => { vi.stubGlobal('ClipboardEvent', class extends Event { readonly clipboardData = null; }); });
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  for (const editor of editors.splice(0)) if (!editor.isDestroyed) editor.destroy();
  vi.unstubAllGlobals();
});
function mount(): Editor {
  const editor = new Editor({ content: '<p>Before</p>', extensions: [Document, Paragraph, Text, History] });
  editors.push(editor);
  editor.commands.selectAll();
  return editor;
}
function event(html = '<p>Source</p>'): ClipboardEvent {
  const result = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(result, 'clipboardData', { value: { getData: (kind: string) => kind === 'text/html' ? html : '' } });
  return result as ClipboardEvent;
}
function identity(context: ClipboardHTMLPreparationContext): ClipboardPasteAttemptIdentity {
  if (context.attempt === undefined) throw new Error('Core must identify a registered attempt');
  return context.attempt;
}

describe('opaque clipboard paste attempt identity', () => {
  it.each(['native', 'html-event', 'html-no-event', 'text-no-event', 'empty-html', 'intercepted'] as const)(
    'exposes one data-free identity during %s and closes it synchronously afterward', route => {
      const editor = mount();
      const observed: ClipboardPasteAttemptIdentity[] = [];
      const gates: ClipboardPasteAttemptIdentity[] = [];
      if (route === 'intercepted') editor.view.setProps({ handlePaste: () => true });
      expect(getClipboardPasteAttemptIdentity(editor.view)).toBeUndefined();
      disposers.push(registerClipboardHTMLPreparation(editor.view, (_html, context) => {
        gates.push(identity(context));
        expect(getClipboardPasteAttemptIdentity(editor.view)).toBe(context.attempt);
        return undefined;
      }, context => {
        const current = identity(context);
        observed.push(current);
        expect(getClipboardPasteAttemptIdentity(editor.view)).toBe(current);
        expect(Object.isFrozen(current)).toBe(true);
        expect(Reflect.ownKeys(current)).toEqual([]);
        expect(JSON.stringify(current)).toBe('{}');
      }));
      if (route === 'native') editor.view.dom.dispatchEvent(event());
      else if (route === 'html-event') editor.view.pasteHTML('<p>Source</p>', event());
      else if (route === 'empty-html') editor.view.pasteHTML('');
      else if (route === 'text-no-event') editor.view.pasteText('Source');
      else editor.view.pasteHTML('<p>Source</p>');
      expect(observed).toHaveLength(1);
      expect(gates.every(value => value === observed[0])).toBe(true);
      expect(getClipboardPasteAttemptIdentity(editor.view)).toBeUndefined();
      expect(editor.state.doc.textContent).toBe(route === 'intercepted' || route === 'empty-html' ? 'Before' : 'Source');
    },
  );

  it('restores the outer identity after a nested event-free paste while keeping attempts distinct', () => {
    const editor = mount();
    const observed: ClipboardPasteAttemptIdentity[] = [];
    let restored: ClipboardPasteAttemptIdentity | undefined;
    disposers.push(registerClipboardHTMLPreparation(editor.view, () => undefined, context => {
      observed.push(identity(context));
      if (observed.length === 1) {
        editor.view.pasteHTML('<p>Inner</p>');
        restored = getClipboardPasteAttemptIdentity(editor.view);
      }
    }));
    editor.view.pasteHTML('<p>Outer</p>');
    expect(observed).toHaveLength(2);
    expect(observed[0]).not.toBe(observed[1]);
    expect(restored).toBe(observed[0]);
    expect(editor.state.doc.textContent).toBe('Inner');
    expect(getClipboardPasteAttemptIdentity(editor.view)).toBeUndefined();
  });

  it('gives deferred replay a fresh identity without authorizing reuse of its old one', async () => {
    const editor = mount();
    const observed: ClipboardPasteAttemptIdentity[] = [];
    let resume: ClipboardHTMLReplay | undefined;
    disposers.push(registerClipboardHTMLPreparation(editor.view, () => ({ onDeferred(replay) { resume = replay; } }),
      context => { observed.push(identity(context)); }));
    editor.view.pasteHTML('<p>Source</p>');
    expect(editor.state.doc.textContent).toBe('Before');
    expect(getClipboardPasteAttemptIdentity(editor.view)).toBeUndefined();
    await Promise.resolve();
    expect(resume?.('<p>Prepared</p>', event('<p>Prepared</p>'))).toBe(true);
    expect(observed).toHaveLength(2);
    expect(observed[0]).not.toBe(observed[1]);
    expect(getClipboardPasteAttemptIdentity(editor.view)).toBeUndefined();
    expect(resume?.('<p>Again</p>', event('<p>Again</p>'))).toBe(false);
    expect(observed).toHaveLength(2);
    expect(editor.state.doc.textContent).toBe('Prepared');
    expect(editor.commands.undo()).toBe(true);
    expect(editor.state.doc.textContent).toBe('Before');
  });

  it('does not reuse an event identity across attempts or views', () => {
    const first = mount();
    const second = mount();
    const observed: ClipboardPasteAttemptIdentity[] = [];
    for (const editor of [first, second]) disposers.push(registerClipboardHTMLPreparation(editor.view, () => undefined,
      context => { observed.push(identity(context)); }));
    const reused = event();
    first.view.pasteHTML('<p>One</p>', reused);
    first.view.pasteHTML('<p>Two</p>', reused);
    second.view.pasteHTML('<p>Three</p>', reused);
    expect(new Set(observed).size).toBe(3);
  });

  it.each(['dispose', 'destroy'] as const)('exposes no active identity after %s inside an observer', action => {
    const editor = mount();
    let dispose = (): void => undefined;
    dispose = registerClipboardHTMLPreparation(editor.view, () => undefined, context => {
      expect(getClipboardPasteAttemptIdentity(editor.view)).toBe(identity(context));
      if (action === 'dispose') dispose(); else editor.destroy();
      expect(getClipboardPasteAttemptIdentity(editor.view)).toBeUndefined();
    });
    disposers.push(dispose);
    editor.view.pasteHTML('<p>Source</p>');
    expect(getClipboardPasteAttemptIdentity(editor.view)).toBeUndefined();
  });
});
