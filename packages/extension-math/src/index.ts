/**
 * @domternal/extension-math
 *
 * LaTeX math for the Domternal editor: inline and block equation nodes rendered
 * through a pluggable renderer. KaTeX is the default engine (supplied via
 * `createKatexRenderer`), but any engine implementing `MathRenderer` works.
 */

export { MathInline } from './MathInline.js';
export type { MathInlineOptions } from './MathInline.js';
export { MathBlock } from './MathBlock.js';
export type { MathBlockOptions } from './MathBlock.js';
export type { MathOptions } from './shared.js';
export { MATH_INLINE_NAME, MATH_BLOCK_NAME } from './shared.js';

export { createKatexRenderer } from './renderer.js';
export type { MathRenderer, KatexLike, KatexRendererOptions } from './renderer.js';
