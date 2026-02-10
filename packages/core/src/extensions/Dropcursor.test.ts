import { describe, it, expect } from 'vitest';
import { Dropcursor } from './Dropcursor.js';

describe('Dropcursor', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(Dropcursor.name).toBe('dropcursor');
    });

    it('is an extension type', () => {
      expect(Dropcursor.type).toBe('extension');
    });

    it('has default options', () => {
      const opts = Dropcursor.config.addOptions?.call(Dropcursor);
      expect(opts).toEqual({ color: 'currentColor', width: 1 });
    });

    it('can configure color', () => {
      const custom = Dropcursor.configure({ color: 'red' });
      expect(custom.options.color).toBe('red');
    });

    it('can configure width', () => {
      const custom = Dropcursor.configure({ width: 2 });
      expect(custom.options.width).toBe(2);
    });

    it('can configure class', () => {
      const custom = Dropcursor.configure({ class: 'my-cursor' });
      expect(custom.options.class).toBe('my-cursor');
    });
  });

  describe('addProseMirrorPlugins', () => {
    it('returns dropcursor plugin', () => {
      const plugins = Dropcursor.config.addProseMirrorPlugins?.call(Dropcursor);
      expect(plugins).toHaveLength(1);
    });
  });
});
