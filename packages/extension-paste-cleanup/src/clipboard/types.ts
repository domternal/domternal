import type { ClipboardAssetLimits } from './limits.js';
import type { ClipboardImageBinding, ClipboardImageReference } from './references.js';

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

export interface ClipboardImageAssetOptions {
  readonly mode: 'embedded';
  /** Supply explicit placement bindings. No filename, CID, or positional matching is inferred. */
  readonly match?: (context: ClipboardImageMatchContext) => readonly ClipboardImageBinding[];
  /** Missing bindings reject the entire paste unless omissions are explicitly enabled. */
  readonly unresolved?: 'reject' | 'omit';
  readonly limits?: Partial<ClipboardAssetLimits>;
}

export interface PastePreparationProgress {
  readonly operationId: string;
  readonly phase: 'preparing';
  readonly cancel: () => void;
}
