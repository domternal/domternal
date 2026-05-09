import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection, SelectionRange } from '@domternal/pm/state';
import { toggleList } from './listCommands.js';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { BulletList } from '../nodes/BulletList.js';
import { OrderedList } from '../nodes/OrderedList.js';
import { ListItem } from '../nodes/ListItem.js';
import { TaskList } from '../nodes/TaskList.js';
import { TaskItem } from '../nodes/TaskItem.js';

const extensions = [Document, Text, Paragraph, BulletList, OrderedList, ListItem, TaskList, TaskItem];

function setSelection(editor: Editor, from: number, to?: number): void {
  const tr = editor.state.tr.setSelection(
    TextSelection.create(editor.state.doc, from, to ?? from)
  );
  editor.view.dispatch(tr);
}

describe('listCommands', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.view.dom.remove();
      editor.destroy();
    }
  });

  describe('toggleList', () => {
    it('wraps paragraph in bullet list', () => {
      editor = new Editor({ extensions, content: '<p>Item</p>' });
      setSelection(editor, 2);
      editor.commands.toggleList('bulletList', 'listItem');
      expect(editor.getHTML()).toContain('<ul>');
      expect(editor.getHTML()).toContain('<li>');
    });

    it('wraps paragraph in ordered list', () => {
      editor = new Editor({ extensions, content: '<p>Item</p>' });
      setSelection(editor, 2);
      editor.commands.toggleList('orderedList', 'listItem');
      expect(editor.getHTML()).toContain('<ol>');
    });

    it('unwraps bullet list back to paragraph', () => {
      editor = new Editor({ extensions, content: '<ul><li><p>Item</p></li></ul>' });
      setSelection(editor, 3);
      editor.commands.toggleList('bulletList', 'listItem');
      expect(editor.getHTML()).not.toContain('<ul>');
      expect(editor.getHTML()).toContain('Item');
    });

    it('converts bullet list to ordered list', () => {
      editor = new Editor({ extensions, content: '<ul><li><p>Item</p></li></ul>' });
      setSelection(editor, 3);
      editor.commands.toggleList('orderedList', 'listItem');
      expect(editor.getHTML()).toContain('<ol>');
      expect(editor.getHTML()).not.toContain('<ul>');
    });

    it('returns false for unknown list type', () => {
      editor = new Editor({ extensions, content: '<p>Text</p>' });
      setSelection(editor, 2);
      expect(editor.commands.toggleList('fakeList', 'listItem')).toBe(false);
    });

    it('handles multi-paragraph selection', () => {
      editor = new Editor({ extensions, content: '<p>One</p><p>Two</p>' });
      setSelection(editor, 2, 8);
      editor.commands.toggleList('bulletList', 'listItem');
      const html = editor.getHTML();
      expect(html).toContain('<ul>');
      // Both items should be in the list
      expect(html).toContain('One');
      expect(html).toContain('Two');
    });

    it('wraps in task list', () => {
      editor = new Editor({ extensions, content: '<p>Task</p>' });
      setSelection(editor, 2);
      editor.commands.toggleList('taskList', 'taskItem');
      expect(editor.getHTML()).toContain('data-type="taskList"');
    });

    it('mixed: bullet list + paragraphs → toggle bullet list flattens and wraps', () => {
      editor = new Editor({
        extensions,
        content: '<ul><li><p>first</p></li></ul><p>second</p><p>third</p>',
      });
      // Select all content
      const docSize = editor.state.doc.content.size;
      setSelection(editor, 0, docSize);
      const result = editor.commands.toggleList('bulletList', 'listItem');
      const html = editor.getHTML();
      expect(result).toBe(true);
      expect(html).toContain('first');
      expect(html).toContain('second');
      expect(html).toContain('third');
      // Should be a single flat bullet list, NOT nested
      const ulCount = (html.match(/<ul>/g) ?? []).length;
      expect(ulCount).toBe(1);
    });

    it('mixed: bullet list + paragraphs → toggle ordered list', () => {
      editor = new Editor({
        extensions,
        content: '<ul><li><p>first</p></li></ul><p>second</p><p>third</p>',
      });
      const docSize = editor.state.doc.content.size;
      setSelection(editor, 0, docSize);
      editor.commands.toggleList('orderedList', 'listItem');
      const html = editor.getHTML();
      expect(html).toContain('<ol>');
      expect(html).not.toContain('<ul>');
      expect(html).toContain('first');
      expect(html).toContain('second');
    });
  });

  describe('toggleList with multi-range selection (CellSelection simulation)', () => {
    // Build a fake selection that has ranges.length > 1 to exercise the
    // multi-range code path without requiring extension-table.
    function invokeToggleList(
      ed: Editor,
      ranges: SelectionRange[],
      listNodeName: string,
      listItemNodeName: string,
    ): boolean {
      const state = ed.state;
      const tr = state.tr;
      const fakeSel: any = {
        ranges,
        $from: ranges[0]!.$from,
        $to: ranges[ranges.length - 1]!.$to,
        from: ranges[0]!.$from.pos,
        to: ranges[ranges.length - 1]!.$to.pos,
      };
      Object.defineProperty(tr, 'selection', { value: fakeSel, configurable: true });
      const cmd = toggleList(listNodeName, listItemNodeName);
      return cmd({
        editor: ed,
        state,
        tr,
        dispatch: (t) => { ed.view.dispatch(t); },
        chain: () => ed.chain(),
        can: () => ed.can(),
        commands: ed.commands,
      });
    }

    it('multi-range: wraps multiple unrelated blocks into lists', () => {
      editor = new Editor({
        extensions,
        content: '<p>first</p><p>second</p><p>third</p>',
      });
      const doc = editor.state.doc;
      const r1 = new SelectionRange(doc.resolve(1), doc.resolve(6));
      const r2 = new SelectionRange(doc.resolve(8), doc.resolve(14));
      const result = invokeToggleList(editor, [r1, r2], 'bulletList', 'listItem');
      expect(result).toBe(true);
      const html = editor.getHTML();
      expect(html).toContain('<ul>');
    });

    it('multi-range: all in target list → lifts items out', () => {
      editor = new Editor({
        extensions,
        content:
          '<ul><li><p>a</p></li></ul><ul><li><p>b</p></li></ul>',
      });
      const doc = editor.state.doc;
      // Both list item paragraph positions
      const pos1 = 3;
      const pos2 = 9;
      const r1 = new SelectionRange(doc.resolve(pos1), doc.resolve(pos1 + 1));
      const r2 = new SelectionRange(doc.resolve(pos2), doc.resolve(pos2 + 1));
      const result = invokeToggleList(editor, [r1, r2], 'bulletList', 'listItem');
      expect(result).toBe(true);
    });

    it('multi-range: some in other list → converts type', () => {
      editor = new Editor({
        extensions,
        content:
          '<ul><li><p>a</p></li></ul><ul><li><p>b</p></li></ul>',
      });
      const doc = editor.state.doc;
      const pos1 = 3;
      const pos2 = 9;
      const r1 = new SelectionRange(doc.resolve(pos1), doc.resolve(pos1 + 1));
      const r2 = new SelectionRange(doc.resolve(pos2), doc.resolve(pos2 + 1));
      const result = invokeToggleList(editor, [r1, r2], 'orderedList', 'listItem');
      expect(result).toBe(true);
    });

    it('multi-range: dispatch=undefined returns true when toggle possible', () => {
      editor = new Editor({ extensions, content: '<p>first</p><p>second</p>' });
      const doc = editor.state.doc;
      const r1 = new SelectionRange(doc.resolve(1), doc.resolve(6));
      const r2 = new SelectionRange(doc.resolve(8), doc.resolve(14));
      const state = editor.state;
      const tr = state.tr;
      const fakeSel: any = { ranges: [r1, r2], $from: r1.$from, $to: r2.$to, from: r1.$from.pos, to: r2.$to.pos };
      Object.defineProperty(tr, 'selection', { value: fakeSel, configurable: true });
      const cmd = toggleList('bulletList', 'listItem');
      const result = cmd({ editor: editor, state, tr, dispatch: undefined, chain: () => editor!.chain(), can: () => editor!.can(), commands: editor.commands });
      expect(result).toBe(true);
    });

    it('multi-range: taskItem cross-type conversion via replaceWith', () => {
      editor = new Editor({
        extensions,
        content:
          '<ul data-type="taskList"><li data-type="taskItem"><p>a</p></li></ul><ul data-type="taskList"><li data-type="taskItem"><p>b</p></li></ul>',
      });
      const doc = editor.state.doc;
      const pos1 = 3;
      const pos2 = 9;
      const r1 = new SelectionRange(doc.resolve(pos1), doc.resolve(pos1 + 1));
      const r2 = new SelectionRange(doc.resolve(pos2), doc.resolve(pos2 + 1));
      // Convert taskList → bulletList (cross-type: taskItem → listItem)
      const result = invokeToggleList(editor, [r1, r2], 'bulletList', 'listItem');
      expect(result).toBe(true);
    });
  });

  describe('toggleList single-range edge cases', () => {
    it('returns true without dispatch when all in some list (can convert)', () => {
      editor = new Editor({ extensions, content: '<ul><li><p>a</p></li></ul>' });
      const state = editor.state;
      const tr = state.tr;
      tr.setSelection(TextSelection.create(state.doc, 3));
      const cmd = toggleList('orderedList', 'listItem');
      const result = cmd({ editor: editor, state, tr, dispatch: undefined, chain: () => editor!.chain(), can: () => editor!.can(), commands: editor.commands });
      expect(result).toBe(true);
    });

    it('joinListBackwards merges adjacent lists of same type', () => {
      editor = new Editor({
        extensions,
        content: '<ul><li><p>first</p></li></ul><p>second</p>',
      });
      // Select the trailing paragraph
      const docSize = editor.state.doc.content.size;
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, docSize - 2, docSize - 1)));
      const result = editor.commands.toggleList('bulletList', 'listItem');
      expect(result).toBe(true);
      const html = editor.getHTML();
      const ulCount = (html.match(/<ul>/g) ?? []).length;
      // Should merge into one list
      expect(ulCount).toBe(1);
    });

    it('joinListForwards merges with following list of same type', () => {
      editor = new Editor({
        extensions,
        content: '<p>first</p><ul><li><p>second</p></li></ul>',
      });
      // Select leading paragraph
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6)));
      const result = editor.commands.toggleList('bulletList', 'listItem');
      expect(result).toBe(true);
      const html = editor.getHTML();
      const ulCount = (html.match(/<ul>/g) ?? []).length;
      expect(ulCount).toBe(1);
    });

    it('multi-range cellInTarget branch (continue) skips already-target list cells', () => {
      editor = new Editor({
        extensions,
        content:
          '<ul><li><p>a</p></li></ul><p>b</p>',
      });
      const doc = editor.state.doc;
      const r1 = new SelectionRange(doc.resolve(3), doc.resolve(3));
      const r2 = new SelectionRange(doc.resolve(8), doc.resolve(9));
      const state = editor.state;
      const tr = state.tr;
      Object.defineProperty(tr, 'selection', {
        value: { ranges: [r1, r2], $from: r1.$from, $to: r2.$to, from: r1.$from.pos, to: r2.$to.pos },
        configurable: true,
      });
      const cmd = toggleList('bulletList', 'listItem');
      const result = cmd({ editor: editor, state, tr, dispatch: (t) => { editor!.view.dispatch(t); }, chain: () => editor!.chain(), can: () => editor!.can(), commands: editor.commands });
      expect(result).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Children-zone exception. Cursor in a non-label paragraph of a list
  // item should INSERT a new list at the cursor instead of converting
  // the ancestor list. Without this, a slash-command "Numbered list"
  // on an empty children-zone paragraph silently re-types the parent
  // bullet list.
  // ────────────────────────────────────────────────────────────────────

  describe('toggleList children-zone exception', () => {
    function caretAtNthEmptyP(ed: Editor, n: number): void {
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

    function caretAtEndOfText(ed: Editor, text: string): void {
      let pos = -1;
      ed.state.doc.descendants((node, p) => {
        if (pos !== -1) return false;
        if (node.isText && node.text === text) { pos = p + text.length; return false; }
        return true;
      });
      if (pos === -1) throw new Error(`text "${text}" not found`);
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)));
    }

    it('empty children-zone p in bullet item: toggleOrderedList inserts NEW ol, parent ul stays bullet', () => {
      editor = new Editor({
        extensions,
        content: '<ul><li><p>label</p><p></p></li></ul>',
      });
      caretAtNthEmptyP(editor, 0);
      const result = editor.commands.toggleList('orderedList', 'listItem');
      expect(result).toBe(true);
      const ul = editor.state.doc.firstChild;
      expect(ul?.type.name).toBe('bulletList');
      const li = ul?.firstChild;
      expect(li?.type.name).toBe('listItem');
      // li children: [label paragraph, NEW ordered list]
      expect(li?.childCount).toBe(2);
      expect(li?.child(0).type.name).toBe('paragraph');
      expect(li?.child(1).type.name).toBe('orderedList');
    });

    it('non-empty children-zone p in bullet item: toggleOrderedList inserts NEW ol, parent ul stays bullet', () => {
      editor = new Editor({
        extensions,
        content: '<ul><li><p>label</p><p>note</p></li></ul>',
      });
      caretAtEndOfText(editor, 'note');
      const result = editor.commands.toggleList('orderedList', 'listItem');
      expect(result).toBe(true);
      const ul = editor.state.doc.firstChild;
      expect(ul?.type.name).toBe('bulletList');
      const li = ul?.firstChild;
      expect(li?.childCount).toBe(2);
      const newOl = li?.child(1);
      expect(newOl?.type.name).toBe('orderedList');
      expect(newOl?.firstChild?.textContent).toBe('note');
    });

    it('empty children-zone p in task item: toggleBulletList inserts NEW ul, parent taskList stays', () => {
      editor = new Editor({
        extensions,
        content:
          '<ul data-type="taskList"><li data-type="taskItem" data-checked="false">' +
          '<label contenteditable="false"><input type="checkbox"></label>' +
          '<div><p>task</p><p></p></div></li></ul>',
      });
      caretAtNthEmptyP(editor, 0);
      const result = editor.commands.toggleList('bulletList', 'listItem');
      expect(result).toBe(true);
      const taskList = editor.state.doc.firstChild;
      expect(taskList?.type.name).toBe('taskList');
      const taskItem = taskList?.firstChild;
      expect(taskItem?.type.name).toBe('taskItem');
      // Last child of taskItem is the new bullet list.
      const lastChild = taskItem?.lastChild;
      expect(lastChild?.type.name).toBe('bulletList');
    });

    it('LABEL paragraph (childIndex 0) keeps existing convert behaviour: toggleOrderedList on bullet label converts ul to ol', () => {
      editor = new Editor({
        extensions,
        content: '<ul><li><p>label</p></li></ul>',
      });
      caretAtEndOfText(editor, 'label');
      const result = editor.commands.toggleList('orderedList', 'listItem');
      expect(result).toBe(true);
      // The ENTIRE list is converted, not "wrapped in another list".
      const top = editor.state.doc.firstChild;
      expect(top?.type.name).toBe('orderedList');
    });

    it('children-zone p between an existing ol sibling and a heading: new ol merges with the sibling ol via joinListBackwards', () => {
      editor = new Editor({
        extensions,
        content:
          '<ul><li><p>label</p><ol><li><p>existing</p></li></ol><p></p></li></ul>',
      });
      caretAtNthEmptyP(editor, 0);
      const result = editor.commands.toggleList('orderedList', 'listItem');
      expect(result).toBe(true);
      const li = editor.state.doc.firstChild?.firstChild;
      // Adjacent ols of same type merge into one.
      expect(li?.childCount).toBe(2);
      expect(li?.child(1).type.name).toBe('orderedList');
      expect(li?.child(1).childCount).toBe(2);
      expect(li?.child(1).child(0).textContent).toBe('existing');
      expect(li?.child(1).child(1).textContent).toBe('');
    });

    it('top-level empty p (no list ancestor): existing wrap path runs (control)', () => {
      editor = new Editor({
        extensions,
        content: '<p></p>',
      });
      caretAtNthEmptyP(editor, 0);
      const result = editor.commands.toggleList('orderedList', 'listItem');
      expect(result).toBe(true);
      expect(editor.state.doc.firstChild?.type.name).toBe('orderedList');
    });

    it('range selection (non-collapsed) does not trigger the children-zone branch', () => {
      // Non-collapsed selection in a children-zone p still goes through the
      // generic toggle path. Documents the boundary of the new branch.
      editor = new Editor({
        extensions,
        content: '<ul><li><p>label</p><p>content</p></li></ul>',
      });
      // Select the whole "content" word.
      let from = -1;
      let to = -1;
      editor.state.doc.descendants((node, p) => {
        if (node.isText && node.text === 'content') { from = p; to = p + node.nodeSize; return false; }
        return true;
      });
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
      const result = editor.commands.toggleList('orderedList', 'listItem');
      expect(result).toBe(true);
      // Convert path: parent bullet list becomes ordered list (existing behaviour).
      expect(editor.state.doc.firstChild?.type.name).toBe('orderedList');
    });

    it('returns true without dispatch when collapsed in children-zone (can wrap)', () => {
      editor = new Editor({
        extensions,
        content: '<ul><li><p>label</p><p></p></li></ul>',
      });
      caretAtNthEmptyP(editor, 0);
      const ok = editor.can().toggleList('orderedList', 'listItem');
      expect(ok).toBe(true);
    });
  });
});
