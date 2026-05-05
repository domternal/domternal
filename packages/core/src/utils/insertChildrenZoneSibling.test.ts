import { describe, it, expect, afterEach } from 'vitest';
import type { Node as PMNode } from '@domternal/pm/model';
import { TextSelection } from '@domternal/pm/state';
import { insertChildrenZoneSibling } from './insertChildrenZoneSibling.js';
import { getListItemCursorContext } from './listItemCursorContext.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Heading } from '../nodes/Heading.js';
import { Blockquote } from '../nodes/Blockquote.js';
import { CodeBlock } from '../nodes/CodeBlock.js';
import { HorizontalRule } from '../nodes/HorizontalRule.js';
import { BulletList } from '../nodes/BulletList.js';
import { OrderedList } from '../nodes/OrderedList.js';
import { ListItem } from '../nodes/ListItem.js';
import { TaskList } from '../nodes/TaskList.js';
import { TaskItem } from '../nodes/TaskItem.js';
import { History } from '../extensions/History.js';
import { Editor } from '../Editor.js';

const extensions = [
  Document, Text, Paragraph,
  Heading, Blockquote, CodeBlock, HorizontalRule,
  BulletList, OrderedList, ListItem,
  TaskList, TaskItem,
  History,
];

function makeEditor(content: string): Editor {
  return new Editor({ extensions, content });
}

function setCaretAt(editor: Editor, pos: number): void {
  const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos));
  editor.view.dispatch(tr);
}

function caretAtItemChild(editor: Editor, itemIndex: number, childIndex: number): void {
  let foundItemPos = -1;
  let foundItemNode: PMNode | null = null;
  let counter = 0;
  editor.state.doc.descendants((node, p) => {
    if (foundItemPos !== -1) return false;
    if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
      if (counter === itemIndex) { foundItemPos = p; foundItemNode = node; return false; }
      counter++;
    }
    return true;
  });
  if (foundItemPos === -1 || !foundItemNode) {
    throw new Error(`itemIndex ${String(itemIndex)} not found`);
  }
  const item = foundItemNode as PMNode;
  let childStart = foundItemPos + 1;
  for (let i = 0; i < childIndex; i++) childStart += item.child(i).nodeSize;
  const child = item.child(childIndex);
  setCaretAt(editor, childStart + child.nodeSize - 1);
}

interface BlockShape { type: string; text: string }
function topLevelBlocks(editor: Editor): BlockShape[] {
  const out: BlockShape[] = [];
  editor.state.doc.forEach((n) => out.push({ type: n.type.name, text: n.textContent }));
  return out;
}

interface ItemShape { type: string; childTypes: string[]; text: string }
function listItemShapes(editor: Editor): ItemShape[] {
  const out: ItemShape[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
      const childTypes: string[] = [];
      for (let i = 0; i < node.childCount; i++) childTypes.push(node.child(i).type.name);
      out.push({ type: node.type.name, childTypes, text: node.textContent });
    }
    return true;
  });
  return out;
}

describe('insertChildrenZoneSibling', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
  });

  it('SINGLE-item list, empty trailing p - inserts another empty p as sibling INSIDE same listItem', () => {
    editor = makeEditor('<ul><li><p>Label</p><h1>Title</h1><p></p></li></ul>');
    caretAtItemChild(editor, 0, 2);
    const ctx = getListItemCursorContext(editor.state.selection.$from);
    expect(ctx).not.toBeNull();

    const ok = insertChildrenZoneSibling(editor.state, editor.view.dispatch.bind(editor.view), ctx!);
    expect(ok).toBe(true);

    // List item now has [label, h1, empty-p, NEW empty-p].
    const items = listItemShapes(editor);
    expect(items).toHaveLength(1);
    expect(items[0]?.childTypes).toEqual(['paragraph', 'heading', 'paragraph', 'paragraph']);
    // Doc top-level still just the bulletList - nothing escaped.
    expect(topLevelBlocks(editor).map((b) => b.type)).toEqual(['bulletList']);
  });

  it('MID-list (li in middle of multi-item list), empty trailing p - inserts sibling INSIDE that li, list stays intact', () => {
    editor = makeEditor(
      '<ul>'
      + '<li><p>A</p></li>'
      + '<li><p>B-label</p><h1>B-title</h1><p></p></li>'
      + '<li><p>C</p></li>'
      + '</ul>',
    );
    caretAtItemChild(editor, 1, 2);
    const ctx = getListItemCursorContext(editor.state.selection.$from);

    const ok = insertChildrenZoneSibling(editor.state, editor.view.dispatch.bind(editor.view), ctx!);
    expect(ok).toBe(true);

    const items = listItemShapes(editor);
    // 3 items still exist; middle li gets one extra empty paragraph.
    expect(items.length).toBe(3);
    const middle = items.find((i) => i.text === 'B-labelB-title');
    expect(middle).toBeTruthy();
    expect(middle?.childTypes).toEqual(['paragraph', 'heading', 'paragraph', 'paragraph']);
    // Top-level: still a single bulletList - no split, no escape.
    expect(topLevelBlocks(editor).map((b) => b.type)).toEqual(['bulletList']);
  });

  it('MIDDLE empty p (not last child) - inserts new sibling AFTER the middle empty-p', () => {
    editor = makeEditor('<ul><li><p>Label</p><p></p><h1>Below</h1></li></ul>');
    caretAtItemChild(editor, 0, 1);
    const ctx = getListItemCursorContext(editor.state.selection.$from);
    expect(ctx?.isLastChild).toBe(false);

    const ok = insertChildrenZoneSibling(editor.state, editor.view.dispatch.bind(editor.view), ctx!);
    expect(ok).toBe(true);

    // Listitem now has [label, empty-p (original), NEW empty-p, h1] - new sibling
    // sits between the original empty-p and the h1.
    const items = listItemShapes(editor);
    expect(items).toHaveLength(1);
    expect(items[0]?.childTypes).toEqual(['paragraph', 'paragraph', 'paragraph', 'heading']);
  });

  it('returns false when ctx.paragraphIsEmpty is false (non-empty paragraph in children-zone)', () => {
    editor = makeEditor('<ul><li><p>Label</p><p>Body</p></li></ul>');
    caretAtItemChild(editor, 0, 1);
    const ctx = getListItemCursorContext(editor.state.selection.$from);
    expect(ctx?.paragraphIsEmpty).toBe(false);

    const before = editor.state.doc.toString();
    const ok = insertChildrenZoneSibling(editor.state, editor.view.dispatch.bind(editor.view), ctx!);
    expect(ok).toBe(false);
    expect(editor.state.doc.toString()).toBe(before);
  });

  it('returns false when ctx.isInChildrenZone is false (cursor in label paragraph)', () => {
    editor = makeEditor('<ul><li><p>Label</p></li></ul>');
    caretAtItemChild(editor, 0, 0);
    const ctx = getListItemCursorContext(editor.state.selection.$from);
    expect(ctx?.isInChildrenZone).toBe(false);

    const before = editor.state.doc.toString();
    const ok = insertChildrenZoneSibling(editor.state, editor.view.dispatch.bind(editor.view), ctx!);
    expect(ok).toBe(false);
    expect(editor.state.doc.toString()).toBe(before);
  });

  it('dry-run (dispatch undefined) - returns true without mutating', () => {
    editor = makeEditor('<ul><li><p>Label</p><h1>T</h1><p></p></li></ul>');
    caretAtItemChild(editor, 0, 2);
    const ctx = getListItemCursorContext(editor.state.selection.$from);

    const before = editor.state.doc.toString();
    const ok = insertChildrenZoneSibling(editor.state, undefined, ctx!);
    expect(ok).toBe(true);
    expect(editor.state.doc.toString()).toBe(before);
  });

  it('stale ctx (cursor moved to non-paragraph after ctx was captured) - returns false defensively', () => {
    // Construct a stale ctx scenario: capture ctx while cursor is in
    // a children-zone empty paragraph, then move the cursor into a
    // heading (whose parent is no longer a paragraph). The util's
    // defensive `$from.parent.type.name !== 'paragraph'` guard should
    // fire and return false without mutating.
    editor = makeEditor('<ul><li><p>Label</p><h1>Heading</h1><p></p></li></ul>');
    caretAtItemChild(editor, 0, 2);
    const staleCtx = getListItemCursorContext(editor.state.selection.$from);
    expect(staleCtx).not.toBeNull();

    // Move cursor INTO the heading - $from.parent is now heading.
    let headingPos = -1;
    editor.state.doc.descendants((node, p) => {
      if (headingPos !== -1) return false;
      if (node.type.name === 'heading') { headingPos = p; return false; }
      return true;
    });
    setCaretAt(editor, headingPos + 1);

    const before = editor.state.doc.toString();
    const ok = insertChildrenZoneSibling(editor.state, editor.view.dispatch.bind(editor.view), staleCtx!);
    expect(ok).toBe(false);
    expect(editor.state.doc.toString()).toBe(before);
  });

  it('stale ctx (paragraph filled with content after ctx was captured) - returns false defensively', () => {
    // Capture ctx while paragraph is empty, then fill it with text via
    // a separate transaction. The util's defensive
    // `$from.parent.content.size !== 0` guard should fire.
    editor = makeEditor('<ul><li><p>Label</p><h1>Title</h1><p></p></li></ul>');
    caretAtItemChild(editor, 0, 2);
    const staleCtx = getListItemCursorContext(editor.state.selection.$from);
    expect(staleCtx?.paragraphIsEmpty).toBe(true);

    // Insert text into the empty paragraph - it's no longer empty.
    editor.view.dispatch(editor.state.tr.insertText('Filled'));

    const before = editor.state.doc.toString();
    const ok = insertChildrenZoneSibling(editor.state, editor.view.dispatch.bind(editor.view), staleCtx!);
    expect(ok).toBe(false);
    expect(editor.state.doc.toString()).toBe(before);
  });

  it('multiple invocations accumulate empty paragraphs (Notion-style)', () => {
    editor = makeEditor('<ul><li><p>Label</p><h1>T</h1><p></p></li></ul>');
    caretAtItemChild(editor, 0, 2);

    // Five Enter presses -> five new empty paragraphs accumulated.
    for (let i = 0; i < 5; i++) {
      const ctx = getListItemCursorContext(editor.state.selection.$from);
      expect(ctx?.isInChildrenZone).toBe(true);
      expect(ctx?.paragraphIsEmpty).toBe(true);
      const ok = insertChildrenZoneSibling(editor.state, editor.view.dispatch.bind(editor.view), ctx!);
      expect(ok).toBe(true);
    }

    // li starts with [label, h1, empty-p] (3) plus 5 inserted = 8 children.
    const items = listItemShapes(editor);
    expect(items[0]?.childTypes.length).toBe(8);
    expect(items[0]?.childTypes[0]).toBe('paragraph');
    expect(items[0]?.childTypes[1]).toBe('heading');
    // All remaining 6 children are paragraphs.
    expect(items[0]?.childTypes.slice(2)).toEqual([
      'paragraph', 'paragraph', 'paragraph', 'paragraph', 'paragraph', 'paragraph',
    ]);
  });

  it('cursor lands at start of inserted paragraph (offset 0, ready to type)', () => {
    editor = makeEditor('<ul><li><p>Label</p><h1>T</h1><p></p></li></ul>');
    caretAtItemChild(editor, 0, 2);
    const ctx = getListItemCursorContext(editor.state.selection.$from);

    insertChildrenZoneSibling(editor.state, editor.view.dispatch.bind(editor.view), ctx!);

    const sel = editor.state.selection;
    expect(sel.empty).toBe(true);
    expect(sel.$from.parent.type.name).toBe('paragraph');
    expect(sel.$from.parent.content.size).toBe(0);
    expect(sel.$from.parentOffset).toBe(0);
    // Cursor parent is still INSIDE the listItem (children-zone), not at doc level.
    // The depth chain is doc -> bulletList -> listItem -> paragraph (=4? actually 3 indices from 0).
    expect(sel.$from.depth).toBe(3);
    expect(sel.$from.node(2).type.name).toBe('listItem');
  });

  it('after sibling insert, typing inserts into new paragraph', () => {
    editor = makeEditor('<ul><li><p>Label</p><h1>T</h1><p></p></li></ul>');
    caretAtItemChild(editor, 0, 2);
    const ctx = getListItemCursorContext(editor.state.selection.$from);

    insertChildrenZoneSibling(editor.state, editor.view.dispatch.bind(editor.view), ctx!);

    const tr = editor.state.tr.insertText('Hi');
    editor.view.dispatch(tr);

    // The newly-inserted paragraph (last child of li) now contains "Hi".
    const items = listItemShapes(editor);
    expect(items[0]?.text).toBe('LabelTHi');
  });

  it('Mod-Z (history undo) restores pre-insert shape in ONE step', () => {
    editor = makeEditor('<ul><li><p>Label</p><h1>T</h1><p></p></li></ul>');
    caretAtItemChild(editor, 0, 2);
    const ctx = getListItemCursorContext(editor.state.selection.$from);

    const before = editor.state.doc.toString();
    insertChildrenZoneSibling(editor.state, editor.view.dispatch.bind(editor.view), ctx!);
    expect(editor.state.doc.toString()).not.toBe(before);

    const undid = editor.commands['undo']?.();
    expect(undid).toBe(true);
    expect(editor.state.doc.toString()).toBe(before);
  });

  it('TASKitem variant - same accumulate behaviour inside taskItem', () => {
    editor = makeEditor(
      '<ul data-type="taskList"><li data-type="taskItem"><p>Label</p><h1>T</h1><p></p></li></ul>',
    );
    caretAtItemChild(editor, 0, 2);
    const ctx = getListItemCursorContext(editor.state.selection.$from);
    expect(editor.state.doc.nodeAt(ctx?.itemPos ?? -1)?.type.name).toBe('taskItem');

    const ok = insertChildrenZoneSibling(editor.state, editor.view.dispatch.bind(editor.view), ctx!);
    expect(ok).toBe(true);

    // taskItem retains all original children plus one new empty paragraph.
    const items = listItemShapes(editor);
    expect(items[0]?.type).toBe('taskItem');
    expect(items[0]?.childTypes).toEqual(['paragraph', 'heading', 'paragraph', 'paragraph']);
    // Top-level still just the taskList.
    expect(topLevelBlocks(editor).map((b) => b.type)).toEqual(['taskList']);
  });
});
