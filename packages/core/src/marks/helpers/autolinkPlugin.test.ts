import { describe, it, expect } from 'vitest';
import { autolinkPlugin, autolinkPluginKey } from './autolinkPlugin.js';
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

describe('autolinkPlugin', () => {
  it('creates a plugin', () => {
    const plugin = autolinkPlugin({ type: schema.marks.link });
    expect(plugin).toBeDefined();
  });

  it('uses autolinkPluginKey', () => {
    expect(autolinkPluginKey).toBeDefined();
  });

  it('accepts custom protocols', () => {
    const plugin = autolinkPlugin({
      type: schema.marks.link,
      protocols: ['http:', 'https:', 'ftp:'],
    });
    expect(plugin).toBeDefined();
  });

  it('accepts custom defaultProtocol', () => {
    const plugin = autolinkPlugin({
      type: schema.marks.link,
      defaultProtocol: 'http',
    });
    expect(plugin).toBeDefined();
  });

  it('accepts shouldAutoLink callback', () => {
    const plugin = autolinkPlugin({
      type: schema.marks.link,
      shouldAutoLink: (url) => !url.includes('spam'),
    });
    expect(plugin).toBeDefined();
  });

  it('has handleTextInput prop', () => {
    const plugin = autolinkPlugin({ type: schema.marks.link });
    expect(plugin.props.handleTextInput).toBeDefined();
  });
});
