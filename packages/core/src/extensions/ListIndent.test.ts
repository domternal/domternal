import { describe, it, expect, afterEach } from 'vitest';
import type { Node as PMNode } from '@domternal/pm/model';
import {
  ListIndent,
  indentBlockAsListChild,
  outdentBlockFromListItem,
} from './ListIndent.js';
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
import { BaseKeymap } from './BaseKeymap.js';
import { ListKeymap } from './ListKeymap.js';
import { Editor } from '../Editor.js';
import { NodeSelection, TextSelection } from '@domternal/pm/state';

const extensions = [
  Document, Text, Paragraph,
  Heading, Blockquote, CodeBlock, HorizontalRule,
  BulletList, OrderedList, ListItem,
  TaskList, TaskItem,
  BaseKeymap, ListKeymap, ListIndent,
];

function makeEditor(content: string): Editor {
  return new Editor({ extensions, content });
}

/** Place caret inside the FIRST node matching `predicate` at offset 0. */
function caretInside(editor: Editor, predicate: (n: PMNode) => boolean): boolean {
  let pos = -1;
  editor.state.doc.descendants((node, p) => {
    if (pos !== -1) return false;
    if (predicate(node)) { pos = p; return false; }
    return true;
  });
  if (pos === -1) return false;
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos + 1)),
  );
  return true;
}

/** Returns the doc.toString() representation. */
function dump(editor: Editor): string {
  return editor.state.doc.toString();
}

describe('ListIndent extension', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
  });

  describe('exports + identity', () => {
    it('exposes the ListIndent extension factory + helpers', () => {
      expect(ListIndent.name).toBe('listIndent');
      expect(typeof indentBlockAsListChild).toBe('function');
      expect(typeof outdentBlockFromListItem).toBe('function');
    });
  });

  describe('indentBlockAsListChild', () => {
    it('indents a heading after a bulletList into the LAST item of that list', () => {
      editor = makeEditor('<ul><li><p>First</p></li><li><p>Second</p></li></ul><h2>After</h2>');
      caretInside(editor, (n) => n.type.name === 'heading' && n.textContent === 'After');
      const ok = indentBlockAsListChild(editor.state, editor.view.dispatch);
      expect(ok).toBe(true);

      // Heading should now sit inside the last (Second) listItem.
      const top = dump(editor);
      expect(top).toContain('listItem(paragraph("Second"), heading("After"))');
      expect(top).not.toMatch(/heading\("After"\)\s*\)\s*$/);
    });

    it('indents a heading after an orderedList', () => {
      editor = makeEditor('<ol><li><p>One</p></li></ol><h3>Topic</h3>');
      caretInside(editor, (n) => n.type.name === 'heading' && n.textContent === 'Topic');
      expect(indentBlockAsListChild(editor.state, editor.view.dispatch)).toBe(true);
      expect(dump(editor)).toContain('listItem(paragraph("One"), heading("Topic"))');
    });

    it('indents a heading after a taskList into the LAST taskItem', () => {
      editor = makeEditor(
        '<ul data-type="taskList"><li data-type="taskItem"><p>Task</p></li></ul><h2>Notes</h2>',
      );
      caretInside(editor, (n) => n.type.name === 'heading' && n.textContent === 'Notes');
      expect(indentBlockAsListChild(editor.state, editor.view.dispatch)).toBe(true);
      expect(dump(editor)).toContain('taskItem(paragraph("Task"), heading("Notes"))');
    });

    it('indents a codeBlock after a bulletList', () => {
      editor = makeEditor('<ul><li><p>L</p></li></ul><pre><code>x = 1</code></pre>');
      caretInside(editor, (n) => n.type.name === 'codeBlock');
      expect(indentBlockAsListChild(editor.state, editor.view.dispatch)).toBe(true);
      expect(dump(editor)).toContain('codeBlock("x = 1")');
      expect(dump(editor)).toContain('listItem(paragraph("L"), codeBlock');
    });

    it('indents a blockquote after a bulletList', () => {
      editor = makeEditor('<ul><li><p>L</p></li></ul><blockquote><p>Q</p></blockquote>');
      caretInside(editor, (n) => n.type.name === 'blockquote');
      expect(indentBlockAsListChild(editor.state, editor.view.dispatch)).toBe(true);
      expect(dump(editor)).toContain('listItem(paragraph("L"), blockquote');
    });

    it('indents a horizontalRule (atom block) after a list via NodeSelection', () => {
      // Atom blocks (hr / image) have no inline text position - users
      // select them via click which produces a NodeSelection. The
      // handler treats that as the subject block and indents it.
      editor = makeEditor('<ul><li><p>L</p></li></ul><hr><p>Tail</p>');
      let hrPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (hrPos !== -1) return false;
        if (node.type.name === 'horizontalRule') { hrPos = pos; return false; }
        return true;
      });
      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, hrPos)),
      );
      expect(indentBlockAsListChild(editor.state, editor.view.dispatch)).toBe(true);
      expect(dump(editor)).toContain('listItem(paragraph("L"), horizontalRule)');
    });

    it('indents a paragraph after a list (boring but consistent)', () => {
      editor = makeEditor('<ul><li><p>L</p></li></ul><p>Body</p>');
      caretInside(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'Body');
      expect(indentBlockAsListChild(editor.state, editor.view.dispatch)).toBe(true);
      expect(dump(editor)).toContain('listItem(paragraph("L"), paragraph("Body"))');
    });

    it('returns false when there is NO previous sibling (block at index 0)', () => {
      editor = makeEditor('<h2>Title</h2><ul><li><p>L</p></li></ul>');
      caretInside(editor, (n) => n.type.name === 'heading');
      expect(indentBlockAsListChild(editor.state, editor.view.dispatch)).toBe(false);
    });

    it('returns false when the previous sibling is NOT a list (e.g. paragraph)', () => {
      editor = makeEditor('<p>Above</p><h2>Heading</h2>');
      caretInside(editor, (n) => n.type.name === 'heading');
      expect(indentBlockAsListChild(editor.state, editor.view.dispatch)).toBe(false);
    });

    it('returns false when the cursor is INSIDE a list item (defer to ListKeymap.Tab)', () => {
      editor = makeEditor('<ul><li><p>Inside</p></li></ul>');
      caretInside(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'Inside');
      expect(indentBlockAsListChild(editor.state, editor.view.dispatch)).toBe(false);
    });

    it('returns false when the cursor is at NESTED depth (e.g. inside blockquote, MVP scope)', () => {
      editor = makeEditor('<ul><li><p>L</p></li></ul><blockquote><p>Quoted</p></blockquote>');
      // Caret inside blockquote's paragraph -> $from.depth = 2 (doc -> blockquote -> p).
      caretInside(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'Quoted');
      expect(indentBlockAsListChild(editor.state, editor.view.dispatch)).toBe(false);
    });

    it('returns false on a non-empty selection (range) - the handler is single-cursor only', () => {
      editor = makeEditor('<ul><li><p>L</p></li></ul><p>Body</p>');
      // Range across the paragraph.
      const pPos = (() => {
        let p = -1;
        editor!.state.doc.descendants((n, pos) => {
          if (p !== -1) return false;
          if (n.type.name === 'paragraph' && n.textContent === 'Body') { p = pos; return false; }
          return true;
        });
        return p;
      })();
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pPos + 1, pPos + 4)),
      );
      expect(indentBlockAsListChild(editor.state, editor.view.dispatch)).toBe(false);
    });

    it('does not throw and returns false when called against an empty doc', () => {
      editor = makeEditor('');
      expect(() => indentBlockAsListChild(editor!.state, editor!.view.dispatch)).not.toThrow();
    });

    it('does not dispatch when called WITHOUT a dispatch fn (dry run returns truthy when applicable)', () => {
      editor = makeEditor('<ul><li><p>L</p></li></ul><p>Body</p>');
      caretInside(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'Body');
      const before = dump(editor);
      const ok = indentBlockAsListChild(editor.state);
      expect(ok).toBe(true);
      // Doc unchanged - dry-run check.
      expect(dump(editor)).toBe(before);
    });
  });

  describe('outdentBlockFromListItem', () => {
    it('outdents a heading that is the LAST child of the LAST bullet item to top-level (sibling after the list)', () => {
      editor = makeEditor('<ul><li><p>L</p><h2>Inside</h2></li></ul>');
      caretInside(editor, (n) => n.type.name === 'heading' && n.textContent === 'Inside');
      const ok = outdentBlockFromListItem(editor.state, editor.view.dispatch);
      expect(ok).toBe(true);

      // Heading lifted out: doc has [bulletList, heading].
      const top: string[] = [];
      editor.state.doc.forEach((n) => top.push(n.type.name));
      expect(top).toEqual(['bulletList', 'heading']);
    });

    it('outdents a heading from the LAST taskItem to top-level', () => {
      editor = makeEditor(
        '<ul data-type="taskList"><li data-type="taskItem"><p>T</p><h2>Notes</h2></li></ul>',
      );
      caretInside(editor, (n) => n.type.name === 'heading' && n.textContent === 'Notes');
      expect(outdentBlockFromListItem(editor.state, editor.view.dispatch)).toBe(true);
      const top: string[] = [];
      editor.state.doc.forEach((n) => top.push(n.type.name));
      expect(top).toEqual(['taskList', 'heading']);
    });

    it('outdents a codeBlock as last child of last bullet item', () => {
      editor = makeEditor('<ul><li><p>L</p><pre><code>code</code></pre></li></ul>');
      caretInside(editor, (n) => n.type.name === 'codeBlock');
      expect(outdentBlockFromListItem(editor.state, editor.view.dispatch)).toBe(true);
      const top: string[] = [];
      editor.state.doc.forEach((n) => top.push(n.type.name));
      expect(top).toEqual(['bulletList', 'codeBlock']);
    });

    it('returns false when cursor is in the LABEL paragraph (first-child slot)', () => {
      editor = makeEditor('<ul><li><p>Label</p><h2>Below</h2></li></ul>');
      caretInside(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'Label');
      expect(outdentBlockFromListItem(editor.state, editor.view.dispatch)).toBe(false);
    });

    it('returns false when the nested block is NOT the last child (middle position, MVP)', () => {
      editor = makeEditor('<ul><li><p>L</p><h2>Mid</h2><p>End</p></li></ul>');
      caretInside(editor, (n) => n.type.name === 'heading' && n.textContent === 'Mid');
      expect(outdentBlockFromListItem(editor.state, editor.view.dispatch)).toBe(false);
    });

    it('returns false when the list item is NOT the last in its wrapper (MVP)', () => {
      editor = makeEditor('<ul><li><p>L1</p><h2>H</h2></li><li><p>L2</p></li></ul>');
      caretInside(editor, (n) => n.type.name === 'heading');
      expect(outdentBlockFromListItem(editor.state, editor.view.dispatch)).toBe(false);
    });

    it('returns false when the cursor is OUTSIDE any list item', () => {
      editor = makeEditor('<p>Top-level</p>');
      caretInside(editor, (n) => n.type.name === 'paragraph');
      expect(outdentBlockFromListItem(editor.state, editor.view.dispatch)).toBe(false);
    });

    it('returns false on a non-empty selection range', () => {
      editor = makeEditor('<ul><li><p>L</p><h2>Inside</h2></li></ul>');
      const hPos = (() => {
        let p = -1;
        editor!.state.doc.descendants((n, pos) => {
          if (p !== -1) return false;
          if (n.type.name === 'heading') { p = pos; return false; }
          return true;
        });
        return p;
      })();
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, hPos + 1, hPos + 4)),
      );
      expect(outdentBlockFromListItem(editor.state, editor.view.dispatch)).toBe(false);
    });

    it('does not dispatch when called WITHOUT a dispatch fn (dry-run truthy without mutation)', () => {
      editor = makeEditor('<ul><li><p>L</p><h2>X</h2></li></ul>');
      caretInside(editor, (n) => n.type.name === 'heading');
      const before = dump(editor);
      const ok = outdentBlockFromListItem(editor.state);
      expect(ok).toBe(true);
      expect(dump(editor)).toBe(before);
    });
  });

  describe('round-trip Tab + Shift-Tab', () => {
    it('indent then outdent restores the doc to its original shape', () => {
      const html = '<ul><li><p>L</p></li></ul><h2>Title</h2>';
      editor = makeEditor(html);
      const original = dump(editor);

      // Tab: indent heading into last bullet item.
      caretInside(editor, (n) => n.type.name === 'heading');
      expect(indentBlockAsListChild(editor.state, editor.view.dispatch)).toBe(true);
      expect(dump(editor)).not.toBe(original);

      // Shift-Tab: outdent back.
      caretInside(editor, (n) => n.type.name === 'heading');
      expect(outdentBlockFromListItem(editor.state, editor.view.dispatch)).toBe(true);

      // Doc structure matches the original.
      expect(dump(editor)).toBe(original);
    });
  });

  describe('schema interactions', () => {
    it('indent into a strict-schema listItem still satisfies `paragraph block*` (existing label kept, heading appended)', () => {
      editor = makeEditor('<ul><li><p>Label</p></li></ul><h2>H</h2>');
      caretInside(editor, (n) => n.type.name === 'heading');
      expect(indentBlockAsListChild(editor.state, editor.view.dispatch)).toBe(true);

      // The last (and only) listItem now has [Label-p, h2]. First child
      // is still a paragraph -> Notion-strict invariant intact.
      const li = editor.state.doc.firstChild?.firstChild;
      expect(li?.type.name).toBe('listItem');
      expect(li?.firstChild?.type.name).toBe('paragraph');
      expect(li?.lastChild?.type.name).toBe('heading');
    });
  });
});
