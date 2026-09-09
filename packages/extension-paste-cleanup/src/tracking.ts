import type { Node as PMNode, Slice } from '@domternal/pm/model';
import type { EditorView } from '@domternal/pm/view';
import type { NormalizePasteHTMLResult, PasteDiagnostic, PasteFormatting } from './html/types.js';
import { headingOutline } from './html/headingLevels.js';
import type { HeadingOutline } from './html/headingLevels.js';
import { pasteDocumentRevision, readPasteReceipt } from './operations.js';
import type { PasteInsertion, PasteOperationResult, PasteNormalizationContext, PasteOperationRejectionReason } from './operations.js';

let nextEditor = 0;

export type PendingPasteOperation = Readonly<Pick<PasteOperationResult,
  'operationId' | 'source' | 'formatting' | 'diagnostics' | 'diagnosticsTruncated'>>;

export interface PasteFinishDetails {
  readonly reason?: PasteOperationRejectionReason;
  /** A prepared operation can replace its provisional diagnostics after resolving its assets. */
  readonly normalization?: NormalizePasteHTMLResult;
}

/** The headings of a parsed paste slice. */
export interface SliceHeadings {
  /** Every heading node, at any depth. */
  readonly count: number;
  /**
   * The first textblock when it is a heading open at the slice start. ProseMirror can join such a
   * heading into the textblock at the caret instead of inserting it as a node.
   */
  readonly openFirst?: PMNode;
}

/** Measures the headings of the slice a paste inserts. */
export function sliceHeadings(slice: Slice): SliceHeadings {
  let count = 0;
  slice.content.descendants(node => {
    if (node.type.name === 'heading') count++;
  });
  let first = slice.content.firstChild;
  let depth = 1;
  while (first !== null && !first.isTextblock) {
    first = first.firstChild;
    depth++;
  }
  return first !== null && first.type.name === 'heading' && slice.openStart >= depth ? { count, openFirst: first } : { count };
}

const HEADING_ADAPTED: PasteDiagnostic['code'] = 'destination-heading-level-adapted';

/**
 * The diagnostics of an applied paste without the heading adaptations of pasted headings that
 * never became headings. ProseMirror inserts every pasted heading as a heading node, except an
 * open first heading that joins the textblock where the change starts: its text merges into that
 * block. It still reached the document as a heading when the replace covered that block whole,
 * since a heading of another markup would have replaced it there: the block is a heading of the
 * pasted heading's own markup, which ProseMirror keeps instead of replacing. With no heading
 * created, every adaptation goes but such a first heading's; with one fewer created than pasted
 * and a merged first heading, only the first heading's goes. Any other count, a slice whose
 * headings differ from the cleaned HTML, a heading finding lost to truncation, a joined block that
 * contradicts the replace, or an unmeasured insertion keeps every finding.
 */
export function reconcileHeadingDiagnostics(
  diagnostics: readonly PasteDiagnostic[],
  outline: HeadingOutline | undefined,
  slice: SliceHeadings | undefined,
  insertion: PasteInsertion | undefined,
): readonly PasteDiagnostic[] {
  if (outline === undefined || slice === undefined || insertion === undefined || slice.count !== outline.length) return diagnostics;
  const findings = diagnostics.flatMap((diagnostic, index) => diagnostic.code === HEADING_ADAPTED ? [index] : []);
  if (findings.length !== outline.filter(Boolean).length) return diagnostics;
  const { openFirst } = slice;
  const block = insertion.joined;
  const joined = openFirst !== undefined && block !== undefined;
  // A covered block of another markup would have been replaced: this joined state is unexplained.
  if (joined && insertion.joinedCovered && !block.sameMarkup(openFirst)) return diagnostics;
  const kept = joined && insertion.joinedCovered;
  // The finding of the first pasted heading, when that heading was adapted.
  const first = outline[0] === true ? findings[0] : undefined;
  let removed: readonly number[];
  if (insertion.createdHeadings === 0) removed = findings.filter(index => !kept || index !== first);
  else if (insertion.createdHeadings === outline.length - 1 && joined && !kept && first !== undefined) removed = [first];
  else return diagnostics;
  if (removed.length === 0) return diagnostics;
  return Object.freeze(diagnostics.filter((_, index) => !removed.includes(index)));
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
  /** Records the slice a paste handler lets ProseMirror or a later handler insert, so heading findings can follow it. */
  recordSlice: (operation: PendingPasteOperation, slice: Slice) => void;
  finish: (view: EditorView, operation: PendingPasteOperation, rejected: boolean, details?: PasteFinishDetails) => Promise<PasteOperationResult>;
} {
  const scope = ++nextEditor;
  let sequence = 0;
  const outlines = new WeakMap<PendingPasteOperation, HeadingOutline>();
  const slices = new WeakMap<PendingPasteOperation, SliceHeadings>();
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
      const operation: PendingPasteOperation = Object.freeze({
        operationId: `paste-${String(scope)}-${String(++sequence)}`,
        source: result?.source ?? 'plain-text', formatting,
        diagnostics: Object.freeze((result?.diagnostics ?? []).map(diagnostic => Object.freeze({ ...diagnostic }))),
        diagnosticsTruncated: result?.diagnosticsTruncated ?? false,
      });
      const outline = headingOutline(result);
      if (outline !== undefined) outlines.set(operation, outline);
      return operation;
    },
    recordSlice(operation, slice) {
      slices.set(operation, sliceHeadings(slice));
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
      // A prepared operation's final normalization replaces its provisional outline.
      const outline = details.normalization === undefined ? outlines.get(operation) : headingOutline(details.normalization);
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
        // The notice and onPasteResult follow what an applied paste inserted; onResult keeps the cleanup's view.
        const diagnostics = receipt?.changed === true
          ? reconcileHeadingDiagnostics(normalized.diagnostics, outline, slices.get(operation), receipt.insertion)
          : normalized.diagnostics;
        const result: PasteOperationResult = Object.freeze({
          ...normalized,
          diagnostics,
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
