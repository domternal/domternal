import { describe, expect, it } from 'vitest';
import type { Schema } from '@domternal/pm/model';
import { ExtensionManager } from '../ExtensionManager.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { Heading } from '../nodes/Heading.js';
import { ListItem } from '../nodes/ListItem.js';
import { OrderedList } from '../nodes/OrderedList.js';
import { BulletList } from '../nodes/BulletList.js';
import { Link } from '../marks/Link.js';
import type { AnyExtension } from '../types/index.js';
import { resolveAttributeValue } from '../index.js';

const build = (extensions: AnyExtension[]): Schema =>
  new ExtensionManager({ extensions: [Document, Paragraph, Text, ...extensions] }, { state: null, view: null, schema: null, commands: {} } as never).schema;
const schema = build([Heading, ListItem, OrderedList, BulletList, Link]);

describe('resolveAttributeValue', () => {
  it.each([[1, 1], [4, 4], [5, 4], [6, 4], ['5', 4], ['x', 1], [9, 4], [0, 1], [2.5, 3], [null, 1]])(
    'reads a stored heading level %j as %j with levels 1 to 4', (stored, rendered) => {
      expect(resolveAttributeValue(schema, 'heading', 'level', stored)).toBe(rendered);
    });

  it('follows the configured levels', () => {
    const narrow = build([Heading.configure({ levels: [2, 3] })]);
    expect([1, 2, 3, 4, 5, 6].map(level => resolveAttributeValue(narrow, 'heading', 'level', level))).toEqual([2, 2, 3, 3, 3, 3]);
    const all = build([Heading.configure({ levels: [1, 2, 3, 4, 5, 6] })]);
    expect([1, 2, 3, 4, 5, 6].map(level => resolveAttributeValue(all, 'heading', 'level', level))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('reads an unknown list marker as the default marker', () => {
    expect(resolveAttributeValue(schema, 'orderedList', 'listStyleType', 'foo')).toBeNull();
    expect(resolveAttributeValue(schema, 'orderedList', 'listStyleType', 'lower-roman')).toBe('lower-roman');
    expect(resolveAttributeValue(schema, 'bulletList', 'listStyleType', null)).toBeNull();
  });

  it('reads an href the URL policy refuses as null, a link that does not apply', () => {
    expect(resolveAttributeValue(schema, 'link', 'href', 'javascript:alert(1)')).toBeNull();
    expect(resolveAttributeValue(schema, 'link', 'href', 'https://example.com')).toBe('https://example.com');
    // An absent href counts as the default, which a link without an href cannot carry.
    expect(resolveAttributeValue(schema, 'link', 'href', undefined)).toBeNull();
  });

  it('returns the value as given for an attribute or type the editor does not normalize', () => {
    const value = { any: 'value' };
    expect(resolveAttributeValue(schema, 'heading', 'id', value)).toBe(value);
    expect(resolveAttributeValue(schema, 'paragraph', 'level', 9)).toBe(9);
    expect(resolveAttributeValue(schema, 'missing', 'level', 9)).toBe(9);
    expect(resolveAttributeValue(schema, 'heading', 'level', undefined)).toBeUndefined();
    expect(resolveAttributeValue(build([Heading.extend({ name: 'title' })]), 'title', 'level', 6)).toBe(4);
  });
});
