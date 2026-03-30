import { defaultIcons } from '@domternal/core';
import type { IconSet, ToolbarButton, ToolbarDropdown } from '@domternal/core';

export const DROPDOWN_CARET = '<svg class="dm-dropdown-caret" width="10" height="10" viewBox="0 0 10 10"><path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export function useToolbarIcons(icons?: IconSet | null) {
  const cache = new Map<string, string>();
  let prevIcons = icons;

  function checkCacheInvalidation(currentIcons: IconSet | null | undefined) {
    if (currentIcons !== prevIcons) {
      cache.clear();
      prevIcons = currentIcons;
    }
  }

  function resolveIconSvg(name: string): string {
    if (icons) {
      return icons[name] ?? '';
    }
    return defaultIcons[name] ?? '';
  }

  function getCachedIcon(name: string): string {
    checkCacheInvalidation(icons);
    const key = `i:${name}`;
    let cached = cache.get(key);
    if (!cached) {
      cached = resolveIconSvg(name);
      cache.set(key, cached);
    }
    return cached;
  }

  function getCachedTriggerLabel(label: string, isIcon?: boolean): string {
    checkCacheInvalidation(icons);
    const key = `tl:${label}:${isIcon ? '1' : '0'}`;
    let cached = cache.get(key);
    if (!cached) {
      const content = isIcon ? resolveIconSvg(label) : label;
      cached = `<span class="dm-toolbar-trigger-label">${content}</span>${DROPDOWN_CARET}`;
      cache.set(key, cached);
    }
    return cached;
  }

  function getCachedTriggerIcon(iconName: string): string {
    checkCacheInvalidation(icons);
    const key = `t:${iconName}`;
    let cached = cache.get(key);
    if (!cached) {
      cached = resolveIconSvg(iconName) + DROPDOWN_CARET;
      cache.set(key, cached);
    }
    return cached;
  }

  function getCachedItemContent(
    iconName: string,
    label: string,
    displayMode?: 'icon-text' | 'text' | 'icon',
  ): string {
    const mode = displayMode ?? 'icon-text';
    checkCacheInvalidation(icons);
    const key = `dc:${iconName}:${label}:${mode}`;
    let cached = cache.get(key);
    if (!cached) {
      if (mode === 'text') {
        cached = label;
      } else if (mode === 'icon') {
        cached = resolveIconSvg(iconName);
      } else {
        cached = resolveIconSvg(iconName) + ' ' + label;
      }
      cache.set(key, cached);
    }
    return cached;
  }

  function getDropdownTriggerHtml(
    dropdown: ToolbarDropdown,
    activeItem: ToolbarButton | undefined,
  ): string {
    checkCacheInvalidation(icons);

    if (dropdown.layout === 'grid') {
      const color = activeItem?.color ?? dropdown.defaultIndicatorColor ?? null;
      const key = `tr:${dropdown.icon}:${color ?? ''}`;
      let cached = cache.get(key);
      if (!cached) {
        cached = resolveIconSvg(dropdown.icon) + DROPDOWN_CARET;
        if (color) {
          cached += `<span class="dm-toolbar-color-indicator" style="background-color: ${color}"></span>`;
        }
        cache.set(key, cached);
      }
      return cached;
    }

    if (dropdown.dynamicLabel) {
      if (activeItem) return getCachedTriggerLabel(activeItem.label);
      if (dropdown.dynamicLabelFallback) return getCachedTriggerLabel(dropdown.dynamicLabelFallback);
      return getCachedTriggerLabel(dropdown.icon, true);
    }

    const icon = dropdown.dynamicIcon && activeItem ? activeItem.icon : dropdown.icon;
    return getCachedTriggerIcon(icon);
  }

  return {
    resolveIconSvg,
    getCachedIcon,
    getCachedTriggerLabel,
    getCachedTriggerIcon,
    getCachedItemContent,
    getDropdownTriggerHtml,
  };
}
