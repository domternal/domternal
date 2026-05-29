/**
 * Unit tests for liftCurrentListItem helper.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { liftCurrentListItem } from './liftCurrentListItem.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Heading } from '../nodes/Heading.js';
import { BulletList } from '../nodes/BulletList.js';
import { OrderedList } from '../nodes/OrderedList.js';
import { ListItem } from '../nodes/ListItem.js';
import { TaskList } from '../nodes/TaskList.js';
import { TaskItem } from '../nodes/TaskItem.js';
import { Editor } from '../Editor.js';

const extensions = [
  Document, Text, Paragraph, Heading,
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
        const label = node.firstChild;
        if (label) labelStart = p + 1 + 1; // +1 enter item, +1 enter label paragraph
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

describe('liftCurrentListItem', () => {
  let editor: Editor | undefined;
  afterEach(() => { if (editor && !editor.isDestroyed) editor.destroy(); });

  it('lifts a mid-list item out, splits the list around it', () => {
    editor = make('<ul><li><p>A</p></li><li><p>B</p></li><li><p>C</p></li></ul>');
    caretAtItemLabel(editor, 1);
    const tr = editor.state.tr;
    const ok = liftCurrentListItem(editor.state, tr);
    editor.view.dispatch(tr);
    expect(ok).toBe(true);
    expect(topLevelBlocks(editor)).toEqual([
      { type: 'bulletList', text: 'A' },
      { type: 'paragraph', text: 'B' },
      { type: 'bulletList', text: 'C' },
    ]);
  });

  it('lifts the only item out (whole list dissolves)', () => {
    editor = make('<ul><li><p>Solo</p></li></ul>');
    caretAtItemLabel(editor, 0);
    const tr = editor.state.tr;
    const ok = liftCurrentListItem(editor.state, tr);
    editor.view.dispatch(tr);
    expect(ok).toBe(true);
    expect(topLevelBlocks(editor)).toEqual([{ type: 'paragraph', text: 'Solo' }]);
  });

  it('lifts last item out, list keeps preceding items', () => {
    editor = make('<ul><li><p>A</p></li><li><p>B</p></li></ul>');
    caretAtItemLabel(editor, 1);
    const tr = editor.state.tr;
    const ok = liftCurrentListItem(editor.state, tr);
    editor.view.dispatch(tr);
    expect(ok).toBe(true);
    expect(topLevelBlocks(editor)).toEqual([
      { type: 'bulletList', text: 'A' },
      { type: 'paragraph', text: 'B' },
    ]);
  });

  it('lifts first item out, list keeps following items', () => {
    editor = make('<ul><li><p>A</p></li><li><p>B</p></li></ul>');
    caretAtItemLabel(editor, 0);
    const tr = editor.state.tr;
    const ok = liftCurrentListItem(editor.state, tr);
    editor.view.dispatch(tr);
    expect(ok).toBe(true);
    expect(topLevelBlocks(editor)).toEqual([
      { type: 'paragraph', text: 'A' },
      { type: 'bulletList', text: 'B' },
    ]);
  });

  it('works on ordered list items', () => {
    editor = make('<ol><li><p>One</p></li><li><p>Two</p></li></ol>');
    caretAtItemLabel(editor, 0);
    const tr = editor.state.tr;
    const ok = liftCurrentListItem(editor.state, tr);
    editor.view.dispatch(tr);
    expect(ok).toBe(true);
    expect(topLevelBlocks(editor)).toEqual([
      { type: 'paragraph', text: 'One' },
      { type: 'orderedList', text: 'Two' },
    ]);
  });

  it('works on task list items (taskItem type)', () => {
    editor = make('<ul data-type="taskList"><li data-type="taskItem"><p>Task A</p></li><li data-type="taskItem"><p>Task B</p></li></ul>');
    caretAtItemLabel(editor, 0);
    const tr = editor.state.tr;
    const ok = liftCurrentListItem(editor.state, tr);
    editor.view.dispatch(tr);
    expect(ok).toBe(true);
    const blocks = topLevelBlocks(editor);
    expect(blocks[0]).toEqual({ type: 'paragraph', text: 'Task A' });
    expect(blocks[1]?.type).toBe('taskList');
    expect(blocks[1]?.text).toBe('Task B');
  });

  it('returns false when cursor is NOT in a list item', () => {
    editor = make('<p>Plain</p>');
    setCaretAt(editor, 1);
    const tr = editor.state.tr;
    const ok = liftCurrentListItem(editor.state, tr);
    expect(ok).toBe(false);
    expect(tr.steps.length).toBe(0);
  });

  it('returns false when cursor is in children-zone (not label) paragraph', () => {
    editor = make('<ul><li><p>Label</p><p>Child-zone</p></li></ul>');
    // Caret in the second paragraph (children-zone, index 1)
    let liPos = -1;
    editor.state.doc.descendants((n, p) => { if (n.type.name === 'listItem') { liPos = p; return false; } return true; });
    const li = editor.state.doc.nodeAt(liPos);
    const label = li?.firstChild;
    const labelSize = label?.nodeSize ?? 0;
    // +1 to enter li, +labelSize past label, +1 to enter the second paragraph
    setCaretAt(editor, liPos + 1 + labelSize + 1);
    const tr = editor.state.tr;
    const ok = liftCurrentListItem(editor.state, tr);
    expect(ok).toBe(false);
    expect(tr.steps.length).toBe(0);
  });

  it('returns false when selection is non-empty', () => {
    editor = make('<ul><li><p>Hello world</p></li></ul>');
    const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3, 7));
    editor.view.dispatch(tr);
    const tr2 = editor.state.tr;
    const ok = liftCurrentListItem(editor.state, tr2);
    expect(ok).toBe(false);
  });

  it('returns false when tr already has steps (chain-safety)', () => {
    editor = make('<ul><li><p>Hello</p></li></ul>');
    caretAtItemLabel(editor, 0);
    const tr = editor.state.tr;
    tr.insertText('X');
    const ok = liftCurrentListItem(editor.state, tr);
    expect(ok).toBe(false);
  });

  // ── Nested lists: keep the block at its current indentation (Notion's
  //    "Turn into" semantics). A nested item is lifted ONE level into its
  //    parent's children zone, NOT out to the top level. ──

  /** Direct children {type,text} of the first list item whose label === labelText. */
  function listItemChildren(editor: Editor, labelText: string): BlockShape[] {
    const out: BlockShape[] = [];
    editor.state.doc.descendants((node) => {
      if (out.length > 0) return false;
      if ((node.type.name === 'listItem' || node.type.name === 'taskItem')
        && node.firstChild?.textContent === labelText) {
        node.forEach((c) => out.push({ type: c.type.name, text: c.textContent }));
        return false;
      }
      return true;
    });
    return out;
  }

  it('lifts a NESTED item into the parent children zone (stays indented)', () => {
    editor = make('<ul><li><p>First</p><ul><li><p>Inner</p></li></ul></li></ul>');
    caretAtItemLabel(editor, 1); // the inner item
    const tr = editor.state.tr;
    const ok = liftCurrentListItem(editor.state, tr);
    editor.view.dispatch(tr);
    expect(ok).toBe(true);
    // "Inner" is now a children-zone paragraph of "First" (inner list dissolved),
    // not lifted out to the top level.
    expect(listItemChildren(editor, 'First')).toEqual([
      { type: 'paragraph', text: 'First' },
      { type: 'paragraph', text: 'Inner' },
    ]);
    expect(topLevelBlocks(editor).map((b) => b.type)).toEqual(['bulletList']);
  });

  it('DEEPLY (3-level) nested item lifts one level, staying under its parent', () => {
    editor = make('<ul><li><p>A</p><ul><li><p>B</p><ul><li><p>C</p></li></ul></li></ul></li></ul>');
    caretAtItemLabel(editor, 2); // the deepest item "C"
    const tr = editor.state.tr;
    const ok = liftCurrentListItem(editor.state, tr);
    editor.view.dispatch(tr);
    expect(ok).toBe(true);
    // "C" moved into "B"'s children zone (stays nested under B), not to top level.
    expect(listItemChildren(editor, 'B')).toEqual([
      { type: 'paragraph', text: 'B' },
      { type: 'paragraph', text: 'C' },
    ]);
    expect(topLevelBlocks(editor).map((b) => b.type)).toEqual(['bulletList']);
  });

  it('CONVERT: toggleHeading on a nested item produces an indented (children-zone) heading', () => {
    editor = make('<ul><li><p>First</p><ul><li><p>Inner</p></li></ul></li></ul>');
    caretAtItemLabel(editor, 1);
    const ok = editor.commands.toggleHeading({ level: 2 });
    expect(ok).toBe(true);
    expect(listItemChildren(editor, 'First')).toEqual([
      { type: 'paragraph', text: 'First' },
      { type: 'heading', text: 'Inner' },
    ]);
  });
});
