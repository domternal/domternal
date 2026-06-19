/**
 * Pluggable math renderer abstraction.
 *
 * The math nodes do not bundle a rendering engine. Instead the integrator passes
 * a `MathRenderer` instance (peer-dependency style, mirroring how
 * `@domternal/extension-code-block-lowlight` accepts a `lowlight` instance). The
 * default adapter wraps KaTeX, but any engine that turns a LaTeX string into an
 * HTML string can be supplied.
 */

/** Renders a LaTeX string to an HTML string. Implemented by the chosen engine. */
export interface MathRenderer {
  /**
   * @param latex Raw LaTeX source (without `$`/`$$` delimiters).
   * @param options.displayMode `true` for block (display) math, `false` for inline.
   * @returns An HTML string. Engines should not throw on invalid input; they
   *   should return markup describing the error instead.
   */
  renderToString(latex: string, options: { displayMode: boolean }): string;
}

/**
 * Minimal structural type for the parts of the KaTeX module this adapter uses.
 * Declared locally so the package does not hard-depend on KaTeX's types at build
 * time (KaTeX stays a peer dependency).
 */
export interface KatexLike {
  renderToString(
    expression: string,
    options?: {
      displayMode?: boolean;
      throwOnError?: boolean;
      output?: 'html' | 'mathml' | 'htmlAndMathml';
      [key: string]: unknown;
    },
  ): string;
}

/** Options for {@link createKatexRenderer}. */
export interface KatexRendererOptions {
  /**
   * Throw on invalid LaTeX instead of rendering an error node.
   * @default false
   */
  throwOnError?: boolean;
  /**
   * KaTeX output format. `'htmlAndMathml'` emits a hidden MathML annotation
   * alongside the visual HTML for accessibility.
   * @default 'htmlAndMathml'
   */
  output?: 'html' | 'mathml' | 'htmlAndMathml';
}

/**
 * Wraps a KaTeX module/instance as a {@link MathRenderer}.
 *
 * @example
 * ```ts
 * import katex from 'katex';
 * import { MathInline, createKatexRenderer } from '@domternal/extension-math';
 *
 * const renderer = createKatexRenderer(katex);
 * const editor = new Editor({
 *   extensions: [MathInline.configure({ renderer })],
 * });
 * ```
 */
export function createKatexRenderer(
  katex: KatexLike,
  options?: KatexRendererOptions,
): MathRenderer {
  const throwOnError = options?.throwOnError ?? false;
  const output = options?.output ?? 'htmlAndMathml';

  return {
    renderToString(latex, { displayMode }) {
      return katex.renderToString(latex, {
        displayMode,
        throwOnError,
        output,
      });
    },
  };
}
