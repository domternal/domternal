/**
 * Where a paste puts content that the selection's textblock cannot hold. A node whose textblock
 * takes text only, inside a parent that takes no block beside it, can place such content
 * elsewhere: Details puts blocks pasted into its summary in a new block at the start of its
 * content, as Enter in the summary puts the caret there. The paste handlers that build their own
 * transaction, such as Markdown's, SmartPaste and the image node's, start it here, so each of them
 * places a paste the same way, and the placement is part of the paste's one transaction: a paste
 * that a transaction filter refuses leaves nothing behind, and undo takes it back in one step.
 */
import type { Fragment } from '@domternal/pm/model';
import type { Transaction } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';

/**
 * @experimental Places content pasted at the view's selection: returns a transaction on the view's
 * current state whose selection is where `content` belongs, with what that took, such as a new
 * empty block, or undefined to leave the paste at the selection. `content` is whole nodes, as the
 * handler will insert them.
 */
export type ClipboardPastePlacement = (view: EditorView, content: Fragment) => Transaction | undefined;

interface Registration {
  readonly token: object;
  readonly place: ClipboardPastePlacement;
}

const placements = new WeakMap<EditorView, Registration[]>();

/**
 * @experimental Register a paste placement for a view. Placements form a stack: the latest one that
 * places a paste wins, and the ones before it are asked when it returns undefined. The returned
 * function removes only this registration, may be called more than once, and belongs in the
 * registering plugin view's destroy. A destroyed view ignores the registration.
 */
export function registerClipboardPastePlacement(view: EditorView, place: ClipboardPastePlacement): () => void {
  try { if (view.isDestroyed) return () => undefined; }
  catch { return () => undefined; }
  const token = {};
  let registrations = placements.get(view);
  if (registrations === undefined) {
    registrations = [];
    placements.set(view, registrations);
  }
  registrations.push({ token, place });
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const current = placements.get(view);
    if (current === undefined) return;
    const index = current.findIndex(registration => registration.token === token);
    if (index !== -1) current.splice(index, 1);
    if (current.length === 0) placements.delete(view);
  };
}

/**
 * @experimental The transaction a paste handler starts from to insert `content`, whole nodes, at the
 * view's selection: a registered placement's, whose selection is where the content belongs, or
 * undefined when no placement moves it, and the handler inserts at the selection as before. A
 * placement that throws, or returns a transaction that does not start from the view's current
 * state, counts as none.
 */
export function placeClipboardPaste(view: EditorView, content: Fragment): Transaction | undefined {
  try {
    if (view.isDestroyed) return undefined;
    const registrations = [...(placements.get(view) ?? [])];
    for (let index = registrations.length - 1; index >= 0; index--) {
      const placed = registrations[index]?.place(view, content);
      if (placed !== undefined) return placed.before === view.state.doc ? placed : undefined;
    }
  } catch { /* A failing placement leaves the paste at the selection. */ }
  return undefined;
}
