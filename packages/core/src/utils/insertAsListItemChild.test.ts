import { describe, it, expect, afterEach } from 'vitest';
import type { Node as PMNode } from '@domternal/pm/model';
import { insertAsListItemChild } from './insertAsListItemChild.js';
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

/** Locate the first node in the doc matching `predicate`; returns its position (= one BEFORE the node). */
function findPos(editor: Editor, predicate: (n: PMNode) => boolean): number {
  let pos = -1;
  editor.state.doc.descendants((node, p) => {
    if (pos !== -1) return false;
    if (predicate(node)) { pos = p; return false; }
    return true;
  });
  return pos;
}

/** Build a fresh paragraph node with given text using the editor's schema. */
function makeParagraph(editor: Editor, text: string): PMNode {
  return editor.state.schema.nodes['paragraph']!.create(null, editor.state.schema.text(text));
}

/** Build a fresh heading node. */
function makeHeading(editor: Editor, level: number, text: string): PMNode {
  return editor.state.schema.nodes['heading']!.create({ level }, editor.state.schema.text(text));
}

/** Doc to-string for snapshot-style assertions. */
function dump(editor: Editor): string {
  return editor.state.doc.toString();
}

describe('insertAsListItemChild', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
  });

  describe('pure insert (no sourceRange)', () => {
    it('appends a heading as last child of the LAST list item when targetItemPos is omitted', () => {
      editor = makeEditor('<ul><li><p>One</p></li><li><p>Two</p></li></ul>');
      const wrapperPos = findPos(editor, (n) => n.type.name === 'bulletList');
      const heading = makeHeading(editor, 2, 'X');

      const tr = editor.state.tr;
      const result = insertAsListItemChild({ tr, wrapperPos, blockNode: heading });

      expect(result.ok).toBe(true);
      expect(result.insertedAt).toBeGreaterThan(0);
      editor.view.dispatch(tr);

      // Last item should now contain a heading after its label paragraph.
      const lastItem = editor.state.doc.firstChild?.lastChild;
      expect(lastItem?.type.name).toBe('listItem');
      expect(lastItem?.lastChild?.type.name).toBe('heading');
      expect(lastItem?.firstChild?.type.name).toBe('paragraph');
      expect(lastItem?.firstChild?.textContent).toBe('Two');
    });

    it('appends a paragraph as last child of the SPECIFIED list item via targetItemPos', () => {
      editor = makeEditor('<ul><li><p>One</p></li><li><p>Two</p></li></ul>');
      const wrapperPos = findPos(editor, (n) => n.type.name === 'bulletList');
      const firstItemPos = findPos(editor, (n) => n.type.name === 'listItem');
      const para = makeParagraph(editor, 'Inserted');

      const tr = editor.state.tr;
      const result = insertAsListItemChild({
        tr,
        wrapperPos,
        targetItemPos: firstItemPos,
        blockNode: para,
      });

      expect(result.ok).toBe(true);
      editor.view.dispatch(tr);

      const firstItem = editor.state.doc.firstChild?.firstChild;
      expect(firstItem?.childCount).toBe(2);
      expect(firstItem?.lastChild?.type.name).toBe('paragraph');
      expect(firstItem?.lastChild?.textContent).toBe('Inserted');
    });

    it('appends into a taskItem when wrapper is a taskList', () => {
      editor = makeEditor(
        '<ul data-type="taskList"><li data-type="taskItem"><p>T</p></li></ul>',
      );
      const wrapperPos = findPos(editor, (n) => n.type.name === 'taskList');
      const heading = makeHeading(editor, 3, 'Notes');

      const tr = editor.state.tr;
      const result = insertAsListItemChild({ tr, wrapperPos, blockNode: heading });

      expect(result.ok).toBe(true);
      editor.view.dispatch(tr);

      const taskItem = editor.state.doc.firstChild?.firstChild;
      expect(taskItem?.type.name).toBe('taskItem');
      expect(taskItem?.lastChild?.type.name).toBe('heading');
    });

    it('inserts a horizontalRule (atom block) as last child', () => {
      editor = makeEditor('<ul><li><p>L</p></li></ul>');
      const wrapperPos = findPos(editor, (n) => n.type.name === 'bulletList');
      const hr = editor.state.schema.nodes['horizontalRule']!.create();

      const tr = editor.state.tr;
      const result = insertAsListItemChild({ tr, wrapperPos, blockNode: hr });

      expect(result.ok).toBe(true);
      editor.view.dispatch(tr);
      expect(dump(editor)).toContain('listItem(paragraph("L"), horizontalRule)');
    });
  });

  describe('move with sourceRange (delete + insert)', () => {
    it('moves a heading from AFTER the wrapper into the last item (mirrors Tab indent)', () => {
      editor = makeEditor('<ul><li><p>L</p></li></ul><h2>After</h2>');
      const wrapperPos = findPos(editor, (n) => n.type.name === 'bulletList');
      const headingPos = findPos(editor, (n) => n.type.name === 'heading');
      const heading = editor.state.doc.nodeAt(headingPos)!;
      const headingEnd = headingPos + heading.nodeSize;

      const tr = editor.state.tr;
      const result = insertAsListItemChild({
        tr,
        wrapperPos,
        blockNode: heading,
        sourceRange: { from: headingPos, to: headingEnd },
      });

      expect(result.ok).toBe(true);
      editor.view.dispatch(tr);

      // Doc is now [bulletList(li(p, h2))], no top-level heading.
      expect(editor.state.doc.childCount).toBe(1);
      const li = editor.state.doc.firstChild?.firstChild;
      expect(li?.type.name).toBe('listItem');
      expect(li?.childCount).toBe(2);
      expect(li?.lastChild?.type.name).toBe('heading');
      expect(li?.lastChild?.textContent).toBe('After');
    });

    it('moves a heading from BEFORE the wrapper - position math handles shift', () => {
      editor = makeEditor('<h2>Before</h2><ul><li><p>L</p></li></ul>');
      const wrapperPos = findPos(editor, (n) => n.type.name === 'bulletList');
      const headingPos = findPos(editor, (n) => n.type.name === 'heading');
      const heading = editor.state.doc.nodeAt(headingPos)!;
      const headingEnd = headingPos + heading.nodeSize;

      const tr = editor.state.tr;
      const result = insertAsListItemChild({
        tr,
        wrapperPos,
        blockNode: heading,
        sourceRange: { from: headingPos, to: headingEnd },
      });

      expect(result.ok).toBe(true);
      editor.view.dispatch(tr);

      // Doc is now [bulletList(li(p, h2))], no top-level heading.
      expect(editor.state.doc.childCount).toBe(1);
      const li = editor.state.doc.firstChild?.firstChild;
      expect(li?.lastChild?.type.name).toBe('heading');
      expect(li?.lastChild?.textContent).toBe('Before');
    });

    it('insertedAt resolves to the inserted block (caret-able position)', () => {
      editor = makeEditor('<ul><li><p>L</p></li></ul><h2>X</h2>');
      const wrapperPos = findPos(editor, (n) => n.type.name === 'bulletList');
      const headingPos = findPos(editor, (n) => n.type.name === 'heading');
      const heading = editor.state.doc.nodeAt(headingPos)!;

      const tr = editor.state.tr;
      const result = insertAsListItemChild({
        tr,
        wrapperPos,
        blockNode: heading,
        sourceRange: { from: headingPos, to: headingPos + heading.nodeSize },
      });

      expect(result.ok).toBe(true);
      // Resolving at insertedAt must point to a heading node.
      const $at = tr.doc.resolve(result.insertedAt!);
      expect($at.nodeAfter?.type.name).toBe('heading');
    });
  });

  describe('schema rejection', () => {
    it('returns ok=false WITHOUT mutating tr when schema rejects the insertion', () => {
      // Strict listItem schema: paragraph block*. A naked text node would
      // violate the rule. canReplaceWith returns false; util bails clean.
      editor = makeEditor('<ul><li><p>L</p></li></ul>');
      const wrapperPos = findPos(editor, (n) => n.type.name === 'bulletList');
      // Build a doc node (top-level only) - inserting a doc as listItem
      // child violates `paragraph block*` content rule.
      const docNode = editor.state.schema.nodes['doc']!.create(
        null,
        editor.state.schema.nodes['paragraph']!.create(),
      );

      const tr = editor.state.tr;
      const before = tr.doc.toString();
      const result = insertAsListItemChild({ tr, wrapperPos, blockNode: docNode });

      expect(result.ok).toBe(false);
      expect(result.insertedAt).toBeUndefined();
      expect(tr.doc.toString()).toBe(before);
    });
  });

  describe('precondition failures', () => {
    it('returns ok=false when wrapperPos points to a non-list node (paragraph)', () => {
      editor = makeEditor('<p>Top</p><ul><li><p>L</p></li></ul>');
      const paraPos = findPos(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'Top');
      const heading = makeHeading(editor, 2, 'X');

      const tr = editor.state.tr;
      const result = insertAsListItemChild({ tr, wrapperPos: paraPos, blockNode: heading });

      expect(result.ok).toBe(false);
    });

    it('returns ok=false on out-of-bounds wrapperPos (negative)', () => {
      editor = makeEditor('<ul><li><p>L</p></li></ul>');
      const heading = makeHeading(editor, 2, 'X');

      const result = insertAsListItemChild({
        tr: editor.state.tr,
        wrapperPos: -1,
        blockNode: heading,
      });

      expect(result.ok).toBe(false);
    });

    it('returns ok=false on out-of-bounds wrapperPos (past doc end)', () => {
      editor = makeEditor('<ul><li><p>L</p></li></ul>');
      const heading = makeHeading(editor, 2, 'X');

      const result = insertAsListItemChild({
        tr: editor.state.tr,
        wrapperPos: editor.state.doc.content.size + 100,
        blockNode: heading,
      });

      expect(result.ok).toBe(false);
    });

    it('returns ok=false when targetItemPos points to a paragraph (not a list item)', () => {
      editor = makeEditor('<ul><li><p>L</p></li></ul>');
      const wrapperPos = findPos(editor, (n) => n.type.name === 'bulletList');
      const paraPos = findPos(editor, (n) => n.type.name === 'paragraph');
      const heading = makeHeading(editor, 2, 'X');

      const result = insertAsListItemChild({
        tr: editor.state.tr,
        wrapperPos,
        targetItemPos: paraPos,
        blockNode: heading,
      });

      expect(result.ok).toBe(false);
    });

    it('returns ok=false when targetItemPos lives in a DIFFERENT wrapper than wrapperPos', () => {
      editor = makeEditor(
        '<ul><li><p>A</p></li></ul><ul><li><p>B</p></li></ul>',
      );
      // Pick wrapperPos = first wrapper, targetItemPos = item in SECOND wrapper.
      let firstWrapperPos = -1;
      let secondItemPos = -1;
      let seenFirstWrapper = false;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'bulletList') {
          if (!seenFirstWrapper) {
            firstWrapperPos = pos;
            seenFirstWrapper = true;
          }
          return true;
        }
        if (node.type.name === 'listItem' && seenFirstWrapper && firstWrapperPos !== -1) {
          // Second wrapper's item: pos is past first wrapper's nodeSize.
          if (pos > firstWrapperPos + editor!.state.doc.nodeAt(firstWrapperPos)!.nodeSize) {
            if (secondItemPos === -1) secondItemPos = pos;
          }
        }
        return true;
      });
      expect(firstWrapperPos).toBeGreaterThanOrEqual(0);
      expect(secondItemPos).toBeGreaterThanOrEqual(0);
      const heading = makeHeading(editor, 2, 'X');

      const result = insertAsListItemChild({
        tr: editor.state.tr,
        wrapperPos: firstWrapperPos,
        targetItemPos: secondItemPos,
        blockNode: heading,
      });

      expect(result.ok).toBe(false);
    });
  });

  describe('self-drop guard', () => {
    it('returns ok=false when sourceRange contains the targetItemContentEnd (drop into self)', () => {
      // Simulate dragging a list item INTO ITSELF: source range covers
      // the entire wrapper, so target end is inside source range.
      editor = makeEditor('<ul><li><p>L</p></li></ul>');
      const wrapperPos = findPos(editor, (n) => n.type.name === 'bulletList');
      const wrapper = editor.state.doc.nodeAt(wrapperPos)!;
      const para = makeParagraph(editor, 'X');

      const result = insertAsListItemChild({
        tr: editor.state.tr,
        wrapperPos,
        blockNode: para,
        // Source covers the whole wrapper (incl. its only item) -
        // targetItemContentEnd sits INSIDE this range.
        sourceRange: { from: wrapperPos, to: wrapperPos + wrapper.nodeSize },
      });

      expect(result.ok).toBe(false);
    });
  });

  describe('dry-run via discarded transaction', () => {
    it('mutating tr without dispatch leaves the editor doc unchanged', () => {
      editor = makeEditor('<ul><li><p>L</p></li></ul><h2>X</h2>');
      const before = dump(editor);
      const wrapperPos = findPos(editor, (n) => n.type.name === 'bulletList');
      const headingPos = findPos(editor, (n) => n.type.name === 'heading');
      const heading = editor.state.doc.nodeAt(headingPos)!;

      const tr = editor.state.tr;
      const result = insertAsListItemChild({
        tr,
        wrapperPos,
        blockNode: heading,
        sourceRange: { from: headingPos, to: headingPos + heading.nodeSize },
      });
      expect(result.ok).toBe(true);

      // Caller deliberately does NOT dispatch - editor doc unchanged.
      expect(dump(editor)).toBe(before);
    });
  });
});
