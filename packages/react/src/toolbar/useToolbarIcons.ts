import { useCallback, useRef } from 'react';
import { defaultIcons } from '@domternal/core';
import type { IconSet } from '@domternal/core';

export const DROPDOWN_CARET = '<svg class="dm-dropdown-caret" width="10" height="10" viewBox="0 0 10 10"><path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export interface UseToolbarIconsResult {
  resolveIconSvg: (name: string) => string;
  getCachedIcon: (name: string) => string;

}

export function useToolbarIcons(icons?: IconSet | null): UseToolbarIconsResult {
  const cacheRef = useRef(new Map<string, string>());
  const prevIconsRef = useRef(icons);

  // Clear cache when icons source changes
  if (icons !== prevIconsRef.current) {
    cacheRef.current.clear();
    prevIconsRef.current = icons;
  }

  const resolveIconSvg = useCallback((name: string): string => {
    if (icons) {
      return icons[name] ?? '';
    }
    return defaultIcons[name] ?? '';
  }, [icons]);

  const getCachedIcon = useCallback((name: string): string => {
    const cache = cacheRef.current;
    const key = `i:${name}`;
    let cached = cache.get(key);
    if (!cached) {
      cached = resolveIconSvg(name);
      cache.set(key, cached);
    }
    return cached;
  }, [resolveIconSvg]);

  return { resolveIconSvg, getCachedIcon };
}
