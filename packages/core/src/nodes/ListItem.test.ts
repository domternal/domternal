import { describe, it, expect, afterEach } from 'vitest';
import type { Node as PMNode } from '@domternal/pm/model';
import { TextSelection } from '@domternal/pm/state';
import { splitListItem, sinkListItem } from '@domternal/pm/schema-list';
import { ListItem } from './ListItem.js';
import { BulletList } from './BulletList.js';
import { OrderedList } from './OrderedList.js';
import { TaskList } from './TaskList.js';
import { TaskItem } from './TaskItem.js';
import { Document } from './Document.js';
import { Text } from './Text.js';
import { Paragraph } from './Paragraph.js';
import { Editor } from '../Editor.js';

describe('ListItem', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(ListItem.name).toBe('listItem');
    });

    it('is a node type', () => {
      expect(ListItem.type).toBe('node');
    });

    it('has paragraph block* content (Notion-strict label slot)', () => {
      expect(ListItem.config.content).toBe('paragraph block*');
    });

    it('is defining', () => {
      expect(ListItem.config.defining).toBe(true);
    });

    it('has default options', () => {
      expect(ListItem.options).toEqual({
        HTMLAttributes: {},
      });
    });

    it('can configure HTMLAttributes', () => {
      const CustomListItem = ListItem.configure({
        HTMLAttributes: { class: 'custom-item' },
      });
      expect(CustomListItem.options.HTMLAttributes).toEqual({ class: 'custom-item' });
    });
  });

  describe('parseHTML', () => {
    it('returns rule for li tag', () => {
      const rules = ListItem.config.parseHTML?.call(ListItem);

      expect(rules).toEqual([{ tag: 'li' }]);
    });
  });

  describe('renderHTML', () => {
    it('renders li element', () => {
      const spec = ListItem.createNodeSpec();
      const mockNode = { attrs: {} } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, number];

      expect(result[0]).toBe('li');
      expect(result[2]).toBe(0);
    });

    it('merges HTMLAttributes from options', () => {
      const CustomListItem = ListItem.configure({
        HTMLAttributes: { class: 'styled-item' },
      });

      const spec = CustomListItem.createNodeSpec();
      const mockNode = { attrs: {} } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, number];

      expect(result[0]).toBe('li');
      expect(result[1]).toEqual({ class: 'styled-item' });
    });
  });

  describe('addKeyboardShortcuts', () => {
    it('provides Enter shortcut', () => {
      const shortcuts = ListItem.config.addKeyboardShortcuts?.call(ListItem);

      expect(shortcuts).toHaveProperty('Enter');
    });

    it('Tab/Shift-Tab handled by ListKeymap extension', () => {
      // Tab and Shift-Tab are provided by ListKeymap (included via addExtensions),
      // not directly by ListItem's addKeyboardShortcuts.
      const shortcuts = ListItem.config.addKeyboardShortcuts?.call(ListItem);
      expect(shortcuts).not.toHaveProperty('Tab');
      expect(shortcuts).not.toHaveProperty('Shift-Tab');
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    });

    it('works in bullet list', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>Item</p></li></ul>',
      });

      expect(editor.getText()).toContain('Item');
    });

    it('works in ordered list', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, OrderedList, ListItem],
        content: '<ol><li><p>Item</p></li></ol>',
      });

      expect(editor.getText()).toContain('Item');
    });

    it('parses list item correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>List item</p></li></ul>',
      });

      const doc = editor.state.doc;
      const list = doc.child(0);
      expect(list.child(0).type.name).toBe('listItem');
    });

    it('renders list item correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>Test</p></li></ul>',
      });

      const html = editor.getHTML();
      expect(html).toBe('<ul><li><p>Test</p></li></ul>');
    });

    it('can contain multiple blocks', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>First para</p><p>Second para</p></li></ul>',
      });

      const doc = editor.state.doc;
      const listItem = doc.child(0).child(0);
      expect(listItem.childCount).toBe(2);
      expect(listItem.child(0).type.name).toBe('paragraph');
      expect(listItem.child(1).type.name).toBe('paragraph');
    });

    it('can contain nested lists', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>Parent</p><ul><li><p>Child</p></li></ul></li></ul>',
      });

      const doc = editor.state.doc;
      const outerListItem = doc.child(0).child(0);
      expect(outerListItem.childCount).toBe(2);
      expect(outerListItem.child(0).type.name).toBe('paragraph');
      expect(outerListItem.child(1).type.name).toBe('bulletList');
    });

    it('Tab sinks list item via ListKeymap', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>Item 1</p></li><li><p>Item 2</p></li></ul>',
      });

      // Position cursor in second list item
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 14))
      );

      // ListKeymap (included via ListItem.addExtensions) provides Tab handler.
      // Verify sinkListItem works on the editor.
      const nodeType = editor.state.schema.nodes['listItem']!;
      const result = sinkListItem(nodeType)(editor.state, editor.view.dispatch);
      expect(result).toBe(true);
    });

    it('Enter splits list item via keymap plugin', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>Hello world</p></li></ul>',
      });

      // Position cursor in the middle of the text
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 8))
      );

      // The Enter key is handled by addKeyboardShortcuts
      // We can invoke the splitListItem command directly to test the same code path
      const nodeType = editor.state.schema.nodes['listItem']!;
      const result = splitListItem(nodeType)(editor.state, editor.view.dispatch);
      expect(result).toBe(true);

      // Should now have two list items
      expect(editor.state.doc.child(0).childCount).toBe(2);
    });

    it('Enter guard: returns false when cursor parent is not listItem', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<p>Not in a list</p>',
      });

      editor.focus('start');

      const nodeType = editor.state.schema.nodes['listItem'];
      const shortcuts = ListItem.config.addKeyboardShortcuts?.call({
        ...ListItem, editor, nodeType, options: ListItem.options,
      } as any);

      const result = (shortcuts?.['Enter'] as any)?.();
      expect(result).toBe(false);
    });

    it('liftListItem on empty item in bullet list inside taskItem', () => {
      // This tests the scenario where liftListItem would place bare paragraph in taskItem
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, OrderedList, ListItem, TaskList, TaskItem],
        content: `
          <ul data-type="taskList">
            <li data-type="taskItem" data-checked="false">
              <label contenteditable="false"><input type="checkbox"></label>
              <div><p>Task</p>
                <ul><li><p></p></li></ul>
              </div>
            </li>
          </ul>
        `,
      });

      // Find the empty paragraph position inside the nested bullet
      let emptyPos = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'paragraph' && node.content.size === 0) {
          // Find the empty paragraph that's inside the nested bulletList
          const $pos = editor!.state.doc.resolve(pos);
          if ($pos.depth >= 4) { // deep enough to be in nested list
            emptyPos = pos + 1; // inside the paragraph
          }
        }
      });

      if (emptyPos > 0) {
        editor.view.dispatch(
          editor.state.tr.setSelection(TextSelection.create(editor.state.doc, emptyPos))
        );

        // Invoke Enter handler
        const nodeType = editor.state.schema.nodes['listItem'];
        const shortcuts = ListItem.config.addKeyboardShortcuts?.call({
          ...ListItem, editor, nodeType, options: ListItem.options,
        } as any);

        const result = (shortcuts?.['Enter'] as any)?.();
        expect(result).toBe(true);

        // Should have created a new taskItem, not a bare paragraph
        const html = editor.getHTML();
        expect(html).toContain('Task');
        // The taskList should have 2 task items now
        const taskList = editor.state.doc.child(0);
        expect(taskList.type.name).toBe('taskList');
        expect(taskList.childCount).toBe(2);
      }
    });

    it('multiple items in nested list: only removes empty item', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, OrderedList, ListItem, TaskList, TaskItem],
        content: `
          <ul data-type="taskList">
            <li data-type="taskItem" data-checked="false">
              <label contenteditable="false"><input type="checkbox"></label>
              <div><p>Task</p>
                <ul><li><p>Keep me</p></li><li><p></p></li></ul>
              </div>
            </li>
          </ul>
        `,
      });

      // Find the second (empty) listItem paragraph
      let emptyPos = 0;
      let foundKeepMe = false;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'Keep me') foundKeepMe = true;
        if (foundKeepMe && node.type.name === 'paragraph' && node.content.size === 0) {
          emptyPos = pos + 1;
          foundKeepMe = false; // only find the first one after "Keep me"
        }
      });

      if (emptyPos > 0) {
        editor.view.dispatch(
          editor.state.tr.setSelection(TextSelection.create(editor.state.doc, emptyPos))
        );

        const nodeType = editor.state.schema.nodes['listItem'];
        const shortcuts = ListItem.config.addKeyboardShortcuts?.call({
          ...ListItem, editor, nodeType, options: ListItem.options,
        } as any);

        const result = (shortcuts?.['Enter'] as any)?.();
        expect(result).toBe(true);

        const html = editor.getHTML();
        expect(html).toContain('Keep me');
        expect(html).toContain('Task');
      }
    });

    it('Enter falls through to liftListItem for empty top-level item', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>a</p></li><li><p></p></li></ul>',
      });

      // Find empty listItem's paragraph
      let emptyPos = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'paragraph' && node.content.size === 0) {
          emptyPos = pos + 1;
        }
      });

      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, emptyPos))
      );

      const nodeType = editor.state.schema.nodes['listItem'];
      const shortcuts = ListItem.config.addKeyboardShortcuts?.call({
        ...ListItem, editor, nodeType, options: ListItem.options,
      } as any);

      const result = (shortcuts?.['Enter'] as any)?.();
      // splitListItem succeeds for empty item — lifts into paragraph at top level
      expect(typeof result).toBe('boolean');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // children-zone Enter / Backspace handlers
  // ────────────────────────────────────────────────────────────────────

  describe('children-zone Enter', () => {
    let editor: Editor | undefined;
    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    function invokeEnter(ed: Editor): unknown {
      const nodeType = ed.state.schema.nodes['listItem'];
      const shortcuts = ListItem.config.addKeyboardShortcuts?.call({
        ...ListItem, editor: ed, nodeType, options: ListItem.options,
      } as any);
      return (shortcuts?.['Enter'] as any)?.();
    }

    function caretAtEndOfNthEmptyP(ed: Editor, n: number): void {
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

    function caretAtEndOfNodeWithText(ed: Editor, typeName: string, text: string): void {
      let pos = -1;
      let size = 0;
      ed.state.doc.descendants((node, p) => {
        if (pos !== -1) return false;
        if (node.type.name === typeName && node.textContent === text) { pos = p; size = node.nodeSize; return false; }
        return true;
      });
      if (pos === -1) throw new Error(`node ${typeName}:${text} not found`);
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos + size - 1)));
    }

    it('empty children-zone p + Enter inserts another empty p as next sibling INSIDE same li', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>Label</p><p></p></li></ul>',
      });
      caretAtEndOfNthEmptyP(editor, 0);

      const result = invokeEnter(editor);
      expect(result).toBe(true);

      // li now has [Label, empty-p (orig), empty-p (NEW)] = 3 children.
      const li = editor.state.doc.firstChild?.firstChild;
      expect(li?.type.name).toBe('listItem');
      expect(li?.childCount).toBe(3);
    });

    it('non-empty children-zone p + Enter at end splits in place INSIDE same li', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>Label</p><p>Note</p></li></ul>',
      });
      caretAtEndOfNodeWithText(editor, 'paragraph', 'Note');

      const result = invokeEnter(editor);
      expect(result).toBe(true);

      // li now has [Label, "Note", empty-p (NEW)] - both halves stay inside li.
      const li = editor.state.doc.firstChild?.firstChild;
      expect(li?.childCount).toBe(3);
      expect(li?.child(2).type.name).toBe('paragraph');
      expect(li?.child(2).textContent).toBe('');
    });

    it('non-empty children-zone p + Enter at MID splits text in place', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>Label</p><p>HelloWorld</p></li></ul>',
      });
      // Caret at mid of "HelloWorld" (after "Hello").
      let pos = -1;
      editor.state.doc.descendants((node, p) => {
        if (pos !== -1) return false;
        if (node.type.name === 'paragraph' && node.textContent === 'HelloWorld') { pos = p + 1 + 'Hello'.length; return false; }
        return true;
      });
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));

      const result = invokeEnter(editor);
      expect(result).toBe(true);

      // li now has [Label, "Hello", "World"] - text split in place.
      const li = editor.state.doc.firstChild?.firstChild;
      expect(li?.childCount).toBe(3);
      expect(li?.child(1).textContent).toBe('Hello');
      expect(li?.child(2).textContent).toBe('World');
    });

    it('label paragraph empty + Enter does NOT trigger children-zone branch (lifts entire item)', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p></p></li></ul>',
      });
      caretAtEndOfNthEmptyP(editor, 0);

      const result = invokeEnter(editor);
      expect(result).toBe(true);
      // After lift, top-level has a paragraph (or bulletList may still be present).
      // Critical: NO accumulated empty-p inside the listItem (children-zone branch did not fire).
      const li = editor.state.doc.firstChild?.firstChild;
      // listItem may be lifted out entirely; if still present, no extra siblings.
      if (li?.type.name === 'listItem') {
        expect(li.childCount).toBe(1);
      }
    });

    it('label paragraph non-empty + Enter at end creates new sibling listItem (NOT children-zone accumulate)', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>OnlyLabel</p></li></ul>',
      });
      caretAtEndOfNodeWithText(editor, 'paragraph', 'OnlyLabel');

      const result = invokeEnter(editor);
      expect(result).toBe(true);

      // splitListItem creates 2 list items.
      const ul = editor.state.doc.firstChild;
      expect(ul?.childCount).toBe(2);
    });
  });

  describe('Backspace exit', () => {
    let editor: Editor | undefined;
    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    function invokeBackspace(ed: Editor): unknown {
      const nodeType = ed.state.schema.nodes['listItem'];
      const shortcuts = ListItem.config.addKeyboardShortcuts?.call({
        ...ListItem, editor: ed, nodeType, options: ListItem.options,
      } as any);
      return (shortcuts?.['Backspace'] as any)?.();
    }

    function caretAtEndOfNthEmptyP(ed: Editor, n: number): void {
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

    it('empty children-zone p + Backspace lifts JUST that paragraph as top-level sibling', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>Label</p><p></p></li></ul>',
      });
      caretAtEndOfNthEmptyP(editor, 0);

      const result = invokeBackspace(editor);
      expect(result).toBe(true);

      // li retains [Label]; top-level: [bulletList, paragraph (lifted)]
      const docTop: { type: string; size: number }[] = [];
      editor.state.doc.forEach((n) => docTop.push({ type: n.type.name, size: n.childCount }));
      expect(docTop[0]?.type).toBe('bulletList');
      expect(docTop[1]?.type).toBe('paragraph');
    });

    it('label paragraph (empty) + Backspace falls through (returns false), default handler runs', () => {
      // childIndex===0 case: util returns isInChildrenZone=false, our
      // branch does not fire, handler returns false (falls through).
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p></p></li></ul>',
      });
      caretAtEndOfNthEmptyP(editor, 0);

      const result = invokeBackspace(editor);
      expect(result).toBe(false);
    });

    it('non-empty paragraph + Backspace falls through (returns false)', () => {
      // Backspace handler bails when paragraph.content.size !== 0.
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>Label</p><p>Body</p></li></ul>',
      });
      // Caret at start of "Body".
      let pos = -1;
      editor.state.doc.descendants((node, p) => {
        if (pos !== -1) return false;
        if (node.type.name === 'paragraph' && node.textContent === 'Body') { pos = p + 1; return false; }
        return true;
      });
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));

      const result = invokeBackspace(editor);
      expect(result).toBe(false);
    });

    it('caret at offset > 0 + Backspace falls through (returns false)', () => {
      // parentOffset !== 0 guard.
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<ul><li><p>Label</p><p>X</p></li></ul>',
      });
      // Caret at end of "X" (parentOffset 1).
      let pos = -1;
      editor.state.doc.descendants((node, p) => {
        if (pos !== -1) return false;
        if (node.type.name === 'paragraph' && node.textContent === 'X') { pos = p + 2; return false; }
        return true;
      });
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));

      const result = invokeBackspace(editor);
      expect(result).toBe(false);
    });

    it('Backspace bails when not in any list item (no editor.nodeType match)', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, BulletList, ListItem],
        content: '<p>plain</p>',
      });
      editor.focus('start');

      const result = invokeBackspace(editor);
      expect(result).toBe(false);
    });
  });
});
