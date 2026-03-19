/**
 * Attribute specification for Node and Mark extensions
 *
 * Used by addAttributes() to define node/mark attributes
 * with parsing, rendering, and validation rules.
 *
 * @example
 * addAttributes() {
 *   return {
 *     level: {
 *       default: 1,
 *       parseHTML: (element) => parseInt(element.tagName.charAt(1), 10),
 *       renderHTML: (attributes) => ({ 'data-level': attributes.level }),
 *     },
 *   };
 * }
 */

/**
 * Specification for a single attribute
 */
export interface AttributeSpec {
  /**
   * Default value for the attribute
   * Used when the attribute is not explicitly set
   */
  default?: unknown;

  /**
   * Whether this attribute is rendered to the DOM
   * @default true
   */
  rendered?: boolean;

  /**
   * Keep this attribute when splitting the node
   * For example, heading level should be kept when pressing Enter
   * @default true
   */
  keepOnSplit?: boolean;

  /**
   * Validate attribute value (ProseMirror 1.22.0+).
   * When a string, a `|`-separated list of primitive types
   * (`"number"`, `"string"`, `"boolean"`, `"null"`, `"undefined"`).
   * When a function, it should throw if the value is invalid.
   *
   * @example
   * validate: 'number'
   * validate: 'string|null'
   * validate: (value) => { if (typeof value !== 'number') throw new Error('expected number'); }
   */
  validate?: string | ((value: unknown) => void);

  /**
   * Parse attribute value from HTML element
   * Called during HTML parsing to extract attribute value
   *
   * @param element - The HTML element being parsed
   * @returns The attribute value
   *
   * @example
   * parseHTML: (element) => element.getAttribute('data-level')
   */
  parseHTML?: (element: HTMLElement) => unknown;

  /**
   * Render attribute to HTML attributes object
   * Called during HTML serialization
   *
   * @param attributes - All attributes of the node/mark
   * @returns HTML attributes object or null to skip
   *
   * @example
   * renderHTML: (attributes) => ({ 'data-level': attributes.level })
   */
  renderHTML?: (
    attributes: Record<string, unknown>
  ) => Record<string, string | number | boolean | null | undefined> | null;
}

/**
 * Collection of attribute specifications
 * Keyed by attribute name
 */
export type AttributeSpecs = Record<string, AttributeSpec>;
