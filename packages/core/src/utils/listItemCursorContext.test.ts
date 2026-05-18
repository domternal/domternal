import { describe, it, expect, afterEach } from 'vitest';
import type { Node as PMNode } from '@domternal/pm/model';
import { TextSelection } from '@domternal/pm/state';
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
import { Editor } from '../Editor.js';

const extensions = [
  Document, Text, Paragraph,
  Heading, Blockquote, CodeBlock, HorizontalRule,
  BulletList, OrderedList, ListItem,
  TaskList, TaskItem,
];

function makeEditor(content: string): Editor {
  return new Editor({ extensions, content });
}

/** Put the editor's selection at a specific doc position. */
function setCaretAt(editor: Editor, pos: number): void {
  const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos));
  editor.view.dispatch(tr);
}

/**
 * Find first descendant matching predicate, return its position
 * (= one BEFORE the open token of the node).
 */
function findPos(editor: Editor, predicate: (n: PMNode) => boolean): number {
  let pos = -1;
  editor.state.doc.descendants((node, p) => {
    if (pos !== -1) return false;
    if (predicate(node)) { pos = p; return false; }
    return true;
  });
  return pos;
}

/**
 * Find Nth descendant matching predicate (0-indexed), return its position.
 * Used to disambiguate when multiple nodes of the same type/text exist.
 */
function findNthPos(editor: Editor, predicate: (n: PMNode) => boolean, n: number): number {
  let pos = -1;
  let count = 0;
  editor.state.doc.descendants((node, p) => {
    if (pos !== -1) return false;
    if (predicate(node)) {
      if (count === n) { pos = p; return false; }
      count++;
    }
    return true;
  });
  return pos;
}

/**
 * Place caret at end of the Kth child of the Nth list item encountered
 * in doc-traversal order. Mirrors the e2e helper but operates directly
 * on the editor's document.
 */
function caretAtItemChild(
  editor: Editor,
  itemIndex: number,
  childIndex: number,
  position: 'start' | 'end' = 'end',
): void {
  let foundItemPos = -1;
  let foundItemNode: PMNode | null = null;
  let counter = 0;
  editor.state.doc.descendants((node, p) => {
    if (foundItemPos !== -1) return false;
    if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
      if (counter === itemIndex) {
        foundItemPos = p;
        foundItemNode = node;
        return false;
      }
      counter++;
    }
    return true;
  });
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive narrow for TS (loop pairs foundItemNode with foundItemPos)
  if (foundItemPos === -1 || !foundItemNode) {
    throw new Error(`itemIndex ${String(itemIndex)} not found`);
  }
  const item = foundItemNode as PMNode;
  let childStart = foundItemPos + 1;
  for (let i = 0; i < childIndex; i++) {
    childStart += item.child(i).nodeSize;
  }
  const child = item.child(childIndex);
  const targetPos = position === 'start' ? childStart + 1 : childStart + child.nodeSize - 1;
  setCaretAt(editor, targetPos);
}

describe('getListItemCursorContext', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
  });

  it('returns null for cursor at the top level (not in any list item)', () => {
    editor = makeEditor('<p>plain</p>');
    setCaretAt(editor, 1);
    const ctx = getListItemCursorContext(editor.state.selection.$from);
    expect(ctx).toBeNull();
  });

  it('returns null when the cursor parent is a heading nested in a li', () => {
    editor = makeEditor('<ul><li><p>Label</p><h2>Heading</h2></li></ul>');
    const headingPos = findPos(editor, (n) => n.type.name === 'heading');
    // Position INSIDE the heading (1 past its open token).
    setCaretAt(editor, headingPos + 1);
    const ctx = getListItemCursorContext(editor.state.selection.$from);
    expect(ctx).toBeNull();
  });

  it('returns null when the cursor parent is a codeBlock nested in a li', () => {
    editor = makeEditor('<ul><li><p>Label</p><pre><code>x</code></pre></li></ul>');
    const codePos = findPos(editor, (n) => n.type.name === 'codeBlock');
    setCaretAt(editor, codePos + 1);
    const ctx = getListItemCursorContext(editor.state.selection.$from);
    expect(ctx).toBeNull();
  });

  it('returns null when the cursor is in a blockquote-inner paragraph nested in a li (paragraph is not a DIRECT child of the list item)', () => {
    // The cursor's paragraph sits inside a blockquote inside the list
    // item. The util requires the paragraph to be a DIRECT child of
    // the list item - if an intermediate container (blockquote, table
    // cell, details, ...) wraps it, the relevant Enter/Backspace
    // semantics belong to the container, not the list item. The util
    // returns null so callers fall through to default handling.
    editor = makeEditor('<ul><li><p>Label</p><blockquote><p>Quoted</p></blockquote></li></ul>');
    const quotedPos = findNthPos(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'Quoted', 0);
    setCaretAt(editor, quotedPos + 1);
    const ctx = getListItemCursorContext(editor.state.selection.$from);
    expect(ctx).toBeNull();
  });

  it('cursor in label paragraph of bullet li - isInChildrenZone false, childIndex 0', () => {
    editor = makeEditor('<ul><li><p>Label</p></li></ul>');
    caretAtItemChild(editor, 0, 0, 'end');
    const ctx = getListItemCursorContext(editor.state.selection.$from);
    expect(ctx).not.toBeNull();
    expect(ctx?.isInChildrenZone).toBe(false);
    expect(ctx?.childIndex).toBe(0);
    expect(ctx?.paragraphIsEmpty).toBe(false);
    expect(ctx?.isLastChild).toBe(true);
  });

  it('cursor in 2nd-child empty paragraph of bullet li - isInChildrenZone true, paragraphIsEmpty true, isLastChild true', () => {
    editor = makeEditor('<ul><li><p>Label</p><h1>Title</h1><p></p></li></ul>');
    caretAtItemChild(editor, 0, 2, 'end');
    const ctx = getListItemCursorContext(editor.state.selection.$from);
    expect(ctx).not.toBeNull();
    expect(ctx?.isInChildrenZone).toBe(true);
    expect(ctx?.paragraphIsEmpty).toBe(true);
    expect(ctx?.isLastChild).toBe(true);
    expect(ctx?.childIndex).toBe(2);
  });

  it('cursor in 2nd-child non-empty paragraph - paragraphIsEmpty false', () => {
    editor = makeEditor('<ul><li><p>Label</p><p>Body</p></li></ul>');
    caretAtItemChild(editor, 0, 1, 'end');
    const ctx = getListItemCursorContext(editor.state.selection.$from);
    expect(ctx).not.toBeNull();
    expect(ctx?.isInChildrenZone).toBe(true);
    expect(ctx?.paragraphIsEmpty).toBe(false);
    expect(ctx?.isLastChild).toBe(true);
    expect(ctx?.childIndex).toBe(1);
  });

  it('cursor in MIDDLE empty paragraph (not last) - isLastChild false', () => {
    editor = makeEditor('<ul><li><p>Label</p><p></p><h1>Below</h1></li></ul>');
    caretAtItemChild(editor, 0, 1, 'end');
    const ctx = getListItemCursorContext(editor.state.selection.$from);
    expect(ctx).not.toBeNull();
    expect(ctx?.isInChildrenZone).toBe(true);
    expect(ctx?.paragraphIsEmpty).toBe(true);
    expect(ctx?.isLastChild).toBe(false);
    expect(ctx?.childIndex).toBe(1);
  });

  it('cursor in label of taskItem - mirrors listItem behaviour', () => {
    editor = makeEditor(
      '<ul data-type="taskList"><li data-type="taskItem"><p>Task label</p></li></ul>',
    );
    caretAtItemChild(editor, 0, 0, 'end');
    const ctx = getListItemCursorContext(editor.state.selection.$from);
    expect(ctx).not.toBeNull();
    expect(ctx?.isInChildrenZone).toBe(false);
    expect(ctx?.childIndex).toBe(0);
  });

  it('cursor in 2nd-child empty paragraph of taskItem - mirrors listItem', () => {
    editor = makeEditor(
      '<ul data-type="taskList"><li data-type="taskItem"><p>Label</p><h1>Title</h1><p></p></li></ul>',
    );
    caretAtItemChild(editor, 0, 2, 'end');
    const ctx = getListItemCursorContext(editor.state.selection.$from);
    expect(ctx).not.toBeNull();
    expect(ctx?.isInChildrenZone).toBe(true);
    expect(ctx?.paragraphIsEmpty).toBe(true);
    expect(ctx?.isLastChild).toBe(true);
  });

  // Innermost-resolution regression guard. When a listItem is nested
  // inside a taskItem, a cursor inside the inner listItem's children
  // must report the INNER context, not the outer taskItem - otherwise
  // we would target the wrong list item and could lift the outer item
  // by mistake.
  it('cursor in inner listItem (nested in taskItem) - resolves to INNER list item, not outer', () => {
    editor = makeEditor(
      '<ul data-type="taskList"><li data-type="taskItem"><p>OuterLabel</p>'
      + '<ul><li><p>InnerLabel</p><p></p></li></ul>'
      + '</li></ul>',
    );
    // Inner listItem is itemIndex 1 in doc traversal (taskItem first).
    caretAtItemChild(editor, 1, 1, 'end');
    const ctx = getListItemCursorContext(editor.state.selection.$from);
    expect(ctx).not.toBeNull();
    // Resolved item must be the listItem, NOT the outer taskItem.
    const itemAtPos = editor.state.doc.nodeAt(ctx?.itemPos ?? 0);
    expect(itemAtPos?.type.name).toBe('listItem');
    // Wrapper one level up is the inner bulletList, not the outer taskList.
    const wrapperAtPos = editor.state.doc.nodeAt(ctx?.wrapperPos ?? 0);
    expect(wrapperAtPos?.type.name).toBe('bulletList');
    expect(ctx?.isInChildrenZone).toBe(true);
    expect(ctx?.paragraphIsEmpty).toBe(true);
    expect(ctx?.isLastChild).toBe(true);
  });

  it('cursor in OUTER taskItem label when inner listItem exists - reports outer context', () => {
    // Defensive companion to the test above: place caret in OUTER label
    // and ensure resolution prefers the OUTER taskItem (since it is the
    // closest list-item ancestor of the OUTER label paragraph).
    editor = makeEditor(
      '<ul data-type="taskList"><li data-type="taskItem"><p>OuterLabel</p>'
      + '<ul><li><p>InnerLabel</p></li></ul>'
      + '</li></ul>',
    );
    // OUTER taskItem is itemIndex 0; its child 0 is OuterLabel paragraph.
    caretAtItemChild(editor, 0, 0, 'end');
    const ctx = getListItemCursorContext(editor.state.selection.$from);
    expect(ctx).not.toBeNull();
    const itemAtPos = editor.state.doc.nodeAt(ctx?.itemPos ?? 0);
    expect(itemAtPos?.type.name).toBe('taskItem');
    expect(ctx?.isInChildrenZone).toBe(false);
    expect(ctx?.childIndex).toBe(0);
  });

  it('returned wrapperPos points at a list-wrapper node (bulletList for li, taskList for taskItem)', () => {
    editor = makeEditor('<ul><li><p>Label</p></li></ul>');
    caretAtItemChild(editor, 0, 0, 'end');
    const bulletCtx = getListItemCursorContext(editor.state.selection.$from);
    const bulletWrapper = editor.state.doc.nodeAt(bulletCtx?.wrapperPos ?? 0);
    expect(bulletWrapper?.type.name).toBe('bulletList');
    editor.destroy();

    editor = makeEditor(
      '<ul data-type="taskList"><li data-type="taskItem"><p>L</p></li></ul>',
    );
    caretAtItemChild(editor, 0, 0, 'end');
    const taskCtx = getListItemCursorContext(editor.state.selection.$from);
    const taskWrapper = editor.state.doc.nodeAt(taskCtx?.wrapperPos ?? 0);
    expect(taskWrapper?.type.name).toBe('taskList');
  });
});
