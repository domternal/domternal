const TEXT_FORMATS = ['text/html', 'text/plain', 'text/rtf', 'Text', 'text/uri-list'] as const;

export type ClipboardTextFormat = typeof TEXT_FORMATS[number];

/** Explicit capture budgets. Zero is a zero allowance, never an unlimited setting. */
export interface ClipboardCaptureLimits {
  readonly maxItems: number;
  /** UTF-16 code units per source string, checked before counting UTF-8 bytes. */
  readonly maxStringLength: number;
  /** UTF-16 code units per item kind, item type and File type. */
  readonly maxMetadataLength: number;
  readonly maxTextBytes: number;
  readonly maxFileBytes: number;
  readonly maxTotalFileBytes: number;
  /** Combined source string and File bytes. Metadata has its own length and item bounds. */
  readonly maxClipboardBytes: number;
}

export interface CapturedClipboardItem {
  /** Index in the original unfiltered DataTransfer.items list. */
  readonly itemIndex: number;
  readonly kind: string;
  readonly declaredType: string;
  readonly file: File | null;
  readonly fileType: string | null;
  readonly fileSize: number | null;
}

export interface ClipboardSnapshot {
  readonly text: Readonly<Record<ClipboardTextFormat, string>>;
  readonly items: readonly CapturedClipboardItem[];
  readonly textBytes: number;
  readonly fileBytes: number;
}

export type ClipboardCaptureResult =
  | { readonly status: 'captured'; readonly snapshot: ClipboardSnapshot }
  | { readonly status: 'unavailable' }
  | { readonly status: 'rejected'; readonly reason: 'input-limit' | 'unreadable-payload' };

const unavailable = Object.freeze({ status: 'unavailable' as const });
const inputLimit = Object.freeze({ status: 'rejected' as const, reason: 'input-limit' as const });
const unreadable = Object.freeze({ status: 'rejected' as const, reason: 'unreadable-payload' as const });

/** Read configuration once, before a clipboard getter can run application code. */
function captureLimits(input: ClipboardCaptureLimits): ClipboardCaptureLimits {
  const limits = {
    maxItems: input.maxItems,
    maxStringLength: input.maxStringLength,
    maxMetadataLength: input.maxMetadataLength,
    maxTextBytes: input.maxTextBytes,
    maxFileBytes: input.maxFileBytes,
    maxTotalFileBytes: input.maxTotalFileBytes,
    maxClipboardBytes: input.maxClipboardBytes,
  };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid clipboard capture limit: ${key}`);
  }
  return Object.freeze(limits);
}

/** Count UTF-8 with unpaired surrogates encoded as U+FFFD, without an encoded copy. */
function utf8BytesWithin(value: string, maximum: number): number | undefined {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    let width = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3;
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { width = 4; index++; }
    }
    if (width > maximum - bytes) return undefined;
    bytes += width;
  }
  return bytes;
}

/**
 * Capture event-visible data synchronously without parsing, binary reads or DOM access.
 * Browser getData already allocates its string. These limits bound subsequent application
 * work, not the browser's clipboard allocation. No live clipboard item is retained.
 */
export function captureClipboard(data: DataTransfer | null, inputLimits: ClipboardCaptureLimits): ClipboardCaptureResult {
  const limits = captureLimits(inputLimits);
  if (data === null) return unavailable;
  try {
    const sourceItems = data.items;
    const count: unknown = sourceItems.length;
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return unreadable;
    if (count > limits.maxItems) return inputLimit;
    const items: CapturedClipboardItem[] = [];
    let fileBytes = 0;
    for (let itemIndex = 0; itemIndex < count; itemIndex++) {
      const sourceItem = sourceItems[itemIndex];
      if (sourceItem === undefined) return unreadable;
      const kind: unknown = sourceItem.kind;
      const declaredType: unknown = sourceItem.type;
      if (typeof kind !== 'string' || typeof declaredType !== 'string') return unreadable;
      if (kind.length > limits.maxMetadataLength || declaredType.length > limits.maxMetadataLength) return inputLimit;
      const candidate: unknown = kind === 'file' ? sourceItem.getAsFile() : null;
      let file: File | null = null;
      let fileType: string | null = null;
      let fileSize: number | null = null;
      if (candidate !== null) {
        if (typeof candidate !== 'object') return unreadable;
        // Browser File objects may come from another realm. Read only their bounded metadata.
        const captured = candidate as File;
        const size: unknown = captured.size;
        const type: unknown = captured.type;
        if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0 || typeof type !== 'string') return unreadable;
        if (type.length > limits.maxMetadataLength || size > limits.maxFileBytes
          || size > limits.maxTotalFileBytes - fileBytes || size > limits.maxClipboardBytes - fileBytes) return inputLimit;
        fileBytes += size;
        file = captured;
        fileSize = size;
        fileType = type;
      }
      items.push(Object.freeze({ itemIndex, kind, declaredType, file, fileType, fileSize }));
    }

    const text: Record<ClipboardTextFormat, string> = {
      'text/html': '', 'text/plain': '', 'text/rtf': '', Text: '', 'text/uri-list': '',
    };
    let textBytes = 0;
    for (const format of TEXT_FORMATS) {
      const value: unknown = data.getData(format);
      if (typeof value !== 'string') return unreadable;
      if (value.length > limits.maxStringLength) return inputLimit;
      const maximum = Math.min(limits.maxTextBytes - textBytes, limits.maxClipboardBytes - fileBytes - textBytes);
      const bytes = utf8BytesWithin(value, maximum);
      if (bytes === undefined) return inputLimit;
      textBytes += bytes;
      text[format] = value;
    }
    return Object.freeze({
      status: 'captured',
      snapshot: Object.freeze({ text: Object.freeze(text), items: Object.freeze(items), textBytes, fileBytes }),
    });
  } catch {
    return unreadable;
  }
}
