import { getClipboardImageDestination, getClipboardPasteAttemptEvent, pasteHasOwnText, registerClipboardHTMLPreparation } from '@domternal/core/clipboard';
import type { ClipboardHTMLDeferral, ClipboardHTMLPreparationContext, ClipboardHTMLReplay } from '@domternal/core/clipboard';
import type { Slice } from '@domternal/pm/model';
import type { EditorState, Transaction } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import { DEFAULT_PASTE_HTML_LIMITS } from '../html/normalize.js';
import type { NormalizePasteHTMLOptions, NormalizePasteHTMLResult } from '../html/types.js';
import { officeListCapabilities } from '../listCapabilities.js';
import { isOwnCopyNonce } from './ownCopy.js';
import { claimClipboardSlot } from './ownership.js';
import { getUnsupportedDestinationFeatures } from '../destinationCapabilities.js';
import { pasteCleanupKey, pasteDocumentRevision } from '../operations.js';
import type { PasteOperationRejectionReason } from '../operations.js';
import type { createPasteTracking, PendingPasteOperation } from '../tracking.js';
import { captureClipboard } from './capture.js';
import type { ClipboardCaptureLimits, ClipboardCaptureResult, ClipboardSnapshot } from './capture.js';
import { createClipboardImageDestination, sameClipboardImageDestination } from './destination.js';
import type { ClipboardImageDestination } from './destination.js';
import { resolveClipboardAssetLimits } from './limits.js';
import type { ClipboardAssetLimits } from './limits.js';
import { prepareClipboardBlobAssets, prepareClipboardEmbeddedAssets } from './localAssets.js';
import type { ClipboardEmbeddedRejection } from './localAssets.js';
import { discardPreparedClipboardHTML, materializeClipboardHTML, materializeResolvedClipboardHTML, prepareClipboardHTML, readPreparedClipboardHTMLNormalization } from './preparedHTML.js';
import type { ClipboardHTMLPreparationResult } from './preparedHTML.js';
import { resolveClipboardImageBindings } from './references.js';
import type { ClipboardImageBinding, ClipboardImageReference, ClipboardReferenceLimits } from './references.js';
import { createClipboardResolverOperation } from './resolverLifecycle.js';
import { createClipboardResolvedSourcePolicy, readClipboardResolvedSource } from './resolverPolicy.js';
import type { ClipboardResolvedSourcePolicy } from './resolverPolicy.js';
import type { ClipboardResolverAdapter, ClipboardResolverOperation, ClipboardResolverReleaseRequest, ClipboardResolverRequest } from './resolverTypes.js';
import { createClipboardSessionController } from './session.js';
import type { ClipboardSession, ClipboardSessionCancellation } from './session.js';
import type { ClipboardAssetRecoveryReport, ClipboardImageAssetOptions, ClipboardImageMatchContext, ClipboardResolvedImageAssetOptions, PastePreparationProgress } from './types.js';

interface ResolvedImageAssets {
  readonly mode: 'embedded' | 'resolver';
  readonly match: ClipboardImageAssetOptions['match'];
  readonly unresolved: 'reject' | 'omit';
  readonly limits: Readonly<ClipboardAssetLimits>;
  readonly persistent?: {
    readonly adapter: ClipboardResolverAdapter;
    readonly policy: ClipboardResolvedSourcePolicy;
    readonly onRecovery: (report: ClipboardAssetRecoveryReport) => void;
  };
}

/** Resolve configuration before installing any event handler or reading the clipboard. */
export function resolveClipboardImageAssets(input: unknown): ResolvedImageAssets | undefined {
  if (input === undefined || input === false) return undefined;
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new RangeError('Invalid clipboard image asset options');
  for (const key of Reflect.ownKeys(input)) {
    if (!['mode', 'match', 'unresolved', 'limits', 'resolver', 'sourcePolicy', 'onRecovery'].includes(String(key))) throw new RangeError('Unknown clipboard image asset option');
  }
  const options = input as ClipboardImageAssetOptions;
  const mode: unknown = options.mode;
  const match = options.match;
  const unresolved = options.unresolved ?? 'reject';
  const limits = resolveClipboardAssetLimits(options.limits);
  if ((mode !== 'embedded' && mode !== 'resolver') || (match !== undefined && typeof match !== 'function') || !['reject', 'omit'].includes(unresolved)) {
    throw new RangeError('Invalid clipboard image asset options');
  }
  if (mode === 'embedded') {
    if (['resolver', 'sourcePolicy', 'onRecovery'].some(key => Reflect.has(input, key))) throw new RangeError('Unexpected embedded image asset option');
    return Object.freeze({ mode, match, unresolved, limits });
  }
  const persistent = options as ClipboardResolvedImageAssetOptions;
  const adapterValue: unknown = persistent.resolver;
  const sourcePolicyValue: unknown = persistent.sourcePolicy;
  const onRecovery = persistent.onRecovery;
  if (adapterValue === null || typeof adapterValue !== 'object' || Array.isArray(adapterValue)
    || sourcePolicyValue === null || typeof sourcePolicyValue !== 'object' || Array.isArray(sourcePolicyValue)
    || typeof onRecovery !== 'function') throw new RangeError('Invalid clipboard resolver options');
  const adapter = adapterValue as ClipboardResolverAdapter;
  const sourcePolicy = sourcePolicyValue as ClipboardResolvedImageAssetOptions['sourcePolicy'];
  if (Reflect.ownKeys(sourcePolicy).some(key => key !== 'allowedOrigins')) throw new RangeError('Unknown clipboard resolver source policy');
  const idempotency: unknown = adapter.idempotency;
  const resolve = adapter.resolve;
  const releaseUncommitted = adapter.releaseUncommitted;
  if ((idempotency !== 'none' && idempotency !== 'operation-asset-key') || typeof resolve !== 'function' || typeof releaseUncommitted !== 'function') {
    throw new RangeError('Invalid clipboard resolver adapter');
  }
  const policy = createClipboardResolvedSourcePolicy(sourcePolicy.allowedOrigins);
  const frozenAdapter: ClipboardResolverAdapter = Object.freeze({ idempotency,
    resolve: (request: Readonly<ClipboardResolverRequest>) => resolve.call(adapter, request),
    releaseUncommitted: (request: Readonly<ClipboardResolverReleaseRequest>) => releaseUncommitted.call(adapter, request),
  });
  return Object.freeze({ mode, match, unresolved, limits, persistent: Object.freeze({ adapter: frozenAdapter, policy, onRecovery }) });
}

type Tracking = ReturnType<typeof createPasteTracking>;
type Prepared = Extract<ClipboardHTMLPreparationResult, { status: 'prepared' }>;

interface CaptureEntry {
  readonly capture: ClipboardCaptureResult;
  readonly generation: number;
  readonly document: EditorState['doc'];
  readonly selection: EditorState['selection'];
  readonly schema: EditorState['schema'];
  readonly revision: number;
  readonly ownerDocument: Document;
}

interface AssetOperation {
  readonly generation: number;
  readonly target: CaptureEntry;
  readonly operation: PendingPasteOperation;
  readonly session: ClipboardSession | undefined;
  preparation: Prepared | undefined;
  readonly original: NormalizePasteHTMLResult;
  done: boolean;
  notified: boolean;
  applying: boolean;
  resolver?: ClipboardResolverOperation;
  resourcesExposed: boolean;
}

interface ReplayEntry {
  readonly view: EditorView;
  readonly asset: AssetOperation;
  readonly preserveOrderedListStart: boolean;
  attemptSeen: boolean;
  gateUsed: boolean;
  normalizationUsed: boolean;
}

export interface ClipboardReplayNormalization {
  readonly operation: PendingPasteOperation;
  readonly html: string;
  readonly rejected: boolean;
  readonly preserveOrderedListStart: boolean;
}

export interface ClipboardReplayHandling {
  readonly operation: PendingPasteOperation;
  readonly blocked: boolean;
  readonly preserveOrderedListStart: boolean;
}

interface CoordinatorHooks {
  readonly create: (result: NormalizePasteHTMLResult) => PendingPasteOperation;
  readonly notify: (result: NormalizePasteHTMLResult, operation: PendingPasteOperation) => void;
  readonly progress: (progress: PastePreparationProgress) => void;
  readonly tracking: Tracking;
}

export interface ClipboardAssetCoordinator {
  /** Capture native source strings and item references synchronously. */
  capture(event: ClipboardEvent): boolean;
  /** Cancel an older operation when a normal text or HTML attempt starts. */
  ordinaryAttempt(): boolean;
  replayHTML(html: string): ClipboardReplayNormalization | undefined;
  handleReplay(event: ClipboardEvent, slice: Slice): ClipboardReplayHandling | undefined;
  /** Prepares the clipboard's image files when the cleaned content has no text of its own. */
  handleImageOnly(event: ClipboardEvent, slice: Slice, standIns?: readonly string[]): boolean;
  assetsHandled(event: ClipboardEvent): boolean;
  observe(): void;
  adopt(): void;
  destroy(): void;
  filterTransaction(transaction: Transaction): boolean;
  isAssetTransaction(transaction: Transaction): boolean;
}

function cancellationReason(reason: ClipboardSessionCancellation | undefined): PasteOperationRejectionReason {
  if (reason === 'cancelled' || reason === 'superseded') return reason;
  if (reason === 'unavailable-destination') return 'unsupported-destination';
  return 'target-changed';
}

function assetReason(reason: ClipboardEmbeddedRejection): PasteOperationRejectionReason {
  if (['input-limit', 'image-size-limit', 'pixel-limit'].includes(reason)) return 'asset-limit';
  if (['read-failed', 'invalid-buffer', 'size-mismatch'].includes(reason)) return 'asset-read-failed';
  if (reason === 'embedding-disabled') return 'unsupported-destination';
  return 'assets-unavailable';
}

function emptyResult(code?: 'input-limit' | 'parse-failed'): NormalizePasteHTMLResult {
  return { status: code === undefined ? 'cleaned' : 'rejected', html: '', source: 'html',
    diagnostics: code === undefined ? [] : [{ code, severity: 'error' }], diagnosticsTruncated: false };
}

/** Only this module constructs replay events. They contain no File or live clipboard object. */
function replayEvent(view: EditorView, html: string): ClipboardEvent {
  const EventConstructor = view.dom.ownerDocument.defaultView?.Event ?? Event;
  const event = new EventConstructor('paste', { bubbles: true, cancelable: true });
  const empty = Object.freeze([]);
  const clipboard = Object.freeze({
    items: empty, files: empty, types: Object.freeze(['text/html']),
    getData: (type: string): string => type === 'text/html' ? html : '',
  });
  Object.defineProperty(event, 'clipboardData', { value: clipboard });
  return event as ClipboardEvent;
}

function resolverNonce(view: EditorView): string {
  const crypto = (view.dom.ownerDocument.defaultView as { crypto?: Crypto } | null)?.crypto ?? (globalThis as { crypto?: Crypto }).crypto;
  if (crypto === undefined || typeof crypto.getRandomValues !== 'function') throw new Error('Secure randomness is unavailable');
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

/** The alt text of the one image a pasted slice held, or the one stand-in cleanup left for it. */
function singleImageAlt(slice: Slice, nodeTypeName: string | undefined, standIns: readonly string[]): string | undefined {
  const alts: unknown[] = [];
  slice.content.descendants(node => {
    if (node.type.name === nodeTypeName) alts.push(node.attrs['alt']);
  });
  if (alts.length === 1) return typeof alts[0] === 'string' && alts[0] !== '' ? alts[0] : undefined;
  return alts.length === 0 && standIns.length === 1 && standIns[0] !== '' ? standIns[0] : undefined;
}

/** A value written into a double-quoted HTML attribute. */
function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function createClipboardAssetCoordinator(
  view: EditorView,
  assetOptions: ResolvedImageAssets,
  htmlOptions: NormalizePasteHTMLOptions,
  hooks: CoordinatorHooks,
): ClipboardAssetCoordinator {
  const htmlLimits = { ...DEFAULT_PASTE_HTML_LIMITS, ...htmlOptions.limits };
  const assetLimits = assetOptions.limits;
  const maxItems = 256;
  const metadataLength = 1024;
  const captureLimits: ClipboardCaptureLimits = Object.freeze({
    maxItems, maxStringLength: htmlLimits.maxInputLength, maxMetadataLength: metadataLength,
    maxTextBytes: htmlLimits.maxInputLength * 15,
    maxFileBytes: assetLimits.maxFileBytes, maxTotalFileBytes: assetLimits.maxTotalFileBytes,
    maxClipboardBytes: htmlLimits.maxInputLength * 15 + assetLimits.maxTotalFileBytes,
  });
  const referenceLimits: ClipboardReferenceLimits = Object.freeze({ ...captureLimits,
    maxPlacements: htmlLimits.maxImages, maxBindings: htmlLimits.maxImages,
    maxDiagnostics: htmlLimits.maxDiagnostics, maxReferenceLength: htmlLimits.maxInputLength,
    maxDescriptionLength: htmlLimits.maxInputLength, maxDimension: 10_000,
  });
  const preparationLimits = Object.freeze({ maxReferences: htmlLimits.maxImages,
    maxReferenceLength: htmlLimits.maxInputLength, maxDescriptionLength: htmlLimits.maxInputLength,
    maxOutputUnits: assetLimits.maxPreparedOutputUnits });
  const captures = new WeakMap<ClipboardEvent, CaptureEntry>();
  const nativeAttempts = new WeakMap<ClipboardEvent, number>();
  const ordinaryAttempts = new WeakMap<ClipboardEvent, number>();
  const replays = new WeakMap<ClipboardEvent, ReplayEntry>();
  const handledAssets = new WeakSet<ClipboardEvent>();
  const applying = new Map<string, AssetOperation>();
  let active: AssetOperation | undefined;
  let destroyed = false;
  let generation = 0;
  const readDestination = (): ClipboardImageDestination | undefined => {
    const policy = getClipboardImageDestination(view);
    if (policy === undefined) return undefined;
    const result = createClipboardImageDestination(view.state.schema, policy, {
      maxMetadataLength: metadataLength, maxMimeTypes: 32, maxFileBytes: assetLimits.maxFileBytes,
    });
    return result.status === 'available' ? result.destination : undefined;
  };
  const sessions = createClipboardSessionController(view, readDestination);

  const release = (asset: AssetOperation): void => {
    const preparation = asset.preparation;
    asset.preparation = undefined;
    if (preparation !== undefined) discardPreparedClipboardHTML(preparation.handle);
  };
  const notify = (asset: AssetOperation, normalization: NormalizePasteHTMLResult): void => {
    if (asset.notified) return;
    asset.notified = true;
    hooks.notify({ ...normalization, diagnostics: normalization.diagnostics.map(diagnostic => ({ ...diagnostic })) }, asset.operation);
  };
  const finishOwnership = (asset: AssetOperation): void => {
    asset.resolver?.recordAcceptance(hooks.tracking.hasAcceptedReceipt(asset.operation) ? 'accepted'
      : asset.resourcesExposed ? 'uncertain' : 'known-unapplied');
  };
  const stop = (asset: AssetOperation, reason: PasteOperationRejectionReason): void => {
    if (asset.done) return;
    asset.done = true;
    if (active === asset) active = undefined;
    release(asset);
    asset.session?.cancel();
    asset.session?.finish();
    asset.resolver?.cancel();
    const normalization = { ...asset.original, status: 'rejected' as const, html: '',
      diagnostics: asset.original.diagnostics.map(diagnostic => ({ ...diagnostic })) };
    void hooks.tracking.finish(view, asset.operation, true, { reason, normalization }).then(() => { finishOwnership(asset); });
    notify(asset, normalization);
  };
  const supersede = (): void => { if (active !== undefined) stop(active, 'superseded'); };
  const begin = (): number => {
    const ownGeneration = ++generation;
    supersede();
    return ownGeneration;
  };
  const current = (ownGeneration: number): boolean => !destroyed && generation === ownGeneration;
  const isCurrent = (asset: AssetOperation): boolean => !asset.done && current(asset.generation) && active === asset;
  const stillReady = (asset: AssetOperation): boolean => {
    if (asset.done) return false;
    if (!current(asset.generation) || active !== asset) { stop(asset, 'superseded'); return false; }
    if (asset.session?.check() === true && isCurrent(asset)) return true;
    stop(asset, cancellationReason(asset.session?.cancellation));
    return false;
  };
  const capture = (event: ClipboardEvent, html?: string): CaptureEntry => {
    const ownGeneration = generation;
    const state = view.state;
    const ownerDocument = view.dom.ownerDocument;
    const revision = pasteDocumentRevision(view);
    let result: ClipboardCaptureResult;
    try {
      const data = event.clipboardData;
      // A programmatic paste's HTML argument is authoritative. Feed it through the
      // actual capture producer so its UTF-8 and aggregate counters stay accurate.
      const input = html === undefined ? data : {
        items: data?.items ?? [],
        getData: (type: string): string => type === 'text/html' ? html : data?.getData(type) ?? '',
      } as DataTransfer;
      result = captureClipboard(input, captureLimits);
    } catch { result = { status: 'rejected', reason: 'unreadable-payload' }; }
    return { capture: result, generation: ownGeneration, document: state.doc, selection: state.selection, schema: state.schema, revision, ownerDocument };
  };
  const targetMatches = (entry: CaptureEntry): boolean => !view.isDestroyed && view.state.doc === entry.document &&
    view.state.schema === entry.schema && view.state.selection.eq(entry.selection) &&
    pasteDocumentRevision(view) === entry.revision && view.dom.ownerDocument === entry.ownerDocument;
  const rejectCapture = (entry: CaptureEntry): void => {
    const limited = entry.capture.status === 'rejected' && entry.capture.reason === 'input-limit';
    const normalization = emptyResult(limited ? 'input-limit' : 'parse-failed');
    const operation = hooks.create(normalization);
    void hooks.tracking.finish(view, operation, true, { reason: limited ? 'asset-limit' : 'assets-unavailable', normalization });
    hooks.notify(normalization, operation);
  };
  const prepare = (html: string): ClipboardHTMLPreparationResult => {
    const destination = readDestination();
    const inline = assetOptions.mode === 'resolver' && destination?.allowEmbedded === false
      ? { destination, assetLimits, sourceAllowDataImages: htmlOptions.allowDataImages !== false } : undefined;
    return prepareClipboardHTML(html, preparationLimits, htmlOptions,
      () => officeListCapabilities(view.state.schema, view.dom.ownerDocument, { preserveMarkers: true }), inline,
      features => getUnsupportedDestinationFeatures(view.state.schema, view.dom.ownerDocument, features), isOwnCopyNonce);
  };
  const makeOperation = (result: ClipboardHTMLPreparationResult, entry: CaptureEntry): AssetOperation => {
    const normalization = result.status === 'prepared'
      ? readPreparedClipboardHTMLNormalization(result.handle) ?? emptyResult('parse-failed') : result.normalization;
    const operation = hooks.create(normalization);
    const targetReady = current(entry.generation) && targetMatches(entry);
    const destinationRejected = result.status === 'rejected' && result.destinationRejected === true;
    const started = targetReady && !destinationRejected ? sessions.start(operation.operationId) : undefined;
    const asset: AssetOperation = {
      generation: entry.generation, target: entry, operation, original: normalization, preparation: result.status === 'prepared' ? result : undefined,
      session: started?.status === 'started' ? started.session : undefined,
      done: false, notified: false, applying: false, resourcesExposed: false,
    };
    if (current(entry.generation)) active = asset;
    else { stop(asset, 'superseded'); return asset; }
    if (!targetReady) stop(asset, 'target-changed');
    else if (destinationRejected) stop(asset, 'unsupported-content');
    else if (started?.status === 'rejected') stop(asset, cancellationReason(started.reason));
    else if (started === undefined) stop(asset, 'target-changed');
    else if (result.status === 'rejected') stop(asset, result.assetReason ??
      (result.normalization.diagnostics.some(item => item.code === 'input-limit' || item.code === 'structure-limit') ? 'asset-limit' : 'assets-unavailable'));
    return asset;
  };
  const apply = (asset: AssetOperation, normalization: NormalizePasteHTMLResult, replay: ClipboardHTMLReplay | undefined): void => {
    if (!stillReady(asset)) return;
    if (asset.session?.ready() !== true) { stop(asset, cancellationReason(asset.session?.cancellation)); return; }
    const html = normalization.html;
    const completion = hooks.tracking.finish(view, asset.operation, false, { normalization });
    void completion.then(() => { finishOwnership(asset); });
    // Once the host sees a persistent URL, it may insert it through an untagged
    // callback. Only positive installed acceptance can resolve this uncertainty.
    if (asset.resolver !== undefined) {
      if (!asset.resolver.beginApply()) { stop(asset, 'assets-unavailable'); return; }
      asset.resourcesExposed = true;
    }
    notify(asset, normalization);
    if (!stillReady(asset)) return;
    const event = replayEvent(view, html);
    const entry: ReplayEntry = { view, asset,
      preserveOrderedListStart: asset.preparation?.preserveOrderedListStart === true,
      attemptSeen: false, gateUsed: replay !== undefined, normalizationUsed: false };
    replays.set(event, entry);
    asset.applying = true;
    applying.set(asset.operation.operationId, asset);
    try {
      const handled = replay === undefined ? view.pasteHTML(html, event) : replay(html, event);
      if (!handled && !asset.done) stop(asset, 'target-changed');
    } catch { /* Receipts distinguish accepted content from a throwing post-commit observer. */ }
    finally {
      replays.delete(event);
      applying.delete(asset.operation.operationId);
      asset.applying = false;
      asset.done = true;
      if (active === asset) active = undefined;
      release(asset);
      asset.session.finish();
      void completion;
    }
  };
  const execute = async (
    asset: AssetOperation,
    snapshot: ClipboardSnapshot,
    references: readonly ClipboardImageReference[],
    explicit: readonly ClipboardImageBinding[] | undefined,
    replay: ClipboardHTMLReplay | undefined,
  ): Promise<void> => {
    // Core enables its one-use replay after onDeferred returns.
    await Promise.resolve();
    if (!stillReady(asset) || asset.preparation === undefined || asset.session === undefined) return;
    try {
      const context: ClipboardImageMatchContext = Object.freeze({
        operationId: asset.operation.operationId, references,
        items: Object.freeze(snapshot.items.map(item => Object.freeze({
          itemIndex: item.itemIndex, kind: item.kind, declaredType: item.declaredType,
          fileType: item.fileType, fileSize: item.fileSize, available: item.file !== null,
        }))),
      });
      const bindings = explicit ?? assetOptions.match?.(context) ?? [];
      if (!stillReady(asset)) return;
      if (assetOptions.mode === 'embedded' && !asset.session.destination.allowEmbedded && bindings.length > 0) { stop(asset, 'unsupported-destination'); return; }
      const checked = resolveClipboardImageBindings(snapshot, references, bindings, asset.session.destination, referenceLimits);
      if (!stillReady(asset)) return;
      if (checked.status === 'rejected') { stop(asset, checked.reason === 'input-limit' ? 'asset-limit' : 'assets-unavailable'); return; }
      if (checked.hasInvalidBindings ||
        (checked.matches.length !== references.length && assetOptions.unresolved !== 'omit')) {
        stop(asset, 'assets-unavailable'); return;
      }
      if (assetOptions.mode === 'embedded' && !asset.session.destination.allowEmbedded && checked.matches.length > 0) { stop(asset, 'unsupported-destination'); return; }
      const progress: PastePreparationProgress = Object.freeze({ operationId: asset.operation.operationId, phase: 'preparing',
        cancel: () => { stop(asset, 'cancelled'); } });
      try { hooks.progress(progress); } catch { /* Progress observers cannot disable validation. */ }
      if (!stillReady(asset)) return;
      const persistent = assetOptions.persistent;
      if (persistent !== undefined) {
        const replacements = new Map<string, { readonly src: string; readonly pixels: number }>();
        if (checked.matches.length > 0 || asset.preparation.inlineAssets.placements.length > 0) {
          const remainingPixels = htmlLimits.maxImagePixels - asset.preparation.existingImagePixels;
          if (remainingPixels <= 0) { stop(asset, 'asset-limit'); return; }
          const blobs = await prepareClipboardBlobAssets(checked.matches, asset.session.destination, {
            maxPlacements: htmlLimits.maxImages, maxFiles: maxItems, maxFileBytes: assetLimits.maxFileBytes,
            maxTotalFileBytes: assetLimits.maxTotalFileBytes, maxTotalPixels: remainingPixels,
            maxMetadataLength: metadataLength, maxDescriptionLength: htmlLimits.maxInputLength, maxDimension: 10_000,
          }, { signal: asset.session.signal }, asset.preparation.inlineAssets);
          if (!stillReady(asset)) return;
          if (blobs.status === 'cancelled') { stop(asset, cancellationReason(asset.session.cancellation)); return; }
          if (blobs.status === 'rejected') { stop(asset, assetReason(blobs.reason)); return; }
          const nonce = resolverNonce(view);
          const resources = blobs.resources.map((resource, index) => ({
            assetId: `asset-${String(index + 1)}`, idempotencyKey: `paste:${nonce}:${String(index + 1)}`,
            blob: resource.blob, mimeType: resource.mimeType,
          }));
          asset.resolver = createClipboardResolverOperation({ operationId: asset.operation.operationId, assets: resources,
            adapter: persistent.adapter, allowPersistentURL: src => readClipboardResolvedSource(persistent.policy, src) === src,
            onChange: persistent.onRecovery,
            limits: { maxBlobBytes: assetLimits.maxFileBytes, maxTotalBlobBytes: assetLimits.maxTotalFileBytes,
              maxDiagnostics: Math.min(100, htmlLimits.maxDiagnostics) },
          });
          const resolution = await asset.resolver.resolve();
          if (!stillReady(asset)) return;
          if (resolution.status !== 'ready') { stop(asset, 'assets-unavailable'); return; }
          const resolved = new Map(resolution.assets.map(resource => [resource.assetId, resource.src]));
          for (const placement of blobs.placements) {
            const resource = blobs.resources[placement.resourceIndex];
            const identity = resources[placement.resourceIndex];
            const src = identity === undefined ? undefined : resolved.get(identity.assetId);
            if (resource === undefined || src === undefined) { stop(asset, 'assets-unavailable'); return; }
            replacements.set(placement.placementId, { src, pixels: resource.pixels });
          }
        }
        if (!stillReady(asset)) return;
        const materialized = materializeResolvedClipboardHTML(asset.preparation.handle, replacements, persistent.policy,
          { omitUnresolved: assetOptions.unresolved === 'omit' });
        if (materialized.status === 'rejected') { stop(asset, materialized.reason === 'output-limit' ? 'asset-limit' : 'assets-unavailable'); return; }
        apply(asset, materialized.normalization, replay);
        return;
      }
      const urls = new Map<string, string>();
      if (checked.matches.length > 0) {
        const remainingPixels = htmlLimits.maxImagePixels - asset.preparation.existingImagePixels;
        if (remainingPixels <= 0) { stop(asset, 'asset-limit'); return; }
        const embedded = await prepareClipboardEmbeddedAssets(checked.matches, asset.session.destination, {
          maxPlacements: htmlLimits.maxImages, maxFiles: maxItems, maxFileBytes: assetLimits.maxFileBytes,
          maxTotalFileBytes: assetLimits.maxTotalFileBytes, maxTotalPixels: remainingPixels,
          maxPreparedUrlUnits: assetLimits.maxPreparedOutputUnits, maxMetadataLength: metadataLength,
          maxDescriptionLength: htmlLimits.maxInputLength, maxDimension: 10_000,
        }, { signal: asset.session.signal });
        if (!stillReady(asset)) return;
        if (embedded.status === 'cancelled') { stop(asset, cancellationReason(asset.session.cancellation)); return; }
        if (embedded.status === 'rejected') { stop(asset, assetReason(embedded.reason)); return; }
        for (const placement of embedded.placements) {
          const resource = embedded.resources[placement.resourceIndex];
          if (resource === undefined) { stop(asset, 'assets-unavailable'); return; }
          urls.set(placement.placementId, resource.dataUrl);
        }
      }
      if (!stillReady(asset)) return;
      const materialized = materializeClipboardHTML(asset.preparation.handle, urls, { omitUnresolved: assetOptions.unresolved === 'omit' });
      if (materialized.status === 'rejected') { stop(asset, materialized.reason === 'output-limit' ? 'asset-limit' : 'assets-unavailable'); return; }
      apply(asset, materialized.normalization, replay);
    } catch { stop(asset, 'assets-unavailable'); }
  };
  const defer = (asset: AssetOperation, snapshot: ClipboardSnapshot, references: readonly ClipboardImageReference[]): ClipboardHTMLDeferral => ({
    onDeferred(replay) { void execute(asset, snapshot, references, undefined, replay); },
    discard() {
      if (asset.applying) release(asset);
      else stop(asset, 'superseded');
    },
  });
  const gate = (html: string, context: Readonly<ClipboardHTMLPreparationContext>): ClipboardHTMLDeferral | undefined => {
    // Core deliberately preserves an omitted programmatic event. Use only a
    // local capture facade; the later replay always receives another fresh event.
    const sourceEvent = context.event ?? (context.origin === 'programmatic' ? replayEvent(view, html) : undefined);
    const own = sourceEvent === undefined ? undefined : replays.get(sourceEvent);
    if (own?.view === view) {
      if (!own.gateUsed) { own.gateUsed = true; return undefined; }
      stop(own.asset, 'superseded');
      return { onDeferred() { /* A reused replay event cannot authorize another preparation. */ } };
    }
    if (destroyed || sourceEvent === undefined) return undefined;
    const stored = context.origin === 'native' ? captures.get(sourceEvent) : undefined;
    const ownGeneration = stored?.generation ?? begin();
    if (!current(ownGeneration)) return { onDeferred() { /* A nested attempt owns the current preparation. */ } };
    const captured = stored ?? capture(sourceEvent, html);
    if (!current(ownGeneration)) return { onDeferred() { /* Clipboard getters can start a newer attempt. */ } };
    if (captured.capture.status !== 'captured') {
      if (captured.capture.status === 'unavailable') return undefined;
      rejectCapture(captured);
      return { onDeferred() { /* Capture rejection must not reach ordinary paste handlers. */ } };
    }
    if (context.origin === 'native' && captured.capture.snapshot.text['text/html'] !== html) {
      rejectCapture({ ...captured, capture: { status: 'rejected', reason: 'unreadable-payload' } });
      return { onDeferred() { /* The source changed after its synchronous capture. */ } };
    }
    handledAssets.add(sourceEvent);
    const result = prepare(html);
    if (result.status === 'prepared' && result.references.length === 0 && result.inlineAssets.placements.length === 0
      && !(assetOptions.mode === 'resolver' && readDestination()?.allowEmbedded === false && result.hasRemovedImages)) {
      discardPreparedClipboardHTML(result.handle); return undefined;
    }
    const asset = makeOperation(result, captured);
    const references = result.status === 'prepared' ? result.references : Object.freeze([]);
    return defer(asset, captured.capture.snapshot, references);
  };
  const applyingOperation = (transaction: Transaction): AssetOperation | undefined => {
    const metadata: unknown = transaction.getMeta(pasteCleanupKey);
    return metadata !== null && typeof metadata === 'object' && 'operationId' in metadata && typeof metadata.operationId === 'string'
      ? applying.get(metadata.operationId) : undefined;
  };
  let unregister: () => void;
  try {
    unregister = claimClipboardSlot('html-preparation', () => registerClipboardHTMLPreparation(view, gate, context => {
      const own = context.event === undefined ? undefined : replays.get(context.event);
      if (own?.view === view && !own.attemptSeen && !own.asset.done) {
        own.attemptSeen = true;
        return;
      }
      const ownGeneration = begin();
      if (current(ownGeneration) && context.origin === 'native' && context.event !== undefined) {
        nativeAttempts.set(context.event, ownGeneration);
      }
    }));
  } catch (error) {
    // A refused preparation leaves no live coordinator behind.
    destroyed = true;
    sessions.destroy();
    throw error;
  }
  return {
    capture(event) {
      // A discarded older attempt can still traverse DOM handlers after a nested
      // paste starts. Only the attempt observer can authorize this capture.
      const ownGeneration = nativeAttempts.get(event);
      if (ownGeneration === undefined || !current(ownGeneration)) { event.preventDefault(); return true; }
      const entry = capture(event);
      if (!current(ownGeneration)) { event.preventDefault(); return true; }
      captures.set(event, entry);
      if (entry.capture.status !== 'rejected') return false;
      event.preventDefault();
      rejectCapture(entry);
      return true;
    },
    ordinaryAttempt: () => {
      const ownGeneration = begin();
      // The image-only route of the same event continues this generation.
      const event = getClipboardPasteAttemptEvent(view);
      if (event !== undefined) ordinaryAttempts.set(event, ownGeneration);
      return current(ownGeneration);
    },
    replayHTML(html) {
      const event = getClipboardPasteAttemptEvent(view);
      const own = event === undefined ? undefined : replays.get(event);
      if (own?.view !== view) return undefined;
      const rejected = own.normalizationUsed || own.asset.done;
      own.normalizationUsed = true;
      return { operation: own.asset.operation, html: rejected ? '' : html, rejected,
        preserveOrderedListStart: own.preserveOrderedListStart };
    },
    handleReplay(event, slice) {
      const own = replays.get(event);
      if (own?.view !== view) return undefined;
      let blocked = own.asset.done || slice.content.size === 0;
      if (!blocked && own.asset.session?.beginApply() !== true) blocked = true;
      if (blocked && !own.asset.done) stop(own.asset, slice.content.size === 0 ? 'assets-unavailable' : cancellationReason(own.asset.session?.cancellation));
      return { operation: own.asset.operation, blocked, preserveOrderedListStart: own.preserveOrderedListStart };
    },
    handleImageOnly(event, slice, standIns = []) {
      // Core's rule: white space, format characters and alt text left in place of removed images are not text of its own.
      if (destroyed || replays.has(event) || pasteHasOwnText(event, slice, { imageStandIns: standIns })) return false;
      const captured = event.currentTarget === view.dom && event.eventPhase !== 0 ? captures.get(event) : undefined;
      // Cleaning the event's HTML began a newer generation; the capture belongs to it.
      const ordinary = ordinaryAttempts.get(event);
      const stored = captured === undefined || ordinary === undefined ? captured : { ...captured, generation: ordinary };
      const ownGeneration = stored?.generation ?? begin();
      if (!current(ownGeneration)) { event.preventDefault(); return true; }
      const entry = stored ?? capture(event);
      if (!current(ownGeneration)) { event.preventDefault(); return true; }
      if (entry.capture.status === 'rejected') { event.preventDefault(); rejectCapture(entry); return true; }
      if (entry.capture.status !== 'captured') return false;
      const snapshot = entry.capture.snapshot;
      const files = snapshot.items.filter(item => item.kind === 'file' && (item.declaredType.startsWith('image/') || item.fileType?.startsWith('image/') === true));
      if (files.length === 0) return false;
      event.preventDefault();
      // One file stands for the one image the pasted content held and keeps its alt text.
      const alt = files.length === 1 ? singleImageAlt(slice, readDestination()?.nodeTypeName, standIns) : undefined;
      const altAttribute = alt === undefined ? '' : ` alt="${escapeAttribute(alt)}"`;
      const result = prepare(files.map(item => `<img src="cid:clipboard-item-${String(item.itemIndex)}"${altAttribute}>`).join(''));
      const asset = makeOperation(result, entry);
      if (result.status !== 'prepared') return true;
      // Each source File is the explicitly selected image in this HTML-free route.
      // These bindings do not infer correspondence to any external HTML reference.
      const references = Object.freeze(result.references.map(({ sourceOffset: _offset, ...reference }) => Object.freeze(reference)));
      const bindings = Object.freeze(references.map((reference, index) => Object.freeze({
        placementId: reference.placementId, itemIndex: files[index]?.itemIndex ?? -1,
        evidence: Object.freeze({ kind: 'host' as const, matcherId: 'domternal:image-only-item' }),
      })));
      void execute(asset, snapshot, references, bindings, undefined);
      return true;
    },
    assetsHandled: event => handledAssets.has(event) || replays.has(event),
    observe: () => { sessions.observe(); if (active?.session?.signal.aborted === true) stop(active, cancellationReason(active.session.cancellation)); },
    adopt: () => { generation++; if (active !== undefined) stop(active, 'target-changed'); },
    destroy() { destroyed = true; if (active !== undefined) stop(active, 'target-changed'); sessions.destroy(); unregister(); },
    filterTransaction(transaction) {
      const asset = applyingOperation(transaction);
      if (asset === undefined) return true;
      if (asset.done) return false;
      try {
        const destination = readDestination();
        if (!isCurrent(asset) || !targetMatches(asset.target) || destination === undefined ||
          asset.session === undefined || !sameClipboardImageDestination(asset.session.destination, destination)) {
          stop(asset, 'target-changed');
          return false;
        }
        return true;
      } catch { stop(asset, 'target-changed'); return false; }
    },
    isAssetTransaction: transaction => applyingOperation(transaction) !== undefined,
  };
}
