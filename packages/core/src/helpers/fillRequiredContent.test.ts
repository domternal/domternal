// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Node as PMNode } from '@domternal/pm/model';
import { fillRequiredContent } from './fillRequiredContent.js';
import { createSchema } from './ssr.js';
import { StarterKit } from '../extensions/StarterKit.js';
import { Node } from '../Node.js';
import type { JSONContent } from '../types/index.js';

const schema = createSchema([StarterKit]);
const load = (json: JSONContent): PMNode => PMNode.fromJSON(schema, json);
const text = (value: string): JSONContent => ({ type: 'text', text: value });
const paragraph = (value?: string): JSONContent => ({ type: 'paragraph', ...(value !== undefined && { content: [text(value)] }) });
const heading = (value: string): JSONContent => ({ type: 'heading', attrs: { level: 2 }, content: [text(value)] });
const bulletList = (...items: JSONContent[][]): JSONContent => ({
  type: 'bulletList',
  content: items.map(content => ({ type: 'listItem', content })),
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });
const isValid = (node: PMNode): boolean => {
  try { node.check(); return true; } catch { return false; }
};

describe('fillRequiredContent', () => {
  it('starts a list item that starts with a heading with an empty paragraph, keeping the heading', () => {
    const loaded = load(doc(bulletList([heading('Title'), paragraph('body')])));
    expect(isValid(loaded)).toBe(false);
    const filled = fillRequiredContent(loaded);
    expect(isValid(filled)).toBe(true);
    expect(filled.toJSON()).toEqual(load(doc(bulletList([paragraph(), heading('Title'), paragraph('body')]))).toJSON());
  });

  it('starts a list item that holds only a nested list with an empty paragraph', () => {
    const filled = fillRequiredContent(load(doc(bulletList([bulletList([paragraph('nested')])]))));
    expect(isValid(filled)).toBe(true);
    expect(filled.toJSON()).toEqual(load(doc(bulletList([paragraph(), bulletList([paragraph('nested')])]))).toJSON());
  });

  it('repairs nested list items and leaves their valid siblings as they were', () => {
    const loaded = load(doc(
      paragraph('before'),
      bulletList([paragraph('outer'), bulletList([heading('Inner')])], [paragraph('sibling')]),
    ));
    const filled = fillRequiredContent(loaded);
    expect(isValid(filled)).toBe(true);
    expect(filled.child(0)).toBe(loaded.child(0));
    expect(filled.child(1).child(1)).toBe(loaded.child(1).child(1));
    expect(filled.child(1).child(0).child(1).child(0).toJSON()).toEqual({ type: 'listItem', content: [{ type: 'paragraph' }, heading('Inner')] });
  });

  it('gives an empty document and an empty blockquote the paragraph they must hold', () => {
    expect(fillRequiredContent(load(doc())).toJSON()).toEqual(doc(paragraph()));
    expect(fillRequiredContent(load(doc({ type: 'blockquote' }))).toJSON()).toEqual(doc({ type: 'blockquote', content: [paragraph()] }));
  });

  it('adds required blocks after the content as well', () => {
    const Pair = Node.create({ name: 'pair', group: 'block', content: 'heading paragraph' });
    const paired = createSchema([StarterKit, Pair]);
    const filled = fillRequiredContent(PMNode.fromJSON(paired, doc({ type: 'pair', content: [heading('Only')] })));
    expect(isValid(filled)).toBe(true);
    expect(filled.toJSON()).toEqual(doc({ type: 'pair', content: [heading('Only'), paragraph()] }));
  });

  it('returns a valid document as the same object', () => {
    const loaded = load(doc(paragraph('a'), bulletList([paragraph('b')]), { type: 'blockquote', content: [paragraph('c')] }));
    expect(fillRequiredContent(loaded)).toBe(loaded);
  });

  it('leaves content no fill can make valid as it was, removing nothing', () => {
    const loaded = load(doc(bulletList([paragraph('label'), text('stray')])));
    const filled = fillRequiredContent(loaded);
    expect(filled).toBe(loaded);
    expect(filled.textContent).toBe('labelstray');
  });
});
