/**
 * @domternal/extension-math
 *
 * LaTeX math for the Domternal editor: inline and block equation nodes rendered
 * through a pluggable renderer. KaTeX is the default engine (supplied via
 * `createKatexRenderer`), but any engine implementing `MathRenderer` works.
 *
 * Nodes and commands are added in subsequent commits.
 */

export { createKatexRenderer } from './renderer.js';
export type { MathRenderer, KatexLike, KatexRendererOptions } from './renderer.js';
