import { describe, it, expect } from 'vitest';
import { Placeholder, placeholderPluginKey } from './Placeholder.js';

describe('Placeholder', () => {
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
      const fn = () => 'dynamic';
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

  describe('addProseMirrorPlugins', () => {
    it('returns placeholder plugin', () => {
      const plugins = Placeholder.config.addProseMirrorPlugins?.call({
        ...Placeholder,
        options: {
          placeholder: 'Write something …',
          showOnlyWhenEditable: true,
          emptyNodeClass: 'is-empty',
          emptyEditorClass: 'is-editor-empty',
          showOnlyCurrent: true,
          includeChildren: false,
        },
        editor: null,
      } as never);
      expect(plugins).toHaveLength(1);
    });
  });
});
