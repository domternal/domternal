import { describe, it, expect } from 'vitest';
import { linkPastePlugin, linkPastePluginKey } from './linkPastePlugin.js';
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

describe('linkPastePlugin', () => {
  it('creates a plugin', () => {
    const plugin = linkPastePlugin({ type: schema.marks.link });
    expect(plugin).toBeDefined();
  });

  it('uses linkPastePluginKey', () => {
    expect(linkPastePluginKey).toBeDefined();
  });

  it('accepts custom protocols', () => {
    const plugin = linkPastePlugin({
      type: schema.marks.link,
      protocols: ['http:', 'https:', 'ftp:'],
    });
    expect(plugin).toBeDefined();
  });

  it('accepts validate callback', () => {
    const plugin = linkPastePlugin({
      type: schema.marks.link,
      validate: (url) => !url.includes('malicious'),
    });
    expect(plugin).toBeDefined();
  });

  it('has handlePaste prop', () => {
    const plugin = linkPastePlugin({ type: schema.marks.link });
    expect(plugin.props.handlePaste).toBeDefined();
  });
});
