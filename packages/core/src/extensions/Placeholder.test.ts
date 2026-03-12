import { describe, it, expect, afterEach } from 'vitest';
import { Placeholder, placeholderPluginKey } from './Placeholder.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Heading } from '../nodes/Heading.js';
import { Editor } from '../Editor.js';
import { DecorationSet } from '@domternal/pm/view';
import { TextSelection } from '@domternal/pm/state';

const baseExtensions = [Document, Text, Paragraph, Heading];

function getPlaceholderDecorations(editor: Editor): DecorationSet {
  const plugin = editor.state.plugins.find(
    (p) => p.spec.key === placeholderPluginKey
  );
   
  const decosFn = plugin?.props.decorations as any;
  return decosFn?.call(plugin, editor.state) ?? DecorationSet.empty;
}

describe('Placeholder', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
  });

  describe('configuration', () => {
    it('has correct name', () => {
      expect(Placeholder.name).toBe('placeholder');
    });

    it('is an extension type', () => {
      expect(Placeholder.type).toBe('extension');
    });

    it('has default options', () => {
      const opts = Placeholder.config.addOptions?.call(Placeholder);
      expect(opts).toEqual({
        placeholder: 'Write something …',
        showOnlyWhenEditable: true,
        emptyNodeClass: 'is-empty',
        emptyEditorClass: 'is-editor-empty',
        showOnlyCurrent: true,
        includeChildren: false,
      });
    });

    it('can configure placeholder text', () => {
      const custom = Placeholder.configure({ placeholder: 'Type here...' });
      expect(custom.options.placeholder).toBe('Type here...');
    });

    it('can configure placeholder function', () => {
      const fn = (): string => 'dynamic';
      const custom = Placeholder.configure({ placeholder: fn });
      expect(custom.options.placeholder).toBe(fn);
    });

    it('can disable showOnlyWhenEditable', () => {
      const custom = Placeholder.configure({ showOnlyWhenEditable: false });
      expect(custom.options.showOnlyWhenEditable).toBe(false);
    });

    it('can configure emptyNodeClass', () => {
      const custom = Placeholder.configure({ emptyNodeClass: 'empty' });
      expect(custom.options.emptyNodeClass).toBe('empty');
    });

    it('can configure showOnlyCurrent', () => {
      const custom = Placeholder.configure({ showOnlyCurrent: false });
      expect(custom.options.showOnlyCurrent).toBe(false);
    });
  });

  describe('placeholderPluginKey', () => {
    it('is defined', () => {
      expect(placeholderPluginKey).toBeDefined();
    });
  });

  describe('plugin decorations', () => {
    it('shows placeholder on empty editor', () => {
      editor = new Editor({
        extensions: [...baseExtensions, Placeholder],
        content: '',
      });

      const decos = getPlaceholderDecorations(editor);
      const found = decos.find();
      expect(found.length).toBe(1);
    });

    it('shows placeholder with data-placeholder attribute', () => {
      editor = new Editor({
        extensions: [
          ...baseExtensions,
          Placeholder.configure({ placeholder: 'Type here...' }),
        ],
        content: '',
      });

      const decos = getPlaceholderDecorations(editor);
      const found = decos.find();
      expect(found.length).toBe(1);
       
      const spec = (found[0] as any).type?.attrs;
      expect(spec?.['data-placeholder']).toBe('Type here...');
    });

    it('adds emptyNodeClass and emptyEditorClass on empty doc', () => {
      editor = new Editor({
        extensions: [...baseExtensions, Placeholder],
        content: '',
      });

      const decos = getPlaceholderDecorations(editor);
      const found = decos.find();
       
      const spec = (found[0] as any).type?.attrs;
      expect(spec?.class).toContain('is-empty');
      expect(spec?.class).toContain('is-editor-empty');
    });

    it('does not show placeholder when content exists', () => {
      editor = new Editor({
        extensions: [...baseExtensions, Placeholder],
        content: '<p>Hello world</p>',
      });

      const decos = getPlaceholderDecorations(editor);
      const found = decos.find();
      expect(found.length).toBe(0);
    });

    it('uses custom emptyNodeClass', () => {
      editor = new Editor({
        extensions: [
          ...baseExtensions,
          Placeholder.configure({ emptyNodeClass: 'custom-empty' }),
        ],
        content: '',
      });

      const decos = getPlaceholderDecorations(editor);
      const found = decos.find();
       
      const spec = (found[0] as any).type?.attrs;
      expect(spec?.class).toContain('custom-empty');
    });

    it('supports function-based placeholder', () => {
      editor = new Editor({
        extensions: [
          ...baseExtensions,
          Placeholder.configure({
            placeholder: ({ node }) => `Enter ${node.type.name}...`,
          }),
        ],
        content: '',
      });

      const decos = getPlaceholderDecorations(editor);
      const found = decos.find();
      expect(found.length).toBe(1);
       
      const spec = (found[0] as any).type?.attrs;
      expect(spec?.['data-placeholder']).toBe('Enter paragraph...');
    });

    it('showOnlyCurrent=true shows placeholder only in focused node', () => {
      editor = new Editor({
        extensions: [
          ...baseExtensions,
          Placeholder.configure({ showOnlyCurrent: true }),
        ],
        content: '<p>text</p><p></p>',
      });

      // Place cursor in the first (non-empty) paragraph
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, 2)
        )
      );

      const decos = getPlaceholderDecorations(editor);
      const found = decos.find();
      // Second paragraph is empty but cursor is not there, so no placeholder
      expect(found.length).toBe(0);
    });

    it('showOnlyCurrent=true shows placeholder when cursor is in empty node', () => {
      editor = new Editor({
        extensions: [
          ...baseExtensions,
          Placeholder.configure({ showOnlyCurrent: true }),
        ],
        content: '<p>text</p><p></p>',
      });

      // Place cursor in the second (empty) paragraph
      const secondParaPos = editor.state.doc.child(0).nodeSize;
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, secondParaPos + 1)
        )
      );

      const decos = getPlaceholderDecorations(editor);
      const found = decos.find();
      expect(found.length).toBe(1);
    });

    it('showOnlyCurrent=false shows placeholder in all empty nodes', () => {
      editor = new Editor({
        extensions: [
          ...baseExtensions,
          Placeholder.configure({ showOnlyCurrent: false }),
        ],
        content: '<p></p><p></p>',
      });

      const decos = getPlaceholderDecorations(editor);
      const found = decos.find();
      expect(found.length).toBe(2);
    });

    it('does not add emptyEditorClass when doc has content', () => {
      editor = new Editor({
        extensions: [
          ...baseExtensions,
          Placeholder.configure({ showOnlyCurrent: false }),
        ],
        content: '<p>text</p><p></p>',
      });

      const decos = getPlaceholderDecorations(editor);
      const found = decos.find();
      if (found.length > 0) {
         
        const spec = (found[0] as any).type?.attrs;
        expect(spec?.class).not.toContain('is-editor-empty');
      }
    });
  });
});
