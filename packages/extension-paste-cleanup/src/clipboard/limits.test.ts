// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLIPBOARD_ASSET_LIMITS, MAX_CLIPBOARD_ASSET_LIMITS, resolveClipboardAssetLimits } from './limits.js';
import type { ClipboardAssetLimits } from './limits.js';

describe('coordinated clipboard asset limits', () => {
  it('uses immutable conservative defaults independently of the private stress-test envelope', () => {
    const result = resolveClipboardAssetLimits();
    expect(result).toEqual({ maxFileBytes: 1_048_576, maxTotalFileBytes: 4_194_304, maxPreparedOutputUnits: 8_388_608 });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CLIPBOARD_ASSET_LIMITS)).toBe(true);
    expect(Object.isFrozen(MAX_CLIPBOARD_ASSET_LIMITS)).toBe(true);
    expect(resolveClipboardAssetLimits(MAX_CLIPBOARD_ASSET_LIMITS)).toEqual(MAX_CLIPBOARD_ASSET_LIMITS);
  });

  it('snapshots lowered values and rejects a per-file limit above the aggregate', () => {
    const input = { maxFileBytes: 100, maxTotalFileBytes: 200, maxPreparedOutputUnits: 1000 };
    const result = resolveClipboardAssetLimits(input);
    input.maxFileBytes = 0;
    expect(result.maxFileBytes).toBe(100);
    expect(() => resolveClipboardAssetLimits({ maxFileBytes: 201, maxTotalFileBytes: 200 })).toThrow(RangeError);
  });

  it.each([0, -1, 0.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER, 'unlimited', undefined])('rejects the explicit unsupported value %s before work', value => {
    for (const key of Object.keys(DEFAULT_CLIPBOARD_ASSET_LIMITS)) {
      expect(() => resolveClipboardAssetLimits({ [key]: value })).toThrow(RangeError);
    }
  });

  it.each([null, false, [], 1, 'limits', { extra: 1 }, { [Symbol('limit')]: 1 }])('rejects invalid shapes and unknown fields: %s', input => {
    expect(() => resolveClipboardAssetLimits(input as Partial<ClipboardAssetLimits>)).toThrow(RangeError);
  });

  it('refuses the larger private qualification envelope as a production configuration', () => {
    expect(() => resolveClipboardAssetLimits({ maxTotalFileBytes: 20 * 1024 * 1024 })).toThrow(RangeError);
    expect(() => resolveClipboardAssetLimits({ maxPreparedOutputUnits: 32 * 1024 * 1024 })).toThrow(RangeError);
  });
});
