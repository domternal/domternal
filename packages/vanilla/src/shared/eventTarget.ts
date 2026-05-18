/**
 * Helpers for typed event subscription over `EventTarget`.
 *
 * Each `@domternal/vanilla` class extends the platform `EventTarget` and
 * dispatches `CustomEvent` instances. Consumers can use the platform
 * `addEventListener('eventName', handler)` directly, OR call `subscribe()`
 * which returns an unsubscribe function and narrows the detail type.
 *
 * Usage:
 * ```ts
 * import { subscribe } from '@domternal/vanilla';
 *
 * const off = subscribe<{ isOpen: boolean }>(picker, 'openchange', (detail) => {
 *   console.log(detail.isOpen);
 * });
 * off(); // remove listener
 * ```
 *
 * Each class JSDoc lists the events it emits + the shape of `detail`.
 */
// TDetail is used once in the signature (intentional - consumer specifies
// the CustomEvent detail type at call site for type-safe handler). The
// rule flags this as "unnecessary", but it IS necessary for DX.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function subscribe<TDetail = unknown>(
  target: EventTarget,
  type: string,
  listener: (detail: TDetail) => void,
): () => void {
  const wrapper = (event: Event): void => {
    listener((event as CustomEvent<TDetail>).detail);
  };
  target.addEventListener(type, wrapper);
  return (): void => {
    target.removeEventListener(type, wrapper);
  };
}
