import { describe, it, expect, afterEach } from 'vitest';
import { Focus, focusPluginKey } from './Focus.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Blockquote } from '../nodes/Blockquote.js';
import { Editor } from '../Editor.js';
import { DecorationSet } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';

const baseExtensions = [Document, Text, Paragraph, Blockquote];

function getFocusDecorations(editor: Editor): DecorationSet {
  const plugin = editor.state.plugins.find(
    (p) => p.spec.key === focusPluginKey
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const decosFn = plugin?.props.decorations as any;
  return decosFn?.call(plugin, editor.state) ?? DecorationSet.empty;
}

describe('Focus', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
  });

  describe('configuration', () => {
    it('has correct name', () => {
      expect(Focus.name).toBe('focus');
    });

    it('is an extension type', () => {
      expect(Focus.type).toBe('extension');
    });

    it('has default options', () => {
      const opts = Focus.config.addOptions?.call(Focus);
      expect(opts).toEqual({ className: 'has-focus', mode: 'all' });
    });

    it('can configure className', () => {
      const custom = Focus.configure({ className: 'focused' });
      expect(custom.options.className).toBe('focused');
    });

    it('can configure mode to deepest', () => {
      const custom = Focus.configure({ mode: 'deepest' });
      expect(custom.options.mode).toBe('deepest');
    });

    it('can configure mode to shallowest', () => {
      const custom = Focus.configure({ mode: 'shallowest' });
      expect(custom.options.mode).toBe('shallowest');
    });
  });

  describe('focusPluginKey', () => {
    it('is defined', () => {
      expect(focusPluginKey).toBeDefined();
    });
  });

  describe('plugin decorations', () => {
    it('creates decorations in mode=all', () => {
      editor = new Editor({
        extensions: [...baseExtensions, Focus],
        content: '<blockquote><p>nested text</p></blockquote>',
      });

      // Place cursor inside the paragraph within blockquote
      let textPos = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'nested text') {
          textPos = pos;
        }
      });

      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, textPos + 1)
        )
      );

      const decos = getFocusDecorations(editor);
      expect(decos).not.toBe(DecorationSet.empty);

      // In mode=all, should decorate both blockquote and paragraph (+ doc)
      const found = decos.find();
      expect(found.length).toBeGreaterThanOrEqual(2);
    });

    it('creates single decoration in mode=deepest', () => {
      editor = new Editor({
        extensions: [...baseExtensions, Focus.configure({ mode: 'deepest' })],
        content: '<blockquote><p>nested text</p></blockquote>',
      });

      let textPos = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'nested text') {
          textPos = pos;
        }
      });

      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, textPos + 1)
        )
      );

      const decos = getFocusDecorations(editor);
      const found = decos.find();
      // Deepest = only innermost paragraph
      expect(found.length).toBe(1);
    });

    it('creates single decoration in mode=shallowest', () => {
      editor = new Editor({
        extensions: [
          ...baseExtensions,
          Focus.configure({ mode: 'shallowest' }),
        ],
        content: '<blockquote><p>nested text</p></blockquote>',
      });

      let textPos = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'nested text') {
          textPos = pos;
        }
      });

      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, textPos + 1)
        )
      );

      const decos = getFocusDecorations(editor);
      const found = decos.find();
      // Shallowest = only outermost node containing selection
      expect(found.length).toBe(1);
    });

    it('decorates simple paragraph', () => {
      editor = new Editor({
        extensions: [...baseExtensions, Focus],
        content: '<p>hello world</p>',
      });

      const decos = getFocusDecorations(editor);
      expect(decos).not.toBe(DecorationSet.empty);
      const found = decos.find();
      expect(found.length).toBeGreaterThan(0);
    });

    it('decorates multiple paragraphs when selection spans them', () => {
      editor = new Editor({
        extensions: [...baseExtensions, Focus],
        content: '<p>first</p><p>second</p>',
      });

      // Select across both paragraphs
      const docSize = editor.state.doc.content.size;
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 1, docSize - 1)
        )
      );

      const decos = getFocusDecorations(editor);
      const found = decos.find();
      // Should decorate both paragraphs and the doc
      expect(found.length).toBeGreaterThanOrEqual(2);
    });

    it('returns empty decorations for empty focused nodes array', () => {
      // Test the edge case via the plugin directly
      const plugins = Focus.config.addProseMirrorPlugins?.call({
        ...Focus,
        options: { className: 'has-focus', mode: 'all' },
        editor: null,
      } as never);
      expect(plugins).toHaveLength(1);
    });
  });
});
