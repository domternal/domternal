import { describe, it, expect } from 'vitest';
import { linkClickPlugin, linkClickPluginKey } from './linkClickPlugin.js';
import { Schema } from 'prosemirror-model';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      toDOM: () => ['p', 0],
      parseDOM: [{ tag: 'p' }],
    },
    text: { group: 'inline' },
  },
  marks: {
    link: {
      attrs: { href: { default: null } },
      toDOM: (mark) => ['a', { href: mark.attrs['href'] }, 0],
      parseDOM: [{ tag: 'a[href]' }],
    },
  },
});

describe('linkClickPlugin', () => {
  it('creates a plugin', () => {
    const plugin = linkClickPlugin({ type: schema.marks.link });
    expect(plugin).toBeDefined();
  });

  it('uses linkClickPluginKey', () => {
    expect(linkClickPluginKey).toBeDefined();
  });

  it('accepts openOnClick boolean option', () => {
    const plugin = linkClickPlugin({
      type: schema.marks.link,
      openOnClick: true,
    });
    expect(plugin).toBeDefined();
  });

  it('accepts openOnClick whenNotEditable option', () => {
    const plugin = linkClickPlugin({
      type: schema.marks.link,
      openOnClick: 'whenNotEditable',
    });
    expect(plugin).toBeDefined();
  });

  it('has handleClick prop', () => {
    const plugin = linkClickPlugin({ type: schema.marks.link });
    expect(plugin.props.handleClick).toBeDefined();
  });
});
