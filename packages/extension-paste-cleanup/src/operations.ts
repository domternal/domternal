import { PluginKey } from '@domternal/pm/state';
import type { StateField, Transaction } from '@domternal/pm/state';
import { AddMarkStep, RemoveMarkStep } from '@domternal/pm/transform';
import type { EditorView } from '@domternal/pm/view';
import type { PasteDiagnostic, PasteFormatting, PasteSource } from './html/types.js';

export interface PasteAffectedRange {
  readonly from: number;
  readonly to: number;
}

/** Short-lived transaction references, not exact source-diagnostic or comment anchors. */
export interface PasteAffectedReferences {
  readonly referenceId: string;
  readonly precision: 'operation';
  readonly documentRevision: number;
  readonly ranges: readonly PasteAffectedRange[];
  /** References expire when subsequent edits affect their content or the receipt ages out. */
  readonly expired: boolean;
}

export interface PasteOperationResult {
  readonly operationId: string;
  readonly source: PasteSource | 'plain-text';
  readonly formatting: PasteFormatting;
  /** Applied means an accepted tagged transaction, not a promise of complete source fidelity. */
  readonly status: 'applied' | 'rejected' | 'untracked' | 'noop';
  readonly diagnostics: readonly PasteDiagnostic[];
  readonly diagnosticsTruncated: boolean;
  readonly references: PasteAffectedReferences;
}

export interface PasteNormalizationContext {
  readonly operationId: string;
  readonly formatting: PasteFormatting;
}

interface Receipt {
  readonly operationId: string;
  readonly changed: boolean;
  readonly ranges: readonly PasteAffectedRange[];
  readonly expired: boolean;
}

interface ReceiptState {
  readonly revision: number;
  readonly receipts: readonly Receipt[];
}

const MAX_RECEIPTS = 16;
const MAX_RANGES = 32;
export const pasteCleanupKey = new PluginKey<ReceiptState>('pasteCleanup');

function operationId(transaction: Transaction): string | undefined {
  const descriptor: unknown = transaction.getMeta(pasteCleanupKey);
  if (descriptor === null || typeof descriptor !== 'object' || !('operationId' in descriptor)) return undefined;
  return typeof descriptor.operationId === 'string' && descriptor.operationId.length <= 128
    ? descriptor.operationId : undefined;
}

function freezeRanges(ranges: readonly PasteAffectedRange[]): readonly PasteAffectedRange[] {
  return Object.freeze(ranges.map(range => Object.freeze({ ...range })));
}

function compactRanges(ranges: readonly PasteAffectedRange[]): readonly PasteAffectedRange[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: PasteAffectedRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous !== undefined && previous.to >= range.from) {
      merged[merged.length - 1] = { from: previous.from, to: Math.max(previous.to, range.to) };
    } else merged.push(range);
  }
  return freezeRanges(merged);
}

function overlaps(range: PasteAffectedRange, from: number, to: number): boolean {
  if (range.from === range.to) return from <= range.from && to >= range.to;
  return from === to ? from > range.from && from < range.to : from < range.to && to > range.from;
}

/** Map outside edits, but expire a reference rather than absorb unrelated edits inside it. */
function mapRanges(
  ranges: readonly PasteAffectedRange[], transaction: Transaction, allowInteriorChanges: boolean,
): { ranges: readonly PasteAffectedRange[]; expired: boolean } {
  let current = [...ranges];
  let expired = false;
  for (let index = 0; index < transaction.steps.length; index++) {
    const step = transaction.steps[index];
    const map = transaction.mapping.maps[index];
    if (step === undefined || map === undefined) continue;
    const edits: PasteAffectedRange[] = [];
    map.forEach((from, to) => { edits.push({ from, to }); });
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) edits.push({ from: step.from, to: step.to });
    const unknownChange = edits.length === 0;
    const mapped: PasteAffectedRange[] = [];
    for (const range of current) {
      if (!allowInteriorChanges && (unknownChange || edits.some(edit => overlaps(range, edit.from, edit.to)))) {
        expired = true;
        continue;
      }
      const from = map.map(range.from, 1);
      const to = map.map(range.to, -1);
      if (from > to) { expired = true; continue; }
      mapped.push({ from, to });
    }
    current = mapped;
  }
  return { ranges: freezeRanges(current), expired };
}

/** Replacement geometry and explicit mark ranges in the final transaction document. */
function affectedRanges(transaction: Transaction): { ranges: readonly PasteAffectedRange[]; expired: boolean } {
  const ranges: PasteAffectedRange[] = [];
  let expired = false;
  for (let index = 0; index < transaction.steps.length; index++) {
    const step = transaction.steps[index];
    const map = transaction.mapping.maps[index];
    if (step === undefined || map === undefined) continue;
    const changed: PasteAffectedRange[] = [];
    map.forEach((_from, _to, from, to) => { changed.push({ from, to }); });
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) changed.push({ from: step.from, to: step.to });
    const remaining = transaction.mapping.slice(index + 1);
    for (const range of changed) {
      const from = remaining.map(range.from, 1);
      const to = remaining.map(range.to, -1);
      if (from > to || from < 0 || to > transaction.doc.content.size) { expired = true; continue; }
      if (ranges.length >= MAX_RANGES) { expired = true; continue; }
      ranges.push({ from, to });
    }
    if (changed.length === 0) expired = true;
  }
  return { ranges: compactRanges(ranges), expired };
}

export const receiptStateField: StateField<ReceiptState> = {
  init: () => ({ revision: 0, receipts: Object.freeze([]) }),
  apply(transaction, previous) {
    const revision = previous.revision + Number(transaction.docChanged);
    const ownId = operationId(transaction);
    const appended: unknown = transaction.getMeta('appendedTransaction');
    const appendedId = appended !== null && typeof appended === 'object' && 'getMeta' in appended
      && typeof appended.getMeta === 'function' ? operationId(appended as Transaction) : undefined;
    const currentId = ownId ?? appendedId;
    const receipts: Receipt[] = previous.receipts.map(receipt => {
      const mapped = mapRanges(receipt.ranges, transaction, receipt.operationId === currentId);
      return { ...receipt, ranges: mapped.ranges, expired: receipt.expired || mapped.expired };
    });
    if (currentId !== undefined) {
      const index = receipts.findIndex(receipt => receipt.operationId === currentId);
      const earlier = index < 0 ? undefined : receipts[index];
      // Appended normalizers extend an existing accepted root receipt only.
      if (ownId !== undefined || earlier !== undefined) {
        const changed = affectedRanges(transaction);
        const ranges = compactRanges([...(earlier?.ranges ?? []), ...changed.ranges]);
        const receipt: Receipt = Object.freeze({
          operationId: currentId, changed: transaction.docChanged || earlier?.changed === true,
          ranges: ranges.length > MAX_RANGES ? Object.freeze([]) : ranges,
          expired: changed.expired || earlier?.expired === true || ranges.length > MAX_RANGES,
        });
        if (index < 0) receipts.push(receipt); else receipts[index] = receipt;
      }
    }
    return Object.freeze({ revision, receipts: Object.freeze(receipts.slice(-MAX_RECEIPTS)) });
  },
};

/** Read only the installed view state. Speculative state.apply results are never receipts. */
export function getPasteAffectedReferences(view: EditorView, id: string): PasteAffectedReferences | undefined {
  if (view.isDestroyed) return undefined;
  const state = pasteCleanupKey.getState(view.state);
  const receipt = state?.receipts.find(entry => entry.operationId === id);
  if (receipt === undefined || state === undefined) return undefined;
  return Object.freeze({ referenceId: id, precision: 'operation', documentRevision: state.revision, ranges: freezeRanges(receipt.ranges), expired: receipt.expired });
}

export function readPasteReceipt(view: EditorView, id: string): { changed: boolean; references: PasteAffectedReferences } | undefined {
  const state = pasteCleanupKey.getState(view.state);
  const receipt = state?.receipts.find(entry => entry.operationId === id);
  if (receipt === undefined || state === undefined) return undefined;
  // Destruction can occur in an earlier plugin view after state was installed.
  // Retain its acceptance evidence without exposing usable positions.
  const references = getPasteAffectedReferences(view, id) ?? Object.freeze({
    referenceId: id, precision: 'operation' as const, documentRevision: state.revision,
    ranges: Object.freeze([]), expired: true,
  });
  return { changed: receipt.changed, references };
}

export function pasteDocumentRevision(view: EditorView): number {
  return pasteCleanupKey.getState(view.state)?.revision ?? 0;
}
