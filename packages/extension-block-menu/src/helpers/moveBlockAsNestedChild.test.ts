/**
 * Unit coverage for `moveBlockAsNestedChild`. Moves a dragged block into
 * the trailing slot of a target list item (instead of as a sibling). Covers:
 *
 *  - non-list source types (paragraph, heading, codeBlock, blockquote, hr)
 *  - list-item source wrapped in a fresh list wrapper
 *  - cross-list-type case (bullet listItem → taskList target)
 *  - guards: self-drop, wrapper inside source, invalid positions
 *  - source-before-vs-after-target ordering (delegated to insertAsListItemChild)
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  Document,
  Text,
  Paragraph,
  Heading,
  Blockquote,
  CodeBlock,
  HorizontalRule,
  BulletList,
  OrderedList,
  ListItem,
  TaskList,
  TaskItem,
  Editor,
} from '@domternal/core';
import { moveBlockAsNestedChild } from './moveBlockAsNestedChild.js';

const extensions = [
  Document, Text, Paragraph, Heading, Blockquote, CodeBlock, HorizontalRule,
  BulletList, OrderedList, ListItem, TaskList, TaskItem,
];

function makeEditor(html: string): Editor {
  return new Editor({ extensions, content: html });
}

function posOf(
  editor: Editor,
  predicate: (n: { type: { name: string }; textContent: string }) => boolean,
): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (predicate(node)) { found = pos; return false; }
    return true;
  });
  if (found === -1) throw new Error('node not found');
  return found;
}

function dump(editor: Editor): string {
  return editor.state.doc.toString();
}

describe('moveBlockAsNestedChild', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
  });

  describe('non-list source types', () => {
    it('moves a top-level paragraph as last child of the target list item', () => {
      editor = makeEditor('<p>Source</p><ul><li><p>Target</p></li></ul>');
      const sourcePos = posOf(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'Source');
      const wrapperPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const targetItemPos = posOf(editor, (n) => n.type.name === 'listItem');

      const tr = editor.state.tr;
      const ok = moveBlockAsNestedChild(tr, sourcePos, wrapperPos, targetItemPos);
      expect(ok).toBe(true);
      editor.view.dispatch(tr);

      // Doc now has only the bulletList. listItem has [Target paragraph, Source paragraph].
      expect(editor.state.doc.childCount).toBe(1);
      const li = editor.state.doc.firstChild?.firstChild;
      expect(li?.type.name).toBe('listItem');
      expect(li?.childCount).toBe(2);
      expect(li?.firstChild?.textContent).toBe('Target');
      expect(li?.lastChild?.type.name).toBe('paragraph');
      expect(li?.lastChild?.textContent).toBe('Source');
    });

    it('moves a heading and preserves its level', () => {
      editor = makeEditor('<h2>Title</h2><ul><li><p>Item</p></li></ul>');
      const sourcePos = posOf(editor, (n) => n.type.name === 'heading');
      const wrapperPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const targetItemPos = posOf(editor, (n) => n.type.name === 'listItem');

      const tr = editor.state.tr;
      expect(moveBlockAsNestedChild(tr, sourcePos, wrapperPos, targetItemPos)).toBe(true);
      editor.view.dispatch(tr);

      const li = editor.state.doc.firstChild?.firstChild;
      expect(li?.lastChild?.type.name).toBe('heading');
      expect(li?.lastChild?.attrs['level']).toBe(2);
      expect(li?.lastChild?.textContent).toBe('Title');
    });

    it('moves a codeBlock', () => {
      editor = makeEditor('<pre><code>x = 1</code></pre><ul><li><p>L</p></li></ul>');
      const sourcePos = posOf(editor, (n) => n.type.name === 'codeBlock');
      const wrapperPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const targetItemPos = posOf(editor, (n) => n.type.name === 'listItem');

      const tr = editor.state.tr;
      expect(moveBlockAsNestedChild(tr, sourcePos, wrapperPos, targetItemPos)).toBe(true);
      editor.view.dispatch(tr);

      expect(dump(editor)).toContain('listItem(paragraph("L"), codeBlock');
    });

    it('moves a blockquote (preserves its inner content)', () => {
      editor = makeEditor('<blockquote><p>Quote</p></blockquote><ul><li><p>L</p></li></ul>');
      const sourcePos = posOf(editor, (n) => n.type.name === 'blockquote');
      const wrapperPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const targetItemPos = posOf(editor, (n) => n.type.name === 'listItem');

      const tr = editor.state.tr;
      expect(moveBlockAsNestedChild(tr, sourcePos, wrapperPos, targetItemPos)).toBe(true);
      editor.view.dispatch(tr);

      expect(dump(editor)).toContain('listItem(paragraph("L"), blockquote');
    });

    it('moves a horizontalRule (atom)', () => {
      editor = makeEditor('<hr><ul><li><p>L</p></li></ul>');
      const sourcePos = posOf(editor, (n) => n.type.name === 'horizontalRule');
      const wrapperPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const targetItemPos = posOf(editor, (n) => n.type.name === 'listItem');

      const tr = editor.state.tr;
      expect(moveBlockAsNestedChild(tr, sourcePos, wrapperPos, targetItemPos)).toBe(true);
      editor.view.dispatch(tr);

      expect(dump(editor)).toContain('listItem(paragraph("L"), horizontalRule)');
    });
  });

  describe('source position ordering (delegated to insertAsListItemChild)', () => {
    it('source positioned BEFORE the wrapper - position math handles shift', () => {
      editor = makeEditor('<h2>Before</h2><ul><li><p>L</p></li></ul>');
      const sourcePos = posOf(editor, (n) => n.type.name === 'heading');
      const wrapperPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const targetItemPos = posOf(editor, (n) => n.type.name === 'listItem');

      const tr = editor.state.tr;
      expect(moveBlockAsNestedChild(tr, sourcePos, wrapperPos, targetItemPos)).toBe(true);
      editor.view.dispatch(tr);

      expect(editor.state.doc.childCount).toBe(1);
      expect(editor.state.doc.firstChild?.firstChild?.lastChild?.textContent).toBe('Before');
    });

    it('source positioned AFTER the wrapper - position math handles delete-first', () => {
      editor = makeEditor('<ul><li><p>L</p></li></ul><h2>After</h2>');
      const sourcePos = posOf(editor, (n) => n.type.name === 'heading');
      const wrapperPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const targetItemPos = posOf(editor, (n) => n.type.name === 'listItem');

      const tr = editor.state.tr;
      expect(moveBlockAsNestedChild(tr, sourcePos, wrapperPos, targetItemPos)).toBe(true);
      editor.view.dispatch(tr);

      expect(editor.state.doc.childCount).toBe(1);
      expect(editor.state.doc.firstChild?.firstChild?.lastChild?.textContent).toBe('After');
    });
  });

  describe('list-item source wrapping', () => {
    it('listItem source wraps in a fresh bulletList inside the target listItem', () => {
      editor = makeEditor('<ul><li><p>One</p></li><li><p>Two</p></li></ul>');
      const wrapperPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const sourcePos = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Two');
      const targetItemPos = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'One');

      const tr = editor.state.tr;
      expect(moveBlockAsNestedChild(tr, sourcePos, wrapperPos, targetItemPos)).toBe(true);
      editor.view.dispatch(tr);

      // Outer bulletList has 1 child (target item). Target item has [paragraph
      // "One", nested bulletList(listItem "Two")].
      const outerUl = editor.state.doc.firstChild;
      expect(outerUl?.type.name).toBe('bulletList');
      expect(outerUl?.childCount).toBe(1);
      const targetLi = outerUl?.firstChild;
      expect(targetLi?.childCount).toBe(2);
      expect(targetLi?.firstChild?.textContent).toBe('One');
      expect(targetLi?.lastChild?.type.name).toBe('bulletList');
      expect(targetLi?.lastChild?.firstChild?.type.name).toBe('listItem');
      expect(targetLi?.lastChild?.firstChild?.textContent).toBe('Two');
    });

    it('cross-list-type: bullet listItem source dropped into a TASK list target wraps in fresh taskList with taskItem', () => {
      editor = makeEditor(
        '<ul><li><p>BulletItem</p></li></ul>'
        + '<ul data-type="taskList"><li data-type="taskItem"><p>Task</p></li></ul>',
      );
      const sourcePos = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'BulletItem');
      const wrapperPos = posOf(editor, (n) => n.type.name === 'taskList');
      const targetItemPos = posOf(editor, (n) => n.type.name === 'taskItem');

      const tr = editor.state.tr;
      expect(moveBlockAsNestedChild(tr, sourcePos, wrapperPos, targetItemPos)).toBe(true);
      editor.view.dispatch(tr);

      // Source bulletList collapsed (had only 1 li). Doc has 1 top-level: taskList.
      expect(editor.state.doc.childCount).toBe(1);
      const taskList = editor.state.doc.firstChild;
      expect(taskList?.type.name).toBe('taskList');
      expect(taskList?.childCount).toBe(1);
      const taskItem = taskList?.firstChild;
      expect(taskItem?.type.name).toBe('taskItem');
      expect(taskItem?.childCount).toBe(2); // [label, nested taskList]
      expect(taskItem?.firstChild?.textContent).toBe('Task');
      const nestedList = taskItem?.lastChild;
      expect(nestedList?.type.name).toBe('taskList');
      // Source was a bullet listItem - convertListItemForParent adapted it.
      expect(nestedList?.firstChild?.type.name).toBe('taskItem');
      expect(nestedList?.firstChild?.textContent).toBe('BulletItem');
    });
  });

  describe('guards', () => {
    it('returns false on out-of-bounds sourcePos', () => {
      editor = makeEditor('<p>X</p><ul><li><p>L</p></li></ul>');
      const wrapperPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const targetItemPos = posOf(editor, (n) => n.type.name === 'listItem');

      const tr = editor.state.tr;
      const before = tr.doc.toString();
      expect(moveBlockAsNestedChild(tr, -1, wrapperPos, targetItemPos)).toBe(false);
      expect(moveBlockAsNestedChild(tr, 9999, wrapperPos, targetItemPos)).toBe(false);
      expect(tr.doc.toString()).toBe(before);
    });

    it('self-drop guard: target item INSIDE source range returns false', () => {
      // Source is the entire bulletList; target item is one of its children.
      editor = makeEditor('<ul><li><p>One</p></li><li><p>Two</p></li></ul>');
      const wrapperPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const targetItemPos = posOf(editor, (n) => n.type.name === 'listItem');

      const tr = editor.state.tr;
      const before = tr.doc.toString();
      // Use the wrapper as "source" - target item sits inside it.
      expect(moveBlockAsNestedChild(tr, wrapperPos, wrapperPos, targetItemPos)).toBe(false);
      expect(tr.doc.toString()).toBe(before);
    });

    it('self-drop guard: wrapperPos INSIDE source range returns false', () => {
      // Drag the parent of a list as source - wrapperPos is inside source.
      editor = makeEditor('<blockquote><ul><li><p>L</p></li></ul></blockquote>');
      const sourcePos = posOf(editor, (n) => n.type.name === 'blockquote');
      const wrapperPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const targetItemPos = posOf(editor, (n) => n.type.name === 'listItem');

      const tr = editor.state.tr;
      const before = tr.doc.toString();
      expect(moveBlockAsNestedChild(tr, sourcePos, wrapperPos, targetItemPos)).toBe(false);
      expect(tr.doc.toString()).toBe(before);
    });

    it('returns false when wrapperPos points to a non-list node (paragraph)', () => {
      editor = makeEditor('<p>Top</p><p>Source</p>');
      const sourcePos = posOf(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'Source');
      const wrapperPos = posOf(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'Top');

      const tr = editor.state.tr;
      const before = tr.doc.toString();
      // wrapperPos validates inside insertAsListItemChild -> fails schema check.
      expect(moveBlockAsNestedChild(tr, sourcePos, wrapperPos, wrapperPos)).toBe(false);
      expect(tr.doc.toString()).toBe(before);
    });
  });

  describe('source range expansion', () => {
    it('moves a heading whose only-child wrapper collapses (expandToEmptyWrappers)', () => {
      // Wrap the heading in a single-child blockquote. After move, the
      // wrapping blockquote collapses with the heading.
      editor = makeEditor('<blockquote><h2>Solo</h2></blockquote><ul><li><p>L</p></li></ul>');
      const sourcePos = posOf(editor, (n) => n.type.name === 'heading');
      const wrapperPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const targetItemPos = posOf(editor, (n) => n.type.name === 'listItem');

      const tr = editor.state.tr;
      expect(moveBlockAsNestedChild(tr, sourcePos, wrapperPos, targetItemPos)).toBe(true);
      editor.view.dispatch(tr);

      // Top-level blockquote gone (had only 1 child = the heading). Doc
      // is now [bulletList(li(p"L", h2"Solo"))].
      expect(editor.state.doc.childCount).toBe(1);
      expect(editor.state.doc.firstChild?.type.name).toBe('bulletList');
      const li = editor.state.doc.firstChild?.firstChild;
      expect(li?.lastChild?.type.name).toBe('heading');
      expect(li?.lastChild?.textContent).toBe('Solo');
    });
  });

  describe('childIndex (position-aware nested drop)', () => {
    it('non-list source forwarded with childIndex=1 lands as the FIRST child (before existing block children)', () => {
      editor = makeEditor('<p>Source</p><ul><li><p>Target</p><p>Existing</p></li></ul>');
      const sourcePos = posOf(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'Source');
      const wrapperPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const targetItemPos = posOf(editor, (n) => n.type.name === 'listItem');

      const tr = editor.state.tr;
      expect(moveBlockAsNestedChild(tr, sourcePos, wrapperPos, targetItemPos, 1)).toBe(true);
      editor.view.dispatch(tr);

      // Target item is now [Target(label), Source, Existing].
      expect(dump(editor)).toContain(
        'listItem(paragraph("Target"), paragraph("Source"), paragraph("Existing"))',
      );
    });

    it('list-item source with childIndex=1 wraps in a fresh sublist placed BEFORE the existing block child', () => {
      editor = makeEditor(
        '<ul><li><p>Drag</p></li></ul><ul><li><p>Target</p><p>X</p></li></ul>',
      );
      const sourcePos = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Drag');
      const targetItemPos = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent.startsWith('Target'));
      const wrapperPos = editor.state.doc.resolve(targetItemPos).before();

      const tr = editor.state.tr;
      expect(moveBlockAsNestedChild(tr, sourcePos, wrapperPos, targetItemPos, 1)).toBe(true);
      editor.view.dispatch(tr);

      // Target item: [label, nested bulletList(Drag), X]. The fresh sublist
      // sits at index 1 (before X), not appended last.
      const out = dump(editor);
      expect(out).toContain('paragraph("Target"), bulletList(listItem(paragraph("Drag")))');
      expect(out).toContain('bulletList(listItem(paragraph("Drag"))), paragraph("X")');
    });

    it('childIndex omitted still appends as last child (backward-compat)', () => {
      editor = makeEditor('<p>Source</p><ul><li><p>Target</p><p>Existing</p></li></ul>');
      const sourcePos = posOf(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'Source');
      const wrapperPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const targetItemPos = posOf(editor, (n) => n.type.name === 'listItem');

      const tr = editor.state.tr;
      expect(moveBlockAsNestedChild(tr, sourcePos, wrapperPos, targetItemPos)).toBe(true);
      editor.view.dispatch(tr);

      expect(dump(editor)).toContain(
        'listItem(paragraph("Target"), paragraph("Existing"), paragraph("Source"))',
      );
    });
  });
});
