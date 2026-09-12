import type { ClipboardRasterMime } from './destination.js';

/**
 * @experimental One prepared clipboard image a resolver receives: validated, immutable raster
 * bytes with their identity. The resolver ownership protocol may change in a minor release.
 */
export interface ClipboardResolverAsset {
  readonly assetId: string;
  readonly idempotencyKey: string;
  readonly blob: Blob;
  readonly mimeType: ClipboardRasterMime;
}

declare const createdResource: unique symbol;
/** @experimental Authentic capabilities are issued only by the current asset's registerCreated callback. */
export interface ClipboardCreatedResource { readonly [createdResource]: true }

/** @experimental What a resolver's `resolve` receives for one asset. */
export interface ClipboardResolverRequest extends ClipboardResolverAsset {
  readonly operationId: string;
  readonly signal: AbortSignal;
  /** Register immediately after creation, including partial failures and late aborted completion. */
  readonly registerCreated: (handle: string) => ClipboardCreatedResource | undefined;
}

/** @experimental What a resolver's `resolve` returns for one asset. */
export type ClipboardResolverAdapterResult =
  | { readonly status: 'resolved'; readonly src: string; readonly ownership: 'existing' }
  | { readonly status: 'resolved'; readonly src: string; readonly ownership: 'created'; readonly resource: ClipboardCreatedResource }
  | { readonly status: 'failed'; readonly creation: 'none' | 'registered' | 'unknown'; readonly recoveryToken?: string };

/** @experimental What a resolver's `releaseUncommitted` receives for a resource it created. */
export interface ClipboardResolverReleaseRequest {
  readonly operationId: string;
  readonly assetId: string;
  readonly idempotencyKey: string;
  readonly handle: string;
}

/** @experimental What a resolver's `releaseUncommitted` returns. */
export type ClipboardResolverReleaseResult =
  | { readonly status: 'released' }
  | { readonly status: 'cleanup-pending'; readonly retryToken: string };

/**
 * @experimental An application resolver that stores pasted images and owns what it creates.
 * No adapter callback is retried by this foundation, regardless of its declaration.
 */
export interface ClipboardResolverAdapter {
  readonly idempotency: 'none' | 'operation-asset-key';
  /** Creation and registration must stop when this promise settles. */
  readonly resolve: (request: Readonly<ClipboardResolverRequest>) => Promise<ClipboardResolverAdapterResult>;
  readonly releaseUncommitted: (request: Readonly<ClipboardResolverReleaseRequest>) => Promise<ClipboardResolverReleaseResult>;
}

export interface ClipboardResolverLimits {
  readonly maxAssets: number;
  readonly maxCreatedResources: number;
  readonly maxBlobBytes: number;
  readonly maxTotalBlobBytes: number;
  readonly maxURLUnits: number;
  readonly maxTotalURLUnits: number;
  readonly maxHandleUnits: number;
  readonly maxTotalHandleUnits: number;
  readonly maxIdentityUnits: number;
  readonly maxRecoveryTokenUnits: number;
  readonly maxDiagnostics: number;
}

export interface ClipboardResolverSourceContext {
  readonly operationId: string;
  readonly assetId: string;
  readonly mimeType: ClipboardRasterMime;
}

export interface ClipboardResolverOperationOptions {
  readonly operationId: string;
  readonly assets: readonly ClipboardResolverAsset[];
  readonly adapter: ClipboardResolverAdapter;
  /** Approve a canonical absolute HTTP(S) URL after the mandatory baseline checks. */
  readonly allowPersistentURL: (src: string, context: Readonly<ClipboardResolverSourceContext>) => boolean;
  /** Coalesced private reports, including recovery updates before other work settles. */
  readonly onChange?: (report: ClipboardResolverReport) => void;
  readonly limits?: Partial<ClipboardResolverLimits>;
}

/**
 * @experimental Why the resolver reported an asset. The list is open: a minor release can add a
 * code, so keep a default branch when you switch on it.
 */
export type ClipboardResolverDiagnosticCode =
  | 'resolver-failed' | 'unknown-creation' | 'invalid-result' | 'invalid-source'
  | 'invalid-registration' | 'late-registration' | 'resource-limit' | 'ownership-conflict'
  | 'cleanup-failed' | 'cleanup-pending' | 'invalid-cleanup-result';

/** @experimental One resolver diagnostic, naming the asset it concerns. */
export interface ClipboardResolverDiagnostic {
  readonly code: ClipboardResolverDiagnosticCode;
  readonly assetId: string;
}

/** @experimental Recovery identities are private host data. They must not be rendered as diagnostics. */
export interface ClipboardResolverRecovery {
  readonly assetId: string;
  readonly idempotencyKey: string;
  /** The list is open: a minor release can add a reason, so keep a default branch when you switch on it. */
  readonly reason: 'unknown-creation' | 'cleanup-pending' | 'uncertain-acceptance';
  readonly resourceId?: number;
  readonly token?: string;
}

export interface ClipboardResolvedAsset {
  readonly assetId: string;
  readonly src: string;
  readonly ownership: 'existing' | 'created';
}

export type ClipboardResolverResolution =
  | { readonly status: 'ready'; readonly assets: readonly ClipboardResolvedAsset[] }
  | { readonly status: 'failed' | 'cancelled' };

/** @experimental The resolver operation's ownership and recovery state, for the host only. */
export interface ClipboardResolverReport {
  /** Monotonic operation revision. Coalesced notifications can skip intermediate revisions. */
  readonly revision: number;
  /** Terminal application phase with no tracked work; not proof of stopped external side effects. */
  readonly settled: boolean;
  readonly operationId: string;
  readonly idempotency: ClipboardResolverAdapter['idempotency'];
  readonly phase: 'preparing' | 'ready' | 'applying' | 'accepted' | 'uncertain' | 'unapplied';
  readonly resolution: 'not-started' | 'pending' | 'ready' | 'failed' | 'cancelled';
  readonly ownership: 'open' | 'retained' | 'released' | 'cleanup-pending' | 'recovery-pending';
  readonly pendingResolvers: number;
  readonly pendingReleases: number;
  readonly registeredResources: number;
  readonly releasedResources: number;
  readonly recovery: readonly ClipboardResolverRecovery[];
  readonly diagnostics: readonly ClipboardResolverDiagnostic[];
  readonly diagnosticsTruncated: boolean;
}

export interface ClipboardResolverOperation {
  /** Starts once. Repeated calls share the same work, never an adapter retry. */
  resolve(): Promise<ClipboardResolverResolution>;
  /** Requires a complete successful set. Call before any host insertion callback. */
  beginApply(): boolean;
  /** A terminal known-unapplied proof cannot later authorize application. */
  recordAcceptance(outcome: 'accepted' | 'known-unapplied' | 'uncertain'): boolean;
  /** Abort is advisory. Applying cancellation retains resources as uncertain. */
  cancel(): void;
  snapshot(): ClipboardResolverReport;
  /** Waits tracked adapter and cleanup promises. There is no timeout or side-effect-stop guarantee. */
  settled(): Promise<ClipboardResolverReport>;
}
