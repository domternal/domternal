import { useRef } from 'react';

/**
 * Stable `dangerouslySetInnerHTML` payloads, keyed by the markup itself.
 *
 * React compares that prop by identity, so a fresh literal per render rewrites
 * `innerHTML` and destroys the icon nodes. These menus re-render on every
 * editor transaction, so an overlay closing on pointerdown swaps the icon out
 * mid-gesture, leaving mousedown and mouseup with no element in common and no
 * click fired at all.
 *
 * The cache lives on a ref, so it dies with the component and is keyed by
 * markup rather than by icon name: a trigger whose html varies with state
 * (a dynamic icon, a label appended to it) still gets one object per variant.
 */
export function useInnerHtml(): (html: string) => { __html: string } {
  const cache = useRef<Map<string, { __html: string }> | null>(null);
  cache.current ??= new Map();
  return (html: string): { __html: string } => {
    const store = cache.current as Map<string, { __html: string }>;
    let prop = store.get(html);
    if (prop === undefined) {
      prop = { __html: html };
      store.set(html, prop);
    }
    return prop;
  };
}
