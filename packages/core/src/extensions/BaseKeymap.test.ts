import { describe, it, expect } from 'vitest';
import { BaseKeymap } from './BaseKeymap.js';

describe('BaseKeymap', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(BaseKeymap.name).toBe('baseKeymap');
    });

    it('is an extension type', () => {
      expect(BaseKeymap.type).toBe('extension');
    });

    it('has default options', () => {
      const opts = BaseKeymap.config.addOptions?.call(BaseKeymap);
      expect(opts).toEqual({ enter: true });
    });

    it('can disable enter', () => {
      const custom = BaseKeymap.configure({ enter: false });
      expect(custom.options.enter).toBe(false);
    });
  });

  describe('addProseMirrorPlugins', () => {
    it('returns keymap plugin', () => {
      const plugins = BaseKeymap.config.addProseMirrorPlugins?.call(BaseKeymap);
      expect(plugins).toHaveLength(1);
    });
  });
});
