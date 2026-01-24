/**
 * Mark configuration types
 *
 * These types define the configuration object passed to Mark.create()
 * for creating ProseMirror mark extensions.
 */

import type { Mark as PMMark, DOMOutputSpec } from 'prosemirror-model';
import type { ExtensionConfig } from './ExtensionConfig.js';
import type { AttributeSpecs } from './AttributeSpec.js';

/**
 * Parse rule for converting HTML to ProseMirror mark
 * Simplified version of ProseMirror's ParseRule for marks
 */
export interface MarkParseRule {
  /**
   * CSS selector or tag name to match
   * @example 'strong', 'b', 'span.bold'
   */
  tag?: string;

  /**
   * Match by CSS style property
   * Can include expected value after '='
   * @example 'font-weight', 'font-weight=bold'
   */
  style?: string;

  /**
   * Priority for this rule (higher = checked first)
   * @default 50
   */
  priority?: number;

  /**
   * Whether to consume the matched element
   * @default true
   */
  consuming?: boolean;

  /**
   * Get attributes from the matched element
   * Return null/undefined to skip this rule
   * Return false to explicitly not match
   *
   * For style rules, receives the style value as string
   */
  getAttrs?:
    | ((node: HTMLElement | string) => Record<string, unknown> | false | null)
    | null;
}

/**
 * Props passed to renderHTML function for marks
 */
export interface MarkRenderHTMLProps {
  /**
   * The ProseMirror mark being rendered
   */
  mark: PMMark;

  /**
   * Merged HTML attributes from all sources
   */
  HTMLAttributes: Record<string, unknown>;
}

/**
 * Configuration for Mark extensions
 * Extends ExtensionConfig with mark-specific schema properties
 *
 * @typeParam Options - Mark options type
 * @typeParam Storage - Mark storage type
 *
 * @example
 * const Bold = Mark.create({
 *   name: 'bold',
 *   parseHTML() {
 *     return [
 *       { tag: 'strong' },
 *       { tag: 'b' },
 *       { style: 'font-weight=bold' },
 *     ];
 *   },
 *   renderHTML({ HTMLAttributes }) {
 *     return ['strong', HTMLAttributes, 0];
 *   },
 * });
 */
export interface MarkConfig<Options = unknown, Storage = unknown>
  extends ExtensionConfig<Options, Storage> {
  // === Schema Properties ===

  /**
   * Whether this mark should be active when the cursor
   * is at its end (or beginning for marks that open).
   *
   * When true, typing at the mark's boundary continues the mark.
   * When false, typing creates unmarked content.
   *
   * @default true
   */
  inclusive?: boolean;

  /**
   * Marks that this mark excludes (cannot coexist with)
   *
   * - '_' excludes all marks
   * - Space-separated mark names exclude specific marks
   * - Empty string or undefined means no exclusions
   *
   * @example 'code' - excludes code mark
   * @example 'bold italic' - excludes bold and italic
   * @example '_' - excludes all other marks
   */
  excludes?: string;

  /**
   * Mark group(s) this mark belongs to
   * Used in node's marks property
   *
   * @example 'formatting', 'inline'
   */
  group?: string;

  /**
   * Whether this mark can span multiple nodes
   *
   * When true (default), the mark persists across inline nodes.
   * When false, the mark only applies within a single text node.
   *
   * @default true
   */
  spanning?: boolean;

  // === Mark-specific Methods ===

  /**
   * Define mark attributes
   * Returns attribute specifications
   *
   * @example
   * addAttributes() {
   *   return {
   *     color: { default: null },
   *   };
   * }
   */
  addAttributes?: () => AttributeSpecs;

  /**
   * Parse rules for converting HTML to this mark
   * Each rule defines how to match and parse HTML elements
   *
   * @example
   * parseHTML() {
   *   return [
   *     { tag: 'strong' },
   *     { tag: 'b' },
   *     { style: 'font-weight', getAttrs: (value) => /bold|[5-9]\d{2}/.test(value) && null },
   *   ];
   * }
   */
  parseHTML?: () => MarkParseRule[];

  /**
   * Render this mark to DOM
   * Returns DOMOutputSpec (tag, attributes, hole)
   *
   * The 0 in the return array indicates where child content goes.
   *
   * @example
   * renderHTML({ mark, HTMLAttributes }) {
   *   return ['strong', HTMLAttributes, 0];
   * }
   */
  renderHTML?: (props: MarkRenderHTMLProps) => DOMOutputSpec;
}
