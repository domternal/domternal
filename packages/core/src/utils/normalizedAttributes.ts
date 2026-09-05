/**
 * Attributes whose stored values the editor normalizes. The JSON entry points
 * and normalizeContent replace an unsupported value while loading, the paste
 * guard keeps invalid values out of pasted slices, and a migration command
 * replaces them in the document. An attribute is found by the identity of its
 * validator, so a renamed or extended node that keeps the attribute spec is
 * recognized, and a foreign attribute that happens to share its name is not.
 */
import type { Schema } from '@domternal/pm/model';
import type { ContentDiagnostic } from '../types/Content.js';

export interface AttributeNormalizer {
  /** The diagnostic code that reports a replaced value. */
  readonly code: ContentDiagnostic['code'];
  /** Whether schema validation rejects the value. */
  readonly invalid: (value: unknown) => boolean;
  /**
   * Whether loading replaces the value: an invalid one, or a valid one this
   * configuration does not support. Without it, only invalid values are replaced.
   */
  readonly unsupported?: (value: unknown) => boolean;
  /** The value that replaces an unsupported one. */
  readonly replacement: (value: unknown) => unknown;
}

/** Which values to find: those validation rejects, or also those this configuration does not support. */
export type NormalizedAttributeCheck = 'invalid' | 'unsupported';

const normalizers = new WeakMap<object, AttributeNormalizer>();
const schemaAttributes = new WeakMap<Schema, Map<string, [attribute: string, normalizer: AttributeNormalizer][]>>();

/** Registers how values of the attribute with this validator are normalized. */
export function registerAttributeNormalizer(validate: (value: unknown) => void, normalizer: AttributeNormalizer): void {
  normalizers.set(validate, normalizer);
}

/** Node type names mapped to their normalized attributes, built once per schema. */
export function normalizedAttributeTypes(schema: Schema): ReadonlyMap<string, readonly [attribute: string, normalizer: AttributeNormalizer][]> {
  let types = schemaAttributes.get(schema);
  if (!types) {
    schemaAttributes.set(schema, types = new Map<string, [string, AttributeNormalizer][]>());
    for (const type of Object.values(schema.nodes)) {
      for (const [attribute, spec] of Object.entries(type.spec.attrs ?? {})) {
        // A string validator is not an object, so the lookup misses it without throwing.
        const normalizer = normalizers.get(spec.validate as object);
        if (normalizer) types.set(type.name, [...types.get(type.name) ?? [], [attribute, normalizer]]);
      }
    }
  }
  return types;
}

/**
 * Calls `found` for each normalized attribute of the node type whose value in
 * `attrs` the check finds, only for attributes reporting `code` when it is
 * given. `attrs` may be unchecked JSON. An absent value takes the attribute's
 * default, so it is never found.
 */
export function forEachNormalizedAttribute(
  schema: Schema,
  typeName: string,
  attrs: unknown,
  check: NormalizedAttributeCheck,
  found: (attribute: string, value: unknown, normalizer: AttributeNormalizer) => void,
  code?: ContentDiagnostic['code'],
): void {
  for (const [attribute, normalizer] of normalizedAttributeTypes(schema).get(typeName) ?? []) {
    if (code !== undefined && normalizer.code !== code) continue;
    const value = (attrs as Record<string, unknown> | null | undefined)?.[attribute];
    if (value === undefined) continue;
    const replaced = check === 'invalid' ? normalizer.invalid : normalizer.unsupported ?? normalizer.invalid;
    if (replaced(value)) found(attribute, value, normalizer);
  }
}
