/**
 * Heading levels: the vocabulary every configuration shares (whole numbers
 * from 1 to 6) and the rule that places a level a configuration lacks.
 */
import { ExtensionConfigurationError } from '../ExtensionConfigurationError.js';
import type { AttributeSpec } from '../types/AttributeSpec.js';
import { registerAttributeNormalizer } from './normalizedAttributes.js';

/** Whether the value is a heading level: a whole number from 1 to 6. */
export function isHeadingLevel(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6;
}

/** Checks the Heading `levels` option: a non-empty list of heading levels, in any order. */
export function configuredHeadingLevels(levels: unknown): readonly number[] {
  if (!Array.isArray(levels) || levels.length === 0 || ![...levels as unknown[]].every(isHeadingLevel)) {
    throw new ExtensionConfigurationError('Heading: levels must be a non-empty list of whole numbers from 1 to 6');
  }
  return levels as readonly number[];
}

/**
 * The configured level that keeps a heading's place in the outline: the
 * nearest level of equal or lower importance, otherwise the deepest configured
 * level. A heading is never promoted while a deeper level exists, and the
 * order of outline levels is kept. PasteCleanup applies the same rule to
 * pasted headings with its own copy, since its HTML entry must not import Core.
 */
export function nearestHeadingLevel(level: number, levels: readonly number[]): number {
  let deeper: number | undefined;
  let deepest = levels[0] ?? 1;
  for (const candidate of levels) {
    if (candidate >= level && (deeper === undefined || candidate < deeper)) deeper = candidate;
    if (candidate > deepest) deepest = candidate;
  }
  return deeper ?? deepest;
}

/** A decimal number written as a string, such as a level stored as "5". */
const decimal = /^\s*[+-]?\d+(?:\.\d+)?\s*$/;

/**
 * The configured level a stored value renders and loads as. A decimal string
 * counts as its number, so "5" keeps its place in the outline. Another finite
 * number is rounded up, toward less importance, into the range 1 to 6 first.
 * Any other value takes the first configured level, the default.
 */
export function resolveHeadingLevel(value: unknown, levels: readonly number[]): number {
  const level = typeof value === 'string' && decimal.test(value) ? Number(value) : value;
  if (typeof level !== 'number' || !Number.isFinite(level)) return levels[0] ?? 1;
  return nearestHeadingLevel(Math.min(6, Math.max(1, Math.ceil(level))), levels);
}

/**
 * The default and validation of the heading `level` attribute. Validation
 * accepts the whole vocabulary, not only the configured levels, so a document
 * written with other levels, such as by a collaborator configured with more,
 * still loads everywhere: in Node.fromJSON, Node.check and Step.fromJSON.
 * The editor's JSON entry points move a level these `levels` lack to the
 * nearest configured one and report it; rendering does the same without
 * changing the document.
 */
export function headingLevelAttribute(levels: readonly number[]): Pick<AttributeSpec, 'default' | 'validate'> {
  const invalid = (value: unknown): boolean => !isHeadingLevel(value);
  const validate = (value: unknown): void => {
    if (invalid(value)) throw new RangeError('Invalid heading level');
  };
  registerAttributeNormalizer(validate, {
    code: 'unsupported-heading-level',
    invalid,
    unsupported: value => invalid(value) || !levels.includes(value as number),
    replacement: value => resolveHeadingLevel(value, levels),
  });
  // Content and commands without a level get the first configured one.
  return { default: levels[0], validate };
}
