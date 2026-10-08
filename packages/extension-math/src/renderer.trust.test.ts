/**
 * The KaTeX adapter pins `trust: false` (K4), so a KaTeX default change, or a
 * document holding `\href` or `\includegraphics`, can never make rendered
 * math carry a link or load an image.
 */
import { describe, it, expect } from 'vitest';
import katex from 'katex';
import { createKatexRenderer } from './renderer.js';
import type { KatexLike } from './renderer.js';

describe('createKatexRenderer trust', () => {
  it('passes trust false to the engine for inline and display math', () => {
    const calls: Record<string, unknown>[] = [];
    const engine: KatexLike = { renderToString: (_expression, options) => { calls.push({ ...options }); return ''; } };
    const renderer = createKatexRenderer(engine, { throwOnError: true, output: 'html' });
    renderer.renderToString('x', { displayMode: false });
    renderer.renderToString('x', { displayMode: true });
    expect(calls.map(options => options['trust'])).toEqual([false, false]);
  });

  it('cannot be widened through the adapter options', () => {
    const calls: Record<string, unknown>[] = [];
    const engine: KatexLike = { renderToString: (_expression, options) => { calls.push({ ...options }); return ''; } };
    createKatexRenderer(engine, { trust: true } as never).renderToString('x', { displayMode: false });
    expect(calls[0]?.['trust']).toBe(false);
  });

  it.each([
    ['\\href{javascript:alert(1)}{click}'],
    ['\\url{javascript:alert(1)}'],
    ['\\href{https://example.com/}{click}'],
    ['\\includegraphics{https://probe.test/x.png}'],
    ['\\htmlClass{x}{y}'],
    ['\\htmlData{onclick=alert(1)}{y}'],
  ])('renders %s with the real KaTeX without a link, an image or an HTML extension', (latex) => {
    const html = createKatexRenderer(katex).renderToString(latex, { displayMode: false });
    const host = document.createElement('div');
    host.innerHTML = html;
    expect(host.querySelector('a, img, [href], [src], [onclick]')).toBeNull();
    // The source may appear as the MathML annotation's text, never in an attribute.
    const attributes = Array.from(host.querySelectorAll('*')).flatMap(element => Array.from(element.attributes, attribute => attribute.value));
    expect(attributes.filter(value => /javascript:|probe\.test/.test(value))).toEqual([]);
  });
});
