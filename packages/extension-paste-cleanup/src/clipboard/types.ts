import type { ClipboardAssetLimits } from './limits.js';
import type { ClipboardImageBinding, ClipboardImageReference } from './references.js';
import type { ClipboardResolverAdapter, ClipboardResolverReport } from './resolverTypes.js';

export interface ClipboardImageItemMetadata {
  readonly itemIndex: number;
  readonly kind: string;
  readonly declaredType: string;
  readonly fileType: string | null;
  readonly fileSize: number | null;
  readonly available: boolean;
}

/** Bounded source references are private matching data, never feedback text. */
export interface ClipboardImageMatchContext {
  readonly operationId: string;
  readonly references: readonly ClipboardImageReference[];
  readonly items: readonly ClipboardImageItemMetadata[];
}

interface ClipboardImageAssetCommonOptions {
  /** Supply explicit placement bindings. No filename, CID, or positional matching is inferred. */
  readonly match?: (context: ClipboardImageMatchContext) => readonly ClipboardImageBinding[];
  /** Missing bindings reject the entire paste unless omissions are explicitly enabled. */
  readonly unresolved?: 'reject' | 'omit';
  readonly limits?: Partial<ClipboardAssetLimits>;
}

export interface ClipboardEmbeddedImageAssetOptions extends ClipboardImageAssetCommonOptions {
  readonly mode: 'embedded';
}

/** Host-only resource ownership information. Recovery tokens must not appear in user feedback. */
export type ClipboardAssetRecoveryReport = ClipboardResolverReport;

export interface ClipboardResolvedImageAssetOptions extends ClipboardImageAssetCommonOptions {
  readonly mode: 'resolver';
  readonly resolver: ClipboardResolverAdapter;
  /** Exact HTTP(S) origins approved for persistent resolver results. */
  readonly sourcePolicy: { readonly allowedOrigins: readonly string[] };
  /** May run after cancellation or editor destruction while tracked adapter work settles. */
  readonly onRecovery: (report: ClipboardAssetRecoveryReport) => void;
}

export type ClipboardImageAssetOptions = ClipboardEmbeddedImageAssetOptions | ClipboardResolvedImageAssetOptions;

export interface PastePreparationProgress {
  readonly operationId: string;
  readonly phase: 'preparing';
  readonly cancel: () => void;
}
