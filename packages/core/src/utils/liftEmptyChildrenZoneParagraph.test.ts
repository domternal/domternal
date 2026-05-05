import { describe, it, expect, afterEach } from 'vitest';
import type { Node as PMNode } from '@domternal/pm/model';
import { TextSelection } from '@domternal/pm/state';
import { liftEmptyChildrenZoneParagraph } from './liftEmptyChildrenZoneParagraph.js';
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

/**
 * Position caret at end of the Kth child of the Nth list/task item in
 * doc-traversal order.
 */
function caretAtItemChild(
  editor: Editor,
  itemIndex: number,
  childIndex: number,
): void {
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
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- defensive narrow for TS (loop pairs foundItemNode with foundItemPos)
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

describe('liftEmptyChildrenZoneParagraph', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
  });

  it('SINGLE-item list, empty trailing p - lifts as top-level sibling AFTER wrapper', () => {
    editor = makeEditor('<ul><li><p>Label</p><h1>Title</h1><p></p></li></ul>');
    caretAtItemChild(editor, 0, 2);
    const ctx = getListItemCursorContext(editor.state.selection.$from);
    expect(ctx).not.toBeNull();

    const ok = liftEmptyChildrenZoneParagraph(editor.state, editor.view.dispatch.bind(editor.view), ctx!);
    expect(ok).toBe(true);

    expect(topLevelBlocks(editor)).toEqual([
      { type: 'bulletList', text: 'LabelTitle' },
      { type: 'paragraph', text: '' },
    ]);
    const items = listItemShapes(editor);
    expect(items).toHaveLength(1);
    expect(items[0]?.childTypes).toEqual(['paragraph', 'heading']);
  });

  it('MID-list (item in middle of multi-item list), empty trailing p - splits wrapper, lifted p between halves', () => {
    editor = makeEditor(
      '<ul>'
      + '<li><p>A</p></li>'
      + '<li><p>B-label</p><h1>B-title</h1><p></p></li>'
      + '<li><p>C</p></li>'
      + '</ul>',
    );
    // Middle li is itemIndex 1; its 3rd child (childIndex 2) is empty p.
    caretAtItemChild(editor, 1, 2);
    const ctx = getListItemCursorContext(editor.state.selection.$from);

    const ok = liftEmptyChildrenZoneParagraph(editor.state, editor.view.dispatch.bind(editor.view), ctx!);
    expect(ok).toBe(true);

    const top = topLevelBlocks(editor);
    expect(top.map((b) => b.type)).toEqual(['bulletList', 'paragraph', 'bulletList']);
    expect(top[0]?.text).toBe('AB-labelB-title');
    expect(top[1]?.text).toBe('');
    expect(top[2]?.text).toBe('C');
  });

  it('FIRST item of multi-item list, empty trailing p - splits wrapper after item 0', () => {
    editor = makeEditor(
      '<ul>'
      + '<li><p>First-label</p><h1>F-title</h1><p></p></li>'
      + '<li><p>Second</p></li>'
      + '</ul>',
    );
    caretAtItemChild(editor, 0, 2);
    const ctx = getListItemCursorContext(editor.state.selection.$from);

    const ok = liftEmptyChildrenZoneParagraph(editor.state, editor.view.dispatch.bind(editor.view), ctx!);
    expect(ok).toBe(true);

    const top = topLevelBlocks(editor);
    expect(top.map((b) => b.type)).toEqual(['bulletList', 'paragraph', 'bulletList']);
    expect(top[0]?.text).toBe('First-labelF-title');
    expect(top[2]?.text).toBe('Second');
  });

  it('LAST item of multi-item list, empty trailing p - simple lift, no split', () => {
    editor = makeEditor(
      '<ul>'
      + '<li><p>First</p></li>'
      + '<li><p>Last-label</p><h1>L-title</h1><p></p></li>'
      + '</ul>',
    );
    caretAtItemChild(editor, 1, 2);
    const ctx = getListItemCursorContext(editor.state.selection.$from);

    const ok = liftEmptyChildrenZoneParagraph(editor.state, editor.view.dispatch.bind(editor.view), ctx!);
    expect(ok).toBe(true);

    const top = topLevelBlocks(editor);
    expect(top.map((b) => b.type)).toEqual(['bulletList', 'paragraph']);
    expect(top[0]?.text).toBe('FirstLast-labelL-title');
  });

  it('MIDDLE empty p (not last child of li) - same simple/split path as trailing, h1 gets demoted to be next-to-label', () => {
    editor = makeEditor('<ul><li><p>Label</p><p></p><h1>Below</h1></li></ul>');
    caretAtItemChild(editor, 0, 1);
    const ctx = getListItemCursorContext(editor.state.selection.$from);
    expect(ctx?.isLastChild).toBe(false);

    const ok = liftEmptyChildrenZoneParagraph(editor.state, editor.view.dispatch.bind(editor.view), ctx!);
    expect(ok).toBe(true);

    // Listitem retains [Label, h1] - middle p removed.
    const items = listItemShapes(editor);
    expect(items).toHaveLength(1);
    expect(items[0]?.childTypes).toEqual(['paragraph', 'heading']);
    // Top-level: bulletList + lifted-p (since item is last & only).
    expect(topLevelBlocks(editor).map((b) => b.type)).toEqual(['bulletList', 'paragraph']);
  });

  it('Path 2 + isLastItem=false: middle empty-p in MIDDLE listItem of multi-item wrapper - splits wrapper, lifted-p between halves', () => {
    // Path 2 fires because liftTarget returns null (cutting the
    // listItem at the middle empty-p would yield [h1] as second-half
    // first child = schema reject). isLastItem is false because the
    // affected li is in the MIDDLE of a 3-item wrapper.
    editor = makeEditor(
      '<ul>'
      + '<li><p>A</p></li>'
      + '<li><p>L</p><p></p><h1>X</h1></li>'
      + '<li><p>C</p></li>'
      + '</ul>',
    );
    caretAtItemChild(editor, 1, 1);
    const ctx = getListItemCursorContext(editor.state.selection.$from);
    expect(ctx?.isLastChild).toBe(false);
    expect(ctx?.itemIndexInWrapper).toBe(1);

    const ok = liftEmptyChildrenZoneParagraph(editor.state, editor.view.dispatch.bind(editor.view), ctx!);
    expect(ok).toBe(true);

    // Wrapper splits in two with lifted-p in the gap. Affected li keeps
    // [L, h1] (only the empty middle p was removed) and stays in the
    // FIRST half of the split wrapper, alongside li=A.
    const top = topLevelBlocks(editor);
    expect(top.map((b) => b.type)).toEqual(['bulletList', 'paragraph', 'bulletList']);
    expect(top[0]?.text).toBe('ALX');
    expect(top[1]?.text).toBe('');
    expect(top[2]?.text).toBe('C');
    const items = listItemShapes(editor);
    const affected = items.find((i) => i.text === 'LX');
    expect(affected?.childTypes).toEqual(['paragraph', 'heading']);
  });

  it('returns false when ctx.paragraphIsEmpty is false (non-empty paragraph in children-zone)', () => {
    editor = makeEditor('<ul><li><p>Label</p><p>Body</p></li></ul>');
    caretAtItemChild(editor, 0, 1);
    const ctx = getListItemCursorContext(editor.state.selection.$from);
    expect(ctx?.paragraphIsEmpty).toBe(false);

    const before = editor.state.doc.toString();
    const ok = liftEmptyChildrenZoneParagraph(editor.state, editor.view.dispatch.bind(editor.view), ctx!);
    expect(ok).toBe(false);
    expect(editor.state.doc.toString()).toBe(before);
  });

  it('returns false when ctx.isInChildrenZone is false (cursor in label paragraph)', () => {
    editor = makeEditor('<ul><li><p>Label</p></li></ul>');
    caretAtItemChild(editor, 0, 0);
    const ctx = getListItemCursorContext(editor.state.selection.$from);
    expect(ctx?.isInChildrenZone).toBe(false);

    const before = editor.state.doc.toString();
    const ok = liftEmptyChildrenZoneParagraph(editor.state, editor.view.dispatch.bind(editor.view), ctx!);
    expect(ok).toBe(false);
    expect(editor.state.doc.toString()).toBe(before);
  });

  it('dry-run (dispatch undefined) - returns true without mutating', () => {
    editor = makeEditor('<ul><li><p>Label</p><h1>T</h1><p></p></li></ul>');
    caretAtItemChild(editor, 0, 2);
    const ctx = getListItemCursorContext(editor.state.selection.$from);

    const before = editor.state.doc.toString();
    const ok = liftEmptyChildrenZoneParagraph(editor.state, undefined, ctx!);
    expect(ok).toBe(true);
    expect(editor.state.doc.toString()).toBe(before);
  });

  it('wrapper inside a blockquote - lifted p lands INSIDE the blockquote', () => {
    editor = makeEditor(
      '<blockquote><ul><li><p>Label</p><h1>T</h1><p></p></li></ul></blockquote>',
    );
    caretAtItemChild(editor, 0, 2);
    const ctx = getListItemCursorContext(editor.state.selection.$from);

    const ok = liftEmptyChildrenZoneParagraph(editor.state, editor.view.dispatch.bind(editor.view), ctx!);
    expect(ok).toBe(true);

    // Doc top-level: still a single blockquote.
    const top = topLevelBlocks(editor);
    expect(top.map((b) => b.type)).toEqual(['blockquote']);

    // Blockquote children: bulletList + paragraph (lifted-p stays
    // inside the blockquote, NOT escaped to doc level).
    const bq = editor.state.doc.firstChild;
    expect(bq?.type.name).toBe('blockquote');
    const bqChildTypes: string[] = [];
    for (let i = 0; i < (bq?.childCount ?? 0); i++) bqChildTypes.push(bq!.child(i).type.name);
    expect(bqChildTypes).toEqual(['bulletList', 'paragraph']);

    // The listItem keeps [label, h1] (empty trailing p removed).
    const items = listItemShapes(editor);
    expect(items[0]?.childTypes).toEqual(['paragraph', 'heading']);
  });

  it('cursor lands at start of lifted paragraph (offset 0, ready to type)', () => {
    editor = makeEditor('<ul><li><p>Label</p><h1>T</h1><p></p></li></ul>');
    caretAtItemChild(editor, 0, 2);
    const ctx = getListItemCursorContext(editor.state.selection.$from);

    liftEmptyChildrenZoneParagraph(editor.state, editor.view.dispatch.bind(editor.view), ctx!);

    const sel = editor.state.selection;
    expect(sel.empty).toBe(true);
    expect(sel.$from.parent.type.name).toBe('paragraph');
    expect(sel.$from.parent.content.size).toBe(0);
    expect(sel.$from.parentOffset).toBe(0);
    // The cursor's parent paragraph is a TOP-LEVEL paragraph (doc child),
    // not nested in any list item.
    expect(sel.$from.depth).toBe(1);
  });

  it('after lift, typing inserts into lifted paragraph (cursor reachable)', () => {
    editor = makeEditor('<ul><li><p>Label</p><h1>T</h1><p></p></li></ul>');
    caretAtItemChild(editor, 0, 2);
    const ctx = getListItemCursorContext(editor.state.selection.$from);

    liftEmptyChildrenZoneParagraph(editor.state, editor.view.dispatch.bind(editor.view), ctx!);

    // Type via insertText command analog (direct schema insert).
    const tr = editor.state.tr.insertText('Hi');
    editor.view.dispatch(tr);

    const liftedP = editor.state.doc.lastChild;
    expect(liftedP?.type.name).toBe('paragraph');
    expect(liftedP?.textContent).toBe('Hi');
  });

  it('Mod-Z (history undo) restores pre-lift shape in ONE step', () => {
    editor = makeEditor('<ul><li><p>Label</p><h1>T</h1><p></p></li></ul>');
    caretAtItemChild(editor, 0, 2);
    const ctx = getListItemCursorContext(editor.state.selection.$from);

    const before = editor.state.doc.toString();

    liftEmptyChildrenZoneParagraph(editor.state, editor.view.dispatch.bind(editor.view), ctx!);
    expect(editor.state.doc.toString()).not.toBe(before);

    // Trigger one undo via the History extension's command.
    const undid = editor.commands.undo();
    expect(undid).toBe(true);
    expect(editor.state.doc.toString()).toBe(before);
  });

  it('TASKitem variant - same lift behaviour (wrapperPos = taskList)', () => {
    editor = makeEditor(
      '<ul data-type="taskList"><li data-type="taskItem"><p>Label</p><h1>T</h1><p></p></li></ul>',
    );
    caretAtItemChild(editor, 0, 2);
    const ctx = getListItemCursorContext(editor.state.selection.$from);
    expect(editor.state.doc.nodeAt(ctx?.itemPos ?? -1)?.type.name).toBe('taskItem');
    expect(editor.state.doc.nodeAt(ctx?.wrapperPos ?? -1)?.type.name).toBe('taskList');

    const ok = liftEmptyChildrenZoneParagraph(editor.state, editor.view.dispatch.bind(editor.view), ctx!);
    expect(ok).toBe(true);

    expect(topLevelBlocks(editor).map((b) => b.type)).toEqual(['taskList', 'paragraph']);
    const items = listItemShapes(editor);
    expect(items[0]?.type).toBe('taskItem');
    expect(items[0]?.childTypes).toEqual(['paragraph', 'heading']);
  });
});
