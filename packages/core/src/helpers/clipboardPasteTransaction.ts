import type { PluginKey, Transaction } from '@domternal/pm/state';
import { EditorView } from '@domternal/pm/view';

interface ArmedPaste {
  key: PluginKey;
  descriptor: Readonly<object>;
}

const armedPastes = new WeakMap<EditorView, ArmedPaste>();

/** @internal Begin an independent paste attempt before parsing or plugin interception. */
export function clearPendingClipboardPasteTransaction(view: EditorView): void {
  armedPastes.delete(view);
}

/** @internal Public paste entry points also run when empty input skips all transforms. */
export class ClipboardEditorView extends EditorView {
  override pasteHTML(html: string, event?: ClipboardEvent): boolean {
    clearPendingClipboardPasteTransaction(this);
    return super.pasteHTML(html, event);
  }

  override pasteText(text: string, event?: ClipboardEvent): boolean {
    clearPendingClipboardPasteTransaction(this);
    return super.pasteText(text, event);
  }
}

/**
 * Arm from the current paste handler to tag its next untagged paste transaction.
 * A new native or programmatic paste attempt clears the previous arm in Core editors.
 * The newest arm also replaces the previous one and expires at the next microtask.
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
