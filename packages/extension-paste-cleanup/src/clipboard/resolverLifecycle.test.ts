// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { CLIPBOARD_RESOLVER_LIMITS, createClipboardResolverOperation } from './resolverLifecycle.js';
import type {
  ClipboardCreatedResource, ClipboardResolverAdapter, ClipboardResolverAdapterResult, ClipboardResolverAsset,
  ClipboardResolverOperation, ClipboardResolverOperationOptions, ClipboardResolverReleaseResult, ClipboardResolverRequest,
} from './resolverTypes.js';

// These tests exercise ownership, not raster qualification. Production callers must
// qualify the immutable bytes separately before creating this private operation.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'), value => value.charCodeAt(0));
const URL_A = 'https://storage.example/assets/a.png';
function asset(assetId = 'a'): ClipboardResolverAsset {
  return { assetId, idempotencyKey: `operation-1:${assetId}`, blob: new Blob([PNG], { type: 'image/png' }), mimeType: 'image/png' };
}
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function created(request: ClipboardResolverRequest, handle = 'private-cleanup-handle', src = URL_A): ClipboardResolverAdapterResult {
  const resource = request.registerCreated(handle);
  if (resource === undefined) throw new Error('Expected registered resource');
  return { status: 'resolved', ownership: 'created', src, resource };
}
function fixture(input: Partial<ClipboardResolverOperationOptions> = {}): {
  operation: ClipboardResolverOperation;
  resolve: ReturnType<typeof vi.fn<ClipboardResolverAdapter['resolve']>>;
  release: ReturnType<typeof vi.fn<ClipboardResolverAdapter['releaseUncommitted']>>;
  allow: ReturnType<typeof vi.fn<ClipboardResolverOperationOptions['allowPersistentURL']>>;
} {
  const resolve = vi.fn<ClipboardResolverAdapter['resolve']>(() => Promise.resolve({ status: 'resolved', ownership: 'existing', src: URL_A }));
  const release = vi.fn<ClipboardResolverAdapter['releaseUncommitted']>(() => Promise.resolve({ status: 'released' }));
  const allow = vi.fn<ClipboardResolverOperationOptions['allowPersistentURL']>(() => true);
  const operation = createClipboardResolverOperation({ operationId: 'operation-1', assets: [asset()],
    adapter: { idempotency: 'none', resolve, releaseUncommitted: release }, allowPersistentURL: allow, ...input });
  return { operation, resolve, release, allow };
}
async function start(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }

function privateDiagnostics(operation: ClipboardResolverOperation): string {
  return JSON.stringify(operation.snapshot().diagnostics);
}

describe('private clipboard resolver ownership', () => {
  it('starts once with frozen stable identities and never owns existing resources', async () => { await Promise.resolve();
    const { operation, resolve, release, allow } = fixture();
    expect(operation.beginApply()).toBe(false);
    expect((await operation.settled()).resolution).toBe('not-started');
    expect(resolve).not.toHaveBeenCalled();
    const first = operation.resolve();
    expect(operation.resolve()).toBe(first);
    const result = await first;
    expect(resolve).toHaveBeenCalledTimes(1);
    const request = resolve.mock.calls[0]?.[0];
    expect(request).toMatchObject({ operationId: 'operation-1', assetId: 'a', idempotencyKey: 'operation-1:a', mimeType: 'image/png' });
    expect(Object.isFrozen(request)).toBe(true);
    expect(allow).toHaveBeenCalledWith(URL_A, { operationId: 'operation-1', assetId: 'a', mimeType: 'image/png' });
    expect(result).toEqual({ status: 'ready', assets: [{ assetId: 'a', src: URL_A, ownership: 'existing' }] });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.status !== 'ready') throw new Error('Expected ready');
    expect(Object.isFrozen(result.assets)).toBe(true);
    expect(Object.isFrozen(result.assets[0])).toBe(true);
    expect(operation.beginApply()).toBe(true);
    expect(operation.beginApply()).toBe(false);
    expect(operation.recordAcceptance('accepted')).toBe(true);
    operation.cancel();
    expect(operation.snapshot().phase).toBe('accepted');
    expect(operation.recordAcceptance('known-unapplied')).toBe(false);
    await operation.settled();
    expect(release).not.toHaveBeenCalled();
  });

  it('shares duplicate registrations for one asset and compensates only once without retries', async () => { await Promise.resolve();
    const { operation, resolve, release } = fixture();
    resolve.mockImplementation(async request => { await Promise.resolve();
      const one = request.registerCreated('owned');
      expect(request.registerCreated('owned')).toBe(one);
      return { status: 'resolved', ownership: 'created', resource: one!, src: URL_A };
    });
    expect((await operation.resolve()).status).toBe('ready');
    expect(operation.snapshot().registeredResources).toBe(1);
    operation.cancel(); operation.cancel();
    expect(operation.beginApply()).toBe(false);
    expect(operation.recordAcceptance('accepted')).toBe(false);
    const report = await operation.settled();
    expect(release).toHaveBeenCalledExactlyOnceWith({ operationId: 'operation-1', assetId: 'a', idempotencyKey: 'operation-1:a', handle: 'owned' });
    expect(report).toMatchObject({ phase: 'unapplied', ownership: 'released', registeredResources: 1, releasedResources: 1 });
    await operation.settled(); void operation.resolve();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each(['accepted', 'uncertain'] as const)('retains created resources after %s through cancellation and callback failure', async outcome => {
    const { operation, resolve, release } = fixture();
    resolve.mockImplementation(request => Promise.resolve(created(request)));
    await operation.resolve();
    expect(operation.beginApply()).toBe(true);
    expect(operation.recordAcceptance(outcome)).toBe(true);
    try { throw new Error('Synthetic observer failure'); } catch { operation.cancel(); }
    operation.cancel();
    expect(operation.recordAcceptance('known-unapplied')).toBe(false);
    const report = await operation.settled();
    expect(report.phase).toBe(outcome);
    expect(report.releasedResources).toBe(0);
    expect(release).not.toHaveBeenCalled();
    expect(operation.resolve()).toBe(operation.resolve());
  });

  it('protects applying work before callbacks and allows a later accepted receipt to supersede uncertainty', async () => { await Promise.resolve();
    const { operation, resolve, release } = fixture();
    resolve.mockImplementation(request => Promise.resolve(created(request)));
    await operation.resolve();
    expect(operation.recordAcceptance('accepted')).toBe(false);
    expect(operation.beginApply()).toBe(true);
    operation.cancel();
    expect(operation.snapshot().phase).toBe('uncertain');
    expect(operation.recordAcceptance('known-unapplied')).toBe(false);
    expect(operation.recordAcceptance('accepted')).toBe(true);
    expect((await operation.settled()).phase).toBe('accepted');
    expect(release).not.toHaveBeenCalled();
  });

  it('accepts an explicit known-unapplied proof after beginning the guarded apply phase', async () => { await Promise.resolve();
    const { operation, resolve, release } = fixture();
    resolve.mockImplementation(request => Promise.resolve(created(request)));
    await operation.resolve(); operation.beginApply();
    expect(operation.recordAcceptance('known-unapplied')).toBe(true);
    await operation.settled();
    expect(release).toHaveBeenCalledTimes(1);
    expect(operation.beginApply()).toBe(false);
  });

  it('requires every asset to resolve successfully before application', async () => { await Promise.resolve();
    const second = deferred<ClipboardResolverAdapterResult>();
    const { operation, resolve } = fixture({ assets: [asset('a'), asset('b')] });
    resolve.mockImplementation(async request => request.assetId === 'a'
      ? { status: 'resolved', ownership: 'existing', src: URL_A } : second.promise);
    const result = operation.resolve();
    await start();
    expect(operation.beginApply()).toBe(false);
    second.resolve({ status: 'resolved', ownership: 'existing', src: 'https://storage.example/b.png' });
    expect((await result).status).toBe('ready');
    expect(operation.beginApply()).toBe(true);
    expect(resolve.mock.calls.map(call => call[0].idempotencyKey)).toEqual(['operation-1:a', 'operation-1:b']);
  });

  it('captures resources created after abort and waits for their actual compensation', async () => { await Promise.resolve();
    const pending = deferred<ClipboardResolverAdapterResult>();
    const cleaning = deferred<ClipboardResolverReleaseResult>();
    const { operation, resolve, release, allow } = fixture();
    let request!: ClipboardResolverRequest;
    resolve.mockImplementation(value => { request = value; return pending.promise; });
    release.mockReturnValue(cleaning.promise);
    const result = operation.resolve(); await start();
    operation.cancel();
    expect(request.signal.aborted).toBe(true);
    expect(operation.snapshot()).toMatchObject({ pendingResolvers: 1, ownership: 'cleanup-pending' });
    const finished = vi.fn();
    const settled = operation.settled().then(finished);
    await start(); expect(finished).not.toHaveBeenCalled();
    pending.resolve(created(request, 'late-owned'));
    expect((await result).status).toBe('cancelled');
    await start();
    expect(release).toHaveBeenCalledTimes(1);
    expect(finished).not.toHaveBeenCalled();
    cleaning.resolve({ status: 'released' }); await settled;
    expect(finished).toHaveBeenCalledWith(expect.objectContaining({ ownership: 'released', releasedResources: 1 }));
    expect(allow).not.toHaveBeenCalled();
    expect(operation.beginApply()).toBe(false);
  });

  it.each(['before-cancel', 'after-cancel'] as const)('defers %s creation cleanup until its resolver settles', async registration => {
    const pending = deferred<ClipboardResolverAdapterResult>();
    const { operation, resolve, release } = fixture();
    let request!: ClipboardResolverRequest;
    let resource: ClipboardCreatedResource | undefined;
    let resolverSettled = false;
    let storedObjectExists = false;
    resolve.mockImplementation(value => {
      request = value;
      if (registration === 'before-cancel') {
        storedObjectExists = true;
        resource = request.registerCreated('owned');
      }
      return pending.promise;
    });
    release.mockImplementation(() => {
      expect(resolverSettled).toBe(true);
      storedObjectExists = false;
      return Promise.resolve({ status: 'released' });
    });
    const result = operation.resolve();
    await start();
    operation.cancel();
    if (registration === 'after-cancel') {
      storedObjectExists = true;
      resource = request.registerCreated('owned');
    }
    const settled = operation.settled();
    await start();
    expect(release).not.toHaveBeenCalled();
    expect(operation.snapshot()).toMatchObject({ phase: 'unapplied', pendingResolvers: 1, pendingReleases: 0, releasedResources: 0 });
    expect(resource).toBeDefined();
    expect(storedObjectExists).toBe(true);
    // A resolver may complete a final write after ignoring cancellation. Cleanup
    // must follow that write rather than permit it to recreate a deleted object.
    storedObjectExists = true;
    resolverSettled = true;
    pending.resolve({ status: 'resolved', ownership: 'created', resource: resource!, src: URL_A });
    expect((await result).status).toBe('cancelled');
    expect(await settled).toMatchObject({ ownership: 'released', releasedResources: 1, pendingResolvers: 0 });
    expect(release).toHaveBeenCalledTimes(1);
    expect(storedObjectExists).toBe(false);
  });

  it('cleans a settled asset immediately while awaiting another asset resolver', async () => {
    const pending = deferred<ClipboardResolverAdapterResult>();
    const { operation, resolve, release } = fixture({ assets: [asset('a'), asset('b')] });
    let second: ClipboardResolverAdapterResult | undefined;
    resolve.mockImplementation(request => {
      const result = created(request, `owned-${request.assetId}`);
      if (request.assetId === 'a') return Promise.resolve(result);
      second = result;
      return pending.promise;
    });
    const result = operation.resolve();
    await start();
    expect(second).toBeDefined();
    operation.cancel();
    await start();
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0]?.[0]).toMatchObject({ assetId: 'a', handle: 'owned-a' });
    expect(operation.snapshot()).toMatchObject({ pendingResolvers: 1, registeredResources: 2, releasedResources: 1 });
    pending.resolve(second!);
    await result;
    expect(await operation.settled()).toMatchObject({ ownership: 'released', releasedResources: 2 });
    expect(release.mock.calls.map(call => call[0].assetId)).toEqual(['a', 'b']);
  });

  it.each(['rejected', 'explicit-failure'] as const)('opens deferred compensation after %s resolver settlement', async outcome => {
    const pending = deferred<ClipboardResolverAdapterResult>();
    const { operation, resolve, release } = fixture();
    resolve.mockImplementation(request => {
      request.registerCreated('owned');
      return pending.promise;
    });
    const result = operation.resolve();
    await start();
    operation.cancel();
    await start();
    expect(release).not.toHaveBeenCalled();
    if (outcome === 'rejected') pending.reject(new Error('Synthetic late failure'));
    else pending.resolve({ status: 'failed', creation: 'registered' });
    expect((await result).status).toBe('cancelled');
    expect(await operation.settled()).toMatchObject({
      ownership: outcome === 'rejected' ? 'recovery-pending' : 'released', releasedResources: 1,
    });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('treats a thrown resolver as unknown creation even after all registered handles are released', async () => { await Promise.resolve();
    const { operation, resolve, release } = fixture();
    resolve.mockImplementation(async request => { await Promise.resolve(); request.registerCreated('private-handle'); throw new Error('private source /secret/file.png'); });
    expect((await operation.resolve()).status).toBe('failed');
    const report = await operation.settled();
    expect(release).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({ ownership: 'recovery-pending', releasedResources: 1 });
    expect(report.recovery).toEqual([{ assetId: 'a', idempotencyKey: 'operation-1:a', reason: 'unknown-creation' }]);
    expect(JSON.stringify(report)).not.toContain('/secret/');
    expect(JSON.stringify(report)).not.toContain('private-handle');
  });

  it.each(['none', 'registered', 'unknown'] as const)('accounts for an explicit partial failure declaring %s creation', async creation => {
    const { operation, resolve, release } = fixture();
    resolve.mockImplementation(async request => { await Promise.resolve();
      if (creation !== 'none') request.registerCreated('owned');
      return { status: 'failed', creation, recoveryToken: 'host-recovery:1' };
    });
    await operation.resolve(); const report = await operation.settled();
    expect(release).toHaveBeenCalledTimes(creation === 'none' ? 0 : 1);
    expect(report.ownership).toBe(creation === 'unknown' ? 'recovery-pending' : 'released');
    if (creation === 'unknown') expect(report.recovery[0]?.token).toBe('host-recovery:1');
  });

  it('does not infer no creation from an unregistered rejected promise', async () => { await Promise.resolve();
    const { operation, resolve } = fixture();
    resolve.mockRejectedValue(new Error('Unknown server outcome'));
    await operation.resolve();
    expect(await operation.settled()).toMatchObject({ registeredResources: 0, ownership: 'recovery-pending' });
  });

  it('rejects foreign or fabricated created-resource capabilities without compensating them', async () => { await Promise.resolve();
    const first = fixture();
    let foreign!: ClipboardCreatedResource;
    first.resolve.mockImplementation(async request => { await Promise.resolve();
      foreign = request.registerCreated('first-owned')!;
      return { status: 'resolved', src: URL_A, ownership: 'created', resource: foreign };
    });
    await first.operation.resolve();
    for (const token of [foreign, Object.freeze({}) as ClipboardCreatedResource]) {
      const other = fixture();
      other.resolve.mockResolvedValue({ status: 'resolved', src: URL_A, ownership: 'created', resource: token });
      expect((await other.operation.resolve()).status).toBe('failed');
      expect((await other.operation.settled()).ownership).toBe('recovery-pending');
      expect(other.release).not.toHaveBeenCalled();
    }
    expect(first.release).not.toHaveBeenCalled();
    first.operation.cancel(); await first.operation.settled();
    expect(first.release).toHaveBeenCalledTimes(1);
  });

  it('does not transfer one created handle between assets or compensate it twice', async () => { await Promise.resolve();
    const { operation, resolve, release } = fixture({ assets: [asset('a'), asset('b')] });
    resolve.mockImplementation(async request => { await Promise.resolve();
      const resource = request.registerCreated('same-resource');
      return resource === undefined ? { status: 'failed', creation: 'none' }
        : { status: 'resolved', src: URL_A, ownership: 'created', resource };
    });
    await operation.resolve();
    expect(await operation.settled()).toMatchObject({ registeredResources: 1, releasedResources: 1, ownership: 'recovery-pending' });
    expect(release).toHaveBeenCalledTimes(1);
    expect(privateDiagnostics(operation)).toContain('ownership-conflict');
  });

  it('keeps unknown ownership sticky after a resource registration limit, regardless of adapter claims', async () => { await Promise.resolve();
    const { operation, resolve, release } = fixture({ limits: { maxCreatedResources: 1, maxDiagnostics: 0 } });
    resolve.mockImplementation(async request => { await Promise.resolve();
      expect(request.registerCreated('one')).toBeDefined();
      expect(request.registerCreated('two')).toBeUndefined();
      return { status: 'failed', creation: 'none' };
    });
    await operation.resolve();
    const report = await operation.settled();
    expect(report).toMatchObject({ ownership: 'recovery-pending', registeredResources: 1, releasedResources: 1, diagnostics: [], diagnosticsTruncated: true });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each(['', 'private handle', '\u0000private', 'x'.repeat(1025)])('accounts honestly for a refused cleanup handle (%#)', async handle => {
    const { operation, resolve, release } = fixture();
    resolve.mockImplementation(async request => { await Promise.resolve();
      expect(request.registerCreated(handle)).toBeUndefined();
      return { status: 'failed', creation: 'none' };
    });
    await operation.resolve();
    expect((await operation.settled()).ownership).toBe('recovery-pending');
    expect(release).not.toHaveBeenCalled();
    expect(privateDiagnostics(operation)).not.toContain(handle || 'never-include-source');
  });

  it.each(['ready', 'accepted', 'uncertain'] as const)('closes the registration window and reports late resources without changing an old %s snapshot', async phase => {
    const { operation, resolve, release } = fixture();
    let request!: ClipboardResolverRequest;
    resolve.mockImplementation(async input => { await Promise.resolve(); request = input; return created(input); });
    await operation.resolve();
    if (phase !== 'ready') { operation.beginApply(); operation.recordAcceptance(phase); }
    const previous = await operation.settled();
    const json = JSON.stringify(previous);
    expect(request.registerCreated('too-late')).toBeUndefined();
    expect(JSON.stringify(previous)).toBe(json);
    expect(operation.snapshot().ownership).toBe('recovery-pending');
    expect(operation.beginApply()).toBe(false);
    if (phase !== 'ready') {
      operation.cancel(); operation.recordAcceptance('known-unapplied');
      expect(release).not.toHaveBeenCalled();
    } else {
      operation.cancel(); await operation.settled();
      expect(release).toHaveBeenCalledTimes(1);
    }
  });

  it.each(['blob:https://storage.example/id', 'file:///private/image.png', 'cid:1', 'data:image/png;base64,aA==',
    'javascript:alert(1)', '//storage.example/x', '/relative.png', 'https://user:secret@storage.example/x',
    'https:\\storage.example/x', ' https://storage.example/x', 'https://storage.example/x\n'])('refuses nonpersistent or unsafe source %s before the host predicate', async src => {
    const { operation, resolve, release, allow } = fixture();
    resolve.mockImplementation(request => Promise.resolve(created(request, 'owned', src)));
    expect((await operation.resolve()).status).toBe('failed');
    expect((await operation.settled()).ownership).toBe('released');
    expect(release).toHaveBeenCalledTimes(1);
    expect(allow).not.toHaveBeenCalled();
    expect(privateDiagnostics(operation)).not.toContain(src);
  });

  it('supplies only a bounded canonical HTTP(S) source to the explicit host policy', async () => { await Promise.resolve();
    const { operation, resolve, allow } = fixture();
    resolve.mockResolvedValue({ status: 'resolved', ownership: 'existing', src: 'HTTPS://STORAGE.EXAMPLE:443/a b.png' });
    // Whitespace is rejected before URL normalization or a host override.
    expect((await operation.resolve()).status).toBe('failed');
    expect(allow).not.toHaveBeenCalled();
    const second = fixture();
    second.resolve.mockResolvedValue({ status: 'resolved', ownership: 'existing', src: 'HTTPS://STORAGE.EXAMPLE:443/a%20b.png' });
    expect(await second.operation.resolve()).toEqual({ status: 'ready', assets: [{ assetId: 'a', ownership: 'existing', src: 'https://storage.example/a%20b.png' }] });
    expect(second.allow.mock.calls[0]?.[0]).toBe('https://storage.example/a%20b.png');
  });

  it.each(['reject', 'throw', 'cancel'] as const)('revalidates around a host URL policy that can %s', async action => {
    const { operation, resolve, release, allow } = fixture();
    resolve.mockImplementation(request => Promise.resolve(created(request)));
    allow.mockImplementation(() => {
      expect(operation.beginApply()).toBe(false);
      expect(operation.resolve()).toBe(operation.resolve());
      if (action === 'throw') throw new Error('Private URL policy failure');
      if (action === 'cancel') operation.cancel();
      return action === 'cancel';
    });
    expect((await operation.resolve()).status).toBe(action === 'cancel' ? 'cancelled' : 'failed');
    expect((await operation.settled()).ownership).toBe('released');
    expect(release).toHaveBeenCalledTimes(1);
    expect(privateDiagnostics(operation)).not.toContain('Private URL');
  });

  it.each(['throw', 'pending', 'invalid', 'long-token'] as const)('keeps actionable private identity when compensation returns %s', async outcome => {
    const { operation, resolve, release } = fixture();
    resolve.mockImplementation(request => Promise.resolve(created(request)));
    release.mockImplementation(async () => { await Promise.resolve();
      if (outcome === 'throw') throw new Error('Private cleanup detail');
      if (outcome === 'pending') return { status: 'cleanup-pending', retryToken: 'host-cleanup:1' };
      if (outcome === 'long-token') return { status: 'cleanup-pending', retryToken: 'x'.repeat(1025) };
      return { status: 'unknown' } as unknown as ClipboardResolverReleaseResult;
    });
    await operation.resolve(); operation.cancel();
    const report = await operation.settled();
    expect(report).toMatchObject({ ownership: 'cleanup-pending', releasedResources: 0 });
    expect(report.recovery).toEqual([{ assetId: 'a', idempotencyKey: 'operation-1:a', reason: 'cleanup-pending', resourceId: 1,
      ...(outcome === 'pending' ? { token: 'host-cleanup:1' } : {}) }]);
    operation.cancel(); await operation.settled();
    expect(release).toHaveBeenCalledTimes(1);
    expect(privateDiagnostics(operation)).not.toContain('host-cleanup');
    expect(privateDiagnostics(operation)).not.toContain('Private cleanup');
  });

  it('cannot reenter application once compensation is allowed', async () => { await Promise.resolve();
    const { operation, resolve, release } = fixture();
    resolve.mockImplementation(request => Promise.resolve(created(request)));
    release.mockImplementation(async () => { await Promise.resolve();
      expect(operation.beginApply()).toBe(false);
      expect(operation.recordAcceptance('accepted')).toBe(false);
      operation.cancel();
      return { status: 'released' };
    });
    await operation.resolve(); operation.cancel(); await operation.settled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('snapshots callbacks, identities and array length before asynchronous work', async () => { await Promise.resolve();
    const pending = deferred<ClipboardResolverAdapterResult>();
    const mutable = { ...asset() };
    const inputs = [mutable];
    const resolve = vi.fn<ClipboardResolverAdapter['resolve']>(() => pending.promise);
    const release = vi.fn<ClipboardResolverAdapter['releaseUncommitted']>(() => Promise.resolve({ status: 'released' }));
    const adapter: { idempotency: 'none'; resolve: ClipboardResolverAdapter['resolve']; releaseUncommitted: ClipboardResolverAdapter['releaseUncommitted'] } = { idempotency: 'none', resolve, releaseUncommitted: release };
    const allow = vi.fn(() => true);
    const options = { operationId: 'operation-1', assets: inputs, adapter, allowPersistentURL: allow };
    const operation = createClipboardResolverOperation(options);
    const result = operation.resolve(); await start();
    mutable.assetId = 'changed'; mutable.idempotencyKey = 'changed'; inputs.push(asset('extra'));
    adapter.resolve = vi.fn<ClipboardResolverAdapter['resolve']>(() => Promise.resolve({ status: 'failed', creation: 'unknown' }));
    adapter.releaseUncommitted = vi.fn<ClipboardResolverAdapter['releaseUncommitted']>(() => Promise.resolve({ status: 'cleanup-pending', retryToken: 'wrong' }));
    options.allowPersistentURL = vi.fn(() => false);
    pending.resolve(created(resolve.mock.calls[0]?.[0] as ClipboardResolverRequest));
    expect((await result).status).toBe('ready'); operation.cancel(); await operation.settled();
    expect(resolve).toHaveBeenCalledTimes(1); expect(allow).toHaveBeenCalledTimes(1); expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0]?.[0]).toMatchObject({ assetId: 'a', idempotencyKey: 'operation-1:a' });
    expect(adapter.resolve).not.toHaveBeenCalled(); expect(adapter.releaseUncommitted).not.toHaveBeenCalled();
  });

  it('bounds URL totals independently of per-URL limits and cleans every known creation', async () => { await Promise.resolve();
    const { operation, resolve, release, allow } = fixture({ assets: [asset('a'), asset('b')], limits: { maxURLUnits: 64, maxTotalURLUnits: 64 } });
    resolve.mockImplementation(request => Promise.resolve(created(request, `owned-${request.assetId}`)));
    expect((await operation.resolve()).status).toBe('failed');
    expect((await operation.settled()).releasedResources).toBe(2);
    expect(release).toHaveBeenCalledTimes(2); expect(allow).toHaveBeenCalledTimes(1);
  });

  it('bounds aggregate handles and preserves unknown ownership when an adapter catches a refusal', async () => { await Promise.resolve();
    const { operation, resolve, release } = fixture({ limits: { maxHandleUnits: 4, maxTotalHandleUnits: 4 } });
    resolve.mockImplementation(async request => { await Promise.resolve();
      expect(request.registerCreated('one')).toBeDefined();
      expect(request.registerCreated('two')).toBeUndefined();
      return { status: 'failed', creation: 'registered' };
    });
    await operation.resolve(); expect((await operation.settled()).ownership).toBe('recovery-pending');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('does not start work after cancellation, retry a failed call, or fetch anything itself', async () => { await Promise.resolve();
    const { operation, resolve, release } = fixture();
    operation.cancel();
    expect(await operation.resolve()).toEqual({ status: 'cancelled' });
    expect(resolve).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled();
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network is allowed'));
    try {
      const next = fixture(); next.resolve.mockRejectedValue(new Error('Failure'));
      const promise = next.operation.resolve(); await promise;
      expect(next.operation.resolve()).toBe(promise); await next.operation.settled();
      expect(next.resolve).toHaveBeenCalledTimes(1);
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });

  it('rejects invalid configuration, duplicate identities and non-native or mismatched Blobs before callbacks', () => {
    const resolve = vi.fn<ClipboardResolverAdapter['resolve']>();
    const base: ClipboardResolverOperationOptions = { operationId: 'operation-1', assets: [asset()],
      adapter: { idempotency: 'operation-asset-key', resolve, releaseUncommitted: vi.fn() }, allowPersistentURL: () => true };
    for (const changes of [
      { operationId: '' }, { operationId: 'private source' }, { assets: [] }, { assets: [asset(), asset()] },
      { assets: [asset(), { ...asset('b'), idempotencyKey: 'operation-1:a' }] },
      { assets: [{ ...asset(), blob: { size: PNG.length, type: 'image/png' } as Blob }] },
      { assets: [{ ...asset(), blob: new Blob([PNG], { type: 'image/jpeg' }) }] },
      { assets: [{ ...asset(), blob: new Blob([], { type: 'image/png' }) }] },
      { adapter: { ...base.adapter, idempotency: undefined } },
      { allowPersistentURL: undefined },
    ]) expect(() => createClipboardResolverOperation({ ...base, ...changes } as ClipboardResolverOperationOptions)).toThrow();
    for (const name of Object.keys(CLIPBOARD_RESOLVER_LIMITS)) {
      for (const value of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER]) {
        expect(() => createClipboardResolverOperation({ ...base, limits: { [name]: value } })).toThrow(RangeError);
      }
    }
    expect(() => createClipboardResolverOperation({ ...base, limits: { maxBlobBytes: 1 } })).toThrow(RangeError);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('does not accept a registered-creation failure when no resources were registered', async () => {
    const { operation, resolve } = fixture();
    resolve.mockResolvedValue({ status: 'failed', creation: 'registered' });
    await operation.resolve();
    expect(await operation.settled()).toMatchObject({ ownership: 'recovery-pending', registeredResources: 0 });
    expect(privateDiagnostics(operation)).toContain('invalid-result');
  });

  it.each([false, true])('quarantines a rejected asynchronous URL policy even when it cancels: %s', async cancel => {
    const { operation, resolve, release, allow } = fixture();
    resolve.mockImplementation(request => Promise.resolve(created(request)));
    allow.mockImplementation((() => {
      if (cancel) operation.cancel();
      return Promise.reject(new Error('Invalid async policy'));
    }) as unknown as ClipboardResolverOperationOptions['allowPersistentURL']);
    expect((await operation.resolve()).status).toBe(cancel ? 'cancelled' : 'failed');
    expect((await operation.settled()).ownership).toBe('released');
    await start();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('never trusts a result getter that throws after partial resource creation', async () => {
    const { operation, resolve, release } = fixture();
    resolve.mockImplementation(request => {
      const result = created(request);
      Object.defineProperty(result, 'ownership', { get: () => { throw new Error('Private result detail'); } });
      return Promise.resolve(result);
    });
    expect((await operation.resolve()).status).toBe('failed');
    expect((await operation.settled()).ownership).toBe('recovery-pending');
    expect(release).toHaveBeenCalledTimes(1);
    expect(privateDiagnostics(operation)).not.toContain('Private');
  });

  it('never treats a throwing cleanup-result getter as released', async () => {
    const { operation, resolve, release } = fixture();
    resolve.mockImplementation(request => Promise.resolve(created(request)));
    release.mockImplementation(() => Promise.resolve(Object.defineProperty({}, 'status', {
      get: () => { throw new Error('Private cleanup detail'); },
    }) as ClipboardResolverReleaseResult));
    await operation.resolve(); operation.cancel();
    expect((await operation.settled()).ownership).toBe('cleanup-pending');
    expect(privateDiagnostics(operation)).not.toContain('Private');
  });

  it('ignores custom input iteration and appends after its captured asset count', async () => {
    const items = [asset()];
    Object.defineProperty(items, Symbol.iterator, { value: () => { throw new Error('Custom iterator'); } });
    const input = items[0]!;
    Object.defineProperty(input, 'assetId', { get: () => { items.push(asset('extra')); return 'a'; } });
    const { operation, resolve } = fixture({ assets: items });
    expect((await operation.resolve()).status).toBe('ready');
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('freezes all report containers and keeps diagnostics independent from hidden source data', async () => { await Promise.resolve();
    const { operation, resolve } = fixture();
    resolve.mockImplementation(async request => { await Promise.resolve(); request.registerCreated('private-source-handle'); return { status: 'failed', creation: 'unknown', recoveryToken: 'private-recovery-token' }; });
    await operation.resolve();
    const report = await operation.settled();
    for (const value of [report, report.recovery, report.diagnostics, ...report.recovery, ...report.diagnostics]) expect(Object.isFrozen(value)).toBe(true);
    expect(JSON.stringify(report.diagnostics)).not.toContain('private-');
    expect(JSON.stringify(report)).not.toContain(URL_A);
    expect(JSON.stringify(report)).not.toContain('private-source-handle');
  });
});
