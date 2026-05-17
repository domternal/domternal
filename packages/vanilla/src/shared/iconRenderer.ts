import { defaultIcons } from '@domternal/core';
import type { IconSet } from '@domternal/core';

/**
 * Resolve and inject an icon's SVG string into a host element.
 *
 * Why innerHTML is safe here: icons come from the `defaultIcons` lookup
 * table (Phosphor SVG strings shipped with core) or from a consumer-provided
 * `IconSet` object. Both are trusted by contract - they are constants in
 * source code, not user input. This matches the React (`dangerouslySetInnerHTML`),
 * Angular (`bypassSecurityTrustHtml`), and Vue (`v-html`) patterns.
 *
 * Consumer responsibility (documented in README): never pass user-controlled
 * strings as icon values in your IconSet.
 */
export function renderIconInto(
  hostEl: HTMLElement,
  iconKey: string | undefined,
  icons: IconSet | undefined,
): void {
  if (!iconKey) {
    hostEl.innerHTML = '';
    return;
  }
  const customIcon: string | undefined = icons?.[iconKey];
  const defaultIcon: string | undefined = defaultIcons[iconKey];
  const svg = customIcon ?? defaultIcon ?? '';
  hostEl.innerHTML = svg;
}

/**
 * Resolve an icon's SVG string without injection. Useful when caller
 * builds the final DOM tree (e.g. via document.createElement chain).
 */
export function resolveIcon(
  iconKey: string | undefined,
  icons: IconSet | undefined,
): string {
  if (!iconKey) return '';
  return icons?.[iconKey] ?? defaultIcons[iconKey] ?? '';
}
