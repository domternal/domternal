// @vitest-environment node
/**
 * A headless editor on linkedom, the Node peer of the SSR helpers: getHTML
 * and inlineStyles write attribute values the way a browser reads them back.
 */
import { describe, it, expect } from 'vitest';
import { parseHTML } from 'linkedom';

const server = parseHTML('<!DOCTYPE html><html><body></body></html>');
Object.assign(globalThis, { window: server.window, document: server.document });
const { Editor } = await import('./Editor.js');
const { StarterKit } = await import('./extensions/StarterKit.js');
const { inlineStyles } = await import('./utils/inlineStyles.js');
const { Schema } = await import('@domternal/pm/model');

/** The link attributes a browser reads from the HTML: parsing decodes character references. */
function receivedLink(html: string): Record<string, string | null> {
  const anchor = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`).document.querySelector('a');
  return { href: anchor?.getAttribute('href') ?? null, title: anchor?.getAttribute('title') ?? null };
}

describe('a headless editor on linkedom', () => {
  const stored = { href: '/search?q=x&copy;y&amp;z=1', title: 'Tom &amp; Jerry' };
  const editor = new Editor({
    extensions: [StarterKit],
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: stored }] }] }] },
  });

  it('writes attribute values in getHTML as stored', () => {
    expect(receivedLink(editor.getHTML())).toEqual(stored);
    expect(receivedLink(editor.getHTML({ styled: true }))).toEqual(stored);
  });

  it('writes attribute values in inlineStyles as they arrived', () => {
    expect(receivedLink(inlineStyles(editor.getHTML()))).toEqual(stored);
  });
});

describe('rgb() colors in getHTML on linkedom', () => {
  // linkedom writes `<` and `>` in an attribute value as they are, so a start tag is read to its real end.
  const schema = new Schema({
    nodes: {
      doc: { content: 'paragraph+' },
      paragraph: { content: 'inline*', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
      text: { group: 'inline', inline: true },
    },
    marks: {
      styled: { attrs: { title: { default: null }, style: { default: null } }, toDOM: (mark) => ['span', { title: mark.attrs['title'], style: mark.attrs['style'] }, 0] },
    },
  });
  const text = 'a <b> style="color: rgb(255, 0, 0)" c';
  const editor = new Editor({
    schema,
    content: { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'x', marks: [{ type: 'styled', attrs: { title: 'a > b style="rgb(1, 2, 3)"', style: 'color: rgb(255, 0, 0)' } }] },
      { type: 'text', text },
    ] }] },
  });

  it('writes a style attribute color as hex and leaves text and other attributes as stored', () => {
    const received = parseHTML(`<!DOCTYPE html><html><body>${editor.getHTML()}</body></html>`).document;
    const span = received.querySelector('span');
    expect(span?.getAttribute('title')).toBe('a > b style="rgb(1, 2, 3)"');
    expect(span?.getAttribute('style')).toMatch(/^color: #ff0000;?$/);
    expect(received.querySelector('p')?.textContent).toBe(`x${text}`);
  });
});
