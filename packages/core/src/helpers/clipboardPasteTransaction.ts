import type { PluginKey, Transaction } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';

interface ArmedPaste {
  key: PluginKey;
  descriptor: Readonly<object>;
}

const armedPastes = new WeakMap<EditorView, ArmedPaste>();

/**
 * Attach operation metadata to the next untagged paste transaction dispatched by this view.
 * The newest arm replaces the previous one and expires at the next microtask.
 * Only the descriptor's top level is copied and frozen. Nested data remains caller-owned.
 */
export function armClipboardPasteTransaction(
  view: EditorView,
  key: PluginKey,
  descriptor: Readonly<object>,
): () => void {
  const entry: ArmedPaste = { key, descriptor: Object.freeze({ ...descriptor }) };
  armedPastes.set(view, entry);
  const dispose = (): void => {
    if (armedPastes.get(view) === entry) armedPastes.delete(view);
  };
  queueMicrotask(dispose);
  return dispose;
}

/** @internal Claim before applying state or running transaction filters and observers. */
export function claimClipboardPasteTransaction(view: EditorView, transaction: Transaction): void {
  if (transaction.getMeta('paste') !== true && transaction.getMeta('uiEvent') !== 'paste') return;
  const entry = armedPastes.get(view);
  if (entry === undefined || transaction.getMeta(entry.key) !== undefined) return;
  armedPastes.delete(view);
  transaction.setMeta(entry.key, entry.descriptor);
}
