import { describe, it, expect } from 'vitest';
import { groupFloatingMenuItems } from './groupFloatingMenuItems.js';
import type { FloatingMenuItem } from '../types/FloatingMenu.js';

function item(partial: Partial<FloatingMenuItem> & { name: string }): FloatingMenuItem {
  return { label: partial.name, command: 'noop', ...partial };
}

const names = (groups: { name: string }[]): string[] => groups.map((group) => group.name);

describe('groupFloatingMenuItems', () => {
  it('keeps groups in the order their first item arrived', () => {
    const groups = groupFloatingMenuItems([
      item({ name: 'a', group: 'Basic' }),
      item({ name: 'b', group: 'Media' }),
      item({ name: 'c', group: 'Basic' }),
    ]);

    expect(names(groups)).toEqual(['Basic', 'Media']);
    expect(groups[0]?.items.map((entry) => entry.name)).toEqual(['a', 'c']);
  });

  it('sorts by priority within a group, highest first, default 100', () => {
    const groups = groupFloatingMenuItems([
      item({ name: 'low', group: 'Basic', priority: 10 }),
      item({ name: 'high', group: 'Basic', priority: 300 }),
      item({ name: 'default', group: 'Basic' }),
    ]);

    expect(groups[0]?.items.map((entry) => entry.name)).toEqual(['high', 'default', 'low']);
  });

  describe('an item with no group', () => {
    it('leads, however late it arrives', () => {
      // Insertion order would file it last, which is the whole problem.
      const groups = groupFloatingMenuItems([
        item({ name: 'heading', group: 'Basic' }),
        item({ name: 'image', group: 'Media' }),
        item({ name: 'ask-ai' }),
      ]);

      expect(names(groups)).toEqual(['', 'Basic', 'Media']);
      expect(groups[0]?.items.map((entry) => entry.name)).toEqual(['ask-ai']);
    });

    it('leads when it arrives first too', () => {
      const groups = groupFloatingMenuItems([
        item({ name: 'ask-ai' }),
        item({ name: 'heading', group: 'Basic' }),
      ]);

      expect(names(groups)).toEqual(['', 'Basic']);
    });

    it('leaves the order of the named groups behind it alone', () => {
      const groups = groupFloatingMenuItems([
        item({ name: 'heading', group: 'Basic' }),
        item({ name: 'ask-ai' }),
        item({ name: 'image', group: 'Media' }),
        item({ name: 'table', group: 'Blocks' }),
      ]);

      expect(names(groups)).toEqual(['', 'Basic', 'Media', 'Blocks']);
    });

    it('shares one leading group with every other ungrouped item, by priority', () => {
      const groups = groupFloatingMenuItems([
        item({ name: 'second', priority: 10 }),
        item({ name: 'heading', group: 'Basic' }),
        item({ name: 'first', priority: 20 }),
      ]);

      expect(names(groups)).toEqual(['', 'Basic']);
      expect(groups[0]?.items.map((entry) => entry.name)).toEqual(['first', 'second']);
    });

    it('is absent entirely when every item declares a group', () => {
      // What the separator rule hangs on: no ungrouped item, no line.
      const groups = groupFloatingMenuItems([
        item({ name: 'heading', group: 'Basic' }),
        item({ name: 'image', group: 'Media' }),
      ]);

      expect(groups.some((group) => group.name === '')).toBe(false);
    });

    it('treats an empty-string group as the same thing', () => {
      const groups = groupFloatingMenuItems([
        item({ name: 'heading', group: 'Basic' }),
        item({ name: 'blank', group: '' }),
      ]);

      expect(names(groups)).toEqual(['', 'Basic']);
    });
  });
});
