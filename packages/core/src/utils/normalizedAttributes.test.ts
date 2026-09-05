import { describe, expect, it, vi } from 'vitest';
import type { Schema } from '@domternal/pm/model';
import { Node } from '../Node.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { ListItem } from '../nodes/ListItem.js';
import { OrderedList } from '../nodes/OrderedList.js';
import { BulletList } from '../nodes/BulletList.js';
import { ExtensionManager } from '../ExtensionManager.js';
import type { AnyExtension, AttributeSpec } from '../types/index.js';
import { forEachNormalizedAttribute, normalizedAttributeTypes, registerAttributeNormalizer } from './normalizedAttributes.js';

const build = (extensions: AnyExtension[]): Schema =>
  new ExtensionManager({ extensions: [Document, Paragraph, Text, ListItem, ...extensions] }, { state: null, view: null, schema: null, commands: {} } as never).schema;

/** A third-party node that happens to declare its own listStyleType. */
const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'paragraph+',
  addAttributes: () => ({ listStyleType: { default: null } }),
  parseHTML: () => [{ tag: 'aside' }],
  renderHTML: () => ['aside', 0],
});

/** A node whose attribute loads a smaller set of values than validation accepts. */
const sizeValidator = (value: unknown): void => { if (typeof value !== 'number') throw new RangeError('Invalid size'); };
registerAttributeNormalizer(sizeValidator, {
  code: 'unknown-list-marker',
  invalid: value => typeof value !== 'number',
  unsupported: value => typeof value !== 'number' || value > 2,
  replacement: () => 1,
});
/** The same kind of attribute, reporting a different code. */
const otherValidator = (value: unknown): void => { if (typeof value !== 'number') throw new RangeError('Invalid size'); };
registerAttributeNormalizer(otherValidator, {
  code: 'another-code' as 'unknown-list-marker',
  invalid: value => typeof value !== 'number',
  replacement: () => 1,
});
const Sized = Node.create({
  name: 'sized',
  group: 'block',
  content: 'paragraph+',
  addAttributes: () => ({ size: { default: 1, validate: sizeValidator } }),
  parseHTML: () => [{ tag: 'section' }],
  renderHTML: () => ['section', 0],
});

describe('normalized attribute registry', () => {
  it('finds attributes by validator, including renamed and extended lists, and ignores a foreign attribute of the same name', () => {
    const Steps = OrderedList.extend({ name: 'steps' });
    const Dots = BulletList.extend({ name: 'dots', addAttributes() { return { ...(this.parent?.() as Record<string, AttributeSpec>), tone: { default: null } }; } });
    const schema = build([OrderedList, BulletList, Steps, Dots, Callout, Sized]);
    const types = normalizedAttributeTypes(schema);
    expect([...types.keys()].sort()).toEqual(['bulletList', 'dots', 'orderedList', 'sized', 'steps']);
    expect(types.get('steps')?.map(([attribute, normalizer]) => [attribute, normalizer.code])).toEqual([['listStyleType', 'unknown-list-marker']]);
    expect(types.has('callout')).toBe(false);
  });

  it('builds the lookup once per schema', () => {
    const schema = build([OrderedList]);
    expect(normalizedAttributeTypes(schema)).toBe(normalizedAttributeTypes(schema));
    expect(normalizedAttributeTypes(build([OrderedList]))).not.toBe(normalizedAttributeTypes(schema));
    expect(normalizedAttributeTypes(build([Callout])).size).toBe(0);
  });

  it('finds invalid values, or also valid ones the configuration does not support, and never an absent value', () => {
    const schema = build([OrderedList, Sized]);
    const found = (typeName: string, attrs: unknown, check: 'invalid' | 'unsupported', code?: 'unknown-list-marker'): unknown[] => {
      const values: unknown[] = [];
      forEachNormalizedAttribute(schema, typeName, attrs, check, (attribute, value, normalizer) => {
        values.push([attribute, value, normalizer.replacement(value)]);
      }, code);
      return values;
    };
    expect(found('sized', { size: 5 }, 'invalid')).toEqual([]);
    expect(found('sized', { size: 5 }, 'unsupported')).toEqual([['size', 5, 1]]);
    expect(found('sized', { size: 'x' }, 'invalid')).toEqual([['size', 'x', 1]]);
    expect(found('sized', {}, 'unsupported')).toEqual([]);
    expect(found('sized', undefined, 'unsupported')).toEqual([]);
    expect(found('orderedList', { listStyleType: 'bogus' }, 'invalid')).toEqual([['listStyleType', 'bogus', null]]);
    expect(found('orderedList', { listStyleType: 'bogus' }, 'unsupported')).toEqual([['listStyleType', 'bogus', null]]);
    expect(found('orderedList', { listStyleType: null }, 'unsupported')).toEqual([]);
    expect(found('paragraph', { listStyleType: 'bogus' }, 'unsupported')).toEqual([]);
    const callback = vi.fn();
    forEachNormalizedAttribute(schema, 'orderedList', 'not attrs', 'unsupported', callback);
    expect(callback).not.toHaveBeenCalled();
  });

  it('limits the search to one code', () => {
    const OtherCode = Node.create({
      name: 'other',
      group: 'block',
      content: 'paragraph+',
      addAttributes: () => ({ size: { default: 1, validate: otherValidator } }),
      parseHTML: () => [{ tag: 'article' }],
      renderHTML: () => ['article', 0],
    });
    const schema = build([OrderedList, OtherCode]);
    const values: unknown[] = [];
    forEachNormalizedAttribute(schema, 'other', { size: 'x' }, 'invalid', (_, value) => values.push(value), 'unknown-list-marker');
    expect(values).toEqual([]);
    forEachNormalizedAttribute(schema, 'other', { size: 'x' }, 'invalid', (_, value) => values.push(value));
    expect(values).toEqual(['x']);
  });
});
