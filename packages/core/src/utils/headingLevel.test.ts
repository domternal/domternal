import { describe, expect, it } from 'vitest';
import { ExtensionConfigurationError } from '../ExtensionConfigurationError.js';
import {
  configuredHeadingLevels, headingCannotStand, isHeadingLevel, nearestHeadingLevel, resolveHeadingLevel, unconfiguredTagPriority,
} from './headingLevel.js';

/**
 * Every non-empty set of configured levels, as a bit mask where bit `level - 1` marks a
 * configured level, maps levels 1 to 6 to this row (entry `mask - 1`). PasteCleanup's copy of
 * the rule in extension-paste-cleanup/src/html/headingLevels.test.ts asserts the same table, so
 * the two copies cannot drift.
 */
const LEVEL_TABLE = [
  '111111', '222222', '122222', '333333', '133333', '223333', '123333', '444444', '144444',
  '224444', '124444', '333444', '133444', '223444', '123444', '555555', '155555', '225555',
  '125555', '333555', '133555', '223555', '123555', '444455', '144455', '224455', '124455',
  '333455', '133455', '223455', '123455', '666666', '166666', '226666', '126666', '333666',
  '133666', '223666', '123666', '444466', '144466', '224466', '124466', '333466', '133466',
  '223466', '123466', '555556', '155556', '225556', '125556', '333556', '133556', '223556',
  '123556', '444456', '144456', '224456', '124456', '333456', '133456', '223456', '123456',
] as const;
const LEVELS = [1, 2, 3, 4, 5, 6] as const;
const levelSets = LEVEL_TABLE.map((_, index) => LEVELS.filter(level => ((index + 1) & (1 << (level - 1))) !== 0));

describe('heading level rule', () => {
  it('maps every level of every configured set by the table shared with PasteCleanup', () => {
    levelSets.forEach((levels, index) => {
      expect(LEVELS.map(level => String(nearestHeadingLevel(level, levels))).join(''), levels.join(',')).toBe(LEVEL_TABLE[index]);
    });
  });

  it('stays in the set, keeps configured levels, never promotes while a deeper level exists and keeps outline order', () => {
    for (const levels of levelSets) {
      let previous = 0;
      for (const level of LEVELS) {
        const mapped = nearestHeadingLevel(level, levels);
        expect(levels).toContain(mapped);
        if (levels.includes(level)) expect(mapped).toBe(level);
        if (levels.some(candidate => candidate >= level)) expect(mapped).toBeGreaterThanOrEqual(level);
        else expect(mapped).toBe(Math.max(...levels));
        expect(mapped).toBeGreaterThanOrEqual(previous);
        previous = mapped;
      }
    }
  });

  it.each([
    [5, [1, 2, 3, 4], 4], [3, [1, 5], 5], [1, [2, 3], 2], [4, [4, 2], 4], [3, [4, 2], 4], [6, [4, 2], 4],
    [0, [1, 2, 3, 4], 1], [-1, [2, 3], 2], [2.5, [1, 2, 3, 4], 3], [2.5, [1, 2, 4], 4], [7, [1, 2, 3, 4], 4],
    [99, [1, 6], 6], [1e308, [1, 2, 3, 4], 4],
  ])('resolves the number %j with levels %j to %i', (value, levels, level) => {
    expect(resolveHeadingLevel(value, levels)).toBe(level);
  });

  it.each([
    ['5', [1, 2, 3, 4], 4], ['2', [1, 2, 3, 4], 2], [' 3 ', [1, 2, 3, 4], 3], ['2.5', [1, 2, 4], 4],
    ['1', [2, 3], 2], ['-1', [2, 3], 2], ['+4', [1, 5], 5], ['99', [1, 6], 6], ['0005', [1, 2, 3, 4], 4],
  ])('resolves the decimal string %j with levels %j like its number, to %i', (value, levels, level) => {
    expect(resolveHeadingLevel(value, levels)).toBe(level);
  });

  it.each([
    [''], [' '], ['x'], ['3px'], ['0x5'], ['5e0'], ['.5'], ['5.'], ['Infinity'], ['٣'],
    [null], [true], [undefined], [Number.NaN], [Number.POSITIVE_INFINITY], [Number.NEGATIVE_INFINITY], [{}], [[3]],
  ])('resolves %j, which is not a number or a decimal string, to the first configured level', value => {
    expect(resolveHeadingLevel(value, [1, 2, 3, 4])).toBe(1);
    expect(resolveHeadingLevel(value, [3, 2])).toBe(3);
  });

  it('resolves every level of every configured set, and its decimal string, to the nearest level', () => {
    for (const levels of levelSets) {
      for (const level of LEVELS) {
        expect(resolveHeadingLevel(level, levels)).toBe(nearestHeadingLevel(level, levels));
        expect(resolveHeadingLevel(String(level), levels)).toBe(nearestHeadingLevel(level, levels));
      }
    }
  });

  it('recognizes whole levels from 1 to 6 only', () => {
    expect(LEVELS.every(isHeadingLevel)).toBe(true);
    for (const value of [0, 7, 2.5, -1, '3', null, undefined, Number.NaN, true]) expect(isHeadingLevel(value)).toBe(false);
  });
});

describe('configured heading levels', () => {
  it.each([[[]], [[1, 2, 3, 4]], [[4, 2]], [[6]], [[1, 2, 3, 4, 5, 6]]])('accepts %j', levels => {
    expect(configuredHeadingLevels(levels)).toEqual(levels);
  });

  it('accepts a repeated level and counts it once', () => {
    expect(configuredHeadingLevels([1, 1, 2])).toEqual([1, 2]);
  });

  it.each([[[0]], [[7]], [['3']], [[1.5]], [[1, Number.NaN]], [[1, null]], ['1,2'], [undefined], [null], [{ 0: 1, length: 1 }]])('refuses %j', levels => {
    expect(() => configuredHeadingLevels(levels)).toThrow(ExtensionConfigurationError);
    expect(() => configuredHeadingLevels(levels)).toThrow('Heading: levels must be a list of whole numbers from 1 to 6');
  });
});

describe('configuredHeadingLevels with repeated levels', () => {
  it('keeps each level once, at its first position, in a frozen list', () => {
    const levels = configuredHeadingLevels([4, 2, 2, 4, 1]);
    expect(levels).toEqual([4, 2, 1]);
    expect(Object.isFrozen(levels)).toBe(true);
  });

  it('returns the same list for the same option until the option changes', () => {
    const option = [3, 3, 1];
    const first = configuredHeadingLevels(option);
    expect(configuredHeadingLevels(option)).toBe(first);
    option.push(2);
    expect(configuredHeadingLevels(option)).toEqual([3, 1, 2]);
    option.length = 0;
    expect(configuredHeadingLevels(option)).toEqual([]);
    option.push(4);
    expect(configuredHeadingLevels(option)).toEqual([4]);
  });

  it('refuses an option changed in place to an invalid entry after it was read', () => {
    const option: unknown[] = [1, 2];
    expect(configuredHeadingLevels(option)).toEqual([1, 2]);
    option[1] = 9;
    expect(() => configuredHeadingLevels(option)).toThrow(ExtensionConfigurationError);
    option[1] = 2;
    expect(configuredHeadingLevels(option)).toEqual([1, 2]);
  });

  it('never changes the option it reads', () => {
    const option = [2, 2];
    configuredHeadingLevels(option);
    expect(option).toEqual([2, 2]);
    expect(Object.isFrozen(option)).toBe(false);
  });
});

describe('unconfiguredTagPriority', () => {
  it('ranks every mapped tag below 1, a nearer deeper level above any shallower one', () => {
    expect(unconfiguredTagPriority(5, [1, 2, 3, 4])).toBe(0.89);
    expect(unconfiguredTagPriority(6, [1, 2, 3, 4])).toBe(0.88);
    expect(unconfiguredTagPriority(1, [2, 3])).toBe(0.99);
    expect(unconfiguredTagPriority(1, [6])).toBe(0.95);
    expect(unconfiguredTagPriority(6, [1])).toBe(0.85);
    for (const level of LEVELS) {
      for (const levels of [[1], [6], [2, 4], [1, 2, 3, 4, 5]]) {
        if (levels.includes(level)) continue;
        const priority = unconfiguredTagPriority(level, levels);
        expect(priority).toBeLessThan(1);
        expect(priority).toBeGreaterThan(0.8);
      }
    }
  });
});

describe('headingCannotStand', () => {
  const heading = (html: string): HTMLElement => {
    const host = document.createElement('div');
    host.innerHTML = html;
    const found = host.querySelector<HTMLElement>('#h');
    if (!found) throw new Error('No heading');
    return found;
  };

  it.each([
    '<ul><li><h5 id="h">a</h5></li></ul>',
    '<ul><li> \n <h5 id="h">a</h5></li></ul>',
    '<ul><li><!-- note --><h5 id="h">a</h5></li></ul>',
    '<ul><li><span></span><h5 id="h">a</h5></li></ul>',
    '<ul><li><style>p{}</style><script>x()</script><h5 id="h">a</h5></li></ul>',
    '<ul><li><label><input type="checkbox"></label><div><h5 id="h">a</h5></div></li></ul>',
    '<ol><li>Parent<ul><li><h5 id="h">a</h5></li></ul></li></ol>',
    '<details><summary><b><h5 id="h">a</h5></b></summary></details>',
    '<pre><h5 id="h">a</h5></pre>',
  ])('finds %s where a heading cannot stand', html => {
    expect(headingCannotStand(heading(html))).toBe(true);
  });

  it.each([
    '<h5 id="h">a</h5>',
    '<blockquote><h5 id="h">a</h5></blockquote>',
    '<ul><li>Text<h5 id="h">a</h5></li></ul>',
    '<ul><li><p>x</p><h5 id="h">a</h5></li></ul>',
    '<ul><li><p>x</p><div><h5 id="h">a</h5></div></li></ul>',
    '<details><summary>S</summary><h5 id="h">a</h5></details>',
    '<table><tr><td><h5 id="h">a</h5></td></tr></table>',
    '<ul><li><table><tr><td><h5 id="h">a</h5></td></tr></table></li></ul>',
    '<ul><li><blockquote><h5 id="h">a</h5></blockquote></li></ul>',
    '<ul><li><p>Label</p><details><summary>S</summary><div><h5 id="h">a</h5></div></details></li></ul>',
    // ProseMirror keeps a no-break space as text, and a line break, an image or a block opens the item.
    '<ul><li>&nbsp;<h5 id="h">a</h5></li></ul>',
    '<ul><li><span>\u00a0</span><h5 id="h">a</h5></li></ul>',
    '<ul><li>\ufeff<h5 id="h">a</h5></li></ul>',
    '<ul><li><br><h5 id="h">a</h5></li></ul>',
    '<ul><li><span><img src="x.png"></span><h5 id="h">a</h5></li></ul>',
    '<ul><li><hr><h5 id="h">a</h5></li></ul>',
    '<ul><li><ul></ul><h5 id="h">a</h5></li></ul>',
  ])('lets a heading stand in %s', html => {
    expect(headingCannotStand(heading(html))).toBe(false);
  });
});
