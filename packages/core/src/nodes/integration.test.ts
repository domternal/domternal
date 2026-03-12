/**
 * Integration Tests for All Nodes
 *
 * Tests that verify all nodes work together correctly.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '../Editor.js';
import type { JSONContent } from '../types/Content.js';
import { TextSelection } from '@domternal/pm/state';
import { splitListItem, liftListItem, sinkListItem } from '@domternal/pm/schema-list';
import { Document } from './Document.js';
import { Text } from './Text.js';
import { Paragraph } from './Paragraph.js';
import { Heading } from './Heading.js';
import { Blockquote } from './Blockquote.js';
import { CodeBlock } from './CodeBlock.js';
import { BulletList } from './BulletList.js';
import { OrderedList } from './OrderedList.js';
import { ListItem } from './ListItem.js';
import { TaskList } from './TaskList.js';
import { TaskItem } from './TaskItem.js';
import { HorizontalRule } from './HorizontalRule.js';
import { HardBreak } from './HardBreak.js';

const allNodes = [
  Document,
  Text,
  Paragraph,
  Heading,
  Blockquote,
  CodeBlock,
  BulletList,
  OrderedList,
  ListItem,
  TaskList,
  TaskItem,
  HorizontalRule,
  HardBreak,
];

describe('Node Integration', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  describe('Full Document', () => {
    it('creates document with all node types', () => {
      editor = new Editor({
        extensions: allNodes,
        content: `
          <h1>Title</h1>
          <p>Paragraph with <br>hard break</p>
          <blockquote><p>Quote</p></blockquote>
          <pre><code class="language-js">const x = 1;</code></pre>
          <ul><li><p>Bullet item</p></li></ul>
          <ol><li><p>Numbered item</p></li></ol>
          <hr>
        `,
      });

      const doc = editor.state.doc;

      // Verify all node types are present
      const nodeTypes = new Set<string>();
      doc.descendants((node) => {
        nodeTypes.add(node.type.name);
        return true;
      });

      expect(nodeTypes.has('heading')).toBe(true);
      expect(nodeTypes.has('paragraph')).toBe(true);
      expect(nodeTypes.has('blockquote')).toBe(true);
      expect(nodeTypes.has('codeBlock')).toBe(true);
      expect(nodeTypes.has('bulletList')).toBe(true);
      expect(nodeTypes.has('orderedList')).toBe(true);
      expect(nodeTypes.has('listItem')).toBe(true);
      expect(nodeTypes.has('horizontalRule')).toBe(true);
      expect(nodeTypes.has('hardBreak')).toBe(true);
    });

    it('preserves content through JSON roundtrip', () => {
      const originalContent = `
        <h2>Heading</h2>
        <p>Some text</p>
        <blockquote><p>A quote</p></blockquote>
      `;

      editor = new Editor({
        extensions: allNodes,
        content: originalContent,
      });

      const json = editor.getJSON() as unknown as JSONContent;

      // Create new editor from JSON
      const editor2 = new Editor({
        extensions: allNodes,
        content: json,
      });

      expect(editor2.getJSON()).toEqual(json);
      editor2.destroy();
    });

    it('preserves content through HTML roundtrip', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<h1>Test</h1><p>Content</p>',
      });

      const html = editor.getHTML();

      const editor2 = new Editor({
        extensions: allNodes,
        content: html,
      });

      expect(editor2.getHTML()).toBe(html);
      editor2.destroy();
    });
  });

  describe('Nested Structures', () => {
    it('handles blockquote containing list', () => {
      editor = new Editor({
        extensions: allNodes,
        content: `
          <blockquote>
            <ul>
              <li><p>Item in quote</p></li>
            </ul>
          </blockquote>
        `,
      });

      const doc = editor.state.doc;
      const blockquote = doc.child(0);

      expect(blockquote.type.name).toBe('blockquote');
      expect(blockquote.child(0).type.name).toBe('bulletList');
    });

    it('handles nested lists', () => {
      editor = new Editor({
        extensions: allNodes,
        content: `
          <ul>
            <li>
              <p>Parent</p>
              <ul>
                <li><p>Child</p></li>
              </ul>
            </li>
          </ul>
        `,
      });

      const doc = editor.state.doc;
      const outerList = doc.child(0);

      expect(outerList.type.name).toBe('bulletList');

      const listItem = outerList.child(0);
      expect(listItem.type.name).toBe('listItem');
      expect(listItem.childCount).toBe(2);
      expect(listItem.child(0).type.name).toBe('paragraph');
      expect(listItem.child(1).type.name).toBe('bulletList');
    });

    it('handles list inside blockquote inside list', () => {
      editor = new Editor({
        extensions: allNodes,
        content: `
          <ul>
            <li>
              <p>Outer</p>
              <blockquote>
                <ol>
                  <li><p>Inner numbered</p></li>
                </ol>
              </blockquote>
            </li>
          </ul>
        `,
      });

      const doc = editor.state.doc;
      expect(doc.child(0).type.name).toBe('bulletList');

      const listItem = doc.child(0).child(0);
      expect(listItem.child(1).type.name).toBe('blockquote');
      expect(listItem.child(1).child(0).type.name).toBe('orderedList');
    });
  });

  describe('Multiple Block Types', () => {
    it('handles alternating block types', () => {
      editor = new Editor({
        extensions: allNodes,
        content: `
          <h1>Title</h1>
          <p>Intro</p>
          <hr>
          <h2>Section</h2>
          <pre><code>code</code></pre>
          <p>End</p>
        `,
      });

      const doc = editor.state.doc;

      expect(doc.child(0).type.name).toBe('heading');
      expect(doc.child(1).type.name).toBe('paragraph');
      expect(doc.child(2).type.name).toBe('horizontalRule');
      expect(doc.child(3).type.name).toBe('heading');
      expect(doc.child(4).type.name).toBe('codeBlock');
      expect(doc.child(5).type.name).toBe('paragraph');
    });
  });

  describe('Inline Content', () => {
    it('handles hard breaks in paragraph', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<p>Line one<br>Line two<br>Line three</p>',
      });

      const paragraph = editor.state.doc.child(0);
      let breakCount = 0;

      paragraph.forEach((node) => {
        if (node.type.name === 'hardBreak') {
          breakCount++;
        }
      });

      expect(breakCount).toBe(2);
    });

    it('handles hard breaks in list items', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<ul><li><p>First<br>Second</p></li></ul>',
      });

      const list = editor.state.doc.child(0);
      const listItem = list.child(0);
      const paragraph = listItem.child(0);

      let hasBreak = false;
      paragraph.forEach((node) => {
        if (node.type.name === 'hardBreak') {
          hasBreak = true;
        }
      });

      expect(hasBreak).toBe(true);
    });
  });

  describe('Heading Levels', () => {
    it('parses all heading levels', () => {
      editor = new Editor({
        extensions: allNodes,
        content: `
          <h1>H1</h1>
          <h2>H2</h2>
          <h3>H3</h3>
          <h4>H4</h4>
          <h5>H5</h5>
          <h6>H6</h6>
        `,
      });

      const doc = editor.state.doc;

      for (let i = 0; i < 6; i++) {
        const heading = doc.child(i);
        expect(heading.type.name).toBe('heading');
        expect(heading.attrs['level']).toBe(i + 1);
      }
    });
  });

  describe('Code Block', () => {
    it('preserves language attribute', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<pre><code class="language-typescript">const x: number = 1;</code></pre>',
      });

      const codeBlock = editor.state.doc.child(0);
      expect(codeBlock.type.name).toBe('codeBlock');
      expect(codeBlock.attrs['language']).toBe('typescript');
    });

    it('preserves whitespace in code', () => {
      const code = '  function test() {\n    return true;\n  }';
      editor = new Editor({
        extensions: allNodes,
        content: `<pre><code>${code}</code></pre>`,
      });

      const codeBlock = editor.state.doc.child(0);
      expect(codeBlock.textContent).toBe(code);
    });
  });

  describe('Ordered List', () => {
    it('preserves start attribute', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<ol start="5"><li><p>Fifth item</p></li></ol>',
      });

      const list = editor.state.doc.child(0);
      expect(list.type.name).toBe('orderedList');
      expect(list.attrs['start']).toBe(5);
    });
  });

  describe('Empty Document', () => {
    it('creates valid document with empty paragraph', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<p></p>',
      });

      const doc = editor.state.doc;
      expect(doc.childCount).toBe(1);
      expect(doc.child(0).type.name).toBe('paragraph');
    });
  });

  describe('getText', () => {
    it('extracts text from complex document', () => {
      editor = new Editor({
        extensions: allNodes,
        content: `
          <h1>Title</h1>
          <p>Paragraph</p>
          <ul><li><p>List item</p></li></ul>
        `,
      });

      const text = editor.getText();
      expect(text).toContain('Title');
      expect(text).toContain('Paragraph');
      expect(text).toContain('List item');
    });
  });

  describe('Edge Cases', () => {
    it('handles empty string content', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '',
      });

      const doc = editor.state.doc;
      expect(doc.childCount).toBeGreaterThanOrEqual(1);
    });

    it('handles null content', () => {
      editor = new Editor({
        extensions: allNodes,
        content: null,
      });

      const doc = editor.state.doc;
      expect(doc.childCount).toBeGreaterThanOrEqual(1);
    });

    it('handles undefined content', () => {
      editor = new Editor({
        extensions: allNodes,
      });

      const doc = editor.state.doc;
      expect(doc.childCount).toBeGreaterThanOrEqual(1);
    });

    it('handles whitespace-only content', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '   \n\t  ',
      });

      const doc = editor.state.doc;
      expect(doc.childCount).toBeGreaterThanOrEqual(1);
    });

    it('handles multiple consecutive horizontal rules', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<hr><hr><hr>',
      });

      const doc = editor.state.doc;
      let hrCount = 0;
      doc.forEach((node) => {
        if (node.type.name === 'horizontalRule') {
          hrCount++;
        }
      });

      expect(hrCount).toBe(3);
    });

    it('handles deeply nested blockquotes', () => {
      editor = new Editor({
        extensions: allNodes,
        content: `
          <blockquote>
            <blockquote>
              <blockquote>
                <p>Deep quote</p>
              </blockquote>
            </blockquote>
          </blockquote>
        `,
      });

      let depth = 0;
      let node = editor.state.doc.child(0);
      while (node.type.name === 'blockquote') {
        depth++;
        node = node.child(0);
      }

      expect(depth).toBe(3);
    });

    it('handles mixed list types as siblings', () => {
      editor = new Editor({
        extensions: allNodes,
        content: `
          <ul><li><p>Bullet 1</p></li></ul>
          <ol><li><p>Number 1</p></li></ol>
          <ul><li><p>Bullet 2</p></li></ul>
        `,
      });

      const doc = editor.state.doc;
      expect(doc.child(0).type.name).toBe('bulletList');
      expect(doc.child(1).type.name).toBe('orderedList');
      expect(doc.child(2).type.name).toBe('bulletList');
    });

    it('handles empty list items', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<ul><li><p></p></li></ul>',
      });

      const list = editor.state.doc.child(0);
      const listItem = list.child(0);
      const paragraph = listItem.child(0);

      expect(paragraph.type.name).toBe('paragraph');
      expect(paragraph.textContent).toBe('');
    });

    it('handles code block without language', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<pre><code>plain code</code></pre>',
      });

      const codeBlock = editor.state.doc.child(0);
      expect(codeBlock.attrs['language']).toBeNull();
      expect(codeBlock.textContent).toBe('plain code');
    });

    it('handles heading without content', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<h1></h1>',
      });

      const heading = editor.state.doc.child(0);
      expect(heading.type.name).toBe('heading');
      expect(heading.textContent).toBe('');
    });
  });

  describe('Large Document', () => {
    it('handles document with many paragraphs', () => {
      const paragraphs = Array.from({ length: 100 }, (_, i) => `<p>Paragraph ${String(i + 1)}</p>`).join('');

      editor = new Editor({
        extensions: allNodes,
        content: paragraphs,
      });

      const doc = editor.state.doc;
      expect(doc.childCount).toBe(100);
    });

    it('handles document with many list items', () => {
      const items = Array.from({ length: 50 }, (_, i) => `<li><p>Item ${String(i + 1)}</p></li>`).join('');

      editor = new Editor({
        extensions: allNodes,
        content: `<ul>${items}</ul>`,
      });

      const list = editor.state.doc.child(0);
      expect(list.childCount).toBe(50);
    });
  });

  describe('Mixed List Types', () => {
    it('handles task list nested inside bullet list', () => {
      editor = new Editor({
        extensions: allNodes,
        content: `
          <ul>
            <li><p>Bullet</p>
              <ul data-type="taskList">
                <li data-type="taskItem" data-checked="false">
                  <label contenteditable="false"><input type="checkbox"></label>
                  <div><p>Task inside bullet</p></div>
                </li>
              </ul>
            </li>
          </ul>
        `,
      });

      const doc = editor.state.doc;
      const bulletList = doc.child(0);
      expect(bulletList.type.name).toBe('bulletList');
      const listItem = bulletList.child(0);
      expect(listItem.child(1).type.name).toBe('taskList');
      expect(listItem.child(1).child(0).type.name).toBe('taskItem');
    });

    it('handles bullet list nested inside task item', () => {
      editor = new Editor({
        extensions: allNodes,
        content: `
          <ul data-type="taskList">
            <li data-type="taskItem" data-checked="false">
              <label contenteditable="false"><input type="checkbox"></label>
              <div><p>Task</p>
                <ul><li><p>Bullet inside task</p></li></ul>
              </div>
            </li>
          </ul>
        `,
      });

      const doc = editor.state.doc;
      const taskList = doc.child(0);
      expect(taskList.type.name).toBe('taskList');
      const taskItem = taskList.child(0);
      expect(taskItem.textContent).toContain('Bullet inside task');
    });

    it('handles ordered list nested inside task item inside bullet list', () => {
      editor = new Editor({
        extensions: allNodes,
        content: `
          <ul>
            <li><p>Top</p>
              <ul data-type="taskList">
                <li data-type="taskItem" data-checked="false">
                  <label contenteditable="false"><input type="checkbox"></label>
                  <div><p>Task</p>
                    <ol><li><p>Numbered</p></li></ol>
                  </div>
                </li>
              </ul>
            </li>
          </ul>
        `,
      });

      const doc = editor.state.doc;
      expect(doc.child(0).type.name).toBe('bulletList');
      const listItem = doc.child(0).child(0);
      const taskList = listItem.child(1);
      expect(taskList.type.name).toBe('taskList');
      const taskItem = taskList.child(0);
      // taskItem contains paragraph + orderedList
      let hasOrdered = false;
      taskItem.forEach((node) => {
        if (node.type.name === 'orderedList') hasOrdered = true;
      });
      expect(hasOrdered).toBe(true);
    });

    it('preserves mixed list types through JSON roundtrip', () => {
      const html = `
        <ul>
          <li><p>Bullet</p>
            <ul data-type="taskList">
              <li data-type="taskItem" data-checked="true">
                <label contenteditable="false"><input type="checkbox" checked></label>
                <div><p>Checked task</p></div>
              </li>
              <li data-type="taskItem" data-checked="false">
                <label contenteditable="false"><input type="checkbox"></label>
                <div><p>Unchecked task</p></div>
              </li>
            </ul>
          </li>
        </ul>
      `;

      editor = new Editor({ extensions: allNodes, content: html });
      const json = editor.getJSON() as unknown as JSONContent;

      const editor2 = new Editor({ extensions: allNodes, content: json });
      expect(editor2.getJSON()).toEqual(json);
      editor2.destroy();
    });
  });

  describe('List Command Integration', () => {
    it('toggleBulletList wraps and unwraps', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<p>Test</p>',
      });

      editor.commands.toggleBulletList();
      expect(editor.state.doc.child(0).type.name).toBe('bulletList');

      editor.commands.toggleBulletList();
      expect(editor.state.doc.child(0).type.name).toBe('paragraph');
    });

    it('toggleOrderedList wraps and unwraps', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<p>Test</p>',
      });

      editor.commands.toggleOrderedList();
      expect(editor.state.doc.child(0).type.name).toBe('orderedList');

      editor.commands.toggleOrderedList();
      expect(editor.state.doc.child(0).type.name).toBe('paragraph');
    });

    it('toggleTaskList wraps and unwraps', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<p>Test</p>',
      });

      editor.commands.toggleTaskList();
      expect(editor.state.doc.child(0).type.name).toBe('taskList');

      editor.commands.toggleTaskList();
      expect(editor.state.doc.child(0).type.name).toBe('paragraph');
    });

    it('bullet → ordered conversion changes list type', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<ul><li><p>Item</p></li></ul>',
      });

      editor.commands.toggleOrderedList();
      expect(editor.state.doc.child(0).type.name).toBe('orderedList');
      expect(editor.getText()).toContain('Item');
    });

    it('bullet → task conversion changes list type and item type', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<ul><li><p>Item</p></li></ul>',
      });

      editor.commands.toggleTaskList();
      expect(editor.state.doc.child(0).type.name).toBe('taskList');
      expect(editor.state.doc.child(0).child(0).type.name).toBe('taskItem');
      expect(editor.getText()).toContain('Item');
    });

    it('task → bullet conversion changes list type and item type', () => {
      editor = new Editor({
        extensions: allNodes,
        content: `
          <ul data-type="taskList">
            <li data-type="taskItem" data-checked="false">
              <label contenteditable="false"><input type="checkbox"></label>
              <div><p>Task</p></div>
            </li>
          </ul>
        `,
      });

      editor.commands.toggleBulletList();
      expect(editor.state.doc.child(0).type.name).toBe('bulletList');
      expect(editor.state.doc.child(0).child(0).type.name).toBe('listItem');
      expect(editor.getText()).toContain('Task');
    });

    it('bullet → ordered → task → bullet round-trip preserves content', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<ul><li><p>Alpha</p></li><li><p>Beta</p></li></ul>',
      });

      editor.commands.toggleOrderedList();
      expect(editor.state.doc.child(0).type.name).toBe('orderedList');

      editor.commands.toggleTaskList();
      expect(editor.state.doc.child(0).type.name).toBe('taskList');

      editor.commands.toggleBulletList();
      expect(editor.state.doc.child(0).type.name).toBe('bulletList');

      expect(editor.getText()).toContain('Alpha');
      expect(editor.getText()).toContain('Beta');
    });
  });

  describe('ProseMirror List Operations', () => {
    it('splitListItem splits at cursor position', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<ul><li><p>Hello World</p></li></ul>',
      });

      // Position cursor after "Hello" (pos 7)
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 7))
      );

      const nodeType = editor.state.schema.nodes['listItem']!;
      const result = splitListItem(nodeType)(editor.state, editor.view.dispatch);
      expect(result).toBe(true);
      expect(editor.state.doc.child(0).childCount).toBe(2);
    });

    it('sinkListItem nests second item under first', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<ul><li><p>First</p></li><li><p>Second</p></li></ul>',
      });

      // Position cursor in "Second"
      let secondPos = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'Second') secondPos = pos;
      });
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, secondPos))
      );

      const nodeType = editor.state.schema.nodes['listItem']!;
      const result = sinkListItem(nodeType)(editor.state, editor.view.dispatch);
      expect(result).toBe(true);

      // First item should now have nested list
      const firstItem = editor.state.doc.child(0).child(0);
      expect(firstItem.childCount).toBe(2);
      expect(firstItem.child(1).type.name).toBe('bulletList');
    });

    it('liftListItem lifts nested item to parent level', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<ul><li><p>Parent</p><ul><li><p>Child</p></li></ul></li></ul>',
      });

      // Position cursor in "Child"
      let childPos = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'Child') childPos = pos;
      });
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, childPos))
      );

      const nodeType = editor.state.schema.nodes['listItem']!;
      const result = liftListItem(nodeType)(editor.state, editor.view.dispatch);
      expect(result).toBe(true);

      // Should now be flat list with two items
      expect(editor.state.doc.child(0).childCount).toBe(2);
    });

    it('splitListItem on empty item returns false (cannot split empty)', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<ul><li><p></p></li></ul>',
      });

      editor.focus('start');

      const nodeType = editor.state.schema.nodes['listItem']!;
      const result = splitListItem(nodeType)(editor.state, editor.view.dispatch);
      // splitListItem returns false for empty items (nothing to split)
      expect(result).toBe(false);
    });

    it('sinkListItem on first item returns false (no previous sibling)', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<ul><li><p>Only</p></li></ul>',
      });

      editor.focus('start');

      const nodeType = editor.state.schema.nodes['listItem']!;
      const result = sinkListItem(nodeType)(editor.state, editor.view.dispatch);
      expect(result).toBe(false);
    });

    it('liftListItem on top-level item lifts out of list', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<ul><li><p>Only</p></li></ul>',
      });

      editor.focus('start');

      const nodeType = editor.state.schema.nodes['listItem']!;
      const result = liftListItem(nodeType)(editor.state, editor.view.dispatch);
      expect(result).toBe(true);

      // Should be a paragraph, not a list
      expect(editor.state.doc.child(0).type.name).toBe('paragraph');
    });
  });

  describe('Task Item Toggle', () => {
    it('toggleTask flips checked from false to true', () => {
      editor = new Editor({
        extensions: allNodes,
        content: `
          <ul data-type="taskList">
            <li data-type="taskItem" data-checked="false">
              <label contenteditable="false"><input type="checkbox"></label>
              <div><p>Task</p></div>
            </li>
          </ul>
        `,
      });

      editor.focus('start');
      const result = editor.commands.toggleTask();
      expect(result).toBe(true);
      expect(editor.state.doc.child(0).child(0).attrs['checked']).toBe(true);
    });

    it('toggleTask flips checked from true to false', () => {
      editor = new Editor({
        extensions: allNodes,
        content: `
          <ul data-type="taskList">
            <li data-type="taskItem" data-checked="true">
              <label contenteditable="false"><input type="checkbox" checked></label>
              <div><p>Done</p></div>
            </li>
          </ul>
        `,
      });

      editor.focus('start');
      editor.commands.toggleTask();
      expect(editor.state.doc.child(0).child(0).attrs['checked']).toBe(false);
    });

    it('toggleTask returns false when cursor not in task item', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<p>Not a task</p>',
      });

      editor.focus('start');
      const result = editor.commands.toggleTask();
      expect(result).toBe(false);
    });
  });

  describe('Blockquote Inside List', () => {
    it('handles blockquote inside list item', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<ul><li><p>Text</p><blockquote><p>Quote</p></blockquote></li></ul>',
      });

      const listItem = editor.state.doc.child(0).child(0);
      expect(listItem.child(0).type.name).toBe('paragraph');
      expect(listItem.child(1).type.name).toBe('blockquote');
    });

    it('handles code block inside list item', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<ul><li><p>Text</p><pre><code>code</code></pre></li></ul>',
      });

      const listItem = editor.state.doc.child(0).child(0);
      expect(listItem.child(0).type.name).toBe('paragraph');
      expect(listItem.child(1).type.name).toBe('codeBlock');
    });
  });
});
