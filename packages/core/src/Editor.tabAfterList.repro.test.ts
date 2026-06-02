import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from './Editor.js';
import { Document } from './nodes/Document.js';
import { Text } from './nodes/Text.js';
import { Paragraph } from './nodes/Paragraph.js';
import { BulletList } from './nodes/BulletList.js';
import { ListIndent } from './extensions/ListIndent.js';
import { BaseKeymap } from './extensions/BaseKeymap.js';

/**
 * Reproduction for issue #98 ("Tabbing works inconsistently for paragraph
 * below list"). NOT a fix - this documents the CURRENT behavior so we can see
 * exactly what the reporter hits.
 *
 * The reporter embeds each editor as a form field and expects Tab to move
 * focus to the NEXT field. That works for a plain paragraph (no keymap
 * captures Tab, so it bubbles to the browser). But a top-level paragraph that
 * sits immediately AFTER a list is captured by ListIndent.indentBlockAsListChild,
 * which pulls it INTO the list as a nested child instead of letting Tab escape.
 * `pressTab` returns whether SOME keymap handled the key: true == captured
 * (Tab swallowed, focus stays), false == not captured (Tab bubbles, focus
 * moves on). That true/false split IS the "inconsistent tabbing".
 */
function caretAtEndOf(editor: Editor, text: string): void {
  let pos = -1; let size = 0;
  editor.state.doc.descendants((n, p) => {
    if (pos !== -1) return false;
    if (n.type.name === 'paragraph' && n.textContent === text) { pos = p; size = n.nodeSize; return false; }
    return true;
  });
  if (pos < 0) throw new Error(`paragraph "${text}" not found`);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos + size - 1)));
}

/** Fire Tab through the keymap chain. Returns true when a handler captured it. */
function pressTab(editor: Editor): boolean {
  const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  return editor.view.someProp('handleKeyDown', (f) => f(editor.view, event)) === true;
}

/** Shape of every listItem in the first bulletList: child block types per item. */
function bulletItems(editor: Editor): string[][] {
  const out: string[][] = [];
  editor.state.doc.descendants((n) => {
    if (out.length) return false;
    if (n.type.name === 'bulletList') {
      n.forEach((item) => {
        const blocks: string[] = [];
        item.forEach((c) => blocks.push(c.type.name));
        out.push(blocks);
      });
      return false;
    }
    return true;
  });
  return out;
}

describe('issue #98: Tab on a paragraph below a list', () => {
  let editors: Editor[] = [];
  afterEach(() => {
    for (const e of editors) if (!e.isDestroyed) e.destroy();
    editors = [];
  });

  function make(content: string): Editor {
    const e = new Editor({ extensions: [Document, Text, Paragraph, BaseKeymap, BulletList, ListIndent], content });
    editors.push(e);
    return e;
  }

  it('CAPTURES Tab on the first top-level paragraph after a list (pulls it INTO the list)', () => {
    const e = make('<ul><li><p>Bullet</p></li></ul><p>Para</p>');
    // Before: two top-level blocks (the list, then a sibling paragraph).
    expect(e.state.doc.childCount).toBe(2);
    expect(bulletItems(e)).toEqual([['paragraph']]);

    caretAtEndOf(e, 'Para');
    const handled = pressTab(e);

    // Tab was swallowed by ListIndent: focus would NOT leave the editor.
    expect(handled).toBe(true);
    // The paragraph is now a children-zone child INSIDE the single list item.
    expect(e.state.doc.childCount).toBe(1);
    expect(bulletItems(e)).toEqual([['paragraph', 'paragraph']]);
  });

  it('does NOT capture Tab on a plain paragraph after another paragraph (Tab would escape)', () => {
    const e = make('<p>Alpha</p><p>Para</p>');
    const before = e.getHTML();

    caretAtEndOf(e, 'Para');
    const handled = pressTab(e);

    // Nothing captured Tab: it bubbles to the browser and moves focus on.
    expect(handled).toBe(false);
    expect(e.getHTML()).toBe(before);
  });

  it('does NOT capture Tab on a lone paragraph (first block, nothing before it)', () => {
    const e = make('<p>Para</p>');
    const before = e.getHTML();

    caretAtEndOf(e, 'Para');
    expect(pressTab(e)).toBe(false);
    expect(e.getHTML()).toBe(before);
  });

  it('caret offset does not matter: Tab is captured at the END of the paragraph too', () => {
    // The transcript guessed "indents only when caret is at position 0". Show
    // the capture is offset-independent: it fires at the END just the same.
    const e = make('<ul><li><p>Bullet</p></li></ul><p>Para</p>');
    caretAtEndOf(e, 'Para');
    expect(pressTab(e)).toBe(true);
    expect(bulletItems(e)).toEqual([['paragraph', 'paragraph']]);
  });
});
