import { describe, it, expect, afterEach } from 'vitest';
import { TrailingNode } from './TrailingNode.js';
import { StarterKit } from './StarterKit.js';
import { Editor } from '../Editor.js';
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

const baseNodes = [
  Document, Text, Paragraph, Heading, Blockquote, CodeBlock, HorizontalRule,
  BulletList, OrderedList, ListItem, TaskList, TaskItem,
];

describe('TrailingNode', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(TrailingNode.name).toBe('trailingNode');
    });

    it('is an extension type', () => {
      expect(TrailingNode.type).toBe('extension');
    });

    it('has default options', () => {
      const opts = TrailingNode.config.addOptions?.call(TrailingNode);
      expect(opts).toEqual({ node: 'paragraph', notAfter: ['paragraph'], notAfterGroups: ['list'] });
    });

    it('can configure node type', () => {
      const custom = TrailingNode.configure({ node: 'heading' });
      expect(custom.options.node).toBe('heading');
    });

    it('can configure notAfter', () => {
      const custom = TrailingNode.configure({
        notAfter: ['paragraph', 'heading'],
      });
      expect(custom.options.notAfter).toEqual(['paragraph', 'heading']);
    });

    it('can configure notAfterGroups', () => {
      const custom = TrailingNode.configure({ notAfterGroups: [] });
      expect(custom.options.notAfterGroups).toEqual([]);
    });
  });

  describe('addProseMirrorPlugins', () => {
    it('returns trailing node plugin', () => {
      const plugins = TrailingNode.config.addProseMirrorPlugins?.call(
        TrailingNode
      );
      expect(plugins).toHaveLength(1);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // Behaviour: which trailing block types get a trailing paragraph.
  // The trailing node materialises via appendTransaction, so it only
  // appears after the first dispatched transaction (not at pure init).
  // We nudge it with a no-op insertText('') at pos 1.
  // ────────────────────────────────────────────────────────────────────
  describe('trailing paragraph insertion', () => {
    let editor: Editor | undefined;
    afterEach(() => { if (editor && !editor.isDestroyed) editor.destroy(); });

    const make = (content: string, opts?: Partial<{ notAfterGroups: string[] }>): Editor => {
      const ext = opts ? TrailingNode.configure(opts) : TrailingNode;
      const e = new Editor({ extensions: [...baseNodes, ext], content });
      e.view.dispatch(e.state.tr.insertText('', 1)); // trigger appendTransaction
      return e;
    };

    it('does NOT add a trailing paragraph after a bulletList (default)', () => {
      editor = make('<ul><li><p>a</p></li></ul>');
      expect(editor.getHTML()).toBe('<ul><li><p>a</p></li></ul>');
    });

    it('does NOT add a trailing paragraph after an orderedList (default)', () => {
      editor = make('<ol><li><p>a</p></li></ol>');
      expect(editor.getHTML()).toBe('<ol><li><p>a</p></li></ol>');
    });

    it('does NOT add a trailing paragraph after a taskList (default)', () => {
      editor = make('<ul data-type="taskList"><li data-type="taskItem"><p>a</p></li></ul>');
      expect(editor.getHTML()).not.toMatch(/<\/ul><p><\/p>$/);
    });

    it('DOES add a trailing paragraph after a heading', () => {
      editor = make('<h2>Title</h2>');
      expect(editor.getHTML()).toBe('<h2>Title</h2><p></p>');
    });

    it('DOES add a trailing paragraph after a horizontalRule', () => {
      editor = make('<p>x</p><hr>');
      expect(editor.getHTML()).toBe('<p>x</p><hr><p></p>');
    });

    it('does not double-add when the doc already ends in a paragraph', () => {
      editor = make('<h2>Title</h2><p>tail</p>');
      expect(editor.getHTML()).toBe('<h2>Title</h2><p>tail</p>');
    });

    it('legacy opt-out: notAfterGroups:[] restores trailing paragraph after a list', () => {
      editor = make('<ul><li><p>a</p></li></ul>', { notAfterGroups: [] });
      expect(editor.getHTML()).toBe('<ul><li><p>a</p></li></ul><p></p>');
    });

    it('empty-token guard: an empty notAfterGroups entry does not match groupless nodes', () => {
      // ''.split(/\s+/) yields [''] before filtering; the filter(Boolean) guard
      // prevents a stray '' entry from silently suppressing the trailing node.
      editor = make('<h2>Title</h2>', { notAfterGroups: [''] });
      expect(editor.getHTML()).toBe('<h2>Title</h2><p></p>');
    });
  });

  // The reported scenario (#90) is a StarterKit-based setup. Verify the
  // default StarterKit bundle no longer leaves a trailing <p> after a list.
  describe('via StarterKit (reported user path)', () => {
    let editor: Editor | undefined;
    afterEach(() => { if (editor && !editor.isDestroyed) editor.destroy(); });

    it('no trailing <p> after a list, but a trailing <p> remains after a heading', () => {
      editor = new Editor({ extensions: [StarterKit], content: '<ul><li><p>a</p></li></ul>' });
      editor.view.dispatch(editor.state.tr.insertText('', 1));
      expect(editor.getHTML()).toBe('<ul><li><p>a</p></li></ul>');

      editor.destroy();
      editor = new Editor({ extensions: [StarterKit], content: '<h2>Heading</h2>' });
      editor.view.dispatch(editor.state.tr.insertText('', 1));
      expect(editor.getHTML()).toBe('<h2>Heading</h2><p></p>');
    });
  });
});
