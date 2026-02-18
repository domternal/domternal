import { describe, it, expect, afterEach } from 'vitest';
import {
  SelectionDecoration,
  selectionDecorationPluginKey,
} from './SelectionDecoration.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';
import { DecorationSet } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';

const baseExtensions = [Document, Text, Paragraph];

function getDecorations(editor: Editor): DecorationSet {
  const plugin = editor.state.plugins.find(
    (p) => p.spec.key === selectionDecorationPluginKey
  );
  return plugin?.getState(editor.state) ?? DecorationSet.empty;
}

function simulateBlur(editor: Editor): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(selectionDecorationPluginKey, 'blur')
  );
}

function simulateFocus(editor: Editor): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(selectionDecorationPluginKey, 'focus')
  );
}

describe('SelectionDecoration', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
  });

  describe('configuration', () => {
    it('has correct name', () => {
      expect(SelectionDecoration.name).toBe('selectionDecoration');
    });

    it('is an extension type', () => {
      expect(SelectionDecoration.type).toBe('extension');
    });

    it('has default options', () => {
      const opts = SelectionDecoration.config.addOptions?.call(
        SelectionDecoration
      );
      expect(opts).toEqual({ className: 'dm-blur-selection' });
    });

    it('can configure className', () => {
      const custom = SelectionDecoration.configure({
        className: 'my-selection',
      });
      expect(custom.options.className).toBe('my-selection');
    });
  });

  describe('plugin key', () => {
    it('is defined', () => {
      expect(selectionDecorationPluginKey).toBeDefined();
    });
  });

  describe('blur behavior', () => {
    it('creates decorations on blur when text is selected', () => {
      editor = new Editor({
        extensions: [...baseExtensions, SelectionDecoration],
        content: '<p>hello world</p>',
      });

      // Select "hello"
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1, 6)
        )
      );

      simulateBlur(editor);

      const decos = getDecorations(editor);
      const found = decos.find();
      expect(found).toHaveLength(1);
      expect(found[0]!.from).toBe(1);
      expect(found[0]!.to).toBe(6);
    });

    it('does not create decorations on blur when only cursor (no range)', () => {
      editor = new Editor({
        extensions: [...baseExtensions, SelectionDecoration],
        content: '<p>hello world</p>',
      });

      // Just a cursor, no range selection
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 3)
        )
      );

      simulateBlur(editor);

      const decos = getDecorations(editor);
      expect(decos).toBe(DecorationSet.empty);
    });

    it('applies the configured className', () => {
      editor = new Editor({
        extensions: [
          ...baseExtensions,
          SelectionDecoration.configure({ className: 'custom-blur' }),
        ],
        content: '<p>hello world</p>',
      });

      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1, 6)
        )
      );

      simulateBlur(editor);

      const decos = getDecorations(editor);
      const found = decos.find();
      expect(found).toHaveLength(1);
      // Inline decoration spec contains the class
      expect((found[0] as any).type.attrs.class).toBe('custom-blur');
    });

    it('applies default dm-blur-selection class', () => {
      editor = new Editor({
        extensions: [...baseExtensions, SelectionDecoration],
        content: '<p>hello world</p>',
      });

      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1, 6)
        )
      );

      simulateBlur(editor);

      const decos = getDecorations(editor);
      const found = decos.find();
      expect((found[0] as any).type.attrs.class).toBe('dm-blur-selection');
    });
  });

  describe('focus behavior', () => {
    it('clears decorations on focus', () => {
      editor = new Editor({
        extensions: [...baseExtensions, SelectionDecoration],
        content: '<p>hello world</p>',
      });

      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1, 6)
        )
      );

      simulateBlur(editor);
      expect(getDecorations(editor).find()).toHaveLength(1);

      simulateFocus(editor);
      expect(getDecorations(editor)).toBe(DecorationSet.empty);
    });

    it('focus on cursor-only state results in empty decorations', () => {
      editor = new Editor({
        extensions: [...baseExtensions, SelectionDecoration],
        content: '<p>hello</p>',
      });

      simulateBlur(editor);
      simulateFocus(editor);

      expect(getDecorations(editor)).toBe(DecorationSet.empty);
    });
  });

  describe('document changes while blurred', () => {
    it('maps decorations when document changes', () => {
      editor = new Editor({
        extensions: [...baseExtensions, SelectionDecoration],
        content: '<p>abc hello world</p>',
      });

      // Select "hello" (positions 5-10)
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 5, 10)
        )
      );

      simulateBlur(editor);

      const decosBefore = getDecorations(editor).find();
      expect(decosBefore).toHaveLength(1);
      expect(decosBefore[0]!.from).toBe(5);
      expect(decosBefore[0]!.to).toBe(10);

      // Insert text at the beginning (before decorations), shifting them
      const tr = editor.state.tr.insertText('XX', 1, 1);
      editor.view.dispatch(tr);

      const decosAfter = getDecorations(editor).find();
      expect(decosAfter).toHaveLength(1);
      // Decorations should be shifted by 2
      expect(decosAfter[0]!.from).toBe(7);
      expect(decosAfter[0]!.to).toBe(12);
    });
  });

  describe('regular transactions (no focus meta)', () => {
    it('starts with empty decorations', () => {
      editor = new Editor({
        extensions: [...baseExtensions, SelectionDecoration],
        content: '<p>hello</p>',
      });

      expect(getDecorations(editor)).toBe(DecorationSet.empty);
    });

    it('preserves empty decorations on selection change without blur', () => {
      editor = new Editor({
        extensions: [...baseExtensions, SelectionDecoration],
        content: '<p>hello world</p>',
      });

      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1, 6)
        )
      );

      // No blur — should remain empty
      expect(getDecorations(editor)).toBe(DecorationSet.empty);
    });
  });

  describe('multi-paragraph selection', () => {
    it('decorates across paragraph boundaries', () => {
      editor = new Editor({
        extensions: [...baseExtensions, SelectionDecoration],
        content: '<p>first</p><p>second</p>',
      });

      // Select from "first" into "second"
      const docSize = editor.state.doc.content.size;
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 2, docSize - 1)
        )
      );

      simulateBlur(editor);

      const decos = getDecorations(editor);
      const found = decos.find();
      // Inline decoration spans across — ProseMirror may split it at block boundary
      expect(found.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('blur/focus cycles', () => {
    it('re-creates decorations on second blur', () => {
      editor = new Editor({
        extensions: [...baseExtensions, SelectionDecoration],
        content: '<p>hello world</p>',
      });

      // Select "hello"
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1, 6)
        )
      );

      // First cycle
      simulateBlur(editor);
      expect(getDecorations(editor).find()).toHaveLength(1);
      simulateFocus(editor);
      expect(getDecorations(editor)).toBe(DecorationSet.empty);

      // Second cycle — decorations should appear again
      simulateBlur(editor);
      const found = getDecorations(editor).find();
      expect(found).toHaveLength(1);
      expect(found[0]!.from).toBe(1);
      expect(found[0]!.to).toBe(6);
    });

    it('handles rapid blur/focus/blur sequence', () => {
      editor = new Editor({
        extensions: [...baseExtensions, SelectionDecoration],
        content: '<p>hello world</p>',
      });

      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1, 6)
        )
      );

      simulateBlur(editor);
      simulateFocus(editor);
      simulateBlur(editor);

      expect(getDecorations(editor).find()).toHaveLength(1);
    });

    it('updates decorations when selection changes between blur cycles', () => {
      editor = new Editor({
        extensions: [...baseExtensions, SelectionDecoration],
        content: '<p>hello world</p>',
      });

      // Select "hello" (1-6), blur
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1, 6)
        )
      );
      simulateBlur(editor);
      expect(getDecorations(editor).find()[0]!.to).toBe(6);

      // Focus, change selection to "world" (7-12), blur again
      simulateFocus(editor);
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 7, 12)
        )
      );
      simulateBlur(editor);

      const found = getDecorations(editor).find();
      expect(found).toHaveLength(1);
      expect(found[0]!.from).toBe(7);
      expect(found[0]!.to).toBe(12);
    });
  });

  describe('document changes while blurred', () => {
    it('preserves decorations on non-doc-changing transactions', () => {
      editor = new Editor({
        extensions: [...baseExtensions, SelectionDecoration],
        content: '<p>hello world</p>',
      });

      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1, 6)
        )
      );

      simulateBlur(editor);
      expect(getDecorations(editor).find()).toHaveLength(1);

      // Dispatch a transaction that doesn't change the doc
      editor.view.dispatch(editor.state.tr);

      // Decorations should still be there
      expect(getDecorations(editor).find()).toHaveLength(1);
    });

    it('removes decorations when selected text is deleted while blurred', () => {
      editor = new Editor({
        extensions: [...baseExtensions, SelectionDecoration],
        content: '<p>hello world</p>',
      });

      // Select "hello" (1-6)
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1, 6)
        )
      );

      simulateBlur(editor);
      expect(getDecorations(editor).find()).toHaveLength(1);

      // Delete the selected text while blurred
      const tr = editor.state.tr.delete(1, 6);
      editor.view.dispatch(tr);

      // Decoration range collapsed — should be empty or zero-width
      const found = getDecorations(editor).find();
      // Mapped inline decoration with collapsed range gets removed by ProseMirror
      expect(found).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('works with empty document', () => {
      editor = new Editor({
        extensions: [...baseExtensions, SelectionDecoration],
      });

      // Default cursor in empty doc — no range
      simulateBlur(editor);
      expect(getDecorations(editor)).toBe(DecorationSet.empty);
    });

    it('handles select-all on single paragraph', () => {
      editor = new Editor({
        extensions: [...baseExtensions, SelectionDecoration],
        content: '<p>test</p>',
      });

      // Select all text in the paragraph (1-5)
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1, 5)
        )
      );

      simulateBlur(editor);
      const found = getDecorations(editor).find();
      expect(found).toHaveLength(1);
      expect(found[0]!.from).toBe(1);
      expect(found[0]!.to).toBe(5);
    });

    it('ignores unrelated meta keys', () => {
      editor = new Editor({
        extensions: [...baseExtensions, SelectionDecoration],
        content: '<p>hello</p>',
      });

      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1, 6)
        )
      );

      // Dispatch with unrelated meta — should not create decorations
      editor.view.dispatch(editor.state.tr.setMeta('someOtherPlugin', true));
      expect(getDecorations(editor)).toBe(DecorationSet.empty);
    });

    it('registers plugin in editor state', () => {
      editor = new Editor({
        extensions: [...baseExtensions, SelectionDecoration],
        content: '<p>hello</p>',
      });

      const plugin = editor.state.plugins.find(
        (p) => p.spec.key === selectionDecorationPluginKey
      );
      expect(plugin).toBeDefined();
    });
  });
});
