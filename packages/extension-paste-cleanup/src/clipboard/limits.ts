export interface ClipboardAssetLimits {
  readonly maxFileBytes: number;
  readonly maxTotalFileBytes: number;
  /** UTF-16 units including resolved URLs, markup and escaping. Source HTML has its own limit. */
  readonly maxPreparedOutputUnits: number;
}

const MIB = 1024 * 1024;

/** Conservative main-thread defaults. These byte counters are not process heap limits. */
export const DEFAULT_CLIPBOARD_ASSET_LIMITS: Readonly<ClipboardAssetLimits> = Object.freeze({
  maxFileBytes: MIB, maxTotalFileBytes: 4 * MIB, maxPreparedOutputUnits: 8 * MIB,
});

/** Larger aggregates require a separately qualified yielding or worker implementation. */
export const MAX_CLIPBOARD_ASSET_LIMITS: Readonly<ClipboardAssetLimits> = Object.freeze({
  maxFileBytes: 5 * MIB, maxTotalFileBytes: 5 * MIB, maxPreparedOutputUnits: 8 * MIB,
});

function record(value: unknown): value is object {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function resolveClipboardAssetLimits(input?: Partial<ClipboardAssetLimits>): Readonly<ClipboardAssetLimits> {
  if (input !== undefined && !record(input)) throw new RangeError('Invalid clipboard asset limits');
  const result = { ...DEFAULT_CLIPBOARD_ASSET_LIMITS };
  if (input === undefined) return Object.freeze(result);
  const keys = Reflect.ownKeys(input);
  if (keys.length > 3) throw new RangeError('Invalid clipboard asset limits');
  for (const key of keys) {
    if (!Object.hasOwn(result, key)) throw new RangeError('Unknown clipboard asset limit');
    const name = key as keyof ClipboardAssetLimits;
    const value: unknown = Reflect.get(input, key);
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAX_CLIPBOARD_ASSET_LIMITS[name]) {
      throw new RangeError(`Invalid clipboard asset limit: ${name}`);
    }
    result[name] = value;
  }
  if (result.maxFileBytes > result.maxTotalFileBytes) throw new RangeError('The clipboard file limit exceeds the total file limit');
  return Object.freeze(result);
}
