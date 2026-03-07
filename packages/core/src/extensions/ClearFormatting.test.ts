import { describe, it, expect } from 'vitest';
import { ClearFormatting } from './ClearFormatting.js';

describe('ClearFormatting', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(ClearFormatting.name).toBe('clearFormatting');
    });

    it('is an extension type', () => {
      expect(ClearFormatting.type).toBe('extension');
    });
  });

  describe('addToolbarItems', () => {
    it('returns a single button item', () => {
      const items = ClearFormatting.config.addToolbarItems?.call(ClearFormatting);
      expect(items).toHaveLength(1);

      const button = items?.[0];
      expect(button?.type).toBe('button');
      if (button?.type === 'button') {
        expect(button.name).toBe('clearFormatting');
        expect(button.command).toBe('unsetAllMarks');
        expect(button.icon).toBe('textTSlash');
        expect(button.label).toBe('Clear Formatting');
        expect(button.group).toBe('utilities');
        expect(button.priority).toBe(200);
      }
    });
  });
});
