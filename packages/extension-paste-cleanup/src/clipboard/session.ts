import type { Node, Schema } from '@domternal/pm/model';
import type { Selection } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import { pasteCleanupKey, pasteDocumentRevision } from '../operations.js';
import { sameClipboardImageDestination } from './destination.js';
import type { ClipboardImageDestination } from './destination.js';

export type ClipboardSessionPhase = 'preparing' | 'ready' | 'applying' | 'settled';
export type ClipboardSessionCancellation =
  | 'cancelled' | 'superseded' | 'destroyed' | 'readonly' | 'adopted'
  | 'document-changed' | 'selection-changed' | 'schema-changed'
  | 'destination-changed' | 'unavailable-destination' | 'invalid-target';

interface Target {
  readonly schema: Schema;
  readonly document: Node;
  readonly revision: number;
  readonly selection: Selection;
  readonly ownerDocument: Document;
  readonly destination: ClipboardImageDestination;
}

/** Private lifetime guard. Application receipts, content mutation and result delivery belong to the caller. */
export interface ClipboardSession {
  readonly operationId: string;
  readonly signal: AbortSignal;
  readonly phase: ClipboardSessionPhase;
  readonly cancellation: ClipboardSessionCancellation | undefined;
  readonly destination: ClipboardImageDestination;
  /** Revalidate the current target, including changes made by the destination policy reader. */
  check(): boolean;
  ready(): boolean;
  beginApply(): boolean;
  cancel(): void;
  /** Always inspect the accepted receipt before classifying a cancelled applying session. */
  finish(): void;
}

type StartResult =
  | { readonly status: 'started'; readonly session: ClipboardSession }
  | { readonly status: 'rejected'; readonly reason: ClipboardSessionCancellation };

export interface ClipboardSessionController {
  readonly current: ClipboardSession | undefined;
  start(operationId: string): StartResult;
  /** Call for every installed view update so selection changes cannot disappear after restoration. */
  observe(): void;
  cancel(): void;
  destroy(): void;
}

/** One active preparation per view. No document placeholders, DOM resources or module-time browser work. */
export function createClipboardSessionController(
  view: EditorView,
  readDestination: () => ClipboardImageDestination | undefined,
): ClipboardSessionController {
  let destroyed = false;
  let generation = 0;
  let current: ClipboardSession | undefined;
  let invalidateCurrent: ((reason: ClipboardSessionCancellation) => void) | undefined;

  const baseline = (target?: Target): ClipboardSessionCancellation | undefined => {
    if (destroyed || view.isDestroyed) return 'destroyed';
    if (!view.editable) return 'readonly';
    if (pasteCleanupKey.getState(view.state) === undefined) return 'invalid-target';
    if (target === undefined) return undefined;
    if (view.dom.ownerDocument !== target.ownerDocument) return 'adopted';
    if (view.state.schema !== target.schema) return 'schema-changed';
    if (pasteDocumentRevision(view) !== target.revision || view.state.doc !== target.document) return 'document-changed';
    if (!view.state.selection.eq(target.selection)) return 'selection-changed';
    return undefined;
  };

  const stop = (reason: ClipboardSessionCancellation): void => {
    generation++;
    invalidateCurrent?.(reason);
  };

  return Object.freeze({
    get current() { return current; },
    start(operationId: string): StartResult {
      if (typeof operationId !== 'string' || operationId.length === 0 || operationId.length > 128) throw new RangeError('Invalid clipboard operation identifier');
      const rejected = (reason: ClipboardSessionCancellation): StartResult => Object.freeze({ status: 'rejected', reason });
      const ownGeneration = ++generation;
      invalidateCurrent?.('superseded');
      if (generation !== ownGeneration) return rejected('superseded');
      try {
        const invalid = baseline();
        if (invalid !== undefined) return rejected(invalid);
        const state = view.state;
        const ownerDocument = view.dom.ownerDocument;
        const revision = pasteDocumentRevision(view);
        const destination = readDestination();
        // Policy readers are trusted host callbacks and may synchronously paste, edit or destroy.
        if (generation !== ownGeneration) return rejected('superseded');
        if (destination === undefined) return rejected('unavailable-destination');
        const target: Target = {
          schema: state.schema, document: state.doc, revision, selection: state.selection,
          ownerDocument, destination,
        };
        const stale = baseline(target);
        if (stale !== undefined) return rejected(stale);
        if (destination.schema !== target.schema) return rejected('destination-changed');
        const controller = new AbortController();
        let phase: ClipboardSessionPhase = 'preparing';
        let cancellation: ClipboardSessionCancellation | undefined;
        let checking = false;
        const isSettled = (): boolean => phase === 'settled';
        const release = (): void => {
          if (current === session) { current = undefined; invalidateCurrent = undefined; }
        };
        const invalidate = (reason: ClipboardSessionCancellation): void => {
          if (phase === 'settled' || cancellation !== undefined) return;
          cancellation = reason;
          // Applying may already have accepted content before a host observer cancels or throws.
          // Abort never rewrites that outcome; the caller must finish from its accepted receipt.
          if (phase !== 'applying') { phase = 'settled'; release(); }
          controller.abort();
        };
        const check = (): boolean => {
          if (phase === 'settled' || phase === 'applying' || cancellation !== undefined) return false;
          if (checking) { invalidate('invalid-target'); return false; }
          checking = true;
          try {
            const staleBefore = baseline(target);
            if (staleBefore !== undefined) { invalidate(staleBefore); return false; }
            const live = readDestination();
            if (controller.signal.aborted || isSettled()) return false;
            if (generation !== ownGeneration || current !== session) { invalidate('superseded'); return false; }
            const staleAfter = baseline(target);
            if (staleAfter !== undefined) { invalidate(staleAfter); return false; }
            if (live === undefined || !sameClipboardImageDestination(target.destination, live)) {
              invalidate('destination-changed'); return false;
            }
            return true;
          } catch { invalidate('invalid-target'); return false; }
          finally { checking = false; }
        };
        const session: ClipboardSession = Object.freeze({
          operationId, signal: controller.signal, destination,
          get phase() { return phase; },
          get cancellation() { return cancellation; },
          check,
          ready(): boolean {
            if (phase !== 'preparing' || !check()) return false;
            phase = 'ready'; return true;
          },
          beginApply(): boolean {
            if (phase !== 'ready' || !check()) return false;
            phase = 'applying'; return true;
          },
          cancel: () => { invalidate('cancelled'); },
          finish: () => { phase = 'settled'; release(); },
        });
        current = session;
        invalidateCurrent = invalidate;
        return Object.freeze({ status: 'started', session });
      } catch { return rejected('invalid-target'); }
    },
    observe(): void { if (current?.phase !== 'applying') current?.check(); },
    cancel(): void { stop('cancelled'); },
    destroy(): void { destroyed = true; stop('destroyed'); },
  });
}
