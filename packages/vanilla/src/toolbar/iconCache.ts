import { defaultIcons } from '@domternal/core';
import type { IconSet, ToolbarButton, ToolbarDropdown } from '@domternal/core';
import { escapePresentationText, safeIndicatorColor } from '../shared/presentation.js';

export const DROPDOWN_CARET =
  '<svg class="dm-dropdown-caret" width="10" height="10" viewBox="0 0 10 10">' +
  '<path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Cached toolbar HTML helpers.
 *
 * IconSet values are trusted, developer-authored SVG markup. Text and color
 * arguments are treated as data and escaped or validated before composition.
 */
export interface IconCache {
  resolveSvg: (name: string) => string;
  getIcon: (name: string) => string;
  getTriggerLabel: (label: string, isIcon?: boolean) => string;
  getTriggerIcon: (iconName: string) => string;
  getItemContent: (icon: string, label: string, mode?: 'icon-text' | 'text' | 'icon') => string;
  getDropdownTriggerHtml: (dropdown: ToolbarDropdown, activeItem: ToolbarButton | undefined) => string;
  setIcons: (icons: IconSet | undefined) => void;
}

/**
 * Resolve and cache toolbar icons with the same fallback order as the other
 * wrappers: consumer `IconSet` first, then `defaultIcons`.
 *
 * Cache is invalidated when consumer swaps `IconSet`.
 *
 * @param initialIcons Trusted, developer-authored SVG constants.
 */
export function createIconCache(initialIcons: IconSet | undefined): IconCache {
  const cache = new Map<string, string>();
  let icons: IconSet | undefined = initialIcons;
  let prevIcons: IconSet | undefined = initialIcons;

  function checkInvalidation(): void {
    if (icons !== prevIcons) {
      cache.clear();
      prevIcons = icons;
    }
  }

  function resolveSvg(name: string): string {
    if (icons) {
      return icons[name] ?? '';
    }
    return defaultIcons[name] ?? '';
  }

  function getIcon(name: string): string {
    checkInvalidation();
    const key = `i:${name}`;
    let cached = cache.get(key);
    if (cached === undefined) {
      cached = resolveSvg(name);
      cache.set(key, cached);
    }
    return cached;
  }

  function getTriggerLabel(label: string, isIcon?: boolean): string {
    checkInvalidation();
    const key = `tl:${label}:${isIcon ? '1' : '0'}`;
    let cached = cache.get(key);
    if (cached === undefined) {
      if (isIcon) {
        const trustedIcon = resolveSvg(label);
        // IconSet values are developer-authored SVG by public API contract.
        // codeql[js/html-constructed-from-input]
        cached = `<span class="dm-toolbar-trigger-label">${trustedIcon}</span>${DROPDOWN_CARET}`;
      } else {
        cached = `<span class="dm-toolbar-trigger-label">${escapePresentationText(label)}</span>${DROPDOWN_CARET}`;
      }
      cache.set(key, cached);
    }
    return cached;
  }

  function getTriggerIcon(iconName: string): string {
    checkInvalidation();
    const key = `t:${iconName}`;
    let cached = cache.get(key);
    if (cached === undefined) {
      // IconSet values are developer-authored SVG by public API contract.
      // codeql[js/html-constructed-from-input]
      cached = resolveSvg(iconName) + DROPDOWN_CARET;
      cache.set(key, cached);
    }
    return cached;
  }

  function getItemContent(
    iconName: string,
    label: string,
    displayMode?: 'icon-text' | 'text' | 'icon',
  ): string {
    const mode = displayMode ?? 'icon-text';
    checkInvalidation();
    const key = `dc:${iconName}:${label}:${mode}`;
    let cached = cache.get(key);
    if (cached === undefined) {
      if (mode === 'text') {
        cached = escapePresentationText(label);
      } else if (mode === 'icon') {
        cached = resolveSvg(iconName);
      } else {
        const trustedIcon = resolveSvg(iconName);
        const escapedLabel = escapePresentationText(label);
        // IconSet values are developer-authored SVG by public API contract.
        // The label is escaped before it is appended.
        // codeql[js/html-constructed-from-input]
        cached = trustedIcon + ' ' + escapedLabel;
      }
      cache.set(key, cached);
    }
    return cached;
  }

  function getDropdownTriggerHtml(
    dropdown: ToolbarDropdown,
    activeItem: ToolbarButton | undefined,
  ): string {
    checkInvalidation();

    if (dropdown.layout === 'grid') {
      const color = safeIndicatorColor(activeItem?.color ?? dropdown.defaultIndicatorColor);
      const key = `tr:${dropdown.icon}:${color ?? ''}`;
      let cached = cache.get(key);
      if (cached === undefined) {
        const trustedIcon = resolveSvg(dropdown.icon);
        const indicator = color
          ? `<span class="dm-toolbar-color-indicator" style="background-color: ${escapePresentationText(color)}"></span>`
          : '';
        // IconSet values are developer-authored SVG by public API contract.
        // The optional indicator contains only validated, escaped color data.
        // codeql[js/html-constructed-from-input]
        cached = trustedIcon + DROPDOWN_CARET + indicator;
        cache.set(key, cached);
      }
      return cached;
    }

    if (dropdown.dynamicLabel) {
      if (activeItem) return getTriggerLabel(activeItem.label);
      if (dropdown.dynamicLabelFallback) return getTriggerLabel(dropdown.dynamicLabelFallback);
      return getTriggerLabel(dropdown.icon, true);
    }

    const icon = dropdown.dynamicIcon && activeItem ? activeItem.icon : dropdown.icon;
    return getTriggerIcon(icon);
  }

  function setIcons(newIcons: IconSet | undefined): void {
    icons = newIcons;
  }

  return {
    resolveSvg,
    getIcon,
    getTriggerLabel,
    getTriggerIcon,
    getItemContent,
    getDropdownTriggerHtml,
    setIcons,
  };
}
