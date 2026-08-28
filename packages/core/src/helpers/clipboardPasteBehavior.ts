import type { EditorView } from '@domternal/pm/view';

/** Formatting intent shared by cooperating paste handlers, never a source trust signal. */
export interface ClipboardPasteBehavior {
  preserveOrderedListStart?: boolean;
}

const behaviors = new WeakMap<ClipboardEvent, WeakMap<EditorView, Readonly<ClipboardPasteBehavior>>>();

/** Set behavior for this event and view. An empty or disabled behavior clears prior intent. */
export function setClipboardPasteBehavior(
  view: EditorView,
  event: ClipboardEvent,
  behavior: Readonly<ClipboardPasteBehavior>,
): void {
  if (behavior.preserveOrderedListStart !== true) {
    behaviors.get(event)?.delete(view);
    return;
  }
  let views = behaviors.get(event);
  if (views === undefined) {
    views = new WeakMap();
    behaviors.set(event, views);
  }
  views.set(view, Object.freeze({ preserveOrderedListStart: true }));
}

/** Read only explicit formatting intent for the same paste event and destination view. */
export function getClipboardPasteBehavior(
  view: EditorView,
  event: ClipboardEvent,
): Readonly<ClipboardPasteBehavior> | undefined {
  return behaviors.get(event)?.get(view);
}
