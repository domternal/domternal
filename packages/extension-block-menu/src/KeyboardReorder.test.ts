import { describe, it, expect } from 'vitest';
import {
  Document,
  Text,
  Paragraph,
  Heading,
  BulletList,
  Blockquote,
  Editor,
} from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { KeyboardReorder } from './KeyboardReorder.js';

const extensions = [Document, Text, Paragraph, Heading, BulletList, Blockquote, KeyboardReorder];

function makeEditor(html: string): Editor {
  return new Editor({ extensions, content: html });
}

function dispatchShortcut(editor: Editor, key: string): boolean {
  // Invoke the shortcut handler directly via the extension config so we
  // don't need a real keymap plugin wired up.
  const shortcuts = KeyboardReorder.config.addKeyboardShortcuts?.call(
    { ...KeyboardReorder, editor } as unknown as typeof KeyboardReorder & { editor: Editor },
  );
  const handler = shortcuts?.[key];
  return handler ? handler() : false;
}

function setCursor(editor: Editor, pos: number): void {
  const sel = TextSelection.near(editor.state.doc.resolve(pos));
  editor.view.dispatch(editor.state.tr.setSelection(sel));
}

function getBlockTexts(editor: Editor): string[] {
  const texts: string[] = [];
  editor.state.doc.forEach((n) => { texts.push(n.textContent); });
  return texts;
}

describe('KeyboardReorder', () => {
  it('has the correct extension name', () => {
    expect(KeyboardReorder.name).toBe('keyboardReorder');
  });

  it('registers Mod-Shift-ArrowUp and Mod-Shift-ArrowDown shortcuts', () => {
    const editor = makeEditor('<p>A</p>');
    const shortcuts = KeyboardReorder.config.addKeyboardShortcuts?.call(
      { ...KeyboardReorder, editor } as unknown as typeof KeyboardReorder & { editor: Editor },
    );
    expect(shortcuts).toBeDefined();
    expect(typeof shortcuts?.['Mod-Shift-ArrowUp']).toBe('function');
    expect(typeof shortcuts?.['Mod-Shift-ArrowDown']).toBe('function');
    editor.destroy();
  });

  it('moves block up with Mod-Shift-ArrowUp', () => {
    const editor = makeEditor('<p>A</p><p>B</p><p>C</p>');
    setCursor(editor, 5); // inside <p>B</p>
    const handled = dispatchShortcut(editor, 'Mod-Shift-ArrowUp');
    expect(handled).toBe(true);
    expect(getBlockTexts(editor)).toEqual(['B', 'A', 'C']);
    editor.destroy();
  });

  it('moves block down with Mod-Shift-ArrowDown', () => {
    const editor = makeEditor('<p>A</p><p>B</p><p>C</p>');
    setCursor(editor, 2); // inside <p>A</p>
    const handled = dispatchShortcut(editor, 'Mod-Shift-ArrowDown');
    expect(handled).toBe(true);
    expect(getBlockTexts(editor)).toEqual(['B', 'A', 'C']);
    editor.destroy();
  });

  it('is a no-op when the current block is already first (ArrowUp)', () => {
    const editor = makeEditor('<p>A</p><p>B</p>');
    setCursor(editor, 2); // inside <p>A</p>
    const handled = dispatchShortcut(editor, 'Mod-Shift-ArrowUp');
    expect(handled).toBe(false);
    expect(getBlockTexts(editor)).toEqual(['A', 'B']);
    editor.destroy();
  });

  it('is a no-op when the current block is already last (ArrowDown)', () => {
    const editor = makeEditor('<p>A</p><p>B</p>');
    setCursor(editor, 5); // inside <p>B</p>
    const handled = dispatchShortcut(editor, 'Mod-Shift-ArrowDown');
    expect(handled).toBe(false);
    expect(getBlockTexts(editor)).toEqual(['A', 'B']);
    editor.destroy();
  });

  it('walks up from nested content to move the top-level block', () => {
    const editor = makeEditor('<blockquote><p>Quote text</p></blockquote><p>After</p>');
    // Cursor inside the blockquote's inner paragraph
    setCursor(editor, 5);
    const handled = dispatchShortcut(editor, 'Mod-Shift-ArrowDown');
    expect(handled).toBe(true);
    // The whole blockquote should move past the paragraph
    const firstChild = editor.state.doc.firstChild;
    expect(firstChild?.type.name).toBe('paragraph');
    expect(firstChild?.textContent).toBe('After');
    editor.destroy();
  });

  it('preserves selection inside the moved block', () => {
    const editor = makeEditor('<p>AAA</p><p>BBB</p>');
    setCursor(editor, 6); // inside <p>BBB</p>, after the 'B'
    dispatchShortcut(editor, 'Mod-Shift-ArrowUp');
    // Block order is now BBB, AAA. Selection should still be inside BBB.
    const { $from } = editor.state.selection;
    expect($from.parent.textContent).toBe('BBB');
    editor.destroy();
  });

  it('handles multi-block moves correctly in sequence', () => {
    const editor = makeEditor('<p>A</p><p>B</p><p>C</p>');
    setCursor(editor, 8); // inside <p>C</p>
    dispatchShortcut(editor, 'Mod-Shift-ArrowUp'); // C up: A, C, B
    dispatchShortcut(editor, 'Mod-Shift-ArrowUp'); // C up: C, A, B
    expect(getBlockTexts(editor)).toEqual(['C', 'A', 'B']);
    editor.destroy();
  });
});
