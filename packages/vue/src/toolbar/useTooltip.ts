import type { ToolbarButton } from '@domternal/core';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

const MODIFIER_MAP: Record<string, string> = isMac
  ? { Mod: '\u2318', Shift: '\u21E7', Alt: '\u2325' }
  : { Mod: 'Ctrl', Shift: 'Shift', Alt: 'Alt' };

export function useTooltip() {
  function getTooltip(item: ToolbarButton): string {
    if (!item.shortcut) return item.label;

    const parts = item.shortcut.split('-').map((part) => MODIFIER_MAP[part] ?? part);
    const shortcut = isMac ? parts.join('') : parts.join('+');
    return `${item.label} (${shortcut})`;
  }

  return { getTooltip };
}
