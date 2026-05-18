import { defaultIcons } from '@domternal/core';
import type { IconSet } from '@domternal/core';

/**
 * Resolve and inject an icon's SVG string into a host element.
 *
 * Why innerHTML is safe here: icons come from the `defaultIcons` lookup
 * table (Phosphor SVG strings shipped with core) or from a consumer-provided
 * `IconSet` object. Both are trusted by contract because they are constants in
 * source code, not user input. This matches the React (`dangerouslySetInnerHTML`),
 * Angular (`bypassSecurityTrustHtml`), and Vue (`v-html`) patterns.
 *
 * Consumer responsibility (documented in README): never pass user-controlled
 * strings as icon values in your `IconSet`.
 *
 * @param hostEl - Target element. `innerHTML` is replaced (existing children
 *   are removed).
 * @param iconKey - Icon name to look up in `icons` first, then `defaultIcons`.
 *   When `undefined`, the host is emptied.
 * @param icons - Optional consumer-provided icon overrides. Falls back to
 *   `defaultIcons` if not provided or if the key is missing.
 *
 * @example
 * ```ts
 * import { renderIconInto } from '@domternal/vanilla';
 *
 * const button = document.createElement('button');
 * const iconSpan = document.createElement('span');
 * button.appendChild(iconSpan);
 *
 * renderIconInto(iconSpan, 'textB');                 // default Phosphor icon
 * renderIconInto(iconSpan, 'bold', { bold: mySvg }); // custom override
 * renderIconInto(iconSpan, undefined);               // clear icon
 * ```
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
 * builds the final DOM tree (e.g. via `document.createElement` chain
 * or template literal interpolation).
 *
 * @param iconKey - Icon name to look up. When `undefined`, returns `''`.
 * @param icons - Optional consumer overrides; falls back to `defaultIcons`.
 * @returns Trusted SVG string, or `''` if the icon is unknown.
 *
 * @example
 * ```ts
 * import { resolveIcon } from '@domternal/vanilla';
 *
 * const iconHtml = resolveIcon('textB', undefined);
 * const button = document.createElement('button');
 * button.innerHTML = `<span class="icon">${iconHtml}</span><span>Bold</span>`;
 * ```
 */
export function resolveIcon(
  iconKey: string | undefined,
  icons: IconSet | undefined,
): string {
  if (!iconKey) return '';
  return icons?.[iconKey] ?? defaultIcons[iconKey] ?? '';
}
