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
