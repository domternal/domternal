import { boundedRaster } from '../html/raster.js';
import { clipboardRasterMime } from './destination.js';
import type { ClipboardImageDestination, ClipboardRasterMime } from './destination.js';
import { MAX_CLIPBOARD_ASSET_LIMITS } from './limits.js';

/** Remaining shared batch capacity, not an independent allowance for each source kind. */
export interface ClipboardInlineDataAllowance {
  readonly maxInputUnits: number;
  readonly maxResourceBytes: number;
  readonly remainingResourceBytes: number;
  readonly remainingPixels: number;
  readonly placements: number;
}

/** Private immutable byte string. Never expose it in matching metadata, diagnostics or recovery reports. */
export interface ClipboardInlineDataResource {
  readonly binary: string;
  readonly mimeType: ClipboardRasterMime;
  readonly byteLength: number;
  /** Header-derived allocation estimate for one placement, not full codec validation. */
  readonly pixels: number;
}

export type ClipboardInlineDataResult =
  | { readonly status: 'qualified'; readonly resource: Readonly<ClipboardInlineDataResource>;
      readonly chargedBytes: number; readonly chargedPixels: number }
  | { readonly status: 'rejected'; readonly reason: 'input-limit' | 'invalid-metadata' | 'invalid-data-url'
      | 'unsupported-image-type' | 'image-size-limit' | 'pixel-limit' | 'invalid-raster' | 'unreadable-input' }
  | { readonly status: 'cancelled' };

const MAX_INPUT_UNITS = 2_000_000;
const MAX_PLACEMENTS = 200;
const MAX_PIXELS = 50_000_000;
const CANCELLED = Object.freeze({ status: 'cancelled' as const });

type Destination = Pick<ClipboardImageDestination, 'allowedMimeTypes' | 'maxFileBytes'>;
type Rejection = Extract<ClipboardInlineDataResult, { status: 'rejected' }>['reason'];

function rejected(reason: Rejection): ClipboardInlineDataResult { return Object.freeze({ status: 'rejected', reason }); }
function integer(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }

function allowanceFor(input: ClipboardInlineDataAllowance): Readonly<ClipboardInlineDataAllowance> {
  const candidate: unknown = input;
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) throw new RangeError('Invalid clipboard inline image allowance');
  const values = { maxInputUnits: input.maxInputUnits, maxResourceBytes: input.maxResourceBytes,
    remainingResourceBytes: input.remainingResourceBytes, remainingPixels: input.remainingPixels, placements: input.placements };
  if (!integer(values.maxInputUnits) || values.maxInputUnits < 1 || values.maxInputUnits > MAX_INPUT_UNITS
    || !integer(values.maxResourceBytes) || values.maxResourceBytes < 1 || values.maxResourceBytes > MAX_CLIPBOARD_ASSET_LIMITS.maxFileBytes
    || !integer(values.remainingResourceBytes) || values.remainingResourceBytes > MAX_CLIPBOARD_ASSET_LIMITS.maxTotalFileBytes
    || !integer(values.remainingPixels) || values.remainingPixels > MAX_PIXELS
    || !integer(values.placements) || values.placements < 1 || values.placements > MAX_PLACEMENTS) {
    throw new RangeError('Invalid clipboard inline image allowance');
  }
  return Object.freeze(values);
}

function destinationFor(input: Destination): { readonly maxFileBytes: number; readonly mimeTypes: ReadonlySet<ClipboardRasterMime> } | undefined {
  const maximum: unknown = input.maxFileBytes;
  const raw: unknown = input.allowedMimeTypes;
  if (!integer(maximum) || maximum < 1 || !Array.isArray(raw)) return undefined;
  const count = raw.length;
  if (!integer(count) || count > 4) return undefined;
  const mimeTypes = new Set<ClipboardRasterMime>();
  for (let index = 0; index < count; index++) {
    const value: unknown = raw[index];
    const mime = typeof value === 'string' ? clipboardRasterMime(value) : undefined;
    if (mime === undefined) return undefined;
    mimeTypes.add(mime);
  }
  return { maxFileBytes: maximum, mimeTypes };
}

/**
 * Qualify one already-authorized inline source without a File, Blob or DOM allocation.
 * The caller must enforce source allowDataImages and resolver authorization separately,
 * pass remaining shared batch capacity, and debit the returned charges before another
 * source is qualified. Source encoding variants are not identity or deduplication keys.
 * A later shared batch can deduplicate exact MIME plus binary and construct one Blob.
 * Synchronous decoding cannot be interrupted; abort is checked before and after it.
 */
export function qualifyClipboardInlineData(
  source: unknown,
  destination: Destination,
  allowance: ClipboardInlineDataAllowance,
  options: Readonly<{ signal?: AbortSignal }> = {},
): ClipboardInlineDataResult {
  const limits = allowanceFor(allowance);
  try {
    const policy = destinationFor(destination);
    const signal = options.signal;
    const aborted = (): boolean => {
      if (signal === undefined) return false;
      const value: unknown = signal.aborted;
      if (typeof value !== 'boolean') throw new TypeError('Invalid clipboard abort signal');
      return value;
    };
    if (aborted()) return CANCELLED;
    if (policy === undefined) return rejected('invalid-metadata');
    if (typeof source !== 'string') return rejected('invalid-data-url');
    if (source.length > limits.maxInputUnits) return rejected('input-limit');
    // This is the same strict MIME/base64 syntax accepted by safeImage. Match only
    // the small header before sizing decoded bytes, not a full captured payload.
    const header = /^data:image\/(png|jpeg|gif|webp);base64,/i.exec(source);
    if (header === null) return rejected('invalid-data-url');
    const mimeType = clipboardRasterMime(`image/${header[1]?.toLowerCase() ?? ''}`);
    if (mimeType === undefined || !policy.mimeTypes.has(mimeType)) return rejected('unsupported-image-type');
    const start = header[0].length;
    const encodedUnits = source.length - start;
    if (encodedUnits === 0 || encodedUnits % 4 !== 0) return rejected('invalid-data-url');
    const padding = source.endsWith('==') ? 2 : source.endsWith('=') ? 1 : 0;
    const decodedBytes = encodedUnits / 4 * 3 - padding;
    if (decodedBytes > limits.maxResourceBytes || decodedBytes > policy.maxFileBytes
      || decodedBytes > limits.remainingResourceBytes) return rejected('image-size-limit');
    if (limits.remainingPixels < limits.placements) return rejected('pixel-limit');
    // Validate without creating a payload substring before the byte preflight.
    const dataEnd = source.length - padding;
    for (let index = start; index < dataEnd; index++) {
      const code = source.charCodeAt(index);
      if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 43 || code === 47)) {
        return rejected('invalid-data-url');
      }
    }
    if (aborted()) return CANCELLED;
    let binary: string;
    try { binary = atob(source.slice(start)); }
    catch { return aborted() ? CANCELLED : rejected('invalid-data-url'); }
    if (aborted()) return CANCELLED;
    if (binary.length !== decodedBytes) return rejected('invalid-data-url');
    const allocation = { pixels: 0, exceeded: false };
    const valid = boundedRaster(binary, mimeType.slice(6), pixels => {
      allocation.pixels = pixels;
      if (pixels > Math.floor(limits.remainingPixels / limits.placements)) { allocation.exceeded = true; return false; }
      return true;
    });
    if (aborted()) return CANCELLED;
    if (!valid || allocation.pixels === 0) return rejected(allocation.exceeded ? 'pixel-limit' : 'invalid-raster');
    return Object.freeze({ status: 'qualified',
      resource: Object.freeze({ binary, mimeType, byteLength: decodedBytes, pixels: allocation.pixels }),
      chargedBytes: decodedBytes, chargedPixels: allocation.pixels * limits.placements,
    });
  } catch { return rejected('unreadable-input'); }
}
