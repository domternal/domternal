import { clipboardRasterMime } from './destination.js';
import type {
  ClipboardCreatedResource, ClipboardResolvedAsset, ClipboardResolverAsset, ClipboardResolverDiagnostic,
  ClipboardResolverDiagnosticCode, ClipboardResolverLimits, ClipboardResolverOperation, ClipboardResolverOperationOptions,
  ClipboardResolverRecovery, ClipboardResolverReport, ClipboardResolverResolution,
} from './resolverTypes.js';

/** Private ceilings. These counters bound retained metadata, not adapter or process memory. */
export const CLIPBOARD_RESOLVER_LIMITS: Readonly<ClipboardResolverLimits> = Object.freeze({
  maxAssets: 200, maxCreatedResources: 400, maxBlobBytes: 5 * 1024 * 1024, maxTotalBlobBytes: 5 * 1024 * 1024,
  maxURLUnits: 8192, maxTotalURLUnits: 200 * 8192, maxHandleUnits: 1024, maxTotalHandleUnits: 400 * 1024,
  maxIdentityUnits: 128, maxRecoveryTokenUnits: 1024, maxDiagnostics: 100,
});

// Native getters verify immutable Blob storage without reading or qualifying its bytes.
// eslint-disable-next-line @typescript-eslint/unbound-method
const BLOB_SIZE = typeof Blob === 'undefined' ? undefined : Object.getOwnPropertyDescriptor(Blob.prototype, 'size')?.get as ((this: unknown) => number) | undefined;
// eslint-disable-next-line @typescript-eslint/unbound-method
const BLOB_TYPE = typeof Blob === 'undefined' ? undefined : Object.getOwnPropertyDescriptor(Blob.prototype, 'type')?.get as ((this: unknown) => string) | undefined;

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function bounded(value: unknown, maximum: number): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 32 || code === 127) return false;
  }
  return true;
}
function quarantineInvalidPromise(value: unknown): void {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return;
  // Asynchronous callback returns cannot authorize a URL or become unhandled.
  void Promise.resolve(value).catch(() => undefined);
}
function isAcceptance(value: unknown): boolean { return value === 'accepted' || value === 'known-unapplied' || value === 'uncertain'; }
function isArray(value: unknown): boolean { return Array.isArray(value); }
function identifier(value: unknown, maximum: number): value is string {
  return bounded(value, maximum) && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/u.test(value);
}
function limitsFor(input: ClipboardResolverOperationOptions['limits']): Readonly<ClipboardResolverLimits> {
  const limits = { ...CLIPBOARD_RESOLVER_LIMITS };
  if (input !== undefined) {
    if (!record(input)) throw new RangeError('Invalid clipboard resolver limits');
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== 'string' || !Object.hasOwn(limits, key)) throw new RangeError('Unknown clipboard resolver limit');
      const name = key as keyof ClipboardResolverLimits;
      const value: unknown = input[name];
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (name === 'maxDiagnostics' ? 0 : 1) || value > CLIPBOARD_RESOLVER_LIMITS[name]) {
        throw new RangeError('Invalid clipboard resolver limit');
      }
      limits[name] = value;
    }
  }
  if (limits.maxBlobBytes > limits.maxTotalBlobBytes || limits.maxURLUnits > limits.maxTotalURLUnits || limits.maxHandleUnits > limits.maxTotalHandleUnits) {
    throw new RangeError('Invalid aggregate clipboard resolver limit');
  }
  return Object.freeze(limits);
}

/** The mandatory baseline never delegates local, temporary or executable URL authorization. */
function persistentSource(input: unknown, maximum: number): string | undefined {
  if (!bounded(input, maximum) || input.includes('\\')) return undefined;
  try {
    const url = new URL(input);
    if (!['https:', 'http:'].includes(url.protocol) || url.username !== '' || url.password !== '' || url.hostname === '') return undefined;
    return url.href.length <= maximum ? url.href : undefined;
  } catch { return undefined; }
}

interface AssetState {
  readonly input: Readonly<Omit<ClipboardResolverAsset, 'blob'>>;
  blob: Blob | undefined;
  registrationOpen: boolean;
  unknown: boolean;
  recoveryToken: string | undefined;
  created: number;
}
interface ResourceState {
  readonly asset: AssetState;
  readonly handle: string;
  readonly token: ClipboardCreatedResource;
  readonly id: number;
  status: 'registered' | 'releasing' | 'released' | 'pending';
  retryToken: string | undefined;
}

/**
 * Private ownership foundation, with no editor, clipboard, upload or network implementation.
 * The adapter must register each new resource before its promise settles. A rejected or late
 * registration is unknown ownership, even if the adapter subsequently claims no creation.
 */
export function createClipboardResolverOperation(options: ClipboardResolverOperationOptions): ClipboardResolverOperation {
  const limits = limitsFor(options.limits);
  const operationId: unknown = options.operationId;
  const adapter = options.adapter;
  const idempotency: unknown = adapter.idempotency;
  const resolveCallback = adapter.resolve;
  const releaseCallback = adapter.releaseUncommitted;
  const allowPersistentURL = options.allowPersistentURL;
  const onChange: ((report: ClipboardResolverReport) => unknown) | undefined = options.onChange;
  if (!identifier(operationId, limits.maxIdentityUnits) || (idempotency !== 'none' && idempotency !== 'operation-asset-key') ||
    typeof resolveCallback !== 'function' || typeof releaseCallback !== 'function' || typeof allowPersistentURL !== 'function' ||
    (onChange !== undefined && typeof onChange !== 'function')) {
    throw new RangeError('Invalid clipboard resolver operation');
  }
  const inputAssets = options.assets;
  if (!isArray(inputAssets)) throw new RangeError('Invalid clipboard resolver assets');
  const count: number = inputAssets.length;
  if (!Number.isSafeInteger(count) || count < 1 || count > limits.maxAssets) throw new RangeError('Invalid clipboard resolver assets');
  const assets: AssetState[] = [];
  const assetIds = new Set<string>();
  const keys = new Set<string>();
  let blobBytes = 0;
  for (let index = 0; index < count; index++) {
    const input = inputAssets[index];
    if (input === undefined) throw new RangeError('Invalid clipboard resolver asset');
    const assetId: unknown = input.assetId;
    const idempotencyKey: unknown = input.idempotencyKey;
    const blob: unknown = input.blob;
    const mimeType = clipboardRasterMime(input.mimeType);
    let size: number | undefined;
    let type: string | undefined;
    try { size = BLOB_SIZE?.call(blob); type = BLOB_TYPE?.call(blob); } catch { /* Reject non-native Blob storage. */ }
    if (!identifier(assetId, limits.maxIdentityUnits) || !identifier(idempotencyKey, limits.maxIdentityUnits) || assetIds.has(assetId) || keys.has(idempotencyKey) ||
      mimeType === undefined || type !== mimeType || size === undefined || !Number.isSafeInteger(size) || size <= 0 || size > limits.maxBlobBytes || size > limits.maxTotalBlobBytes - blobBytes) {
      throw new RangeError('Invalid clipboard resolver asset');
    }
    assetIds.add(assetId); keys.add(idempotencyKey); blobBytes += size;
    assets.push({ input: Object.freeze({ assetId, idempotencyKey, mimeType }), blob: blob as Blob, registrationOpen: false,
      unknown: false, recoveryToken: undefined, created: 0 });
  }
  const controller = new AbortController();
  const isAborted = (): boolean => controller.signal.aborted;
  const hasUnknown = (asset: AssetState): boolean => asset.unknown;
  const resources: ResourceState[] = [];
  const handles = new Map<string, ResourceState>();
  const tokens = new WeakMap<ClipboardCreatedResource, ResourceState>();
  const releases = new Set<Promise<void>>();
  const diagnostics: ClipboardResolverDiagnostic[] = [];
  let diagnosticsTruncated = false;
  let handleUnits = 0;
  let urlUnits = 0;
  let phase: ClipboardResolverReport['phase'] = 'preparing';
  let resolution: ClipboardResolverReport['resolution'] = 'not-started';
  let pendingResolvers = 0;
  let task: Promise<ClipboardResolverResolution> | undefined;
  let taskPending = false;
  let revision = 0;
  let notificationQueued = false;

  const changed = (): void => {
    revision++;
    if (onChange === undefined || notificationQueued) return;
    notificationQueued = true;
    queueMicrotask(() => {
      // Clear before invoking the observer so reentry gets a separate later revision.
      notificationQueued = false;
      try {
        const returned: unknown = onChange(snapshot());
        quarantineInvalidPromise(returned);
      } catch { /* Observation must not change ownership or the operation outcome. */ }
    });
  };
  const changePhase = (next: ClipboardResolverReport['phase']): void => {
    if (phase !== next) { phase = next; changed(); }
  };
  const changeResolution = (next: ClipboardResolverReport['resolution']): void => {
    if (resolution !== next) { resolution = next; changed(); }
  };

  const report = (asset: AssetState, code: ClipboardResolverDiagnosticCode): void => {
    if (diagnostics.some(item => item.assetId === asset.input.assetId && item.code === code)) return;
    if (diagnostics.length === limits.maxDiagnostics) {
      if (!diagnosticsTruncated) { diagnosticsTruncated = true; changed(); }
      return;
    }
    diagnostics.push(Object.freeze({ code, assetId: asset.input.assetId }));
    changed();
  };
  const unknown = (asset: AssetState, code: ClipboardResolverDiagnosticCode): void => {
    if (!asset.unknown) { asset.unknown = true; changed(); }
    report(asset, code);
    if (resolution === 'ready' && phase === 'ready') changeResolution('failed');
  };
  const retained = (): boolean => phase === 'applying' || phase === 'accepted' || phase === 'uncertain';
  const compensate = (resource: ResourceState): void => {
    // A pending resolver may still finish writing a registered resource after abort.
    // Its settlement must precede cleanup so that a late write cannot recreate it.
    if (phase !== 'unapplied' || resource.asset.registrationOpen || resource.status !== 'registered') return;
    resource.status = 'releasing';
    const release = Promise.resolve().then(async () => {
      // The known-unapplied state is terminal and cannot subsequently begin application.
      try {
        const value: unknown = await releaseCallback.call(adapter, Object.freeze({ operationId,
          assetId: resource.asset.input.assetId, idempotencyKey: resource.asset.input.idempotencyKey, handle: resource.handle }));
        const status = record(value) ? value['status'] : undefined;
        const retryToken = record(value) ? value['retryToken'] : undefined;
        if (status === 'released') resource.status = 'released';
        else {
          resource.status = 'pending';
          if (status === 'cleanup-pending' && bounded(retryToken, limits.maxRecoveryTokenUnits)) {
            resource.retryToken = retryToken;
            report(resource.asset, 'cleanup-pending');
          } else report(resource.asset, 'invalid-cleanup-result');
        }
      } catch { resource.status = 'pending'; report(resource.asset, 'cleanup-failed'); }
      changed();
    });
    releases.add(release);
    changed();
    void release.finally(() => { releases.delete(release); changed(); });
  };
  const abandon = (): void => {
    if (retained()) {
      if (phase === 'applying') changePhase('uncertain');
    } else {
      changePhase('unapplied');
      for (const resource of resources) compensate(resource);
    }
    for (const asset of assets) asset.blob = undefined;
    if (!isAborted()) controller.abort();
  };
  const register = (asset: AssetState, handle: unknown): ClipboardCreatedResource | undefined => {
    if (!asset.registrationOpen) { unknown(asset, 'late-registration'); return undefined; }
    if (!bounded(handle, limits.maxHandleUnits)) { unknown(asset, 'invalid-registration'); return undefined; }
    const previous = handles.get(handle);
    if (previous !== undefined) {
      if (previous.asset === asset) return previous.token;
      unknown(asset, 'ownership-conflict');
      return undefined;
    }
    if (resources.length >= limits.maxCreatedResources || handle.length > limits.maxTotalHandleUnits - handleUnits) {
      unknown(asset, 'resource-limit'); return undefined;
    }
    const token = Object.freeze(Object.create(null)) as ClipboardCreatedResource;
    const resource: ResourceState = { asset, handle, token, id: resources.length + 1, status: 'registered', retryToken: undefined };
    resources.push(resource); handles.set(handle, resource); tokens.set(token, resource);
    handleUnits += handle.length; asset.created++;
    changed();
    compensate(resource);
    return token;
  };
  const failed = (cancelled: boolean): ClipboardResolverResolution => {
    const status = cancelled ? 'cancelled' : 'failed';
    changeResolution(status);
    abandon();
    return Object.freeze({ status });
  };
  const run = async (): Promise<ClipboardResolverResolution> => {
    const results: ClipboardResolvedAsset[] = [];
    for (const asset of assets) {
      if (isAborted()) return failed(true);
      const blob = asset.blob;
      if (blob === undefined) return failed(isAborted());
      let value: unknown;
      asset.registrationOpen = true;
      pendingResolvers++;
      changed();
      try {
        value = await resolveCallback.call(adapter, Object.freeze({ ...asset.input, blob, operationId, signal: controller.signal,
          registerCreated: (handle: string): ClipboardCreatedResource | undefined => register(asset, handle) }));
      } catch { unknown(asset, 'unknown-creation'); report(asset, 'resolver-failed'); }
      finally {
        asset.registrationOpen = false;
        asset.blob = undefined;
        pendingResolvers--;
        changed();
        if (phase === 'unapplied') {
          for (const resource of resources) if (resource.asset === asset) compensate(resource);
        }
      }
      try {
        if (!record(value)) { unknown(asset, 'invalid-result'); return failed(isAborted()); }
        const status: unknown = value['status'];
        if (status === 'failed') {
          const creation: unknown = value['creation'];
          const recoveryToken: unknown = value['recoveryToken'];
          if (recoveryToken !== undefined) {
            if (bounded(recoveryToken, limits.maxRecoveryTokenUnits)) { asset.recoveryToken = recoveryToken; changed(); }
            else unknown(asset, 'invalid-result');
          }
          if (creation === 'unknown') unknown(asset, 'unknown-creation');
          else if ((creation !== 'none' && creation !== 'registered') || (creation === 'none' && asset.created > 0) || (creation === 'registered' && asset.created === 0)) unknown(asset, 'invalid-result');
          report(asset, 'resolver-failed');
          return failed(isAborted());
        }
        const ownership: unknown = value['ownership'];
        const src: unknown = value['src'];
        const token: unknown = value['resource'];
        if (status !== 'resolved' || (ownership !== 'existing' && ownership !== 'created')) { unknown(asset, 'invalid-result'); return failed(isAborted()); }
        if (ownership === 'created') {
          const owned = record(token) ? tokens.get(token as unknown as ClipboardCreatedResource) : undefined;
          if (owned?.asset !== asset) { unknown(asset, 'invalid-result'); return failed(isAborted()); }
        } else if (asset.created > 0 || token !== undefined) { unknown(asset, 'invalid-result'); return failed(isAborted()); }
        if (hasUnknown(asset)) return failed(isAborted());
        if (isAborted()) return failed(true);
        const safe = persistentSource(src, limits.maxURLUnits);
        if (safe === undefined || safe.length > limits.maxTotalURLUnits - urlUnits) { report(asset, 'invalid-source'); return failed(false); }
        let approved: unknown;
        try { approved = allowPersistentURL(safe, Object.freeze({ operationId, assetId: asset.input.assetId, mimeType: asset.input.mimeType })); }
        catch { report(asset, 'invalid-source'); return failed(isAborted()); }
        if (approved !== true) quarantineInvalidPromise(approved);
        if (isAborted()) return failed(true);
        if (approved !== true || hasUnknown(asset)) { report(asset, 'invalid-source'); return failed(false); }
        urlUnits += safe.length;
        results.push(Object.freeze({ assetId: asset.input.assetId, src: safe, ownership }));
      } catch { unknown(asset, 'invalid-result'); return failed(isAborted()); }
    }
    if (isAborted() || assets.some(asset => asset.unknown)) return failed(isAborted());
    changeResolution('ready'); changePhase('ready');
    return Object.freeze({ status: 'ready', assets: Object.freeze(results) });
  };
  const snapshot = (): ClipboardResolverReport => {
    const recovery: ClipboardResolverRecovery[] = [];
    for (const asset of assets) {
      if (asset.unknown) recovery.push(Object.freeze({ assetId: asset.input.assetId, idempotencyKey: asset.input.idempotencyKey,
        reason: 'unknown-creation', ...(asset.recoveryToken === undefined ? {} : { token: asset.recoveryToken }) }));
      if (phase === 'uncertain') recovery.push(Object.freeze({ assetId: asset.input.assetId, idempotencyKey: asset.input.idempotencyKey, reason: 'uncertain-acceptance' }));
    }
    for (const resource of resources) {
      if (resource.status === 'pending') recovery.push(Object.freeze({ assetId: resource.asset.input.assetId,
        idempotencyKey: resource.asset.input.idempotencyKey, reason: 'cleanup-pending', resourceId: resource.id,
        ...(resource.retryToken === undefined ? {} : { token: resource.retryToken }) }));
    }
    const releasedResources = resources.filter(resource => resource.status === 'released').length;
    const terminal = phase === 'accepted' || phase === 'uncertain' || phase === 'unapplied';
    return Object.freeze({ operationId, idempotency, phase, resolution, revision,
      settled: terminal && !taskPending && pendingResolvers === 0 && releases.size === 0,
      ownership: recovery.some(item => item.reason === 'unknown-creation' || item.reason === 'uncertain-acceptance') ? 'recovery-pending'
        : retained() ? 'retained' : pendingResolvers > 0 || recovery.length > 0 || releases.size > 0 ? 'cleanup-pending'
          : phase === 'unapplied' && releasedResources === resources.length ? 'released' : 'open',
      pendingResolvers, pendingReleases: releases.size, registeredResources: resources.length, releasedResources,
      recovery: Object.freeze(recovery), diagnostics: Object.freeze([...diagnostics]), diagnosticsTruncated });
  };
  return Object.freeze({
    resolve(): Promise<ClipboardResolverResolution> {
      if (task === undefined) {
        changeResolution(isAborted() ? 'cancelled' : 'pending');
        taskPending = true;
        // Publish the promise before a synchronous adapter callback can reenter resolve.
        task = Promise.resolve().then(run).finally(() => { taskPending = false; changed(); });
        changed();
      }
      return task;
    },
    beginApply(): boolean {
      if (phase !== 'ready' || resolution !== 'ready' || isAborted() || assets.some(asset => asset.unknown)) return false;
      changePhase('applying'); return true;
    },
    recordAcceptance(outcome: 'accepted' | 'known-unapplied' | 'uncertain'): boolean {
      if (!isAcceptance(outcome)) throw new RangeError('Invalid clipboard acceptance outcome');
      if (phase === 'accepted') return outcome === 'accepted';
      if (phase === 'uncertain') { if (outcome === 'accepted') changePhase('accepted'); return outcome !== 'known-unapplied'; }
      if (phase === 'unapplied') return outcome === 'known-unapplied';
      if (outcome === 'known-unapplied') { changePhase('unapplied'); abandon(); return true; }
      if (phase !== 'applying') return false;
      changePhase(outcome);
      return true;
    },
    cancel: abandon,
    snapshot,
    async settled(): Promise<ClipboardResolverReport> {
      if (task !== undefined) await task;
      while (releases.size > 0) await Promise.all([...releases]);
      return snapshot();
    },
  });
}
