/**
 * Mark extensions for @domternal/core
 *
 * Marks define inline formatting that can be applied to text.
 */

export { Bold, type BoldOptions } from './Bold.js';
export { Italic, type ItalicOptions } from './Italic.js';
export { Underline, type UnderlineOptions } from './Underline.js';
export { Strike, type StrikeOptions } from './Strike.js';
export { Code, type CodeOptions } from './Code.js';
export { Link, type LinkOptions, type LinkAttributes } from './Link.js';
export { Subscript, type SubscriptOptions } from './Subscript.js';
export { Superscript, type SuperscriptOptions } from './Superscript.js';
export { TextStyle, type TextStyleOptions } from './TextStyle.js';

// Link helpers - exported for advanced usage
export {
  linkClickPlugin,
  linkClickPluginKey,
  type LinkClickPluginOptions,
  linkPastePlugin,
  linkPastePluginKey,
  type LinkPastePluginOptions,
  autolinkPlugin,
  autolinkPluginKey,
  type AutolinkPluginOptions,
  linkExitPlugin,
  linkExitPluginKey,
  type LinkExitPluginOptions,
} from './helpers/index.js';
