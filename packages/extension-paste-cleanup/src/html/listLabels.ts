import { getListLabelStyleSheet, parseListLabel, readListLabel } from '@domternal/core/list-labels';
import type { ListLabel } from '@domternal/core/list-labels';
import type { Properties } from 'hast';
import { validListStyle } from './listStyles.js';

/** Metadata belongs only to its matching semantic list, never to tasks or arbitrary nodes. */
export function listLabelForTag(tag: string, value: unknown): ListLabel | null {
  const label = readListLabel(value);
  return label !== null && (tag === 'ol' && (label.kind === 'counter' || label.kind === 'compound')
    || tag === 'ul' && (label.kind === 'text' || label.kind === 'image')) ? label : null;
}

export function readHTMLListLabel(properties: Properties, tag: string): ListLabel | null {
  const value = properties['dataDmListLabel'];
  if (properties.dataType === 'taskList') return null;
  return listLabelForTag(tag, parseListLabel(value));
}

/** The compiler owns this name. Pasted style declarations never supply its identity. */
export function listLabelStyleName(label: ListLabel): string {
  const stylesheet = getListLabelStyleSheet({ type: label.kind === 'text' || label.kind === 'image' ? 'bulletList' : 'orderedList', attrs: { listLabel: label } });
  const name = /^@counter-style (dm-ll-[A-Za-z0-9_-]+) \{/u.exec(stylesheet)?.[1];
  if (name === undefined) throw new Error('Missing compiled list label style');
  return name;
}

/** Only the exact compiled variable and a closed native fallback survive normalization. */
export function readCompanionListStyle(value: string, tag: string, name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const match = /^var\(--(dm-ll-[A-Za-z0-9_-]+),\s*([a-z-]+)\)$/u.exec(value);
  const fallback = match?.[2];
  return match?.[1] === name && validListStyle(tag, fallback) ? `var(--${name}, ${fallback})` : undefined;
}
