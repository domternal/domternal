import type { EditorView } from '@domternal/pm/view';
import type { NormalizePasteHTMLResult, PasteFormatting } from './html/types.js';
import { pasteDocumentRevision, readPasteReceipt } from './operations.js';
import type { PasteOperationResult, PasteNormalizationContext, PasteOperationRejectionReason } from './operations.js';

let nextEditor = 0;

export type PendingPasteOperation = Readonly<Pick<PasteOperationResult,
  'operationId' | 'source' | 'formatting' | 'diagnostics' | 'diagnosticsTruncated'>>;

export interface PasteFinishDetails {
  readonly reason?: PasteOperationRejectionReason;
  /** A prepared operation can replace its provisional diagnostics after resolving its assets. */
  readonly normalization?: NormalizePasteHTMLResult;
}

function normalizedOperation(operation: PendingPasteOperation, result?: NormalizePasteHTMLResult): PendingPasteOperation {
  if (result === undefined) return operation;
  return Object.freeze({ ...operation, source: result.source,
    diagnostics: Object.freeze(result.diagnostics.map(diagnostic => Object.freeze({ ...diagnostic }))),
    diagnosticsTruncated: result.diagnosticsTruncated });
}

/** Operation data contains bounded diagnostics, never source HTML or clipboard files. */
export function createPasteTracking(
  formatting: PasteFormatting,
  onPasteResult: ((result: PasteOperationResult) => void) | undefined,
): {
  create: (result?: NormalizePasteHTMLResult) => PendingPasteOperation;
  context: (operation: PendingPasteOperation) => PasteNormalizationContext;
  observe: (view: EditorView) => void;
  /** Installed acceptance survives reference expiry, Undo, destruction, and terminal delivery. */
  hasAcceptedReceipt: (operation: PendingPasteOperation) => boolean;
  skip: (operation: PendingPasteOperation) => void;
  finish: (view: EditorView, operation: PendingPasteOperation, rejected: boolean, details?: PasteFinishDetails) => Promise<PasteOperationResult>;
} {
  const scope = ++nextEditor;
  let sequence = 0;
  interface Waiting {
    operation: PendingPasteOperation;
    rejected: boolean;
    reason: PasteOperationRejectionReason | undefined;
    settled: boolean;
    skipped?: boolean;
    accepted?: ReturnType<typeof readPasteReceipt>;
  }
  const waiting = new Map<string, Waiting>();
  const completions = new WeakMap<PendingPasteOperation, { promise: Promise<PasteOperationResult>; entry: Waiting }>();
  return {
    create(result) {
      return Object.freeze({
        operationId: `paste-${String(scope)}-${String(++sequence)}`,
        source: result?.source ?? 'plain-text', formatting,
        diagnostics: Object.freeze((result?.diagnostics ?? []).map(diagnostic => Object.freeze({ ...diagnostic }))),
        diagnosticsTruncated: result?.diagnosticsTruncated ?? false,
      });
    },
    context: operation => ({ operationId: operation.operationId, formatting: operation.formatting }),
    hasAcceptedReceipt: operation => completions.get(operation)?.entry.accepted !== undefined,
    observe(view) {
      for (const [id, entry] of waiting) {
        const receipt = readPasteReceipt(view, id);
        if (receipt !== undefined) entry.accepted = receipt;
      }
    },
    skip(operation) {
      const entry = waiting.get(operation.operationId);
      if (entry !== undefined) entry.skipped = true;
    },
    finish(view, operation, rejected, details = {}) {
      const previous = completions.get(operation);
      if (previous !== undefined) {
        // A host callback can invalidate the target after tracking starts, before replay.
        // Escalate only a still-pending uncertain outcome; accepted receipts still win.
        if (!previous.entry.settled && !previous.entry.rejected && rejected) {
          previous.entry.rejected = true;
          previous.entry.reason = details.reason;
        }
        return previous.promise;
      }
      const normalized = normalizedOperation(operation, details.normalization);
      const reason = details.reason;
      let resolve!: (result: PasteOperationResult) => void;
      const completion = new Promise<PasteOperationResult>(accept => { resolve = accept; });
      const entry: Waiting = { operation: normalized, rejected, reason, settled: false };
      completions.set(operation, { promise: completion, entry });
      waiting.set(operation.operationId, entry);
      queueMicrotask(() => {
        // Finish before notifying the host, so reentrant paste creates a separate operation.
        entry.settled = true;
        waiting.delete(operation.operationId);
        const receipt = readPasteReceipt(view, operation.operationId) ?? entry.accepted;
        if (receipt !== undefined) entry.accepted = receipt;
        const currentRevision = pasteDocumentRevision(view);
        const fresh = receipt !== undefined && !view.isDestroyed && receipt.references.documentRevision === currentRevision;
        const references = fresh ? receipt.references : Object.freeze({
          referenceId: operation.operationId, precision: 'operation' as const,
          documentRevision: currentRevision, ranges: Object.freeze([]), expired: true,
        });
        const result: PasteOperationResult = Object.freeze({
          ...normalized,
          status: receipt !== undefined ? receipt.changed ? 'applied' : 'noop'
            : entry.rejected ? 'rejected' : entry.skipped === true ? 'noop' : 'untracked',
          ...(receipt === undefined && entry.rejected && entry.reason !== undefined ? { reason: entry.reason } : {}),
          references,
        });
        resolve(result);
        try { onPasteResult?.(result); } catch { /* Host feedback cannot revoke an accepted paste. */ }
      });
      return completion;
    },
  };
}
