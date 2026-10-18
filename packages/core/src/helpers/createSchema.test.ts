// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createSchema, generateText } from './ssr.js';
import { StarterKit } from '../extensions/StarterKit.js';
import { Extension } from '../Extension.js';
import { Node } from '../Node.js';
import { TextStyle } from '../marks/TextStyle.js';
import { FontSize } from '../extensions/FontSize.js';

describe('headless schema creation', () => {
  it('uses the same extension configuration without a browser or editor lifecycle', () => {
    expect(typeof document).toBe('undefined');
    const create = vi.fn();
    const plugins = vi.fn(() => []);
    const lifecycle = Extension.create({ name: 'lifecycle', onCreate: create, addProseMirrorPlugins: plugins });
    const schema = createSchema([StarterKit.configure({ heading: { levels: [2, 3] } }), lifecycle]);
    expect(schema.node('heading').attrs['level']).toBe(2);
    const heading = schema.node('heading', { level: 3 }, schema.text('Worker heading', [schema.mark('bold')]));
    const doc = schema.node('doc', null, [heading]);
    expect(() => { doc.check(); }).not.toThrow();
    expect(heading.marks).toEqual([]);
    expect(heading.firstChild?.marks[0]?.type.name).toBe('bold');
    expect(create).not.toHaveBeenCalled();
    expect(plugins).not.toHaveBeenCalled();
  });

  it('retains configured global attributes and custom nodes in independent schemas', () => {
    const Callout = Node.create({ name: 'callout', group: 'block', content: 'block+',
      addAttributes() { return { tone: { default: 'info', validate: 'string' } }; } });
    const extensions = (): Parameters<typeof createSchema>[0] => [StarterKit, TextStyle, FontSize, Callout];
    const first = createSchema(extensions());
    const second = createSchema(extensions());
    const doc = first.node('doc', null, [first.node('callout', { tone: 'warning' }, [first.node('paragraph', null,
      first.text('Shared schema', [first.mark('textStyle', { fontSize: '18px' })]))])]);
    const restored = second.nodeFromJSON(doc.toJSON());
    expect(restored.toJSON()).toEqual(doc.toJSON());
    expect(() => { restored.check(); }).not.toThrow();
    expect(restored.type).not.toBe(doc.type);
    expect(generateText(doc.toJSON(), extensions())).toBe('Shared schema');
  });

  it('rejects incomplete schemas and invalid extension options before a job starts', () => {
    expect(() => createSchema([])).toThrow();
    expect(() => createSchema([StarterKit.configure({ heading: { levels: [7] } })])).toThrow();
  });
});
