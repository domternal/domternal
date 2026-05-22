/**
 * Copies `dm-theme-*` classes from the editor's host element onto a
 * floating element that lives OUTSIDE `.dm-editor` (typically portaled
 * to `document.body` to escape `overflow: hidden`). Without the copy
 * the `.dm-theme-dark` cascade does not reach the floating element and
 * it renders with light-theme defaults on a dark page.
 *
 * Call this whenever the floating element is shown - cheap and
 * idempotent. Removes stale theme classes from the target first so
 * runtime theme toggles propagate on the next show.
 */
export function copyThemeClass(view: { dom: Element }, target: Element): void {
  const stale: string[] = [];
  target.classList.forEach((cls) => {
    if (cls.startsWith('dm-theme-')) stale.push(cls);
  });
  for (const cls of stale) target.classList.remove(cls);

  const source = view.dom.closest('[class*="dm-theme-"]') ?? view.dom.closest('.dm-editor');
  if (!source) return;
  source.classList.forEach((cls) => {
    if (cls.startsWith('dm-theme-')) target.classList.add(cls);
  });
}
