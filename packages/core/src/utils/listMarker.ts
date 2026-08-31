import type { Attrs, Node as PMNode, NodeType, ResolvedPos, Schema } from '@domternal/pm/model';
import type { AttributeSpec } from '../types/AttributeSpec.js';

const ORDERED = ['decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman'] as const;
const BULLET = ['disc', 'circle', 'square'] as const;
type ListMarker = typeof ORDERED[number] | typeof BULLET[number];
type ListKind = 'orderedList' | 'bulletList';

/** Only the persisted built-in enum is meaningful; null retains the theme. */
export function listMarker(kind: string, value: unknown): ListMarker | null {
  if (typeof value !== 'string') return null;
  const values: readonly string[] = kind === 'orderedList' ? ORDERED : kind === 'bulletList' ? BULLET : [];
  return values.includes(value) ? value as ListMarker : null;
}

export function parseListMarker(kind: ListKind, element: Element): ListMarker | null {
  // Read declarations rather than CSSOM, which may expand shorthand or escapes.
  let explicit: ListMarker | null = null;
  for (const declaration of (element.getAttribute('style') ?? '').split(';')) {
    const separator = declaration.indexOf(':');
    if (separator < 0 || declaration.slice(0, separator).trim().toLowerCase() !== 'list-style-type') continue;
    const value = listMarker(kind, declaration.slice(separator + 1).trim().toLowerCase());
    if (value !== null) explicit = value;
  }
  if (explicit !== null) return explicit;
  const type = element.getAttribute('type');
  if (kind === 'bulletList') return listMarker(kind, type?.trim().toLowerCase());
  switch (type) {
    case '1': return 'decimal';
    case 'a': return 'lower-alpha';
    case 'A': return 'upper-alpha';
    case 'i': return 'lower-roman';
    case 'I': return 'upper-roman';
    case null: return null;
    default: return null;
  }
}

/** Validators created by listMarkerAttribute, so renamed or extended lists are recognized and foreign attributes are not. */
const markerValidators = new WeakMap<object, ListKind>();
const schemaMarkers = new WeakMap<Schema, Map<string, [attribute: string, kind: ListKind][]>>();

export function listMarkerAttribute(kind: ListKind): AttributeSpec {
  const validate = (value: unknown): void => {
    if (value !== null && listMarker(kind, value) === null) throw new RangeError('Invalid list marker');
  };
  markerValidators.set(validate, kind);
  return {
    default: null,
    validate,
    parseHTML: element => parseListMarker(kind, element),
    renderHTML: attributes => {
      const marker = listMarker(kind, attributes['listStyleType']);
      return marker === null ? {} : { style: `list-style-type: ${marker}` };
    },
  };
}

/** Node type names mapped to their list marker attributes, built once per schema. */
export function listMarkerTypes(schema: Schema): ReadonlyMap<string, readonly [attribute: string, kind: ListKind][]> {
  let markers = schemaMarkers.get(schema);
  if (!markers) {
    schemaMarkers.set(schema, markers = new Map<string, [string, ListKind][]>());
    for (const type of Object.values(schema.nodes)) {
      for (const [attribute, spec] of Object.entries(type.spec.attrs ?? {})) {
        // A string validator is not an object, so the lookup misses it without throwing.
        const kind = markerValidators.get(spec.validate as object);
        if (kind) markers.set(type.name, [...markers.get(type.name) ?? [], [attribute, kind]]);
      }
    }
  }
  return markers;
}

/**
 * Calls `found` for each list marker attribute of the node type whose value
 * in `attrs` validation would reject. `attrs` may be unchecked JSON.
 */
export function forEachUnknownListMarker(
  schema: Schema,
  typeName: string,
  attrs: unknown,
  found: (attribute: string, value: unknown) => void,
): void {
  for (const [attribute, kind] of listMarkerTypes(schema).get(typeName) ?? []) {
    const value = (attrs as Record<string, unknown> | null | undefined)?.[attribute];
    if (value !== null && value !== undefined && listMarker(kind, value) === null) found(attribute, value);
  }
}

/** Marker identity intentionally excludes ordered start and unique wrapper IDs. */
export function sameListMarker(left: PMNode, right: PMNode): boolean {
  return left.type === right.type
    && listMarker(left.type.name, left.attrs['listStyleType']) === listMarker(right.type.name, right.attrs['listStyleType']);
}

export function hasListMarker(node: PMNode): boolean {
  return listMarker(node.type.name, node.attrs['listStyleType']) !== null;
}

/** Fresh wrappers inherit a marker, not a source wrapper's identity or start. */
export function freshListAttrs(type: NodeType, source?: Attrs, start = 1): Attrs {
  const attrs: Record<string, unknown> = {};
  if (type.spec.attrs?.['listStyleType']) attrs['listStyleType'] = listMarker(type.name, source?.['listStyleType']);
  if (type.name === 'orderedList') attrs['start'] = start;
  return attrs;
}

/** A utility may leave a null inner wrapper inside an explicitly styled ancestor. */
export function hasListMarkerAncestor(position: ResolvedPos): boolean {
  for (let depth = position.depth; depth > 0; depth--) if (hasListMarker(position.node(depth))) return true;
  return false;
}
