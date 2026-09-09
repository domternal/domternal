import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  SelectionDecoration,
  selectionDecorationPluginKey,
} from './SelectionDecoration.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { HorizontalRule } from '../nodes/HorizontalRule.js';
import { Editor } from '../Editor.js';
import { AllSelection, NodeSelection, TextSelection } from '@domternal/pm/state';

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

/** Blur with a relatedTarget (the element receiving focus). */
function blurWithRelated(editor: Editor, related: HTMLElement): void {
  const plugin = editor.state.plugins.find(
    (p) => p.spec.key === selectionDecorationPluginKey
  );
  const handler = plugin?.spec.props?.handleDOMEvents?.blur;
  if (handler) {
    const event = new FocusEvent('blur');
    Object.defineProperty(event, 'relatedTarget', { value: related, configurable: true });
    (handler as (view: typeof editor.view, event: Event) => boolean)(editor.view, event);
  }
}

/** Editor mounted inside a `.dm-editor` container (the framework wrapper). */
function mountInContainer(content: string): { editor: Editor; container: HTMLElement } {
  const container = document.createElement('div');
  container.className = 'dm-editor';
  container.setAttribute('data-dm-editor-ui', '');
  const host = document.createElement('div');
  container.appendChild(host);
  document.body.appendChild(container);
  const editor = new Editor({
    element: host,
    extensions: [...baseExtensions, SelectionDecoration],
    content,
  });
  return { editor, container };
}

describe('SelectionDecoration', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
    vi.restoreAllMocks();
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

    it('collapses the public select-all command to a valid cursor at the start', () => {
      editor = new Editor({
        extensions: [...baseExtensions, SelectionDecoration],
        content: '<p>test</p>',
      });
      const original = editor.state.doc.toJSON();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      expect(editor.commands.selectAll()).toBe(true);
      expect(editor.state.selection).toBeInstanceOf(AllSelection);
      expect(editor.state.selection.from).toBe(0);

      simulateBlur(editor);

      expect(editor.state.selection).toBeInstanceOf(TextSelection);
      expect(editor.state.selection.from).toBe(1);
      expect(editor.state.selection.empty).toBe(true);
      expect(editor.state.selection.$from.parent.inlineContent).toBe(true);
      expect(editor.state.doc.toJSON()).toEqual(original);
      expect(warn).not.toHaveBeenCalled();
    });

    it('skips a leading block atom when collapsing select-all to a text cursor', () => {
      editor = new Editor({
        extensions: [...baseExtensions, HorizontalRule, SelectionDecoration],
        content: '<hr><p>after</p>',
      });
      const original = editor.state.doc.toJSON();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      editor.commands.selectAll();
      expect(editor.state.selection).toBeInstanceOf(AllSelection);
      simulateBlur(editor);

      expect(editor.state.selection).toBeInstanceOf(TextSelection);
      expect(editor.state.selection.from).toBe(2);
      expect(editor.state.selection.empty).toBe(true);
      expect(editor.state.selection.$from.parent.inlineContent).toBe(true);
      expect(editor.state.doc.toJSON()).toEqual(original);
      expect(warn).not.toHaveBeenCalled();
    });

    it.each([
      { direction: 'forward', content: '<hr><p>after</p>', nodePosition: 0, cursorPosition: 2 },
      { direction: 'backward', content: '<p>before</p><hr>', nodePosition: 8, cursorPosition: 7 },
    ])('finds a text cursor $direction from a selected block atom', ({
      content, nodePosition, cursorPosition,
    }) => {
      editor = new Editor({
        extensions: [...baseExtensions, HorizontalRule, SelectionDecoration],
        content,
      });
      const original = editor.state.doc.toJSON();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, nodePosition))
      );
      expect(editor.state.selection).toBeInstanceOf(NodeSelection);

      simulateBlur(editor);

      expect(editor.state.selection).toBeInstanceOf(TextSelection);
      expect(editor.state.selection.from).toBe(cursorPosition);
      expect(editor.state.selection.empty).toBe(true);
      expect(editor.state.selection.$from.parent.inlineContent).toBe(true);
      expect(editor.state.doc.toJSON()).toEqual(original);
      expect(warn).not.toHaveBeenCalled();
    });

    it.each(['all', 'node'] as const)(
      'keeps a valid fallback in an atom-only document after %s selection',
      (selectionType) => {
        editor = new Editor({
          extensions: [...baseExtensions, HorizontalRule, SelectionDecoration],
          content: '<hr>',
        });
        const original = editor.state.doc.toJSON();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        if (selectionType === 'all') {
          editor.commands.selectAll();
          expect(editor.state.selection).toBeInstanceOf(AllSelection);
        } else {
          editor.view.dispatch(
            editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0))
          );
        }

        simulateBlur(editor);

        expect(editor.state.selection).toBeInstanceOf(NodeSelection);
        expect(editor.state.selection.from).toBe(0);
        expect(editor.state.selection.to).toBe(1);
        expect((editor.state.selection as NodeSelection).node.type.name).toBe('horizontalRule');
        expect(editor.state.doc.toJSON()).toEqual(original);
        expect(warn).not.toHaveBeenCalled();
      }
    );
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

  describe('multi-editor: scope the editor-UI check to THIS editor', () => {
    it('collapses when focus moves to ANOTHER editor on the page', () => {
      const a = mountInContainer('<p>hello world</p>');
      const b = mountInContainer('<p>other editor</p>');
      try {
        a.editor.view.dispatch(
          a.editor.state.tr.setSelection(TextSelection.create(a.editor.state.doc, 1, 6))
        );
        expect(a.editor.state.selection.empty).toBe(false);

        // Focus leaves editor A for editor B's editable. Both containers carry
        // [data-dm-editor-ui]; the OLD handler wrongly treated B as A's own UI
        // and skipped collapsing. It must collapse now.
        blurWithRelated(a.editor, b.editor.view.dom);

        expect(a.editor.state.selection.empty).toBe(true);
        expect(a.editor.state.selection.from).toBe(1);
      } finally {
        a.editor.destroy(); b.editor.destroy();
        a.container.remove(); b.container.remove();
      }
    });

    it("keeps the selection when focus moves to THIS editor's own UI", () => {
      const a = mountInContainer('<p>hello world</p>');
      // A bubble-menu button inside this editor's own container.
      const bubble = document.createElement('div');
      bubble.className = 'dm-bubble-menu';
      const btn = document.createElement('button');
      bubble.appendChild(btn);
      a.container.appendChild(bubble);
      try {
        a.editor.view.dispatch(
          a.editor.state.tr.setSelection(TextSelection.create(a.editor.state.doc, 1, 6))
        );
        blurWithRelated(a.editor, btn);

        // Interacting with our own UI must not collapse the selection.
        expect(a.editor.state.selection.empty).toBe(false);
        expect(a.editor.state.selection.from).toBe(1);
        expect(a.editor.state.selection.to).toBe(6);
      } finally {
        a.editor.destroy(); a.container.remove();
      }
    });
  });

  it("preserves public select-all when focus moves to this editor's own UI", () => {
    const mounted = mountInContainer('<p>hello world</p>');
    const button = document.createElement('button');
    button.setAttribute('data-dm-editor-ui', '');
    mounted.container.appendChild(button);
    try {
      mounted.editor.commands.selectAll();
      const original = mounted.editor.state.selection;
      expect(original).toBeInstanceOf(AllSelection);

      blurWithRelated(mounted.editor, button);

      expect(mounted.editor.state.selection).toBe(original);
    } finally {
      mounted.editor.destroy();
      mounted.container.remove();
    }
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
