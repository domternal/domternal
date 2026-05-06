import { describe, it, expect, afterEach } from 'vitest';
import { ListKeymap } from './ListKeymap.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { BulletList } from '../nodes/BulletList.js';
import { OrderedList } from '../nodes/OrderedList.js';
import { ListItem } from '../nodes/ListItem.js';
import { BaseKeymap } from './BaseKeymap.js';
import { Editor } from '../Editor.js';
import { TextSelection } from '@domternal/pm/state';
import { splitListItem } from '@domternal/pm/schema-list';

const baseExtensions = [
  Document,
  Text,
  Paragraph,
  BulletList,
  OrderedList,
  ListItem,
  BaseKeymap,
  ListKeymap,
];

// Helper to get shortcut handlers with proper this context
 
function getShortcuts(editor: Editor, listItem = 'listItem'): Record<string, any> {
  return ListKeymap.config.addKeyboardShortcuts!.call({
    ...ListKeymap,
    editor,
    options: { listItem },
   
  } as never) as Record<string, any>;
}

describe('ListKeymap', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
  });

  describe('configuration', () => {
    it('has correct name', () => {
      expect(ListKeymap.name).toBe('listKeymap');
    });

    it('is an extension type', () => {
      expect(ListKeymap.type).toBe('extension');
    });

    it('has default options', () => {
      const opts = ListKeymap.config.addOptions?.call(ListKeymap);
      expect(opts).toEqual({ listItem: 'listItem' });
    });

    it('can configure listItem type name', () => {
      const custom = ListKeymap.configure({ listItem: 'customListItem' });
      expect(custom.options.listItem).toBe('customListItem');
    });
  });

  describe('addKeyboardShortcuts', () => {
    it('provides Tab, Shift-Tab, and Backspace shortcuts', () => {
      const shortcuts = ListKeymap.config.addKeyboardShortcuts?.call(ListKeymap);
      expect(shortcuts).toHaveProperty('Tab');
      expect(shortcuts).toHaveProperty('Shift-Tab');
      expect(shortcuts).toHaveProperty('Backspace');
    });

    it('shortcut handlers return false when no editor', () => {
       
      const shortcuts = ListKeymap.config.addKeyboardShortcuts!.call({
        ...ListKeymap,
        editor: null,
        options: { listItem: 'listItem' },
       
      } as never) as Record<string, any>;

      expect(shortcuts['Tab']({ editor: null })).toBe(false);
      expect(shortcuts['Shift-Tab']({ editor: null })).toBe(false);
      expect(shortcuts['Backspace']({ editor: null })).toBe(false);
    });
  });

  describe('Tab - sink list item', () => {
    it('sinks second list item in a flat list', () => {
      editor = new Editor({
        extensions: baseExtensions,
        content: '<ul><li>item 1</li><li>item 2</li></ul>',
      });

      // Place cursor in second list item
      const firstItemSize = editor.state.doc.child(0).child(0).nodeSize;
      const secondItemTextPos = 1 + firstItemSize + 2; // bulletList(1) + firstItem + listItem(1) + paragraph(1)
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.near(editor.state.doc.resolve(secondItemTextPos))
        )
      );

      const shortcuts = getShortcuts(editor);
      const result = shortcuts['Tab']({ editor });
      expect(result).toBe(true);
    });

    it('returns false when cursor is not in a list', () => {
      editor = new Editor({
        extensions: baseExtensions,
        content: '<p>plain paragraph</p>',
      });

      const shortcuts = getShortcuts(editor);
      expect(shortcuts['Tab']({ editor })).toBe(false);
    });

    it('returns false when listItem type does not exist in schema', () => {
      editor = new Editor({
        extensions: baseExtensions,
        content: '<ul><li>item</li></ul>',
      });

      const shortcuts = getShortcuts(editor, 'nonExistentType');
      expect(shortcuts['Tab']({ editor })).toBe(false);
    });
  });

  describe('Shift-Tab - lift list item', () => {
    it('lifts nested list item', () => {
      editor = new Editor({
        extensions: baseExtensions,
        content: '<ul><li>item 1<ul><li>nested</li></ul></li></ul>',
      });

      // Find the nested item text and place cursor there
      let nestedPos = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'nested') {
          nestedPos = pos;
        }
      });

      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.near(editor.state.doc.resolve(nestedPos))
        )
      );

      const shortcuts = getShortcuts(editor);
      const result = shortcuts['Shift-Tab']({ editor });
      expect(result).toBe(true);
    });

    it('returns false when cursor is not in a list', () => {
      editor = new Editor({
        extensions: baseExtensions,
        content: '<p>plain paragraph</p>',
      });

      const shortcuts = getShortcuts(editor);
      expect(shortcuts['Shift-Tab']({ editor })).toBe(false);
    });

    it('returns false when listItem type does not exist in schema', () => {
      editor = new Editor({
        extensions: baseExtensions,
        content: '<ul><li>item</li></ul>',
      });

      const shortcuts = getShortcuts(editor, 'nonExistentType');
      expect(shortcuts['Shift-Tab']({ editor })).toBe(false);
    });
  });

  describe('Backspace - lift at start', () => {
    it('lifts list item when cursor is at start', () => {
      editor = new Editor({
        extensions: baseExtensions,
        content: '<ul><li>item</li></ul>',
      });

      // Place cursor at very start of list item text
      let itemTextPos = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'item') {
          itemTextPos = pos;
        }
      });

      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, itemTextPos)
        )
      );

      const shortcuts = getShortcuts(editor);
      const result = shortcuts['Backspace']({ editor });
      expect(result).toBe(true);
    });

    it('returns false when cursor is not at start of text', () => {
      editor = new Editor({
        extensions: baseExtensions,
        content: '<ul><li>item</li></ul>',
      });

      // Place cursor in middle of text
      let itemTextPos = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'item') {
          itemTextPos = pos;
        }
      });

      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, itemTextPos + 2)
        )
      );

      const shortcuts = getShortcuts(editor);
      expect(shortcuts['Backspace']({ editor })).toBe(false);
    });

    it('returns false when cursor is not in a list', () => {
      editor = new Editor({
        extensions: baseExtensions,
        content: '<p>plain</p>',
      });

      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1)
        )
      );

      const shortcuts = getShortcuts(editor);
      expect(shortcuts['Backspace']({ editor })).toBe(false);
    });

    it('returns false with non-empty selection', () => {
      editor = new Editor({
        extensions: baseExtensions,
        content: '<ul><li>item</li></ul>',
      });

      let itemTextPos = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'item') {
          itemTextPos = pos;
        }
      });

      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, itemTextPos, itemTextPos + 2)
        )
      );

      const shortcuts = getShortcuts(editor);
      expect(shortcuts['Backspace']({ editor })).toBe(false);
    });

    it('returns false when listItem type does not exist in schema', () => {
      editor = new Editor({
        extensions: baseExtensions,
        content: '<ul><li>item</li></ul>',
      });

      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 3)
        )
      );

      const shortcuts = getShortcuts(editor, 'nonExistentType');
      expect(shortcuts['Backspace']({ editor })).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // "Exit-join" Backspace: empty paragraph preceded by a list-group node.
  // Without this branch, PM's joinBackward wraps the empty paragraph back
  // into the list as a new listItem (the "ping-pong" regression).
  // ────────────────────────────────────────────────────────────────────

  describe('Backspace - exit-join after list', () => {
    function caretAtStartOfNthEmptyP(ed: Editor, n: number): void {
      let count = 0;
      let pos = -1;
      ed.state.doc.descendants((node, p) => {
        if (pos !== -1) return false;
        if (node.type.name === 'paragraph' && node.content.size === 0) {
          if (count === n) { pos = p + 1; return false; }
          count++;
        }
        return true;
      });
      if (pos === -1) throw new Error(`empty paragraph #${String(n)} not found`);
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
    }

    it('bullet: BS in empty top-level p preceded by ul deletes p, caret at end of last text', () => {
      editor = new Editor({
        extensions: baseExtensions,
        content: '<ul><li><p>hello</p></li></ul><p></p>',
      });
      caretAtStartOfNthEmptyP(editor, 0);

      const shortcuts = getShortcuts(editor);
      const result = shortcuts['Backspace']({ editor });
      expect(result).toBe(true);
      expect(editor.getHTML()).toBe('<ul><li><p>hello</p></li></ul>');
      expect(editor.state.selection.$from.parent.textContent).toBe('hello');
    });

    it('ordered: BS in empty top-level p preceded by ol deletes p, caret at end of last text', () => {
      editor = new Editor({
        extensions: baseExtensions,
        content: '<ol><li><p>hello</p></li></ol><p></p>',
      });
      caretAtStartOfNthEmptyP(editor, 0);

      const shortcuts = getShortcuts(editor);
      const result = shortcuts['Backspace']({ editor });
      expect(result).toBe(true);
      expect(editor.getHTML()).toBe('<ol><li><p>hello</p></li></ol>');
    });

    it('multi-item bullet: caret lands at end of LAST item text', () => {
      editor = new Editor({
        extensions: baseExtensions,
        content: '<ul><li><p>a</p></li><li><p>b</p></li><li><p>c</p></li></ul><p></p>',
      });
      caretAtStartOfNthEmptyP(editor, 0);

      const shortcuts = getShortcuts(editor);
      expect(shortcuts['Backspace']({ editor })).toBe(true);
      expect(editor.state.selection.$from.parent.textContent).toBe('c');
    });

    it('item with children-zone p: caret lands at end of LAST textblock (children-zone p, not label)', () => {
      editor = new Editor({
        extensions: baseExtensions,
        content: '<ul><li><p>label</p><p>note</p></li></ul><p></p>',
      });
      caretAtStartOfNthEmptyP(editor, 0);

      const shortcuts = getShortcuts(editor);
      expect(shortcuts['Backspace']({ editor })).toBe(true);
      expect(editor.state.selection.$from.parent.textContent).toBe('note');
    });

    it('returns false (falls through) when previous sibling is a paragraph (not a list)', () => {
      editor = new Editor({
        extensions: baseExtensions,
        content: '<p>a</p><p></p>',
      });
      caretAtStartOfNthEmptyP(editor, 0);

      const shortcuts = getShortcuts(editor);
      // Cursor is in the empty p, previous sibling is a paragraph - the
      // exit-join branch must NOT fire.
      expect(shortcuts['Backspace']({ editor })).toBe(false);
    });

    it('returns false when paragraph is the FIRST child of its container (no previous sibling)', () => {
      editor = new Editor({
        extensions: baseExtensions,
        content: '<p></p><ul><li><p>x</p></li></ul>',
      });
      caretAtStartOfNthEmptyP(editor, 0);

      const shortcuts = getShortcuts(editor);
      // Cursor at index 0, no previous sibling.
      expect(shortcuts['Backspace']({ editor })).toBe(false);
    });

    it('returns false when paragraph has content', () => {
      editor = new Editor({
        extensions: baseExtensions,
        content: '<ul><li><p>a</p></li></ul><p>x</p>',
      });
      // Caret at start of "x"
      let pos = -1;
      editor.state.doc.descendants((node, p) => {
        if (pos !== -1) return false;
        if (node.isText && node.text === 'x') { pos = p; return false; }
        return true;
      });
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));

      const shortcuts = getShortcuts(editor);
      // Non-empty paragraph - exit-join branch doesn't fire (content.size guard).
      expect(shortcuts['Backspace']({ editor })).toBe(false);
    });

    // ────────────────────────────────────────────────────────────────────
    // Empty p sandwiched between two same-type list groups: the common
    // shape after Enter (splitListItem) + Backspace (liftListItem) on a
    // MIDDLE item. The two list halves must be joined back into one.
    // ────────────────────────────────────────────────────────────────────

    it('bullet+bullet sandwich: joins the two ul halves into one', () => {
      editor = new Editor({
        extensions: baseExtensions,
        content: '<ul><li><p>a</p></li><li><p>b</p></li></ul><p></p><ul><li><p>c</p></li></ul>',
      });
      caretAtStartOfNthEmptyP(editor, 0);

      const shortcuts = getShortcuts(editor);
      expect(shortcuts['Backspace']({ editor })).toBe(true);
      expect(editor.getHTML()).toBe('<ul><li><p>a</p></li><li><p>b</p></li><li><p>c</p></li></ul>');
      // Caret at end of "b" (the last textblock of the prev list before the join).
      expect(editor.state.selection.$from.parent.textContent).toBe('b');
    });

    it('ordered+ordered sandwich: joins the two ol halves into one', () => {
      editor = new Editor({
        extensions: baseExtensions,
        content: '<ol><li><p>1</p></li><li><p>2</p></li></ol><p></p><ol><li><p>3</p></li></ol>',
      });
      caretAtStartOfNthEmptyP(editor, 0);

      const shortcuts = getShortcuts(editor);
      expect(shortcuts['Backspace']({ editor })).toBe(true);
      expect(editor.getHTML()).toBe('<ol><li><p>1</p></li><li><p>2</p></li><li><p>3</p></li></ol>');
      expect(editor.state.selection.$from.parent.textContent).toBe('2');
    });

    it('bullet+ordered sandwich (different types): does NOT join, but still deletes the empty p', () => {
      editor = new Editor({
        extensions: baseExtensions,
        content: '<ul><li><p>a</p></li></ul><p></p><ol><li><p>1</p></li></ol>',
      });
      caretAtStartOfNthEmptyP(editor, 0);

      const shortcuts = getShortcuts(editor);
      expect(shortcuts['Backspace']({ editor })).toBe(true);
      expect(editor.getHTML()).toBe('<ul><li><p>a</p></li></ul><ol><li><p>1</p></li></ol>');
      expect(editor.state.selection.$from.parent.textContent).toBe('a');
    });

    it('full Enter+BS+BS flow on a MIDDLE bullet item: list stays unified', () => {
      editor = new Editor({
        extensions: baseExtensions,
        content: '<ul><li><p>first</p></li><li><p>second</p></li><li><p>third</p></li></ul>',
      });

      // Place cursor at the END of the second item's text.
      let secondEnd = -1;
      editor.state.doc.descendants((node, p) => {
        if (node.isText && node.text === 'second') secondEnd = p + node.nodeSize;
      });
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, secondEnd)),
      );

      // Enter: invokes splitListItem via the keymap chain.
      const liType = editor.state.schema.nodes['listItem'];
      if (!liType) throw new Error('listItem type missing from schema');
      splitListItem(liType)(editor.state, editor.view.dispatch);

      // BS#1: liftListItem on the new empty middle item -> splits the list.
      let shortcuts = getShortcuts(editor);
      expect(shortcuts['Backspace']({ editor })).toBe(true);

      // The PM standard behaviour after liftListItem on a middle empty item
      // is: ul[1, 2] + p"" + ul[3]. We assert that shape before BS#2 to make
      // the regression target explicit.
      expect(editor.getHTML()).toBe(
        '<ul><li><p>first</p></li><li><p>second</p></li></ul><p></p><ul><li><p>third</p></li></ul>',
      );

      // BS#2: exit-join + same-type join -> single unified list, caret at end of "second".
      shortcuts = getShortcuts(editor);
      expect(shortcuts['Backspace']({ editor })).toBe(true);
      expect(editor.getHTML()).toBe(
        '<ul><li><p>first</p></li><li><p>second</p></li><li><p>third</p></li></ul>',
      );
      expect(editor.state.selection.$from.parent.textContent).toBe('second');
    });
  });
});
