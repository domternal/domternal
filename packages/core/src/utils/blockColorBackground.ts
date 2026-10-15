import { Plugin } from '@domternal/pm/state';
import type { Transaction } from '@domternal/pm/state';
import type { Node as PMNode } from '@domternal/pm/model';
import { Decoration, DecorationSet } from '@domternal/pm/view';
import { AddMarkStep, AttrStep, RemoveMarkStep } from '@domternal/pm/transform';
import { isSafeCssValue } from '../helpers/isSafeCssValue.js';
import { normalizeColor } from '../helpers/normalizeColor.js';
import { measuredContrastColor } from '../helpers/textColorContrast.js';
import { surfaceToneAttributes } from '../helpers/surfaceTone.js';
import { namedCssColor } from './namedCssColor.js';

/** Explicit sRGB paint cannot be confused with existing semantic palette tokens such as red or gray. */
export function literalBlockBackground(value: unknown): string | null {
  if (typeof value !== 'string' || !/^(?:#|rgba?\()/iu.test(value.trim()) || !isSafeCssValue(value)
    || measuredContrastColor(value) === null) return null;
  return normalizeColor(value.trim());
}

/** The inline declaration is CSS, so its named colors are distinct from document palette tokens. */
export function htmlBlockBackground(value: string): string | null {
  return literalBlockBackground(value) ?? namedCssColor(value);
}

function decoration(node: PMNode, position: number, types: ReadonlySet<string>): Decoration | undefined {
  if (!node.isBlock || !types.has(node.type.name)) return undefined;
  const background = literalBlockBackground(node.attrs['bgColor']);
  const tone = background === null ? null : surfaceToneAttributes(background);
  return tone === null ? undefined : Decoration.node(position, position + node.nodeSize, { ...tone });
}

function allDecorations(doc: PMNode, types: ReadonlySet<string>): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, position) => {
    const item = decoration(node, position, types);
    if (item !== undefined) decorations.push(item);
    return !node.isTextblock;
  });
  return DecorationSet.create(doc, decorations);
}

/** Ranges are expressed in the final document, including attribute steps whose position map is empty. */
function changedRanges(transaction: Transaction): { from: number; to: number }[] | undefined {
  const ranges: { from: number; to: number }[] = [];
  for (let index = 0; index < transaction.steps.length; index++) {
    const step = transaction.steps[index];
    const map = transaction.mapping.maps[index];
    if (step === undefined || map === undefined) return undefined;
    const remaining = transaction.mapping.slice(index + 1);
    const before = ranges.length;
    map.forEach((_from, _to, from, to) => {
      ranges.push({ from: remaining.map(from, -1), to: remaining.map(to, 1) });
    });
    if (step instanceof AttrStep) ranges.push({ from: remaining.map(step.pos, -1), to: remaining.map(step.pos + 1, 1) });
    else if (ranges.length === before && !(step instanceof AddMarkStep) && !(step instanceof RemoveMarkStep)) return undefined;
  }
  return ranges;
}

/** View-only tone annotations follow changed blocks; ordinary typing never re-reads unrelated background values. */
export function blockBackgroundTonePlugin(names: readonly string[]): Plugin<DecorationSet> {
  const types = new Set(names);
  return new Plugin<DecorationSet>({
    state: {
      init: (_config, state) => allDecorations(state.doc, types),
      apply(transaction, previous) {
        if (!transaction.docChanged) return previous;
        const ranges = changedRanges(transaction);
        if (ranges === undefined) return allDecorations(transaction.doc, types);
        let mapped = previous.map(transaction.mapping, transaction.doc);
        const nodes = new Map<number, PMNode>();
        for (const range of ranges) {
          // Include both sides of a deletion or split so a newly joined paragraph gets its current tone.
          const from = Math.max(0, Math.min(range.from, range.to) - 1);
          const to = Math.min(transaction.doc.content.size, Math.max(range.from, range.to) + 1);
          if (from >= to) continue;
          transaction.doc.nodesBetween(from, to, (node, position) => {
            if (node.isBlock) nodes.set(position, node);
            return !node.isTextblock;
          });
        }
        const removed: Decoration[] = [];
        const added: Decoration[] = [];
        for (const [position, node] of nodes) {
          removed.push(...mapped.find(position, position + 1).filter(item => item.from === position));
          const item = decoration(node, position, types);
          if (item !== undefined) added.push(item);
        }
        mapped = mapped.remove(removed);
        return mapped.add(transaction.doc, added);
      },
    },
    props: { decorations(state) { return this.getState(state); } },
  });
}
