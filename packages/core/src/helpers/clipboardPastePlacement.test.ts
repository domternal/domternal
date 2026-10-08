import { afterEach, describe, expect, it, vi } from 'vitest';
import { Fragment } from '@domternal/pm/model';
import { TextSelection } from '@domternal/pm/state';
import type { Transaction } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import { Editor } from '../Editor.js';
import { Document, Paragraph, Text } from '../index.js';
import { placeClipboardPaste, registerClipboardPastePlacement } from './clipboardPastePlacement.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

function mount(): Editor {
  const editor = new Editor({ extensions: [Document, Paragraph, Text], content: '<p>one</p><p>two</p>' });
  editors.push(editor);
  return editor;
}

/** A placement that puts the caret at the end of the last paragraph. */
const toEnd = (view: EditorView): Transaction => {
  const tr = view.state.tr;
  return tr.setSelection(TextSelection.atEnd(tr.doc));
};

describe('clipboard paste placement registry', () => {
  it('returns undefined without a placement, so a paste goes at the selection', () => {
    const editor = mount();
    expect(placeClipboardPaste(editor.view, Fragment.empty)).toBeUndefined();
  });

  it("returns the latest placement's transaction, and asks the ones before when it places nothing", () => {
    const editor = mount();
    const content = Fragment.from(editor.schema.text('x'));
    const earlier = vi.fn(toEnd);
    const latest = vi.fn((_view: EditorView, _content: Fragment) => undefined);
    const disposeEarlier = registerClipboardPastePlacement(editor.view, earlier);
    const disposeLatest = registerClipboardPastePlacement(editor.view, latest);

    const placed = placeClipboardPaste(editor.view, content);
    expect(latest).toHaveBeenCalledWith(editor.view, content);
    expect(earlier).toHaveBeenCalledTimes(1);
    expect(placed?.selection.from).toBe(editor.state.doc.content.size - 1);

    disposeEarlier();
    disposeEarlier();
    expect(placeClipboardPaste(editor.view, content)).toBeUndefined();
    disposeLatest();
  });

  it('counts a placement that throws, or one on another state, as none', () => {
    const editor = mount();
    const dispose = registerClipboardPastePlacement(editor.view, () => { throw new Error('placement failed'); });
    expect(placeClipboardPaste(editor.view, Fragment.empty)).toBeUndefined();
    dispose();

    const stale = editor.state.tr;
    editor.view.dispatch(editor.state.tr.insertText('!', 1));
    const disposeStale = registerClipboardPastePlacement(editor.view, () => stale);
    expect(placeClipboardPaste(editor.view, Fragment.empty)).toBeUndefined();
    disposeStale();
  });

  it('keeps views apart and ignores a destroyed view', () => {
    const first = mount();
    const second = mount();
    const dispose = registerClipboardPastePlacement(first.view, toEnd);
    expect(placeClipboardPaste(second.view, Fragment.empty)).toBeUndefined();
    expect(placeClipboardPaste(first.view, Fragment.empty)).toBeDefined();
    dispose();
    second.destroy();
    const disposeDestroyed = registerClipboardPastePlacement(second.view, toEnd);
    expect(placeClipboardPaste(second.view, Fragment.empty)).toBeUndefined();
    disposeDestroyed();
  });
});
