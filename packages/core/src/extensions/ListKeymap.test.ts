import { describe, it, expect } from 'vitest';
import { ListKeymap } from './ListKeymap.js';

describe('ListKeymap', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(ListKeymap.name).toBe('listKeymap');
    });

    it('is an extension type', () => {
      expect(ListKeymap.type).toBe('extension');
    });

    it('has default options', () => {
      const opts = ListKeymap.config.addOptions?.call(ListKeymap);
      expect(opts).toEqual({ listItem: 'listItem' });
    });

    it('can configure listItem type name', () => {
      const custom = ListKeymap.configure({ listItem: 'customListItem' });
      expect(custom.options.listItem).toBe('customListItem');
    });
  });

  describe('addKeyboardShortcuts', () => {
    it('provides Tab, Shift-Tab, and Backspace shortcuts', () => {
      const shortcuts = ListKeymap.config.addKeyboardShortcuts?.call(ListKeymap);
      expect(shortcuts).toHaveProperty('Tab');
      expect(shortcuts).toHaveProperty('Shift-Tab');
      expect(shortcuts).toHaveProperty('Backspace');
    });
  });
});
