import { defaultIcons } from '@domternal/core';
import type { IconSet } from '@domternal/core';

export const DROPDOWN_CARET = '<svg class="dm-dropdown-caret" width="10" height="10" viewBox="0 0 10 10"><path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export interface UseToolbarIconsResult {
  resolveIconSvg: (name: string) => string;
  getCachedIcon: (name: string) => string;

}

export function useToolbarIcons(icons?: IconSet | null): UseToolbarIconsResult {
  const cache = new Map<string, string>();
  let prevIcons = icons;

  function checkCacheInvalidation(currentIcons: IconSet | null | undefined): void {
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

  return { resolveIconSvg, getCachedIcon };
}
