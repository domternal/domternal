import type { FloatingMenuItem } from '../types/FloatingMenu.js';

/**
 * A group of floating-menu items sharing the same `group` value.
 */
export interface FloatingMenuGroup {
  name: string;
  items: FloatingMenuItem[];
}

/**
 * Groups items by their `group` property, preserving extension insertion
 * order of groups. Within each group, items are sorted by `priority`
 * descending (higher first, default 100).
 *
 * Shared between `FloatingMenuController` (which renders grouped item lists
 * for FloatingMenu + framework wrappers) and `createSlashSuggestionRenderer`
 * (the popup shown by SlashCommand). Having one implementation keeps visual
 * grouping consistent across every trigger mechanism.
 */
export function groupFloatingMenuItems(items: FloatingMenuItem[]): FloatingMenuGroup[] {
  const map = new Map<string, FloatingMenuItem[]>();
  const order: string[] = [];

  for (const item of items) {
    const name = item.group ?? '';
    let list = map.get(name);
    if (!list) {
      list = [];
      map.set(name, list);
      order.push(name);
    }
    list.push(item);
  }

  const groups: FloatingMenuGroup[] = [];
  for (const name of order) {
    const list = (map.get(name) ?? []).slice();
    list.sort((a, b) => (b.priority ?? 100) - (a.priority ?? 100));
    groups.push({ name, items: list });
  }
  return groups;
}
