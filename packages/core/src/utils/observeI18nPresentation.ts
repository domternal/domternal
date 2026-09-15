import type { I18nService } from '../i18n/index.js';

/** Defer structural locale updates until composing or activating a control finishes. */
export function observeI18nPresentation(
  i18n: I18nService,
  getRoot: () => HTMLElement | null | undefined,
  update: () => void
): () => void {
  const ownerDocument =
    getRoot()?.ownerDocument ?? (typeof document === 'undefined' ? undefined : document);
  let composing = false;
  let compositionTarget: EventTarget | null = null;
  let activating = false;
  let pending = false;
  let destroyed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const inside = (event: Event): boolean => {
    const root = getRoot();
    const target = event.target;
    return !!root && !!target && root.contains(target as Node);
  };
  const cancelTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const finishActivation = (): void => {
    cancelTimer();
    // A timer runs after the native click handlers, including pointerup without a click.
    timer = setTimeout(() => {
      timer = undefined;
      activating = false;
      if (!destroyed && pending && !composing) {
        pending = false;
        update();
      }
    }, 0);
  };
  const beginPointer = (event: Event): void => {
    if (!inside(event)) return;
    cancelTimer();
    activating = true;
  };
  const endPointer = (): void => {
    if (activating) finishActivation();
  };
  const click = (event: Event): void => {
    if (inside(event)) activating = true;
    if (activating) finishActivation();
  };
  const beginComposition = (event: Event): void => {
    if (inside(event)) {
      composing = true;
      compositionTarget = event.target;
    }
  };
  const endComposition = (event: Event): void => {
    if (!inside(event) && event.target !== compositionTarget) return;
    composing = false;
    compositionTarget = null;
    if (!activating) finishActivation();
  };
  const events: readonly [string, EventListener][] = [
    ['pointerdown', beginPointer],
    ['pointerup', endPointer],
    ['pointercancel', endPointer],
    ['click', click],
    ['compositionstart', beginComposition],
    ['compositionend', endComposition],
  ];
  for (const [name, listener] of events) ownerDocument?.addEventListener(name, listener, true);
  const unsubscribe = i18n.subscribe(() => {
    if (composing || activating) pending = true;
    else update();
  });
  return () => {
    destroyed = true;
    pending = false;
    cancelTimer();
    unsubscribe();
    for (const [name, listener] of events) ownerDocument?.removeEventListener(name, listener, true);
  };
}
