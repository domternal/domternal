/**
 * Shared definitions for the math nodes.
 */
import type { MathRenderer } from './renderer.js';

/** ProseMirror node name for inline math. */
export const MATH_INLINE_NAME = 'mathInline';
/** ProseMirror node name for block (display) math. */
export const MATH_BLOCK_NAME = 'mathBlock';

/** Options shared by both math nodes. */
export interface MathOptions {
  /**
   * Renderer that turns LaTeX into HTML inside the node view. Supply
   * `createKatexRenderer(katex)` (or any `MathRenderer`). When `null`, the node
   * view renders a hint and editing still works, but no math is displayed.
   */
  renderer: MathRenderer | null;
  /** Extra HTML attributes merged onto the rendered element. */
  HTMLAttributes: Record<string, unknown>;
}
