/**
 * Drop the separators that ended up with nothing to separate.
 *
 * A menu built from a flat list of names (`['ai', '|', 'bold', ...]`) resolves
 * each name against the extensions the editor actually loaded, and silently
 * skips the ones it cannot find. That is what lets one default list serve every
 * build: an editor without the AI extension simply does not show `ai`. The
 * separators do not take part in that, because a `|` always resolves. So the
 * list shrinks around them and they stay, and a bar that was drawn between two
 * groups is left leading the menu, trailing it, or standing next to another
 * bar with nothing in between.
 *
 * This is the pass that finishes the job. Run it after everything that can
 * remove an item, which includes schema filtering as well as name resolution:
 * a separator can be orphaned by a selection whose node type does not allow
 * the marks on one side of it, and that is decided per transaction rather than
 * once at construction.
 *
 * The trailing buttons a menu appends afterwards are not visible here, so a
 * caller that appends its own leading separator has to ask whether anything
 * came before it. What this guarantees is the half it can: the list is empty,
 * or it begins and ends with something that is not a separator.
 *
 * Written against `{ type: string }` rather than a menu's item union because
 * every surface spells its item type differently and none of the differences
 * matter here.
 *
 * A list with nothing to drop comes back as the SAME array, not a copy. React
 * and Vue hand this straight to their state, and a fresh array every time is a
 * re-render every time: this runs once per transaction, and pointer motion
 * alone dispatches those. Most lists never need collapsing, so most passes
 * cost nothing.
 */
export function collapseSeparators<T extends { type: string }>(items: readonly T[]): T[] {
  const out: T[] = [];

  for (const item of items) {
    if (item.type !== 'separator') {
      out.push(item);
      continue;
    }
    // Nothing to separate from on the left: either the menu has not started
    // yet, or the previous entry is itself a separator.
    if (out.length === 0) continue;
    if (out[out.length - 1]?.type === 'separator') continue;
    out.push(item);
  }

  // And nothing on the right. One pop would do, since the loop above already
  // left at most one separator in a row, but the loop says what it means.
  while (out.length > 0 && out[out.length - 1]?.type === 'separator') out.pop();

  // Nothing was dropped, so hand back what came in. Only a separator is ever
  // removed, so equal lengths mean an identical list.
  return out.length === items.length ? (items as T[]) : out;
}
