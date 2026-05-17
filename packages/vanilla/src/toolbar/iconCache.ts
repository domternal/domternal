import { defaultIcons } from '@domternal/core';
import type { IconSet, ToolbarButton, ToolbarDropdown } from '@domternal/core';

export const DROPDOWN_CARET =
  '<svg class="dm-dropdown-caret" width="10" height="10" viewBox="0 0 10 10">' +
  '<path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

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
 * Resolve + cache toolbar icons. Mirrors Vue's `useToolbarIcons` logic
 * verbatim - same cache keys, same fallback order (consumer `IconSet` ->
 * `defaultIcons`), same dropdown trigger HTML composition.
 *
 * Cache is invalidated when consumer swaps `IconSet`.
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
      const content = isIcon ? resolveSvg(label) : label;
      cached = `<span class="dm-toolbar-trigger-label">${content}</span>${DROPDOWN_CARET}`;
      cache.set(key, cached);
    }
    return cached;
  }

  function getTriggerIcon(iconName: string): string {
    checkInvalidation();
    const key = `t:${iconName}`;
    let cached = cache.get(key);
    if (cached === undefined) {
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
        cached = label;
      } else if (mode === 'icon') {
        cached = resolveSvg(iconName);
      } else {
        cached = resolveSvg(iconName) + ' ' + label;
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
      const color = activeItem?.color ?? dropdown.defaultIndicatorColor ?? null;
      const key = `tr:${dropdown.icon}:${color ?? ''}`;
      let cached = cache.get(key);
      if (cached === undefined) {
        cached = resolveSvg(dropdown.icon) + DROPDOWN_CARET;
        if (color) {
          cached += `<span class="dm-toolbar-color-indicator" style="background-color: ${color}"></span>`;
        }
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
