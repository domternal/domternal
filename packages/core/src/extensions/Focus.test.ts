import { describe, it, expect } from 'vitest';
import { Focus, focusPluginKey } from './Focus.js';

describe('Focus', () => {
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

  describe('addProseMirrorPlugins', () => {
    it('returns focus plugin', () => {
      const plugins = Focus.config.addProseMirrorPlugins?.call({
        ...Focus,
        options: { className: 'has-focus', mode: 'all' },
        editor: null,
      } as never);
      expect(plugins).toHaveLength(1);
    });
  });
});
