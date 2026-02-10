import { describe, it, expect } from 'vitest';
import { TextAlign } from './TextAlign.js';

describe('TextAlign', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(TextAlign.name).toBe('textAlign');
    });

    it('is an extension type', () => {
      expect(TextAlign.type).toBe('extension');
    });

    it('has default options', () => {
      const opts = TextAlign.config.addOptions?.call(TextAlign);
      expect(opts).toEqual({
        types: ['heading', 'paragraph'],
        alignments: ['left', 'center', 'right', 'justify'],
        defaultAlignment: 'left',
      });
    });

    it('can configure types', () => {
      const custom = TextAlign.configure({ types: ['paragraph'] });
      expect(custom.options.types).toEqual(['paragraph']);
    });

    it('can configure alignments', () => {
      const custom = TextAlign.configure({ alignments: ['left', 'center'] });
      expect(custom.options.alignments).toEqual(['left', 'center']);
    });

    it('can configure defaultAlignment', () => {
      const custom = TextAlign.configure({ defaultAlignment: 'center' });
      expect(custom.options.defaultAlignment).toBe('center');
    });
  });

  describe('addGlobalAttributes', () => {
    it('returns global attributes for configured types', () => {
      const attrs = TextAlign.config.addGlobalAttributes?.call(TextAlign);
      expect(attrs).toHaveLength(1);
      expect(attrs?.[0]).toHaveProperty('types', ['heading', 'paragraph']);
      expect(attrs?.[0]).toHaveProperty('attributes');
      expect(attrs?.[0]?.attributes).toHaveProperty('textAlign');
    });

    it('textAlign attribute has correct default', () => {
      const attrs = TextAlign.config.addGlobalAttributes?.call(TextAlign);
      expect(attrs?.[0]?.attributes?.textAlign?.default).toBe('left');
    });

    it('renderHTML returns null for default alignment', () => {
      const attrs = TextAlign.config.addGlobalAttributes?.call(TextAlign);
      const renderHTML = attrs?.[0]?.attributes?.textAlign?.renderHTML;
      expect(renderHTML?.({ textAlign: 'left' })).toBeNull();
    });

    it('renderHTML returns style for non-default alignment', () => {
      const attrs = TextAlign.config.addGlobalAttributes?.call(TextAlign);
      const renderHTML = attrs?.[0]?.attributes?.textAlign?.renderHTML;
      expect(renderHTML?.({ textAlign: 'center' })).toEqual({
        style: 'text-align: center',
      });
    });
  });

  describe('addCommands', () => {
    it('provides setTextAlign and unsetTextAlign commands', () => {
      const commands = TextAlign.config.addCommands?.call(TextAlign);
      expect(commands).toHaveProperty('setTextAlign');
      expect(commands).toHaveProperty('unsetTextAlign');
    });
  });

  describe('addKeyboardShortcuts', () => {
    it('provides alignment shortcuts', () => {
      const shortcuts = TextAlign.config.addKeyboardShortcuts?.call(TextAlign);
      expect(shortcuts).toHaveProperty('Mod-Shift-l');
      expect(shortcuts).toHaveProperty('Mod-Shift-e');
      expect(shortcuts).toHaveProperty('Mod-Shift-r');
      expect(shortcuts).toHaveProperty('Mod-Shift-j');
    });
  });
});
