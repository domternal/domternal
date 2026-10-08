import type { Element, Properties, Root, RootContent } from 'hast';
import { toHtml } from 'hast-util-to-html';
import { normalizeClipboardHTML, DEFAULT_PASTE_HTML_LIMITS, retainDiagnostic } from '../html/normalize.js';
import type { ClipboardDestinationCheck, ClipboardOwnCopyCheck } from '../html/normalize.js';
import { safeImage } from '../html/urls.js';
import { copyHeadingOutline } from '../html/headingLevels.js';
import type { NormalizePasteHTMLOptions, NormalizePasteHTMLResult, PasteDiagnostic } from '../html/types.js';
import type { OfficeListReconstructionOptions } from '../html/officeLists.js';
import type { ClipboardImageReference } from './references.js';
import { readClipboardResolvedSource } from './resolverPolicy.js';
import type { ClipboardResolvedSourcePolicy } from './resolverPolicy.js';
import { qualifyClipboardInlineData } from './inlineData.js';
import type { ClipboardInlineDataResult, ClipboardInlineDataResource } from './inlineData.js';
import type { ClipboardEmbeddedPlacement, ClipboardInlineAssetBatch } from './localAssets.js';
import type { ClipboardImageDestination, ClipboardRasterMime } from './destination.js';
import { clipboardRasterMime } from './destination.js';
import { resolveClipboardAssetLimits } from './limits.js';
import type { ClipboardAssetLimits } from './limits.js';

const SLOT = 'domternalClipboardImageSlot';
const MAX_PREPARED_UNITS = 32 * 1024 * 1024;

export interface PreparedClipboardHTMLLimits {
  readonly maxReferences: number;
  readonly maxReferenceLength: number;
  readonly maxDescriptionLength: number;
  readonly maxOutputUnits: number;
}

declare const preparedBrand: unique symbol;
export interface PreparedClipboardHTML { readonly [preparedBrand]: true }
interface State {
  readonly tree: Root;
  readonly result: NormalizePasteHTMLResult;
  readonly slots: readonly ImageSlot[];
  readonly limits: PreparedClipboardHTMLLimits;
  readonly maxPixels: number;
  readonly existingPixels: number;
  readonly maxDiagnostics: number;
}
interface ImageSlot { readonly placementId: string; readonly sourceOffset?: number }
const states = new WeakMap<PreparedClipboardHTML, State>();

/** Private resolver authorization. Source policy remains independent of destination embedding. */
export interface ClipboardInlineHTMLPreparation {
  readonly destination: Pick<ClipboardImageDestination, 'allowedMimeTypes' | 'maxFileBytes'>;
  readonly assetLimits: ClipboardAssetLimits;
  readonly sourceAllowDataImages: boolean;
}

/** Read provisional diagnostics without exposing the retained tree or source HTML. */
export function readPreparedClipboardHTMLNormalization(handle: PreparedClipboardHTML): NormalizePasteHTMLResult | undefined {
  const state = states.get(handle);
  if (state === undefined) return undefined;
  const normalization = { ...state.result, html: '', diagnostics: state.result.diagnostics.map(diagnostic => ({ ...diagnostic })) };
  copyHeadingOutline(state.result, normalization);
  return normalization;
}

export type ClipboardHTMLPreparationResult =
  | { readonly status: 'rejected'; readonly normalization: NormalizePasteHTMLResult;
      readonly destinationRejected?: true;
      readonly assetReason?: 'asset-limit' | 'assets-unavailable' }
  | {
      readonly status: 'prepared';
      readonly handle: PreparedClipboardHTML;
      readonly references: readonly ClipboardImageReference[];
      readonly preserveOrderedListStart: boolean;
      readonly existingImagePixels: number;
      readonly hasRemovedImages: boolean;
      readonly inlineAssets: ClipboardInlineAssetBatch;
    };

function validateLimits(input: PreparedClipboardHTMLLimits): PreparedClipboardHTMLLimits {
  const limits = { maxReferences: input.maxReferences, maxReferenceLength: input.maxReferenceLength,
    maxDescriptionLength: input.maxDescriptionLength, maxOutputUnits: input.maxOutputUnits };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PREPARED_UNITS) throw new RangeError(`Invalid prepared HTML limit: ${name}`);
  }
  if (limits.maxReferences > 200 || limits.maxReferenceLength > 2_000_000 || limits.maxDescriptionLength > 2_000_000) {
    throw new RangeError('Invalid prepared HTML reference limits');
  }
  return Object.freeze(limits);
}

function recoverableReference(value: unknown, maximum: number): value is string {
  if (typeof value !== 'string' || !value || value.length > maximum) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 32 || code === 127) return false;
  }
  if (/^(?:cid|file|blob):/iu.test(value)) return true;
  return !/^[a-z][a-z0-9+.-]*:/iu.test(value) && !value.startsWith('//') && !value.startsWith('#');
}

function reference(node: Element, original: Properties, placementId: string, limits: PreparedClipboardHTMLLimits): ClipboardImageReference | undefined {
  if (!recoverableReference(original.src, limits.maxReferenceLength)) return undefined;
  if (typeof original.alt === 'string' && original.alt.length > limits.maxDescriptionLength) return undefined;
  const offset = node.position?.start.offset;
  const width = Number(original.width);
  const height = Number(original.height);
  return Object.freeze({
    placementId, rawReference: original.src,
    ...(offset === undefined ? {} : { sourceOffset: offset }),
    ...(typeof original.alt === 'string' ? { alt: original.alt } : {}),
    ...(Number.isSafeInteger(width) && width > 0 && width <= 10_000 ? { width } : {}),
    ...(Number.isSafeInteger(height) && height > 0 && height <= 10_000 ? { height } : {}),
  });
}

function inlineDestination(input: ClipboardInlineHTMLPreparation['destination']): ClipboardInlineHTMLPreparation['destination'] | undefined {
  try {
    const maxFileBytes: unknown = input.maxFileBytes;
    const raw: unknown = input.allowedMimeTypes;
    if (typeof maxFileBytes !== 'number' || !Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1 || !Array.isArray(raw)) return undefined;
    const count = raw.length;
    if (count > 4) return undefined;
    const allowedMimeTypes: ClipboardRasterMime[] = [];
    for (let index = 0; index < count; index++) {
      const value: unknown = raw[index];
      const mime = typeof value === 'string' ? clipboardRasterMime(value) : undefined;
      if (mime === undefined) return undefined;
      allowedMimeTypes.push(mime);
    }
    return Object.freeze({ maxFileBytes, allowedMimeTypes: Object.freeze(allowedMimeTypes) });
  } catch { return undefined; }
}

/** Sanitize once into an opaque, DOM-free tree. HTML attributes cannot create owned slots. */
export function prepareClipboardHTML(
  html: string,
  inputLimits: PreparedClipboardHTMLLimits,
  options: NormalizePasteHTMLOptions = {},
  capabilities?: () => Pick<OfficeListReconstructionOptions, 'orderedLists' | 'bulletLists' | 'nestedLists' | 'markers'>,
  inline?: ClipboardInlineHTMLPreparation,
  destinationCheck?: ClipboardDestinationCheck,
  ownCopy?: ClipboardOwnCopyCheck,
): ClipboardHTMLPreparationResult {
  const limits = validateLimits(inputLimits);
  const normalizationOptions = { ...options, ...(options.limits === undefined ? {} : { limits: { ...options.limits } }),
    ...(inline === undefined ? {} : { allowDataImages: false }) };
  const sourceAllowDataImages = inline?.sourceAllowDataImages;
  if (inline !== undefined && typeof sourceAllowDataImages !== 'boolean') throw new RangeError('Invalid inline source image policy');
  const assetLimits = inline === undefined ? undefined : resolveClipboardAssetLimits(inline.assetLimits);
  const destination = inline === undefined ? undefined : inlineDestination(inline.destination);
  const references: ClipboardImageReference[] = [];
  const slots: ImageSlot[] = [];
  const resources: ClipboardInlineDataResource[] = [];
  const placements: ClipboardEmbeddedPlacement[] = [];
  const inlineCache = new Map<string, ClipboardInlineDataResult>();
  const resourceIndexes = new Map<ClipboardInlineDataResource, number>();
  let readBytes = 0;
  let pixelCount = 0;
  let assetReason: 'asset-limit' | 'assets-unavailable' | undefined;
  const maxPixels = normalizationOptions.limits?.maxImagePixels ?? DEFAULT_PASTE_HTML_LIMITS.maxImagePixels;
  let tree: Root | undefined;
  let existingPixels = 0;
  let hasRemovedImages = false;
  const normalized = normalizeClipboardHTML(html, normalizationOptions, capabilities, {
    reserveImage(node, original) {
      if (assetReason !== undefined) return undefined;
      const placementId = `image:${String(slots.length + 1)}`;
      if (sourceAllowDataImages === true && typeof original.src === 'string' && /^data:/i.test(original.src)) {
        if (slots.length >= limits.maxReferences) { assetReason = 'asset-limit'; return undefined; }
        if (destination === undefined || assetLimits === undefined) { assetReason = 'assets-unavailable'; return undefined; }
        if (typeof original.alt === 'string' && original.alt.length > limits.maxDescriptionLength) return undefined;
        let qualified = inlineCache.get(original.src);
        if (qualified === undefined) {
          qualified = qualifyClipboardInlineData(original.src, destination, {
            maxInputUnits: normalizationOptions.limits?.maxInputLength ?? DEFAULT_PASTE_HTML_LIMITS.maxInputLength,
            maxResourceBytes: assetLimits.maxFileBytes,
            remainingResourceBytes: assetLimits.maxTotalFileBytes - readBytes,
            remainingPixels: maxPixels - pixelCount, placements: 1,
          });
          inlineCache.set(original.src, qualified);
        }
        if (qualified.status !== 'qualified') {
          if (qualified.status === 'cancelled' || !['invalid-data-url', 'invalid-raster'].includes(qualified.reason)) {
            assetReason = qualified.status === 'rejected' && ['input-limit', 'image-size-limit', 'pixel-limit'].includes(qualified.reason)
              ? 'asset-limit' : 'assets-unavailable';
          }
          return undefined;
        }
        const resource = qualified.resource;
        if (resource.pixels > maxPixels - pixelCount) { assetReason = 'asset-limit'; return undefined; }
        let resourceIndex = resourceIndexes.get(resource);
        if (resourceIndex === undefined) {
          resourceIndex = resources.length;
          resources.push(resource);
          resourceIndexes.set(resource, resourceIndex);
          readBytes += qualified.chargedBytes;
        }
        pixelCount += resource.pixels;
        const offset = node.position?.start.offset;
        const width = Number(original.width);
        const height = Number(original.height);
        const placement = Object.freeze({ placementId, resourceIndex,
          ...(offset === undefined ? {} : { sourceOffset: offset }),
          ...(typeof original.alt === 'string' ? { alt: original.alt } : {}),
          ...(Number.isSafeInteger(width) && width > 0 && width <= 10_000 ? { width } : {}),
          ...(Number.isSafeInteger(height) && height > 0 && height <= 10_000 ? { height } : {}),
        });
        placements.push(placement);
        slots.push(Object.freeze({ placementId, ...(offset === undefined ? {} : { sourceOffset: offset }) }));
        return placementId;
      }
      if (slots.length >= limits.maxReferences) return undefined;
      const placement = reference(node, original, placementId, limits);
      if (placement === undefined) return undefined;
      references.push(placement);
      slots.push(Object.freeze({ placementId, ...(placement.sourceOffset === undefined ? {} : { sourceOffset: placement.sourceOffset }) }));
      return placement.placementId;
    },
    removedImage() { hasRemovedImages = true; },
    retainTree(value, pixels) { tree = value; existingPixels = pixels; },
  }, destinationCheck, ownCopy);
  if (normalized.destinationRejected) return Object.freeze({ status: 'rejected', destinationRejected: true, normalization: normalized.result });
  if (assetReason !== undefined) return Object.freeze({ status: 'rejected', assetReason,
    normalization: { ...normalized.result, status: 'rejected' as const, html: '' } });
  if (normalized.result.status === 'rejected' || tree === undefined) return Object.freeze({ status: 'rejected', normalization: normalized.result });
  const handle = Object.freeze(Object.create(null)) as PreparedClipboardHTML;
  const frozenReferences = Object.freeze(references);
  states.set(handle, { tree, result: normalized.result, slots: Object.freeze(slots), limits,
    maxPixels,
    maxDiagnostics: normalizationOptions.limits?.maxDiagnostics ?? DEFAULT_PASTE_HTML_LIMITS.maxDiagnostics, existingPixels });
  return Object.freeze({ status: 'prepared', handle, references: frozenReferences,
    preserveOrderedListStart: normalized.preserveOrderedListStart, existingImagePixels: existingPixels, hasRemovedImages,
    inlineAssets: Object.freeze({ resources: Object.freeze(resources), placements: Object.freeze(placements), readBytes, pixelCount }) });
}

class PreparedOutputLimit extends Error {}

/** Conservative escaped serialization bound, checked before the serializer allocates output. */
function boundSerialization(tree: Root, maximum: number): void {
  let units = 0;
  const add = (count: number): void => {
    if (!Number.isSafeInteger(count) || count > maximum - units) throw new PreparedOutputLimit();
    units += count;
  };
  const escaped = (value: string): void => {
    // The serializer uses quoted attributes and escapes a subset of these ASCII characters.
    // Six units cover its numeric/named entities; other UTF-16 units remain unchanged.
    for (let index = 0; index < value.length; index++) add('&<>"\'`=\t\n\r\f'.includes(value.charAt(index)) ? 6 : 1);
  };
  const pending: (Root | RootContent)[] = [tree];
  while (pending.length) {
    const node = pending.pop();
    if (node?.type === 'text') escaped(node.value);
    else if (node?.type === 'element') {
      add(node.tagName.length * 2 + 5);
      for (const [name, value] of Object.entries(node.properties)) {
        add(name.length * 2 + 64);
        if (typeof value === 'string') escaped(value);
        else if (Array.isArray(value)) for (const item of value) { escaped(String(item)); add(6); }
        else if (value !== null && value !== undefined) escaped(String(value));
      }
      pending.push(...node.children);
    } else if (node?.type === 'root') pending.push(...node.children);
  }
}

export type ClipboardHTMLMaterialization =
  | { readonly status: 'materialized'; readonly normalization: NormalizePasteHTMLResult }
  | { readonly status: 'rejected'; readonly reason: 'expired-preparation' | 'missing-image' | 'invalid-image' | 'output-limit' | 'invalid-resolution' };

type MaterializationRejection = Extract<ClipboardHTMLMaterialization, { status: 'rejected' }>;
interface ValidatedImage {
  readonly status: 'valid';
  readonly src: string;
  readonly pixels: number;
  readonly urlUnits: number;
}

/** Consume the handle once. A missing resource rejects unless the caller explicitly accepts omissions. */
function materializeImages(
  handle: PreparedClipboardHTML,
  resolvedImages: ReadonlyMap<string, unknown>,
  options: { readonly omitUnresolved?: boolean },
  validateImage: (value: unknown, remainingUnits: number, remainingPixels: number) => ValidatedImage | MaterializationRejection,
): ClipboardHTMLMaterialization {
  const state = states.get(handle);
  if (state === undefined) return Object.freeze({ status: 'rejected', reason: 'expired-preparation' });
  states.delete(handle);
  try {
    if (!Number.isSafeInteger(resolvedImages.size) || resolvedImages.size < 0 || resolvedImages.size > state.slots.length) {
      return Object.freeze({ status: 'rejected', reason: 'invalid-resolution' });
    }
    const urls = new Map<string, string>();
    let pixels = state.existingPixels;
    let urlUnits = 0;
    for (const placement of state.slots) {
      const value = resolvedImages.get(placement.placementId);
      if (value === undefined) {
        if (options.omitUnresolved !== true) return Object.freeze({ status: 'rejected', reason: 'missing-image' });
        continue;
      }
      const image = validateImage(value, state.limits.maxOutputUnits - urlUnits, state.maxPixels - pixels);
      if (image.status === 'rejected') return image;
      urlUnits += image.urlUnits;
      pixels += image.pixels;
      urls.set(placement.placementId, image.src);
    }
    if (urls.size !== resolvedImages.size) return Object.freeze({ status: 'rejected', reason: 'invalid-resolution' });
    const omitted = new Set<string>();
    const resolveChildren = (parent: Root | Element): void => {
      const children: RootContent[] = [];
      for (const node of parent.children) {
        if (node.type !== 'element') { children.push(node); continue; }
        const slot: unknown = node.data === undefined ? undefined : Reflect.get(node.data, SLOT);
        if (typeof slot === 'string') {
          const url = urls.get(slot);
          if (url === undefined) {
            omitted.add(slot);
            if (typeof node.properties.alt === 'string') children.push({ type: 'text', value: node.properties.alt });
            continue;
          }
          node.properties.src = url;
          if (node.data !== undefined) Reflect.deleteProperty(node.data, SLOT);
        }
        resolveChildren(node);
        children.push(node);
      }
      parent.children = children;
    };
    resolveChildren(state.tree);
    boundSerialization(state.tree, state.limits.maxOutputUnits);
    const html = toHtml(state.tree);
    if (html.length > state.limits.maxOutputUnits) throw new PreparedOutputLimit();
    const diagnostics: PasteDiagnostic[] = [...state.result.diagnostics];
    let diagnosticsTruncated = state.result.diagnosticsTruncated;
    for (const placement of state.slots) {
      if (!omitted.has(placement.placementId)) continue;
      const removed: PasteDiagnostic = { code: 'image-removed', severity: 'warning', ...(placement.sourceOffset === undefined ? {} : { offset: placement.sourceOffset }) };
      if (retainDiagnostic(diagnostics, removed, state.maxDiagnostics)) diagnosticsTruncated = true;
    }
    const normalization = { ...state.result, html, diagnostics, diagnosticsTruncated };
    copyHeadingOutline(state.result, normalization);
    return Object.freeze({ status: 'materialized', normalization });
  } catch (error) {
    return Object.freeze({ status: 'rejected', reason: error instanceof PreparedOutputLimit ? 'output-limit' : 'invalid-resolution' });
  }
}

/** Consume local embedded replacements once, keeping their policy separate from source HTML. */
export function materializeClipboardHTML(
  handle: PreparedClipboardHTML,
  resolvedImages: ReadonlyMap<string, string>,
  options: { readonly omitUnresolved?: boolean } = {},
): ClipboardHTMLMaterialization {
  return materializeImages(handle, resolvedImages, options, (value, remainingUnits, remainingPixels) => {
    if (typeof value !== 'string' || value.length > remainingUnits) return Object.freeze({ status: 'rejected', reason: 'output-limit' });
    let pixels = 0;
    const safe = safeImage(value, false, true, count => {
      if (count > remainingPixels - pixels) return false;
      pixels += count;
      return true;
    });
    return safe === undefined ? Object.freeze({ status: 'rejected', reason: 'invalid-image' })
      : { status: 'valid', src: safe, pixels, urlUnits: value.length };
  });
}

export interface ClipboardResolvedImagePlacement {
  readonly src: string;
  /** Positive header-derived pixels from the same immutable Blob handed to the resolver. */
  readonly pixels: number;
}

/**
 * Consume only owned slots with explicitly approved durable resolver outputs. The caller
 * owns the placement-to-Blob association and must retain its resolver ownership operation.
 * This does not enable remote images from source HTML or prove remote byte immutability.
 */
export function materializeResolvedClipboardHTML(
  handle: PreparedClipboardHTML,
  resolvedImages: ReadonlyMap<string, ClipboardResolvedImagePlacement>,
  policy: ClipboardResolvedSourcePolicy,
  options: { readonly omitUnresolved?: boolean } = {},
): ClipboardHTMLMaterialization {
  return materializeImages(handle, resolvedImages, options, (value, remainingUnits, remainingPixels) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return Object.freeze({ status: 'rejected', reason: 'invalid-image' });
    const candidate = value as Record<string, unknown>;
    const src = candidate['src'];
    const pixels = candidate['pixels'];
    if (typeof src !== 'string' || src.length > remainingUnits) return Object.freeze({ status: 'rejected', reason: 'output-limit' });
    if (typeof pixels !== 'number' || !Number.isSafeInteger(pixels) || pixels < 1 || pixels > remainingPixels) {
      return Object.freeze({ status: 'rejected', reason: 'invalid-image' });
    }
    const safe = readClipboardResolvedSource(policy, src);
    if (safe === undefined || safe !== src) return Object.freeze({ status: 'rejected', reason: 'invalid-image' });
    return { status: 'valid', src: safe, pixels, urlUnits: src.length };
  });
}

/** Release a preparation that will not be applied. It owns no File, object URL or remote resource. */
export function discardPreparedClipboardHTML(handle: PreparedClipboardHTML): void { states.delete(handle); }
