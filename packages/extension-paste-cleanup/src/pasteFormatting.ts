import type { PasteFormatting } from './html/types.js';

/** A synchronous policy choice for one paste, without access to clipboard content or browser events. */
export interface PasteFormattingContext {
  readonly defaultFormatting: PasteFormatting;
  readonly origin: 'native' | 'programmatic';
}

export type PasteFormattingResolver = (context: Readonly<PasteFormattingContext>) => PasteFormatting | undefined;

/** Private immutable policy carried from an original attempt into its authorized image replay. */
export interface PasteFormattingSnapshot {
  readonly formatting: PasteFormatting;
}

/** Capture once per Core attempt. Repeated reads and an authorized asynchronous replay keep the captured choice. */
export function createPasteFormattingPolicy(defaultFormatting: PasteFormatting, resolve?: PasteFormattingResolver): {
  capture: (attempt: object | undefined, origin: PasteFormattingContext['origin']) => Readonly<PasteFormattingSnapshot>;
  read: (attempt: object | undefined) => Readonly<PasteFormattingSnapshot>;
  inherit: (attempt: object | undefined, snapshot: Readonly<PasteFormattingSnapshot>) => boolean;
} {
  const fallback: Readonly<PasteFormattingSnapshot> = Object.freeze({ formatting: defaultFormatting });
  const snapshots = new WeakMap<object, Readonly<PasteFormattingSnapshot>>();
  const owned = new WeakSet([fallback]);
  const read = (attempt: object | undefined): Readonly<PasteFormattingSnapshot> => attempt === undefined
    ? fallback : snapshots.get(attempt) ?? fallback;
  return {
    read,
    capture(attempt, origin) {
      if (attempt === undefined) return fallback;
      const previous = snapshots.get(attempt);
      if (previous !== undefined) return previous;
      // A reentrant host callback sees this attempt's provisional default, never a second policy invocation.
      snapshots.set(attempt, fallback);
      let formatting = defaultFormatting;
      try {
        const value: unknown = resolve?.(Object.freeze({ defaultFormatting, origin }));
        if (value === 'preserve' || value === 'adapt') formatting = value;
        // An incorrectly asynchronous callback cannot change an active paste or leak an unhandled rejection.
        else if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
          void Promise.resolve(value).catch(() => undefined);
        }
      } catch { /* Host policy failures retain the configured cleanup policy. */ }
      const snapshot: Readonly<PasteFormattingSnapshot> = formatting === defaultFormatting ? fallback : Object.freeze({ formatting });
      owned.add(snapshot);
      snapshots.set(attempt, snapshot);
      return snapshot;
    },
    inherit(attempt, snapshot) {
      if (attempt === undefined || !owned.has(snapshot) || snapshots.has(attempt)) return false;
      snapshots.set(attempt, snapshot);
      return true;
    },
  };
}
