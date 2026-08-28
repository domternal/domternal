import { boundedRaster } from '../html/raster.js';
import { clipboardRasterMime } from './destination.js';
import type { ClipboardImageDestination, ClipboardRasterMime } from './destination.js';
import type { ClipboardMatchedImage } from './references.js';

export interface ClipboardEmbeddedAssetLimits {
  readonly maxPlacements: number;
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxTotalFileBytes: number;
  readonly maxTotalPixels: number;
  /** UTF-16 units of data URLs, charged once per placement. Excludes all HTML serialization. */
  readonly maxPreparedUrlUnits: number;
  readonly maxMetadataLength: number;
  readonly maxDescriptionLength: number;
  readonly maxDimension: number;
}

export interface ClipboardEmbeddedAssetOptions {
  readonly signal: AbortSignal;
  /** Trusted realm/test adapter. Returned buffers are inspected without mutation or ownership transfer. */
  readonly readFile?: (file: File, signal: AbortSignal) => Promise<unknown>;
}

export interface ClipboardEmbeddedResource {
  readonly dataUrl: string;
  readonly mimeType: ClipboardRasterMime;
  readonly byteLength: number;
  /** Header-derived pixel allocation estimate, not a decoder validation result. */
  readonly pixels: number;
}

/** Private resolver input preparation. It does not authorize an upload or a destination URL. */
export type ClipboardBlobAssetLimits = Omit<ClipboardEmbeddedAssetLimits, 'maxPreparedUrlUnits'>;
export interface ClipboardBlobResource {
  readonly blob: Blob;
  readonly mimeType: ClipboardRasterMime;
  readonly byteLength: number;
  /** Header-derived allocation estimate, not full codec validation. */
  readonly pixels: number;
}

export interface ClipboardEmbeddedPlacement {
  readonly placementId: string;
  readonly resourceIndex: number;
  readonly sourceOffset?: number;
  readonly alt?: string;
  readonly width?: number;
  readonly height?: number;
}

export type ClipboardEmbeddedRejection =
  | 'input-limit' | 'invalid-metadata' | 'unreadable-input' | 'embedding-disabled'
  | 'unsupported-image-type' | 'image-size-limit' | 'read-failed' | 'invalid-buffer'
  | 'size-mismatch' | 'invalid-raster' | 'pixel-limit' | 'encoding-failed';

interface Rejected { readonly status: 'rejected'; readonly reason: ClipboardEmbeddedRejection; readonly placementId?: string }
interface Cancelled { readonly status: 'cancelled' }
type ClipboardLocalAssetResult<Resource> =
  | Rejected | Cancelled
  | {
      readonly status: 'prepared';
      readonly resources: readonly Resource[];
      readonly placements: readonly ClipboardEmbeddedPlacement[];
      /** Bytes read from distinct File objects, including identical content in different Files. */
      readonly readBytes: number;
      /** Sum of URL lengths for all placements, including repeated resource placements. */
      readonly preparedUrlUnits: number;
      readonly pixelCount: number;
    };

export type ClipboardEmbeddedAssetResult = ClipboardLocalAssetResult<ClipboardEmbeddedResource>;
export type ClipboardBlobAssetResult = Rejected | Cancelled | (
  Omit<Extract<ClipboardLocalAssetResult<ClipboardBlobResource>, { status: 'prepared' }>, 'preparedUrlUnits'>
);

interface FilePlan {
  readonly fileSize: number;
  readonly mimeType: ClipboardRasterMime;
  readonly prefix: string;
  readonly urlUnits: number;
  readonly firstPlacementId: string;
  readonly read: () => Promise<unknown>;
  placementCount: number;
}
interface PlacementPlan extends Omit<ClipboardEmbeddedPlacement, 'resourceIndex'> { readonly fileIndex: number }
interface ReadControl {
  readonly signal: AbortSignal;
  readonly aborted: () => boolean;
  readonly add: (listener: () => void) => void;
  readonly remove: (listener: () => void) => void;
}
interface PreparationPlan {
  readonly status: 'ready';
  readonly files: readonly FilePlan[];
  readonly placements: readonly PlacementPlan[];
  readonly readBytes: number;
  readonly preparedUrlUnits: number;
}

const CANCELLED: Cancelled = Object.freeze({ status: 'cancelled' });
// The intrinsic getter is deliberately called with the candidate buffer as its receiver.
// eslint-disable-next-line @typescript-eslint/unbound-method
const BUFFER_LENGTH = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')?.get as ((this: unknown) => number) | undefined;

function reject(reason: ClipboardEmbeddedRejection, placementId?: string): Rejected {
  return Object.freeze({ status: 'rejected', reason, ...(placementId === undefined ? {} : { placementId }) });
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isArray(value: unknown): boolean { return Array.isArray(value); }

function validatedLimits(input: ClipboardEmbeddedAssetLimits): ClipboardEmbeddedAssetLimits {
  const limits = {
    maxPlacements: input.maxPlacements, maxFiles: input.maxFiles, maxFileBytes: input.maxFileBytes,
    maxTotalFileBytes: input.maxTotalFileBytes, maxTotalPixels: input.maxTotalPixels,
    maxPreparedUrlUnits: input.maxPreparedUrlUnits, maxMetadataLength: input.maxMetadataLength,
    maxDescriptionLength: input.maxDescriptionLength, maxDimension: input.maxDimension,
  };
  for (const [key, value] of Object.entries(limits)) {
    if (!integer(value) || value === 0) throw new RangeError(`Invalid clipboard embedded asset limit: ${key}`);
  }
  return Object.freeze(limits);
}

function readControl(signal: AbortSignal): ReadControl {
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  return {
    signal,
    aborted: () => {
      const value: unknown = signal.aborted;
      if (typeof value !== 'boolean') throw new TypeError('Invalid clipboard abort signal');
      return value;
    },
    add: listener => { add('abort', listener, { once: true }); },
    remove: listener => { remove('abort', listener); },
  };
}

/** Snapshot every consumed field and all work budgets before the first asynchronous read. */
function makePlan(
  matches: readonly ClipboardMatchedImage[],
  destination: ClipboardImageDestination,
  limits: ClipboardEmbeddedAssetLimits,
  control: ReadControl,
  readFile: ClipboardEmbeddedAssetOptions['readFile'],
  embedded: boolean,
): PreparationPlan | Rejected {
  const allowEmbedded: unknown = destination.allowEmbedded;
  const maximumFileSize: unknown = destination.maxFileBytes;
  const rawMimeTypes: unknown = destination.allowedMimeTypes;
  if (typeof allowEmbedded !== 'boolean' || !integer(maximumFileSize) || !Array.isArray(rawMimeTypes)) return reject('invalid-metadata');
  if (embedded && !allowEmbedded) return reject('embedding-disabled');
  const mimeCount = rawMimeTypes.length;
  if (!integer(mimeCount) || mimeCount > 4) return reject('invalid-metadata');
  const allowed = new Set<ClipboardRasterMime>();
  for (let index = 0; index < mimeCount; index++) {
    const value: unknown = rawMimeTypes[index];
    if (typeof value !== 'string') return reject('invalid-metadata');
    const mime = clipboardRasterMime(value);
    if (mime === undefined) return reject('invalid-metadata');
    allowed.add(mime);
  }
  if (!isArray(matches)) return reject('invalid-metadata');
  const count = matches.length;
  if (!integer(count)) return reject('invalid-metadata');
  if (count > limits.maxPlacements) return reject('input-limit');
  const files: FilePlan[] = [];
  const placements: PlacementPlan[] = [];
  const fileIndexes = new Map<File, number>();
  const items = new Map<number, File>();
  const placementIds = new Set<string>();
  let readBytes = 0;
  let preparedUrlUnits = 0;
  for (let index = 0; index < count; index++) {
    const match = matches[index];
    if (match === undefined) return reject('invalid-metadata');
    const reference = match.reference;
    const placementId: unknown = reference.placementId;
    const sourceOffset: unknown = reference.sourceOffset;
    const alt: unknown = reference.alt;
    const width: unknown = reference.width;
    const height: unknown = reference.height;
    const file: unknown = match.file;
    const fileSize: unknown = match.fileSize;
    const mimeValue: unknown = match.mimeType;
    const itemIndex: unknown = match.itemIndex;
    if (typeof placementId !== 'string' || placementId.length === 0) return reject('invalid-metadata');
    if (placementId.length > limits.maxMetadataLength) return reject('input-limit');
    if (placementIds.has(placementId) || !integer(itemIndex) || !integer(fileSize) || fileSize === 0
      || file === null || typeof file !== 'object' || typeof mimeValue !== 'string'
      || (sourceOffset !== undefined && !integer(sourceOffset))
      || (alt !== undefined && typeof alt !== 'string')) return reject('invalid-metadata', placementId);
    if (typeof alt === 'string' && alt.length > limits.maxDescriptionLength) return reject('input-limit', placementId);
    for (const dimension of [width, height]) {
      if (dimension !== undefined && (typeof dimension !== 'number' || !Number.isFinite(dimension) || dimension <= 0)) return reject('invalid-metadata', placementId);
      if (typeof dimension === 'number' && dimension > limits.maxDimension) return reject('input-limit', placementId);
    }
    const mimeType = clipboardRasterMime(mimeValue);
    if (mimeType === undefined || !allowed.has(mimeType)) return reject('unsupported-image-type', placementId);
    if (fileSize > limits.maxFileBytes || fileSize > maximumFileSize) return reject('image-size-limit', placementId);
    const prefix = `data:${mimeType};base64,`;
    const base64Units = embedded ? 4 * Math.ceil(fileSize / 3) : 0;
    const urlUnits = embedded ? base64Units + prefix.length : 0;
    if (embedded && (!Number.isSafeInteger(base64Units) || base64Units > limits.maxPreparedUrlUnits - prefix.length
      || urlUnits > limits.maxPreparedUrlUnits - preparedUrlUnits)) return reject('input-limit', placementId);
    preparedUrlUnits += urlUnits;
    const capturedFile = file as File;
    const previousItem = items.get(itemIndex);
    if (previousItem !== undefined && previousItem !== capturedFile) return reject('invalid-metadata', placementId);
    items.set(itemIndex, capturedFile);
    let fileIndex = fileIndexes.get(capturedFile);
    if (fileIndex === undefined) {
      if (files.length >= limits.maxFiles || fileSize > limits.maxTotalFileBytes - readBytes) return reject('input-limit', placementId);
      let read: () => Promise<unknown>;
      if (readFile !== undefined) read = () => readFile(capturedFile, control.signal);
      else read = capturedFile.arrayBuffer.bind(capturedFile);
      fileIndex = files.length;
      fileIndexes.set(capturedFile, fileIndex);
      files.push({ fileSize, mimeType, prefix, urlUnits, firstPlacementId: placementId, read, placementCount: 1 });
      readBytes += fileSize;
    } else {
      const existing = files[fileIndex];
      if (existing?.fileSize !== fileSize || existing.mimeType !== mimeType) return reject('invalid-metadata', placementId);
      existing.placementCount++;
    }
    placementIds.add(placementId);
    placements.push(Object.freeze({
      placementId, fileIndex,
      ...(typeof sourceOffset === 'number' ? { sourceOffset } : {}),
      ...(typeof alt === 'string' ? { alt } : {}),
      ...(typeof width === 'number' ? { width } : {}),
      ...(typeof height === 'number' ? { height } : {}),
    }));
  }
  return { status: 'ready', files, placements, readBytes, preparedUrlUnits };
}

type ReadResult = Cancelled | { readonly status: 'read'; readonly buffer: unknown } | { readonly status: 'failed' };

/** Abort settles promptly. An uncancellable native read can finish later and is discarded. */
function readOne(plan: FilePlan, control: ReadControl): Promise<ReadResult> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (result: ReadResult): void => {
      if (settled) return;
      settled = true;
      control.remove(onAbort);
      resolve(result);
    };
    const onAbort = (): void => { finish(CANCELLED); };
    control.add(onAbort);
    if (control.aborted()) { finish(CANCELLED); return; }
    try {
      void Promise.resolve(plan.read()).then(
        buffer => { finish({ status: 'read', buffer }); },
        () => { finish({ status: 'failed' }); },
      );
    } catch { finish({ status: 'failed' }); }
  });
}

function bufferLength(value: unknown): number | undefined {
  try { return BUFFER_LENGTH?.call(value); }
  catch { return undefined; }
}

function binaryString(buffer: ArrayBuffer): string {
  const view = new Uint8Array(buffer);
  const chunks: string[] = [];
  for (let offset = 0; offset < view.length; offset += 8192) chunks.push(String.fromCharCode(...view.subarray(offset, offset + 8192)));
  return chunks.join('');
}

/**
 * Prepare local resources only; never insert editor content or create browser image resources.
 * boundedRaster inspects container headers and allocation limits, not full codec correctness.
 * URL units exclude markup, escaping, alt and geometry. The later serializer needs its own limit.
 * At most one binary read is active. The File ceiling bounds its buffer and binary string; the
 * URL ceiling bounds encoded output charged per placement. These counters are not a heap bound.
 */
async function prepareLocalAssets<Resource>(
  matches: readonly ClipboardMatchedImage[],
  destination: ClipboardImageDestination,
  inputLimits: ClipboardEmbeddedAssetLimits,
  options: ClipboardEmbeddedAssetOptions,
  embedded: boolean,
  createResource: (file: FilePlan, binary: string, pixels: number) => { readonly key: string; readonly resource: Resource } | Rejected,
): Promise<ClipboardLocalAssetResult<Resource>> {
  const limits = validatedLimits(inputLimits);
  let control: ReadControl;
  let plan: PreparationPlan | Rejected;
  try {
    control = readControl(options.signal);
    if (control.aborted()) return CANCELLED;
    const readFile = options.readFile;
    if (readFile !== undefined && typeof readFile !== 'function') return reject('unreadable-input');
    plan = makePlan(matches, destination, limits, control, readFile, embedded);
    if (control.aborted()) return CANCELLED;
  } catch { return reject('unreadable-input'); }
  if (plan.status === 'rejected') return plan;
  const resources: Resource[] = [];
  const resourceIndexes = new Map<string, number>();
  const fileResources: number[] = [];
  let pixelCount = 0;
  try {
    for (const file of plan.files) {
      if (control.aborted()) return CANCELLED;
      const read = await readOne(file, control);
      if (control.aborted() || read.status === 'cancelled') return CANCELLED;
      if (read.status === 'failed') return reject('read-failed', file.firstPlacementId);
      const length = bufferLength(read.buffer);
      if (length === undefined) return reject('invalid-buffer', file.firstPlacementId);
      if (length !== file.fileSize) return reject('size-mismatch', file.firstPlacementId);
      const binary = binaryString(read.buffer as ArrayBuffer);
      const allocation = { pixels: 0, exceeded: false };
      const valid = boundedRaster(binary, file.mimeType.slice(6), value => {
        allocation.pixels = value;
        if (value > Math.floor((limits.maxTotalPixels - pixelCount) / file.placementCount)) {
          allocation.exceeded = true;
          return false;
        }
        return true;
      });
      if (!valid || allocation.pixels === 0) return reject(allocation.exceeded ? 'pixel-limit' : 'invalid-raster', file.firstPlacementId);
      if (control.aborted()) return CANCELLED;
      const created = createResource(file, binary, allocation.pixels);
      if ('status' in created) return created;
      pixelCount += allocation.pixels * file.placementCount;
      let resourceIndex = resourceIndexes.get(created.key);
      if (resourceIndex === undefined) {
        resourceIndex = resources.length;
        resourceIndexes.set(created.key, resourceIndex);
        resources.push(created.resource);
      }
      fileResources.push(resourceIndex);
    }
    if (control.aborted()) return CANCELLED;
    const placements = plan.placements.map(({ fileIndex, ...placement }) => {
      const resourceIndex = fileResources[fileIndex];
      if (resourceIndex === undefined) throw new Error('Missing clipboard resource');
      return Object.freeze({ ...placement, resourceIndex });
    });
    return Object.freeze({
      status: 'prepared', resources: Object.freeze(resources), placements: Object.freeze(placements),
      readBytes: plan.readBytes, preparedUrlUnits: plan.preparedUrlUnits, pixelCount,
    });
  } catch { return reject('unreadable-input'); }
}

export function prepareClipboardEmbeddedAssets(
  matches: readonly ClipboardMatchedImage[],
  destination: ClipboardImageDestination,
  limits: ClipboardEmbeddedAssetLimits,
  options: ClipboardEmbeddedAssetOptions,
): Promise<ClipboardEmbeddedAssetResult> {
  return prepareLocalAssets(matches, destination, limits, options, true, (file, binary, pixels) => {
    let dataUrl: string;
    try { dataUrl = file.prefix + btoa(binary); }
    catch { return reject('encoding-failed', file.firstPlacementId); }
    if (dataUrl.length !== file.urlUnits) return reject('encoding-failed', file.firstPlacementId);
    return { key: dataUrl, resource: Object.freeze({ dataUrl, mimeType: file.mimeType, byteLength: file.fileSize, pixels }) };
  });
}

/**
 * Prepare immutable raster Blobs for an explicitly selected resolver without base64 encoding.
 * Destination MIME and byte limits still apply when embedding is disabled. URL authorization,
 * resolver ownership and serialized-output limits belong to later stages. No upload occurs here.
 */
export async function prepareClipboardBlobAssets(
  matches: readonly ClipboardMatchedImage[],
  destination: ClipboardImageDestination,
  limits: ClipboardBlobAssetLimits,
  options: ClipboardEmbeddedAssetOptions,
): Promise<ClipboardBlobAssetResult> {
  let control: ReadControl;
  let capturedOptions: ClipboardEmbeddedAssetOptions;
  try {
    const signal = options.signal;
    const readFile = options.readFile;
    control = readControl(signal);
    capturedOptions = { signal, ...(readFile === undefined ? {} : { readFile }) };
  } catch { return reject('unreadable-input'); }
  const result = await prepareLocalAssets(matches, destination, { ...limits, maxPreparedUrlUnits: 1 }, capturedOptions, false, (file, binary, pixels) => {
    // Copy the exact validated bytes; never forward the original File or an adapter-owned buffer.
    const blob = new Blob([Uint8Array.from(binary, value => value.charCodeAt(0))], { type: file.mimeType });
    return {
      key: file.mimeType + '\0' + binary,
      resource: Object.freeze({ blob, mimeType: file.mimeType, byteLength: file.fileSize, pixels }),
    };
  });
  try { if (control.aborted()) return CANCELLED; }
  catch { return reject('unreadable-input'); }
  if (result.status !== 'prepared') return result;
  return Object.freeze({ status: 'prepared', resources: result.resources, placements: result.placements, readBytes: result.readBytes, pixelCount: result.pixelCount });
}
