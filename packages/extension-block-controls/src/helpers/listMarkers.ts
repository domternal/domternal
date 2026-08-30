import type { Attrs, Node as PMNode } from '@domternal/pm/model';

const ORDERED_MARKERS = new Set(['decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman']);
const BULLET_MARKERS = new Set(['disc', 'circle', 'square']);

/** Null keeps destination depth styling and is distinct from an explicit default. */
export function readListMarker(wrapper: PMNode): string | null {
  const allowed = wrapper.type.name === 'orderedList' ? ORDERED_MARKERS
    : wrapper.type.name === 'bulletList' ? BULLET_MARKERS : undefined;
  const value: unknown = wrapper.attrs['listStyleType'];
  return allowed !== undefined && typeof value === 'string' && allowed.has(value) ? value : null;
}

/** IDs and ordered starts retain their separate existing merge policies. */
export function canMergeListWrappers(before: PMNode, after: PMNode): boolean {
  return before.type === after.type && readListMarker(before) === readListMarker(after);
}

/** Fresh wrappers retain only the safe marker, never source IDs or ordered starts. */
export function freshListMarkerAttributes(wrapper: PMNode): Attrs | null {
  const marker = readListMarker(wrapper);
  return marker === null ? null : { listStyleType: marker };
}
