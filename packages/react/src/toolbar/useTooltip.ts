import { useCallback } from 'react';
import type { ToolbarButton } from '@domternal/core';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

export function useTooltip() {
  const getTooltip = useCallback((item: ToolbarButton): string => {
    if (item.shortcut) {
      const parts = item.shortcut.split('-');
      const mapped = parts.map((p: string) => {
        if (p === 'Mod') return isMac ? '\u2318' : 'Ctrl';
        if (p === 'Shift') return isMac ? '\u21E7' : 'Shift';
        if (p === 'Alt') return isMac ? '\u2325' : 'Alt';
        return p.toUpperCase();
      });
      const shortcut = isMac ? mapped.join('') : mapped.join('+');
      return `${item.label} (${shortcut})`;
    }
    return item.label;
  }, []);

  return { getTooltip };
}
