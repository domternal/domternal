import { describe, expect, it } from 'vitest';
import { ExtensionConfigurationError } from '../ExtensionConfigurationError.js';
import { configuredHeadingLevels, isHeadingLevel, nearestHeadingLevel, resolveHeadingLevel } from './headingLevel.js';

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

  it('recognizes whole levels from 1 to 6 only', () => {
    expect(LEVELS.every(isHeadingLevel)).toBe(true);
    for (const value of [0, 7, 2.5, -1, '3', null, undefined, Number.NaN, true]) expect(isHeadingLevel(value)).toBe(false);
  });
});

describe('configured heading levels', () => {
  it.each([[[1, 2, 3, 4]], [[4, 2]], [[6]], [[1, 2, 3, 4, 5, 6]]])('accepts %j', levels => {
    expect(configuredHeadingLevels(levels)).toEqual(levels);
  });

  it('accepts a repeated level and counts it once', () => {
    expect(configuredHeadingLevels([1, 1, 2])).toEqual([1, 2]);
  });

  it.each([[[]], [[0]], [[7]], [['3']], [[1.5]], [[1, Number.NaN]], [[1, null]], ['1,2'], [undefined], [null], [{ 0: 1, length: 1 }]])('refuses %j', levels => {
    expect(() => configuredHeadingLevels(levels)).toThrow(ExtensionConfigurationError);
    expect(() => configuredHeadingLevels(levels)).toThrow('Heading: levels must be a non-empty list of whole numbers from 1 to 6');
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
    expect(() => configuredHeadingLevels(option)).toThrow(ExtensionConfigurationError);
  });

  it('never changes the option it reads', () => {
    const option = [2, 2];
    configuredHeadingLevels(option);
    expect(option).toEqual([2, 2]);
    expect(Object.isFrozen(option)).toBe(false);
  });
});
