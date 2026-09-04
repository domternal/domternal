import type { EditorView } from '@domternal/pm/view';

/** @experimental Formatting and asset ownership intent shared by paste handlers, never a source trust signal. */
export interface ClipboardPasteBehavior {
  preserveOrderedListStart?: boolean;
  assetsAlreadyHandled?: boolean;
}

const behaviors = new WeakMap<ClipboardEvent, WeakMap<EditorView, Readonly<ClipboardPasteBehavior>>>();

/** @experimental Set behavior for this event and view. An empty or disabled behavior clears prior intent. */
export function setClipboardPasteBehavior(
  view: EditorView,
  event: ClipboardEvent,
  behavior: Readonly<ClipboardPasteBehavior>,
): void {
  const preserveOrderedListStart = behavior.preserveOrderedListStart === true;
  const assetsAlreadyHandled = behavior.assetsAlreadyHandled === true;
  if (!preserveOrderedListStart && !assetsAlreadyHandled) {
    behaviors.get(event)?.delete(view);
    return;
  }
  let views = behaviors.get(event);
  if (views === undefined) {
    views = new WeakMap();
    behaviors.set(event, views);
  }
  views.set(view, Object.freeze({
    ...(preserveOrderedListStart ? { preserveOrderedListStart: true } : {}),
    ...(assetsAlreadyHandled ? { assetsAlreadyHandled: true } : {}),
  }));
}

/** @experimental Read only explicit intent for the same paste event and destination view. */
export function getClipboardPasteBehavior(
  view: EditorView,
  event: ClipboardEvent,
): Readonly<ClipboardPasteBehavior> | undefined {
  return behaviors.get(event)?.get(view);
}
