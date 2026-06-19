import { describe, it, expect } from 'vitest';
import { createKatexRenderer } from './renderer.js';
import type { KatexLike } from './renderer.js';

/** Records every renderToString call so we can assert the options passed through. */
function stubKatex(): { katex: KatexLike; calls: { expr: string; options: Record<string, unknown> | undefined }[] } {
  const calls: { expr: string; options: Record<string, unknown> | undefined }[] = [];
  const katex: KatexLike = {
    renderToString(expr, options) {
      calls.push({ expr, options });
      return `<span class="katex">${expr}</span>`;
    },
  };
  return { katex, calls };
}

describe('createKatexRenderer', () => {
  it('returns the engine HTML string', () => {
    const { katex } = stubKatex();
    const renderer = createKatexRenderer(katex);
    expect(renderer.renderToString('a^2', { displayMode: false })).toBe(
      '<span class="katex">a^2</span>',
    );
  });

  it('passes displayMode false for inline', () => {
    const { katex, calls } = stubKatex();
    createKatexRenderer(katex).renderToString('x', { displayMode: false });
    expect(calls[0]?.options?.['displayMode']).toBe(false);
  });

  it('passes displayMode true for block', () => {
    const { katex, calls } = stubKatex();
    createKatexRenderer(katex).renderToString('x', { displayMode: true });
    expect(calls[0]?.options?.['displayMode']).toBe(true);
  });

  it('defaults to throwOnError false and htmlAndMathml output', () => {
    const { katex, calls } = stubKatex();
    createKatexRenderer(katex).renderToString('x', { displayMode: false });
    expect(calls[0]?.options?.['throwOnError']).toBe(false);
    expect(calls[0]?.options?.['output']).toBe('htmlAndMathml');
  });

  it('honors throwOnError and output overrides', () => {
    const { katex, calls } = stubKatex();
    createKatexRenderer(katex, { throwOnError: true, output: 'mathml' }).renderToString('x', {
      displayMode: false,
    });
    expect(calls[0]?.options?.['throwOnError']).toBe(true);
    expect(calls[0]?.options?.['output']).toBe('mathml');
  });
});
