import type { CapturedClipboardItem, ClipboardCaptureLimits, ClipboardSnapshot } from './capture.js';
import { clipboardRasterMime } from './destination.js';
import type { ClipboardImageDestination, ClipboardRasterMime } from './destination.js';

/** Private source data, never a diagnostic payload or a value to render in the feedback UI. */
export interface ClipboardImageReference {
  readonly placementId: string;
  readonly sourceOffset?: number;
  readonly rawReference: string;
  readonly alt?: string;
  readonly width?: number;
  readonly height?: number;
}

/** Only the application or a separately verified source adapter supplies these explicit bindings. */
export interface ClipboardImageBinding {
  readonly placementId: string;
  readonly itemIndex: number;
  readonly evidence:
    | { readonly kind: 'host'; readonly matcherId: string }
    | { readonly kind: 'verified-profile'; readonly profileId: string };
}

export interface ClipboardReferenceLimits extends ClipboardCaptureLimits {
  readonly maxPlacements: number;
  readonly maxBindings: number;
  readonly maxDiagnostics: number;
  readonly maxReferenceLength: number;
  readonly maxDescriptionLength: number;
  readonly maxDimension: number;
}

export type ClipboardReferenceDiagnosticCode =
  | 'input-limit' | 'invalid-snapshot' | 'invalid-reference' | 'unreadable-input'
  | 'invalid-binding' | 'unknown-placement' | 'conflicting-binding' | 'unbound-reference'
  | 'file-unavailable' | 'unsupported-image-type' | 'image-type-mismatch' | 'image-size-limit';

export interface ClipboardReferenceDiagnostic {
  readonly code: ClipboardReferenceDiagnosticCode;
  readonly placementId?: string;
  readonly offset?: number;
}

/** A metadata match is not proof of valid image bytes or destination insertion capability. */
export interface ClipboardMatchedImage {
  readonly reference: ClipboardImageReference;
  readonly itemIndex: number;
  readonly file: File;
  readonly fileSize: number;
  readonly mimeType: ClipboardRasterMime;
}

interface ReferenceCheckResult {
  readonly matches: readonly ClipboardMatchedImage[];
  readonly diagnostics: readonly ClipboardReferenceDiagnostic[];
  readonly diagnosticsTruncated: boolean;
}

export type ClipboardReferenceResult = ReferenceCheckResult & (
  | { readonly status: 'checked' }
  | { readonly status: 'rejected'; readonly reason: 'input-limit' | 'invalid-snapshot' | 'invalid-reference' | 'unreadable-input' }
);

type RejectionReason = Extract<ClipboardReferenceResult, { status: 'rejected' }>['reason'];
const EMPTY_MATCHES: readonly ClipboardMatchedImage[] = Object.freeze([]);
const TEXT_FORMATS = ['text/html', 'text/plain', 'text/rtf', 'Text', 'text/uri-list'] as const;

function validatedLimits(input: ClipboardReferenceLimits): ClipboardReferenceLimits {
  const limits = {
    maxItems: input.maxItems, maxStringLength: input.maxStringLength,
    maxMetadataLength: input.maxMetadataLength, maxTextBytes: input.maxTextBytes,
    maxFileBytes: input.maxFileBytes, maxTotalFileBytes: input.maxTotalFileBytes,
    maxClipboardBytes: input.maxClipboardBytes, maxPlacements: input.maxPlacements,
    maxBindings: input.maxBindings, maxDiagnostics: input.maxDiagnostics,
    maxReferenceLength: input.maxReferenceLength, maxDescriptionLength: input.maxDescriptionLength,
    maxDimension: input.maxDimension,
  };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid clipboard reference limit: ${key}`);
  }
  return Object.freeze(limits);
}

function size(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Preserve caller element types while checking runtime array shape. */
function isArray(value: unknown): boolean { return Array.isArray(value); }

/** Recheck the capture producer's metadata and counters without touching File properties. */
function checkSnapshot(snapshot: ClipboardSnapshot, limits: ClipboardReferenceLimits):
  | { readonly items: readonly CapturedClipboardItem[]; readonly htmlLength: number }
  | RejectionReason {
  const sourceItems: unknown = snapshot.items;
  const textBytes: unknown = snapshot.textBytes;
  const fileBytes: unknown = snapshot.fileBytes;
  if (!Array.isArray(sourceItems) || !size(textBytes) || !size(fileBytes)) return 'invalid-snapshot';
  const itemCount = sourceItems.length;
  if (!size(itemCount)) return 'invalid-snapshot';
  if (itemCount > limits.maxItems || textBytes > limits.maxTextBytes
    || fileBytes > limits.maxTotalFileBytes || fileBytes > limits.maxClipboardBytes
    || textBytes > limits.maxClipboardBytes - fileBytes) return 'input-limit';
  let htmlLength = 0;
  for (const format of TEXT_FORMATS) {
    const text: unknown = snapshot.text[format];
    if (typeof text !== 'string') return 'invalid-snapshot';
    if (text.length > limits.maxStringLength) return 'input-limit';
    if (format === 'text/html') htmlLength = text.length;
  }
  const items: CapturedClipboardItem[] = [];
  let total = 0;
  for (let index = 0; index < itemCount; index++) {
    const raw: unknown = sourceItems[index];
    if (raw === null || typeof raw !== 'object') return 'invalid-snapshot';
    const entry = raw as CapturedClipboardItem;
    const itemIndex: unknown = entry.itemIndex;
    const kind: unknown = entry.kind;
    const declaredType: unknown = entry.declaredType;
    const file: unknown = entry.file;
    const fileType: unknown = entry.fileType;
    const fileSize: unknown = entry.fileSize;
    if (itemIndex !== index || typeof kind !== 'string' || typeof declaredType !== 'string') return 'invalid-snapshot';
    if (kind.length > limits.maxMetadataLength || declaredType.length > limits.maxMetadataLength) return 'input-limit';
    if (file === null) {
      if (fileType !== null || fileSize !== null) return 'invalid-snapshot';
      items.push(Object.freeze({ itemIndex: index, kind, declaredType, file: null, fileType: null, fileSize: null }));
      continue;
    }
    if (typeof file !== 'object' || kind !== 'file' || typeof fileType !== 'string' || !size(fileSize)) return 'invalid-snapshot';
    if (fileType.length > limits.maxMetadataLength || fileSize > limits.maxFileBytes
      || fileSize > limits.maxTotalFileBytes - total || fileSize > limits.maxClipboardBytes - total) return 'input-limit';
    total += fileSize;
    items.push(Object.freeze({ itemIndex: index, kind, declaredType, file: file as File, fileType, fileSize }));
  }
  if (total !== fileBytes) return 'invalid-snapshot';
  return { items, htmlLength };
}

function copyReference(input: ClipboardImageReference, htmlLength: number, limits: ClipboardReferenceLimits): ClipboardImageReference | RejectionReason {
  const placementId: unknown = input.placementId;
  const rawReference: unknown = input.rawReference;
  const sourceOffset: unknown = input.sourceOffset;
  const alt: unknown = input.alt;
  const width: unknown = input.width;
  const height: unknown = input.height;
  if (typeof placementId !== 'string' || placementId.length === 0 || typeof rawReference !== 'string'
    || (alt !== undefined && typeof alt !== 'string')
    || (sourceOffset !== undefined && (!size(sourceOffset) || sourceOffset > htmlLength))) return 'invalid-reference';
  if (placementId.length > limits.maxMetadataLength || rawReference.length > limits.maxReferenceLength
    || (typeof alt === 'string' && alt.length > limits.maxDescriptionLength)) return 'input-limit';
  for (const dimension of [width, height]) {
    if (dimension !== undefined && (typeof dimension !== 'number' || !Number.isFinite(dimension) || dimension <= 0)) return 'invalid-reference';
    if (typeof dimension === 'number' && dimension > limits.maxDimension) return 'input-limit';
  }
  return Object.freeze({
    placementId, rawReference,
    ...(typeof sourceOffset === 'number' ? { sourceOffset } : {}),
    ...(typeof alt === 'string' ? { alt } : {}),
    ...(typeof width === 'number' ? { width } : {}),
    ...(typeof height === 'number' ? { height } : {}),
  });
}

/**
 * Check explicit trusted bindings against an A1 capture and a frozen destination profile.
 * No CID, filename, order, cardinality, dimensions or profile identifier creates a binding.
 * Capture's UTF-8 counter is a producer invariant; this is not a public snapshot deserializer.
 */
export function resolveClipboardImageBindings(
  snapshot: ClipboardSnapshot,
  references: readonly ClipboardImageReference[],
  bindings: readonly ClipboardImageBinding[],
  destination: ClipboardImageDestination,
  inputLimits: ClipboardReferenceLimits,
): ClipboardReferenceResult {
  const limits = validatedLimits(inputLimits);
  const diagnostics: ClipboardReferenceDiagnostic[] = [];
  let diagnosticsTruncated = false;
  const report = (code: ClipboardReferenceDiagnosticCode, reference?: ClipboardImageReference): void => {
    if (diagnostics.length >= limits.maxDiagnostics) { diagnosticsTruncated = true; return; }
    diagnostics.push(Object.freeze({
      code,
      ...(reference !== undefined ? { placementId: reference.placementId } : {}),
      ...(reference?.sourceOffset !== undefined ? { offset: reference.sourceOffset } : {}),
    }));
  };
  const reject = (reason: RejectionReason): ClipboardReferenceResult => {
    report(reason);
    return Object.freeze({ status: 'rejected', reason, matches: EMPTY_MATCHES, diagnostics: Object.freeze(diagnostics), diagnosticsTruncated });
  };
  try {
    if (!isArray(references) || !isArray(bindings)) return reject('unreadable-input');
    const referenceCount = references.length;
    const bindingCount = bindings.length;
    if (!size(referenceCount) || !size(bindingCount)) return reject('unreadable-input');
    if (referenceCount > limits.maxPlacements || bindingCount > limits.maxBindings) return reject('input-limit');
    const capture = checkSnapshot(snapshot, limits);
    if (typeof capture === 'string') return reject(capture);
    const placements = new Map<string, ClipboardImageReference>();
    for (let index = 0; index < referenceCount; index++) {
      const input = references[index];
      if (input === undefined) return reject('invalid-reference');
      const reference = copyReference(input, capture.htmlLength, limits);
      if (typeof reference === 'string') return reject(reference);
      if (placements.has(reference.placementId)) return reject('invalid-reference');
      placements.set(reference.placementId, reference);
    }
    interface BindingState { itemIndex?: number; invalid: boolean; conflict: boolean }
    const assigned = new Map<string, BindingState>();
    for (let index = 0; index < bindingCount; index++) {
      const binding = bindings[index];
      if (binding === undefined) return reject('unreadable-input');
      const placementId: unknown = binding.placementId;
      if (typeof placementId !== 'string' || placementId.length === 0) { report('invalid-binding'); continue; }
      if (placementId.length > limits.maxMetadataLength) return reject('input-limit');
      const reference = placements.get(placementId);
      if (reference === undefined) { report('unknown-placement'); continue; }
      let state = assigned.get(placementId);
      if (state === undefined) { state = { invalid: false, conflict: false }; assigned.set(placementId, state); }
      const itemIndex: unknown = binding.itemIndex;
      const evidence: unknown = binding.evidence;
      if (evidence === null || typeof evidence !== 'object') { state.invalid = true; continue; }
      const kind: unknown = (evidence as ClipboardImageBinding['evidence']).kind;
      const identifier: unknown = kind === 'host'
        ? (evidence as { readonly matcherId?: unknown }).matcherId
        : kind === 'verified-profile' ? (evidence as { readonly profileId?: unknown }).profileId : undefined;
      if (typeof kind === 'string' && kind.length > limits.maxMetadataLength) return reject('input-limit');
      if (typeof identifier === 'string' && identifier.length > limits.maxMetadataLength) return reject('input-limit');
      if (typeof identifier !== 'string' || identifier.length === 0 || !size(itemIndex) || itemIndex >= capture.items.length) {
        state.invalid = true;
        continue;
      }
      if (state.itemIndex !== undefined && state.itemIndex !== itemIndex) state.conflict = true;
      state.itemIndex = itemIndex;
    }
    const matches: ClipboardMatchedImage[] = [];
    for (const reference of placements.values()) {
      const state = assigned.get(reference.placementId);
      if (state === undefined) { report('unbound-reference', reference); continue; }
      if (state.conflict) { report('conflicting-binding', reference); continue; }
      if (state.invalid || state.itemIndex === undefined) { report('invalid-binding', reference); continue; }
      const item = capture.items[state.itemIndex];
      if (item?.file === undefined || item.file === null || item.fileType === null || item.fileSize === null) {
        report('file-unavailable', reference);
        continue;
      }
      const declared = clipboardRasterMime(item.declaredType);
      const mimeType = clipboardRasterMime(item.fileType);
      if (declared === undefined || mimeType === undefined) { report('unsupported-image-type', reference); continue; }
      if (declared !== mimeType) { report('image-type-mismatch', reference); continue; }
      if (!destination.allowedMimeTypes.includes(mimeType)) { report('unsupported-image-type', reference); continue; }
      if (item.fileSize > destination.maxFileBytes) { report('image-size-limit', reference); continue; }
      matches.push(Object.freeze({ reference, itemIndex: state.itemIndex, file: item.file, fileSize: item.fileSize, mimeType }));
    }
    return Object.freeze({ status: 'checked', matches: Object.freeze(matches), diagnostics: Object.freeze(diagnostics), diagnosticsTruncated });
  } catch { return reject('unreadable-input'); }
}
