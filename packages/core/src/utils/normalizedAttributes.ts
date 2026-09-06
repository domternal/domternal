/**
 * Attributes whose stored values the editor normalizes. The JSON entry points
 * and normalizeContent replace an unsupported value while loading, or remove
 * the mark that carries it, the paste guard keeps invalid values out of pasted
 * slices, and a migration command does the same in the document. An attribute
 * is found by the identity of its validator, so a renamed or extended node or
 * mark that keeps the attribute spec is recognized, and a foreign attribute
 * that happens to share its name is not. Node and mark type names never
 * overlap in a schema, so one map holds both.
 */
import type { Schema } from '@domternal/pm/model';
import type { ContentDiagnostic } from '../types/Content.js';

export interface AttributeNormalizer {
  /** The diagnostic code that reports a replaced value. */
  readonly code: ContentDiagnostic['code'];
  /** The code for a value, when one attribute reports more than one code. */
  readonly codeFor?: (value: unknown) => ContentDiagnostic['code'];
  /** Whether schema validation rejects the value. */
  readonly invalid: (value: unknown) => boolean;
  /**
   * Whether loading replaces the value: an invalid one, or a valid one this
   * configuration does not support. Without it, only invalid values are replaced.
   */
  readonly unsupported?: (value: unknown) => boolean;
  /** The value that replaces an unsupported one. Unused when the mark is removed. */
  readonly replacement: (value: unknown) => unknown;
  /**
   * A mark attribute only: an unsupported value removes the mark instead of
   * replacing the value, and an absent value counts as the attribute's
   * default, so a mark that lacks the attribute is removed too.
   */
  readonly removesMark?: true;
}

/** Which values to find: those validation rejects, or also those this configuration does not support. */
export type NormalizedAttributeCheck = 'invalid' | 'unsupported';

/** A normalized attribute of one node or mark type. */
export interface NormalizedAttribute {
  readonly attribute: string;
  readonly normalizer: AttributeNormalizer;
  /** Whether the attribute belongs to a mark type. */
  readonly mark: boolean;
  /** The attribute's default, which an absent value of a mark-removing attribute counts as. */
  readonly defaultValue: unknown;
}

const normalizers = new WeakMap<object, AttributeNormalizer>();
const schemaAttributes = new WeakMap<Schema, Map<string, NormalizedAttribute[]>>();

/** Registers how values of the attribute with this validator are normalized. */
export function registerAttributeNormalizer(validate: (value: unknown) => void, normalizer: AttributeNormalizer): void {
  normalizers.set(validate, normalizer);
}

/** Node and mark type names mapped to their normalized attributes, built once per schema. */
export function normalizedAttributeTypes(schema: Schema): ReadonlyMap<string, readonly NormalizedAttribute[]> {
  let types = schemaAttributes.get(schema);
  if (!types) {
    schemaAttributes.set(schema, types = new Map<string, NormalizedAttribute[]>());
    const collect = (name: string, attrs: Record<string, { validate?: unknown; default?: unknown }> | undefined, mark: boolean): void => {
      for (const [attribute, spec] of Object.entries(attrs ?? {})) {
        // A string validator is not an object, so the lookup misses it without throwing.
        const normalizer = normalizers.get(spec.validate as object);
        if (normalizer) types?.set(name, [...types.get(name) ?? [], { attribute, normalizer, mark, defaultValue: spec.default }]);
      }
    };
    for (const type of Object.values(schema.nodes)) collect(type.name, type.spec.attrs, false);
    for (const type of Object.values(schema.marks)) collect(type.name, type.spec.attrs, true);
  }
  return types;
}

/** Whether the check finds the value of a normalized attribute. */
function finds(entry: NormalizedAttribute, value: unknown, check: NormalizedAttributeCheck): boolean {
  const { normalizer } = entry;
  const replaced = check === 'invalid' ? normalizer.invalid : normalizer.unsupported ?? normalizer.invalid;
  return replaced(value);
}

/**
 * Calls `found` for each normalized attribute of the node or mark type whose
 * value in `attrs` the check finds, only for attributes reporting `code` when
 * it is given. `attrs` may be unchecked JSON. An absent value takes the
 * attribute's default, so it is never found, except for an attribute whose
 * unsupported value removes its mark: there the default is checked.
 */
export function forEachNormalizedAttribute(
  schema: Schema,
  typeName: string,
  attrs: unknown,
  check: NormalizedAttributeCheck,
  found: (attribute: string, value: unknown, normalizer: AttributeNormalizer) => void,
  code?: ContentDiagnostic['code'],
): void {
  for (const entry of normalizedAttributeTypes(schema).get(typeName) ?? []) {
    const { attribute, normalizer } = entry;
    if (code !== undefined && normalizer.code !== code) continue;
    let value = (attrs as Record<string, unknown> | null | undefined)?.[attribute];
    if (value === undefined) {
      if (!normalizer.removesMark) continue;
      value = entry.defaultValue;
    }
    if (finds(entry, value, check)) found(attribute, value, normalizer);
  }
}

/** The diagnostic code that reports this value. */
export const diagnosticCode = (normalizer: AttributeNormalizer, value: unknown): ContentDiagnostic['code'] =>
  normalizer.codeFor?.(value) ?? normalizer.code;

/**
 * Whether loading JSON content keeps this value of the attribute: false when
 * it would replace the value or remove the mark that carries it. True for an
 * attribute the editor does not normalize.
 */
export function isSupportedAttributeValue(schema: Schema, typeName: string, attribute: string, value: unknown): boolean {
  let supported = true;
  forEachNormalizedAttribute(schema, typeName, { [attribute]: value }, 'unsupported', name => {
    if (name === attribute) supported = false;
  });
  return supported;
}
