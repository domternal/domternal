import { afterEach, describe, expect, it } from 'vitest';
import {
  BulletList, Document, Editor, Extension, ListItem, OrderedList, Paragraph, Text,
} from '@domternal/core';
import { getClipboardPasteBehavior } from '@domternal/core/clipboard';
import type { EditorOptions } from '@domternal/core';
import { Slice } from '@domternal/pm/model';
import { Plugin } from '@domternal/pm/state';
import { PasteCleanup } from './PasteCleanup.js';
import type { PasteCleanupOptions } from './PasteCleanup.js';

interface CapturedPaste {
  event: ClipboardEvent;
  text: string;
  preserveOrderedListStart: boolean;
  firstType: string | undefined;
  start: unknown;
}

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
});

const officeHTML = '<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">7. </span>Office item</p>';
const rejectedHTML = '<p>' + 'x'.repeat(1001) + '</p>';
const pasteEvent = (): ClipboardEvent => new Event('paste', { cancelable: true }) as ClipboardEvent;

function mount(
  captured: CapturedPaste[],
  options: PasteCleanupOptions = {},
  extra: NonNullable<EditorOptions['extensions']> = [],
): Editor {
  const Capture = Extension.create({
    name: 'capturePasteBehavior',
    priority: 1000,
    addProseMirrorPlugins() {
      return [new Plugin({
        props: {
          handlePaste(view, event, slice) {
            captured.push({
              event,
              text: slice.content.textBetween(0, slice.content.size, '|'),
              preserveOrderedListStart: getClipboardPasteBehavior(view, event)?.preserveOrderedListStart === true,
              firstType: slice.content.firstChild?.type.name,
              start: slice.content.firstChild?.attrs['start'],
            });
            return false;
          },
        },
      })];
    },
  });
  const editor = new Editor({
    extensions: [Document, Text, Paragraph, OrderedList, BulletList, ListItem, PasteCleanup.configure(options), Capture, ...extra],
    content: '<p>Original</p>',
  });
  editors.push(editor);
  editor.commands.selectAll();
  return editor;
}

function consumeEvents(events: WeakSet<ClipboardEvent>): Extension {
  return Extension.create({
    name: 'consumeSelectedPastesBeforeCleanup',
    priority: 1300,
    addProseMirrorPlugins() {
      return [new Plugin({ props: { handlePaste: (_view, event) => events.has(event) } })];
    },
  });
}

describe('PasteCleanup operation context', () => {
  it('exposes reconstructed list intent and parsed start to a lower paste handler', () => {
    const captured: CapturedPaste[] = [];
    const editor = mount(captured);
    const event = pasteEvent();

    expect(editor.view.pasteHTML(officeHTML, event)).toBe(true);

    expect(captured).toEqual([{ event, text: 'Office item', preserveOrderedListStart: true, firstType: 'orderedList', start: 7 }]);
  });

  it.each([
    { name: 'accepted HTML', nestedHTML: '<p>Nested accepted</p>', capturedInner: true, innerIntent: false },
    { name: 'reconstructed list', nestedHTML: officeHTML, capturedInner: true, innerIntent: true },
    { name: 'rejected HTML', nestedHTML: rejectedHTML, capturedInner: false, innerIntent: false },
  ])('restores outer list intent after an observer pastes $name', ({ nestedHTML, capturedInner, innerIntent }) => {
    const captured: CapturedPaste[] = [];
    const outerEvent = pasteEvent();
    const innerEvent = pasteEvent();
    let nested = false;
    const editor: Editor = mount(captured, {
      limits: { maxInputLength: 1000 },
      onResult: () => {
        if (nested) return;
        nested = true;
        editor.view.pasteHTML(nestedHTML, innerEvent);
      },
    });

    expect(editor.view.pasteHTML(officeHTML, outerEvent)).toBe(true);

    expect(captured.map(entry => [entry.event, entry.preserveOrderedListStart]))
      .toEqual(capturedInner ? [[innerEvent, innerIntent], [outerEvent, true]] : [[outerEvent, true]]);
    expect(editor.state.doc.textContent).toContain('Office item');
    expect(editor.state.doc.textContent).not.toContain('xxx');
    expect(innerEvent.defaultPrevented).toBe(!capturedInner);
  });

  it('keeps an outer rejection after the observer successfully pastes a nested list', () => {
    const captured: CapturedPaste[] = [];
    const outerEvent = pasteEvent();
    const innerEvent = pasteEvent();
    let nested = false;
    const editor: Editor = mount(captured, {
      limits: { maxInputLength: 1000 },
      onResult: () => {
        if (nested) return;
        nested = true;
        editor.view.pasteHTML(officeHTML, innerEvent);
      },
    });

    expect(editor.view.pasteHTML(rejectedHTML, outerEvent)).toBe(true);

    expect(captured.map(entry => [entry.event, entry.preserveOrderedListStart])).toEqual([[innerEvent, true]]);
    expect(outerEvent.defaultPrevented).toBe(true);
    expect(editor.state.doc.textContent).toBe('Office item');
    expect(getClipboardPasteBehavior(editor.view, outerEvent)).toBeUndefined();
  });

  it('keeps an outer plain-text rejection after the observer pastes accepted HTML', () => {
    const captured: CapturedPaste[] = [];
    const outerEvent = pasteEvent();
    const innerEvent = pasteEvent();
    let nested = false;
    const editor: Editor = mount(captured, {
      limits: { maxInputLength: 1000 },
      onResult: () => {
        if (nested) return;
        nested = true;
        editor.view.pasteHTML('<p>Nested accepted</p>', innerEvent);
      },
    });

    expect(editor.view.pasteText('x'.repeat(1001), outerEvent)).toBe(true);

    expect(captured.map(entry => [entry.event, entry.preserveOrderedListStart])).toEqual([[innerEvent, false]]);
    expect(outerEvent.defaultPrevented).toBe(true);
    expect(editor.state.doc.textContent).toBe('Nested accepted');
  });

  it('does not let observer result mutation change accepted HTML or its captured list intent', () => {
    const captured: CapturedPaste[] = [];
    const editor = mount(captured, {
      onResult: result => {
        result.html = '<p onclick="alert(1)">Injected</p>';
        result.status = 'rejected';
        result.source = 'html';
        result.diagnostics.length = 0;
      },
    });
    const event = pasteEvent();

    editor.view.pasteHTML(officeHTML, event);

    expect(captured[0]?.preserveOrderedListStart).toBe(true);
    expect(editor.state.doc.textContent).toBe('Office item');
    expect(editor.view.dom.querySelector('[onclick]')).toBeNull();
  });

  it('does not let observer result mutation turn a rejection into accepted content', () => {
    const captured: CapturedPaste[] = [];
    const editor = mount(captured, {
      limits: { maxInputLength: 1000 },
      onResult: result => {
        result.status = 'cleaned';
        result.html = '<p>Injected</p>';
      },
    });
    const original = editor.state.doc;
    const event = pasteEvent();

    expect(editor.view.pasteHTML(rejectedHTML, event)).toBe(true);

    expect(captured).toEqual([]);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.state.doc.eq(original)).toBe(true);
  });

  it('resets list intent when a programmatic event is reused for plain, internal, and empty paste', () => {
    const captured: CapturedPaste[] = [];
    const editor = mount(captured);
    const event = pasteEvent();
    editor.view.pasteHTML(officeHTML, event);
    expect(getClipboardPasteBehavior(editor.view, event)?.preserveOrderedListStart).toBe(true);

    editor.view.pasteText('Plain', event);
    expect(getClipboardPasteBehavior(editor.view, event)).toBeUndefined();
    editor.view.pasteHTML('<p data-pm-slice="0 0 []">Internal</p>', event);
    expect(getClipboardPasteBehavior(editor.view, event)).toBeUndefined();
    expect(editor.view.pasteHTML('', event)).toBe(false);
    expect(getClipboardPasteBehavior(editor.view, event)).toBeUndefined();
    expect(captured.map(entry => entry.preserveOrderedListStart)).toEqual([true, false, false, false]);
    expect(captured.at(-1)?.text).toBe('');
  });

  it.each([officeHTML, rejectedHTML])('restores an outer operation when a higher handler consumes the nested paste', nestedHTML => {
    const captured: CapturedPaste[] = [];
    const consumed = new WeakSet<ClipboardEvent>();
    const outerEvent = pasteEvent();
    const innerEvent = pasteEvent();
    consumed.add(innerEvent);
    let nested = false;
    const editor: Editor = mount(captured, {
      limits: { maxInputLength: 1000 },
      onResult: () => {
        if (nested) return;
        nested = true;
        editor.view.pasteHTML(nestedHTML, innerEvent);
      },
    }, [consumeEvents(consumed)]);

    editor.view.pasteHTML(officeHTML, outerEvent);

    expect(captured.map(entry => [entry.event, entry.preserveOrderedListStart])).toEqual([[outerEvent, true]]);
    expect(editor.state.doc.textContent).toBe('Office item');
  });

  it('does not retain a consumed rejection for the next normal programmatic paste', () => {
    const captured: CapturedPaste[] = [];
    const consumed = new WeakSet<ClipboardEvent>();
    const rejectedEvent = pasteEvent();
    const nextEvent = pasteEvent();
    consumed.add(rejectedEvent);
    const editor = mount(captured, { limits: { maxInputLength: 1000 } }, [consumeEvents(consumed)]);
    editor.view.pasteHTML(rejectedHTML, rejectedEvent);

    expect(editor.view.pasteText('Next', nextEvent)).toBe(true);

    expect(captured.map(entry => [entry.event, entry.text, entry.preserveOrderedListStart])).toEqual([[nextEvent, 'Next', false]]);
    expect(editor.state.doc.textContent).toBe('Next');
  });

  it('conservatively blocks an empty paste after a consumed rejection, then accepts nonempty input', () => {
    const captured: CapturedPaste[] = [];
    const consumed = new WeakSet<ClipboardEvent>();
    const rejectedEvent = pasteEvent();
    const emptyEvent = pasteEvent();
    consumed.add(rejectedEvent);
    const editor = mount(captured, { limits: { maxInputLength: 1000 } }, [consumeEvents(consumed)]);
    const original = editor.state.doc;
    editor.view.pasteHTML(rejectedHTML, rejectedEvent);

    expect(editor.view.pasteHTML('', emptyEvent)).toBe(true);

    expect(emptyEvent.defaultPrevented).toBe(true);
    expect(captured).toEqual([]);
    expect(editor.state.doc.eq(original)).toBe(true);
    expect(getClipboardPasteBehavior(editor.view, emptyEvent)).toBeUndefined();

    const nextEvent = pasteEvent();
    expect(editor.view.pasteText('Next', nextEvent)).toBe(true);
    expect(captured.map(entry => [entry.event, entry.text, entry.preserveOrderedListStart])).toEqual([[nextEvent, 'Next', false]]);
    expect(editor.state.doc.textContent).toBe('Next');
  });

  it('does not let a lower transform replace rejected content with Slice.empty to bypass rejection', () => {
    const captured: CapturedPaste[] = [];
    let transformed = false;
    let lowerHandlerCalled = false;
    const ReplaceRejectedSlice = Extension.create({
      name: 'replaceRejectedSlice',
      priority: 500,
      addProseMirrorPlugins() {
        return [new Plugin({
          props: {
            transformPasted() {
              transformed = true;
              return Slice.empty;
            },
            handlePaste(view) {
              lowerHandlerCalled = true;
              view.dispatch(view.state.tr.insertText('Injected'));
              return true;
            },
          },
        })];
      },
    });
    const editor = mount(captured, { limits: { maxInputLength: 1000 } }, [ReplaceRejectedSlice]);
    const original = editor.state.doc;
    const event = pasteEvent();

    expect(editor.view.pasteHTML(rejectedHTML, event)).toBe(true);

    expect(transformed).toBe(true);
    expect(lowerHandlerCalled).toBe(false);
    expect(captured).toEqual([]);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.state.doc.eq(original)).toBe(true);
  });
});
