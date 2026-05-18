import type { ToolbarButton } from '@domternal/core';

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

const MODIFIER_MAP: Record<string, string> = isMac
  ? { Mod: '⌘', Shift: '⇧', Alt: '⌥' }
  : { Mod: 'Ctrl', Shift: 'Shift', Alt: 'Alt' };

/**
 * Format a toolbar button's tooltip including its keyboard shortcut.
 *
 * On macOS uses Unicode glyphs (⌘ ⇧ ⌥); elsewhere falls back
 * to "Ctrl+Shift+Alt" text. Mirrors Vue/React wrapper behavior.
 */
export function getTooltip(item: ToolbarButton): string {
  if (!item.shortcut) return item.label;

  const parts = item.shortcut.split('-').map((part) => MODIFIER_MAP[part] ?? part);
  const shortcut = isMac ? parts.join('') : parts.join('+');
  return `${item.label} (${shortcut})`;
}
