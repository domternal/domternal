import type { Element, Properties, Root, RootContent } from 'hast';
import { toHtml } from 'hast-util-to-html';
import { normalizeClipboardHTML, DEFAULT_PASTE_HTML_LIMITS } from '../html/normalize.js';
import { safeImage } from '../html/urls.js';
import type { NormalizePasteHTMLOptions, NormalizePasteHTMLResult, PasteDiagnostic } from '../html/types.js';
import type { OfficeListReconstructionOptions } from '../html/officeLists.js';
import type { ClipboardImageReference } from './references.js';
import { readClipboardResolvedSource } from './resolverPolicy.js';
import type { ClipboardResolvedSourcePolicy } from './resolverPolicy.js';

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
  readonly references: readonly ClipboardImageReference[];
  readonly limits: PreparedClipboardHTMLLimits;
  readonly maxPixels: number;
  readonly existingPixels: number;
  readonly maxDiagnostics: number;
}
const states = new WeakMap<PreparedClipboardHTML, State>();

/** Read provisional diagnostics without exposing the retained tree or source HTML. */
export function readPreparedClipboardHTMLNormalization(handle: PreparedClipboardHTML): NormalizePasteHTMLResult | undefined {
  const state = states.get(handle);
  if (state === undefined) return undefined;
  return { ...state.result, html: '', diagnostics: state.result.diagnostics.map(diagnostic => ({ ...diagnostic })) };
}

export type ClipboardHTMLPreparationResult =
  | { readonly status: 'rejected'; readonly normalization: NormalizePasteHTMLResult }
  | {
      readonly status: 'prepared';
      readonly handle: PreparedClipboardHTML;
      readonly references: readonly ClipboardImageReference[];
      readonly preserveOrderedListStart: boolean;
      readonly existingImagePixels: number;
      readonly hasRemovedImages: boolean;
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

/** Sanitize once into an opaque, DOM-free tree. HTML attributes cannot create owned slots. */
export function prepareClipboardHTML(
  html: string,
  inputLimits: PreparedClipboardHTMLLimits,
  options: NormalizePasteHTMLOptions = {},
  capabilities?: () => Pick<OfficeListReconstructionOptions, 'orderedLists' | 'bulletLists' | 'nestedLists'>,
): ClipboardHTMLPreparationResult {
  const limits = validateLimits(inputLimits);
  const normalizationOptions = { ...options, ...(options.limits === undefined ? {} : { limits: { ...options.limits } }) };
  const references: ClipboardImageReference[] = [];
  let tree: Root | undefined;
  let existingPixels = 0;
  let hasRemovedImages = false;
  const normalized = normalizeClipboardHTML(html, normalizationOptions, capabilities, {
    reserveImage(node, original) {
      if (references.length >= limits.maxReferences) return undefined;
      const placement = reference(node, original, `image:${String(references.length + 1)}`, limits);
      if (placement === undefined) return undefined;
      references.push(placement);
      return placement.placementId;
    },
    removedImage() { hasRemovedImages = true; },
    retainTree(value, pixels) { tree = value; existingPixels = pixels; },
  });
  if (normalized.result.status === 'rejected' || tree === undefined) return Object.freeze({ status: 'rejected', normalization: normalized.result });
  const handle = Object.freeze(Object.create(null)) as PreparedClipboardHTML;
  const frozenReferences = Object.freeze(references);
  states.set(handle, { tree, result: normalized.result, references: frozenReferences, limits,
    maxPixels: normalizationOptions.limits?.maxImagePixels ?? DEFAULT_PASTE_HTML_LIMITS.maxImagePixels,
    maxDiagnostics: normalizationOptions.limits?.maxDiagnostics ?? DEFAULT_PASTE_HTML_LIMITS.maxDiagnostics, existingPixels });
  return Object.freeze({ status: 'prepared', handle, references: frozenReferences,
    preserveOrderedListStart: normalized.preserveOrderedListStart, existingImagePixels: existingPixels, hasRemovedImages });
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
    if (!Number.isSafeInteger(resolvedImages.size) || resolvedImages.size < 0 || resolvedImages.size > state.references.length) {
      return Object.freeze({ status: 'rejected', reason: 'invalid-resolution' });
    }
    const urls = new Map<string, string>();
    let pixels = state.existingPixels;
    let urlUnits = 0;
    for (const placement of state.references) {
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
    for (const placement of state.references) {
      if (!omitted.has(placement.placementId)) continue;
      if (diagnostics.length >= state.maxDiagnostics) { diagnosticsTruncated = true; continue; }
      diagnostics.push({ code: 'image-removed', severity: 'warning', ...(placement.sourceOffset === undefined ? {} : { offset: placement.sourceOffset }) });
    }
    return Object.freeze({ status: 'materialized', normalization: { ...state.result, html, diagnostics, diagnosticsTruncated } });
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
