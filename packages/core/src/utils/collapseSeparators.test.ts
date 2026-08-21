import { describe, it, expect } from 'vitest';
import { collapseSeparators } from './collapseSeparators.js';

/** The two shapes a menu list holds, reduced to what this function reads. */
interface Item { type: string; name: string }
const b = (name: string): Item => ({ type: 'button', name });
const sep = (name = 'sep'): Item => ({ type: 'separator', name });
const names = (items: Item[]): string[] =>
  items.map((i) => (i.type === 'separator' ? '|' : i.name));

describe('collapseSeparators', () => {
  it('drops a separator left leading the list', () => {
    // What every free build of the Notion menu produced: `ai` is a Pro item, so
    // it resolved to nothing and its separator opened the menu.
    expect(names(collapseSeparators([sep(), b('bold'), b('italic')]))).toEqual([
      'bold',
      'italic',
    ]);
  });

  it('drops a separator left trailing the list', () => {
    expect(names(collapseSeparators([b('bold'), sep()]))).toEqual(['bold']);
  });

  it('collapses a run of separators to one', () => {
    // Two names dropped from between three groups.
    expect(names(collapseSeparators([b('bold'), sep('a'), sep('b'), sep('c'), b('link')]))).toEqual(
      ['bold', '|', 'link'],
    );
  });

  it('keeps the separator that still has an item on each side', () => {
    expect(names(collapseSeparators([b('bold'), sep(), b('link')]))).toEqual([
      'bold',
      '|',
      'link',
    ]);
  });

  it('empties a list that is nothing but separators', () => {
    expect(collapseSeparators([sep('a'), sep('b')])).toEqual([]);
  });

  it('returns an empty list unchanged', () => {
    expect(collapseSeparators([])).toEqual([]);
  });

  it('does not mutate the input', () => {
    const input = [sep(), b('bold'), sep()];
    const copy = [...input];
    collapseSeparators(input);
    expect(input).toEqual(copy);
  });

  it('preserves the item objects by reference', () => {
    // The caller renders these, and the bubble menu keys its DOM reuse off
    // object identity: copying them would rebuild the menu on every pass.
    const bold = b('bold');
    const link = b('link');
    expect(collapseSeparators([sep(), bold, sep('keep'), link])).toEqual([
      bold,
      { type: 'separator', name: 'keep' },
      link,
    ]);
    expect(collapseSeparators([bold])[0]).toBe(bold);
  });

  it('returns the very same array when there is nothing to drop', () => {
    // React and Vue hand this to their state, where a fresh array is a
    // re-render, and this runs on every transaction.
    const input = [b('bold'), sep(), b('link')];
    expect(collapseSeparators(input)).toBe(input);
    const empty: Item[] = [];
    expect(collapseSeparators(empty)).toBe(empty);
  });

  it('returns a new array when something is dropped', () => {
    const input = [sep(), b('bold')];
    expect(collapseSeparators(input)).not.toBe(input);
  });

  it('reads only `type`, so any item shape passes through', () => {
    const dropdown = { type: 'dropdown', name: 'heading', items: [] };
    expect(collapseSeparators([sep(), dropdown])).toEqual([dropdown]);
  });
});
