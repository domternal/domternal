import type { AttributeSpec } from '../types/AttributeSpec.js';
import type { GlobalAttributeSpec } from '../types/ExtensionConfig.js';
import type { ListLabel } from '../types/ListLabel.js';
import { listLabelForKind, parseListLabel, serializeListLabel } from './listLabel.js';
import { listLabelStyleName } from './listLabelStyles.js';
import { registerAttributeNormalizer } from './normalizedAttributes.js';

type ListKind = 'orderedList' | 'bulletList';
const ORDERED_TYPES: Readonly<Record<string, string>> = { decimal: '1', 'lower-alpha': 'a', 'upper-alpha': 'A', 'lower-roman': 'i', 'upper-roman': 'I' };
const BULLET = new Set(['disc', 'circle', 'square']);
const contracts = new WeakSet<(value: unknown) => void>();

/** Recognize this contract by validator identity, not by an arbitrary matching attribute name. */
export function hasListLabelContract(attribute: Pick<AttributeSpec, 'validate'> | undefined): boolean {
  return typeof attribute?.validate === 'function' && contracts.has(attribute.validate);
}

export function listLabelAttribute(kind: ListKind): GlobalAttributeSpec {
  const invalid = (value: unknown): boolean => value !== null && listLabelForKind(kind, value) === null;
  const validate = (value: unknown): void => { if (invalid(value)) throw new RangeError('Invalid list label'); };
  contracts.add(validate);
  registerAttributeNormalizer(validate, { code: 'unsupported-list-label', invalid, replacement: () => null });
  return {
    default: null,
    validate,
    parseHTML: element => listLabelForKind(kind, parseListLabel(element.getAttribute('data-dm-list-label'))),
    renderHTML: attributes => {
      const label = listLabelForKind(kind, attributes['listLabel']);
      if (label === null) return null;
      const name = listLabelStyleName(label);
      const marker = attributes['listStyleType'];
      const explicit = typeof marker === 'string' && (kind === 'orderedList' ? Object.hasOwn(ORDERED_TYPES, marker) : BULLET.has(marker)) ? marker : null;
      const fallback = explicit ?? (label.kind === 'counter' ? label.format : label.kind === 'compound' ? label.fallback : 'disc');
      const result: Record<string, string> = {
        'data-dm-list-label': serializeListLabel(label) ?? '',
        style: `list-style-type: var(--${name}, ${fallback})${label.kind === 'image' ? `; list-style-image: var(--${name}-image, none)` : ''}`,
      };
      // Keep an explicit existing marker available to older schemas while preserving a nullable default.
      if (explicit !== null) result['type'] = kind === 'orderedList' ? ORDERED_TYPES[explicit] ?? '1' : explicit;
      return result;
    },
  };
}

/** Values stored by foreign attributes named listLabel are not our presentation contract. */
export function nodeListLabel(node: { readonly type: { readonly name: string; readonly spec: { readonly attrs?: Readonly<Record<string, Pick<AttributeSpec, 'validate'>>> } }; readonly attrs: Readonly<Record<string, unknown>> }): ListLabel | null {
  return hasListLabelContract(node.type.spec.attrs?.['listLabel']) ? listLabelForKind(node.type.name, node.attrs['listLabel']) : null;
}
