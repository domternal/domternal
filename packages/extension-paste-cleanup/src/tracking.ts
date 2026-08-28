import type { EditorView } from '@domternal/pm/view';
import type { NormalizePasteHTMLResult, PasteFormatting } from './html/types.js';
import { pasteDocumentRevision, readPasteReceipt } from './operations.js';
import type { PasteOperationResult, PasteNormalizationContext } from './operations.js';

let nextEditor = 0;

export type PendingPasteOperation = Readonly<Pick<PasteOperationResult,
  'operationId' | 'source' | 'formatting' | 'diagnostics' | 'diagnosticsTruncated'>>;

/** Operation data contains bounded diagnostics, never source HTML or clipboard files. */
export function createPasteTracking(
  formatting: PasteFormatting,
  onPasteResult: ((result: PasteOperationResult) => void) | undefined,
): {
  create: (result?: NormalizePasteHTMLResult) => PendingPasteOperation;
  context: (operation: PendingPasteOperation) => PasteNormalizationContext;
  observe: (view: EditorView) => void;
  skip: (operation: PendingPasteOperation) => void;
  finish: (view: EditorView, operation: PendingPasteOperation, rejected: boolean) => void;
} {
  const scope = ++nextEditor;
  let sequence = 0;
  interface Waiting { operation: PendingPasteOperation; skipped?: boolean; accepted?: ReturnType<typeof readPasteReceipt> }
  const waiting = new Map<string, Waiting>();
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
    finish(view, operation, rejected) {
      const entry: Waiting = { operation };
      waiting.set(operation.operationId, entry);
      queueMicrotask(() => {
        // Finish before notifying the host, so reentrant paste creates a separate operation.
        waiting.delete(operation.operationId);
        const receipt = readPasteReceipt(view, operation.operationId) ?? entry.accepted;
        const currentRevision = pasteDocumentRevision(view);
        const fresh = receipt !== undefined && !view.isDestroyed && receipt.references.documentRevision === currentRevision;
        const references = fresh ? receipt.references : Object.freeze({
          referenceId: operation.operationId, precision: 'operation' as const,
          documentRevision: currentRevision, ranges: Object.freeze([]), expired: true,
        });
        const result: PasteOperationResult = Object.freeze({
          ...operation,
          status: rejected ? 'rejected' : receipt === undefined ? entry.skipped === true ? 'noop' : 'untracked' : receipt.changed ? 'applied' : 'noop',
          references,
        });
        try { onPasteResult?.(result); } catch { /* Host feedback cannot revoke an accepted paste. */ }
      });
    },
  };
}
