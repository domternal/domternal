import { describe, it, expect, afterEach } from 'vitest';
import {
  SelectionDecoration,
  selectionDecorationPluginKey,
} from './SelectionDecoration.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';
import { TextSelection } from 'prosemirror-state';

const baseExtensions = [Document, Text, Paragraph];

/**
 * Simulate a blur DOM event by dispatching directly through the plugin's
 * handleDOMEvents.blur handler. This mirrors what ProseMirror does when the
 * contenteditable element fires a real blur event.
 */
function simulateBlur(editor: Editor): void {
  const plugin = editor.state.plugins.find(
    (p) => p.spec.key === selectionDecorationPluginKey
  );
  const handler = plugin?.spec.props?.handleDOMEvents?.blur;
  if (handler) {
    (handler as (view: typeof editor.view, event: Event) => boolean)(
      editor.view,
      new FocusEvent('blur')
    );
  }
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

  });

  describe('plugin key', () => {
    it('is defined', () => {
      expect(selectionDecorationPluginKey).toBeDefined();
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

  describe('blur with range selection', () => {
    it('collapses range selection to cursor at from position', () => {
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
      expect(editor.state.selection.from).toBe(1);
      expect(editor.state.selection.to).toBe(6);

      simulateBlur(editor);

      // Selection should be collapsed to cursor at position 1
      expect(editor.state.selection.from).toBe(1);
      expect(editor.state.selection.to).toBe(1);
      expect(editor.state.selection.empty).toBe(true);
    });

    it('collapses multi-paragraph selection', () => {
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

      const fromBefore = editor.state.selection.from;
      simulateBlur(editor);

      expect(editor.state.selection.from).toBe(fromBefore);
      expect(editor.state.selection.to).toBe(fromBefore);
      expect(editor.state.selection.empty).toBe(true);
    });

    it('collapses select-all to cursor at start', () => {
      editor = new Editor({
        extensions: [...baseExtensions, SelectionDecoration],
        content: '<p>test</p>',
      });

      // Select all text (1-5)
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1, 5)
        )
      );

      simulateBlur(editor);

      expect(editor.state.selection.from).toBe(1);
      expect(editor.state.selection.to).toBe(1);
    });
  });

  describe('blur with cursor only', () => {
    it('does not change cursor position', () => {
      editor = new Editor({
        extensions: [...baseExtensions, SelectionDecoration],
        content: '<p>hello world</p>',
      });

      // Just a cursor at position 3
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 3)
        )
      );

      simulateBlur(editor);

      // Cursor should stay at position 3
      expect(editor.state.selection.from).toBe(3);
      expect(editor.state.selection.to).toBe(3);
    });

    it('handles empty document', () => {
      editor = new Editor({
        extensions: [...baseExtensions, SelectionDecoration],
      });

      // Default cursor in empty doc
      const posBefore = editor.state.selection.from;
      simulateBlur(editor);

      expect(editor.state.selection.from).toBe(posBefore);
      expect(editor.state.selection.to).toBe(posBefore);
    });
  });

  describe('does not affect focused state', () => {
    it('selection without blur remains unchanged', () => {
      editor = new Editor({
        extensions: [...baseExtensions, SelectionDecoration],
        content: '<p>hello world</p>',
      });

      // Select "hello" but don't blur
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1, 6)
        )
      );

      // Selection should remain a range
      expect(editor.state.selection.from).toBe(1);
      expect(editor.state.selection.to).toBe(6);
      expect(editor.state.selection.empty).toBe(false);
    });
  });
});
