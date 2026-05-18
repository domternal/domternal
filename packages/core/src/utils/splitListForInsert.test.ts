/**
 * Unit tests for splitListForInsert helper.
 *
 * The util returns a top-level position where the caller should insert
 * its block; the tests check both the returned position and the doc
 * structure after the caller-style insert.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { splitListForInsert } from './splitListForInsert.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { HorizontalRule } from '../nodes/HorizontalRule.js';
import { BulletList } from '../nodes/BulletList.js';
import { OrderedList } from '../nodes/OrderedList.js';
import { ListItem } from '../nodes/ListItem.js';
import { TaskList } from '../nodes/TaskList.js';
import { TaskItem } from '../nodes/TaskItem.js';
import { Editor } from '../Editor.js';

const extensions = [
  Document, Text, Paragraph, HorizontalRule,
  BulletList, OrderedList, ListItem,
  TaskList, TaskItem,
];

function make(content: string): Editor {
  return new Editor({ extensions, content });
}

function setCaretAt(editor: Editor, pos: number): void {
  const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos));
  editor.view.dispatch(tr);
}

function caretAtItemLabel(editor: Editor, itemIndex: number, offset = 0): void {
  let counter = 0;
  let labelStart = -1;
  editor.state.doc.descendants((node, p) => {
    if (labelStart !== -1) return false;
    if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
      if (counter === itemIndex) {
        labelStart = p + 2; // +1 enter item, +1 enter label paragraph
        return false;
      }
      counter++;
    }
    return true;
  });
  if (labelStart === -1) throw new Error(`itemIndex ${String(itemIndex)} not found`);
  setCaretAt(editor, labelStart + offset);
}

interface BlockShape { type: string; text: string }
function topLevelBlocks(editor: Editor): BlockShape[] {
  const out: BlockShape[] = [];
  editor.state.doc.forEach((n) => out.push({ type: n.type.name, text: n.textContent }));
  return out;
}

/** Simulate a CALLER replacing the returned range with HR + trailing paragraph. */
function insertHrAndDispatch(editor: Editor, range: { from: number; to: number }): void {
  const tr = editor.state.tr;
  const hrType = editor.state.schema.nodes['horizontalRule'];
  const pType = editor.state.schema.nodes['paragraph'];
  if (!hrType || !pType) throw new Error('schema missing');
  tr.replaceWith(range.from, range.to, [hrType.create(), pType.create()]);
  editor.view.dispatch(tr);
}

describe('splitListForInsert', () => {
  let editor: Editor | undefined;
  afterEach(() => { if (editor && !editor.isDestroyed) editor.destroy(); });

  describe('non-empty LAST item in list', () => {
    it('returns position after the list - no split', () => {
      editor = make('<ul><li><p>A</p></li><li><p>B</p></li></ul>');
      caretAtItemLabel(editor, 1, 1); // caret somewhere in B
      const tr = editor.state.tr;
      const range = splitListForInsert(editor.state, tr);
      expect(tr.steps.length).toBe(0); // no split when last
      editor.view.dispatch(tr);
      expect(range).not.toBeNull();
      insertHrAndDispatch(editor, range!);
      expect(topLevelBlocks(editor)).toEqual([
        { type: 'bulletList', text: 'AB' },
        { type: 'horizontalRule', text: '' },
        { type: 'paragraph', text: '' },
      ]);
    });

    it('only item in single-item list: insert after that list', () => {
      editor = make('<ul><li><p>Solo</p></li></ul>');
      caretAtItemLabel(editor, 0, 2);
      const tr = editor.state.tr;
      const range = splitListForInsert(editor.state, tr);
      editor.view.dispatch(tr);
      insertHrAndDispatch(editor, range!);
      expect(topLevelBlocks(editor)).toEqual([
        { type: 'bulletList', text: 'Solo' },
        { type: 'horizontalRule', text: '' },
        { type: 'paragraph', text: '' },
      ]);
    });
  });

  describe('non-empty MID item in list', () => {
    it('splits the list around the current item', () => {
      editor = make('<ul><li><p>A</p></li><li><p>B</p></li><li><p>C</p></li></ul>');
      caretAtItemLabel(editor, 1, 1);
      const tr = editor.state.tr;
      const range = splitListForInsert(editor.state, tr);
      expect(tr.steps.length).toBe(1); // one split step
      editor.view.dispatch(tr);
      insertHrAndDispatch(editor, range!);
      expect(topLevelBlocks(editor)).toEqual([
        { type: 'bulletList', text: 'AB' },
        { type: 'horizontalRule', text: '' },
        { type: 'paragraph', text: '' },
        { type: 'bulletList', text: 'C' },
      ]);
    });

    it('splits when current is FIRST of >1 items', () => {
      editor = make('<ul><li><p>A</p></li><li><p>B</p></li><li><p>C</p></li></ul>');
      caretAtItemLabel(editor, 0, 1);
      const tr = editor.state.tr;
      const range = splitListForInsert(editor.state, tr);
      editor.view.dispatch(tr);
      insertHrAndDispatch(editor, range!);
      expect(topLevelBlocks(editor)).toEqual([
        { type: 'bulletList', text: 'A' },
        { type: 'horizontalRule', text: '' },
        { type: 'paragraph', text: '' },
        { type: 'bulletList', text: 'BC' },
      ]);
    });
  });

  describe('EMPTY label', () => {
    it('mid-list empty item: consumes the empty bullet, splits naturally', () => {
      editor = make('<ul><li><p>A</p></li><li><p></p></li><li><p>C</p></li></ul>');
      caretAtItemLabel(editor, 1); // empty item
      const tr = editor.state.tr;
      const range = splitListForInsert(editor.state, tr);
      editor.view.dispatch(tr);
      insertHrAndDispatch(editor, range!);
      expect(topLevelBlocks(editor)).toEqual([
        { type: 'bulletList', text: 'A' },
        { type: 'horizontalRule', text: '' },
        { type: 'paragraph', text: '' },
        { type: 'bulletList', text: 'C' },
      ]);
    });

    it('only item in single-item list, empty: list dissolves', () => {
      editor = make('<ul><li><p></p></li></ul>');
      caretAtItemLabel(editor, 0);
      const tr = editor.state.tr;
      const range = splitListForInsert(editor.state, tr);
      editor.view.dispatch(tr);
      insertHrAndDispatch(editor, range!);
      expect(topLevelBlocks(editor)).toEqual([
        { type: 'horizontalRule', text: '' },
        { type: 'paragraph', text: '' },
      ]);
    });

    it('last empty item of multi-item list: empty item consumed', () => {
      editor = make('<ul><li><p>A</p></li><li><p></p></li></ul>');
      caretAtItemLabel(editor, 1);
      const tr = editor.state.tr;
      const range = splitListForInsert(editor.state, tr);
      editor.view.dispatch(tr);
      insertHrAndDispatch(editor, range!);
      expect(topLevelBlocks(editor)).toEqual([
        { type: 'bulletList', text: 'A' },
        { type: 'horizontalRule', text: '' },
        { type: 'paragraph', text: '' },
      ]);
    });

    it('NESTED empty item (ul > li > ul > li(empty)): lifts until top level', () => {
      // Without the multi-lift loop the lifted paragraph stays inside the
      // outer listItem; replaceWith then rejects the top-level node.
      editor = make('<ul><li><p>Outer</p><ul><li><p></p></li></ul></li></ul>');
      // Caret in the nested empty item label
      let nestedItemCount = 0;
      let labelPos = -1;
      editor.state.doc.descendants((node, p) => {
        if (node.type.name === 'listItem') {
          if (nestedItemCount === 1) {
            labelPos = p + 2;
            return false;
          }
          nestedItemCount++;
        }
        return true;
      });
      if (labelPos === -1) throw new Error('nested item not found');
      setCaretAt(editor, labelPos);
      const tr = editor.state.tr;
      const range = splitListForInsert(editor.state, tr);
      editor.view.dispatch(tr);
      expect(range).not.toBeNull();
      insertHrAndDispatch(editor, range!);
      const blocks = topLevelBlocks(editor);
      // The hr lands at top level; the outer bulletList retains 'Outer'.
      expect(blocks[0]).toEqual({ type: 'bulletList', text: 'Outer' });
      expect(blocks[1]).toEqual({ type: 'horizontalRule', text: '' });
      expect(blocks[2]).toEqual({ type: 'paragraph', text: '' });
    });

    it('deeply nested empty (3 levels): lifts to top level', () => {
      editor = make(
        '<ul><li><p>L1</p><ul><li><p>L2</p><ul><li><p></p></li></ul></li></ul></li></ul>',
      );
      let nestedItemCount = 0;
      let labelPos = -1;
      editor.state.doc.descendants((node, p) => {
        if (node.type.name === 'listItem') {
          if (nestedItemCount === 2) {
            labelPos = p + 2;
            return false;
          }
          nestedItemCount++;
        }
        return true;
      });
      if (labelPos === -1) throw new Error('deeply nested item not found');
      setCaretAt(editor, labelPos);
      const tr = editor.state.tr;
      const range = splitListForInsert(editor.state, tr);
      editor.view.dispatch(tr);
      expect(range).not.toBeNull();
      insertHrAndDispatch(editor, range!);
      const blocks = topLevelBlocks(editor);
      // hr at top level after the lifted, non-empty outer items
      const hrIdx = blocks.findIndex((b) => b.type === 'horizontalRule');
      expect(hrIdx).toBeGreaterThan(-1);
      // Subsequent block is the trailing paragraph
      expect(blocks[hrIdx + 1]?.type).toBe('paragraph');
    });
  });

  describe('list type variants', () => {
    it('works for ordered list', () => {
      editor = make('<ol><li><p>One</p></li><li><p>Two</p></li><li><p>Three</p></li></ol>');
      caretAtItemLabel(editor, 1, 1);
      const tr = editor.state.tr;
      const range = splitListForInsert(editor.state, tr);
      editor.view.dispatch(tr);
      insertHrAndDispatch(editor, range!);
      expect(topLevelBlocks(editor)).toEqual([
        { type: 'orderedList', text: 'OneTwo' },
        { type: 'horizontalRule', text: '' },
        { type: 'paragraph', text: '' },
        { type: 'orderedList', text: 'Three' },
      ]);
    });

    it('works for task list (taskItem type)', () => {
      editor = make('<ul data-type="taskList"><li data-type="taskItem"><p>A</p></li><li data-type="taskItem"><p>B</p></li></ul>');
      caretAtItemLabel(editor, 0, 1);
      const tr = editor.state.tr;
      const range = splitListForInsert(editor.state, tr);
      editor.view.dispatch(tr);
      insertHrAndDispatch(editor, range!);
      const blocks = topLevelBlocks(editor);
      expect(blocks[0]?.type).toBe('taskList');
      expect(blocks[0]?.text).toBe('A');
      expect(blocks[1]?.type).toBe('horizontalRule');
      expect(blocks[2]?.type).toBe('paragraph');
      expect(blocks[3]?.type).toBe('taskList');
      expect(blocks[3]?.text).toBe('B');
    });
  });

  describe('returns null in non-applicable contexts', () => {
    it('cursor in top-level paragraph (no list ancestor)', () => {
      editor = make('<p>Hello</p>');
      setCaretAt(editor, 2);
      const tr = editor.state.tr;
      expect(splitListForInsert(editor.state, tr)).toBeNull();
      expect(tr.steps.length).toBe(0);
    });

    it('cursor in children-zone paragraph of list item (not label)', () => {
      editor = make('<ul><li><p>Label</p><p>Child</p></li></ul>');
      let liPos = -1;
      editor.state.doc.descendants((n, p) => { if (n.type.name === 'listItem') { liPos = p; return false; } return true; });
      const li = editor.state.doc.nodeAt(liPos);
      const labelSize = li?.firstChild?.nodeSize ?? 0;
      setCaretAt(editor, liPos + 1 + labelSize + 1);
      const tr = editor.state.tr;
      expect(splitListForInsert(editor.state, tr)).toBeNull();
      expect(tr.steps.length).toBe(0);
    });

    it('non-empty selection', () => {
      editor = make('<ul><li><p>Hello</p></li></ul>');
      const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3, 6));
      editor.view.dispatch(tr);
      const tr2 = editor.state.tr;
      expect(splitListForInsert(editor.state, tr2)).toBeNull();
    });

    it('chain-safety: returns null if tr already has steps', () => {
      editor = make('<ul><li><p>Hi</p></li></ul>');
      caretAtItemLabel(editor, 0);
      const tr = editor.state.tr;
      tr.insertText('X');
      expect(splitListForInsert(editor.state, tr)).toBeNull();
    });
  });
});
