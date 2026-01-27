/**
 * Node configuration types
 *
 * These types define the configuration object passed to Node.create()
 * for creating ProseMirror node extensions.
 */

import type { Node as PMNode, DOMOutputSpec, NodeType } from 'prosemirror-model';
import type { NodeViewConstructor } from 'prosemirror-view';
import type { ExtensionConfigBase, ExtensionContext } from './ExtensionConfig.js';
import type { AttributeSpecs } from './AttributeSpec.js';

/**
 * Editor interface for Node context
 * Includes schema with nodes for NodeType getter
 */
export interface NodeEditorContext {
  readonly state: unknown;
  readonly view: unknown;
  readonly schema: {
    nodes: Record<string, NodeType>;
  };
  readonly commands: Record<string, (...args: unknown[]) => boolean>;
}

/**
 * Context interface for Node config methods.
 * Extends ExtensionContext with node-specific properties.
 * This enables proper typing of `this.options`, `this.nodeType`, etc.
 *
 * @typeParam Options - Node options type
 * @typeParam Storage - Node storage type
 */
export interface NodeContext<Options = unknown, Storage = unknown>
  extends Omit<ExtensionContext<Options, Storage>, 'editor' | 'type'> {
  /** Node type identifier */
  readonly type: 'node';
  /** Editor instance with schema access */
  editor: NodeEditorContext | null;
  /** ProseMirror NodeType (null until editor is initialized) */
  readonly nodeType: NodeType | null;
}

/**
 * Parse rule for converting HTML to ProseMirror node
 * Simplified version of ProseMirror's ParseRule
 */
export interface NodeParseRule {
  /**
   * CSS selector or tag name to match
   * @example 'p', 'h1', 'div.my-class'
   */
  tag?: string;

  /**
   * Match by CSS style
   * @example 'font-weight'
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
   * Context required for this rule to match
   * ProseMirror content expression
   */
  context?: string;

  /**
   * Get attributes from the matched element
   * Return null/undefined to skip this rule
   */
  getAttrs?:
    | ((node: HTMLElement) => Record<string, unknown> | null | undefined)
    | null;

  /**
   * Get content from the matched element
   * Return false to use default content parsing
   */
  getContent?: (node: HTMLElement, schema: unknown) => unknown;

  /**
   * How to preserve whitespace
   */
  preserveWhitespace?: boolean | 'full';
}

/**
 * Props passed to renderHTML function
 */
export interface NodeRenderHTMLProps {
  /**
   * The ProseMirror node being rendered
   */
  node: PMNode;

  /**
   * Merged HTML attributes from all sources
   */
  HTMLAttributes: Record<string, unknown>;
}

/**
 * Node-specific configuration properties (schema-related)
 */
interface NodeSchemaProperties {
  // === Schema Properties ===

  /**
   * Node group(s) this node belongs to
   * Used in content expressions
   *
   * @example 'block', 'inline', 'block list'
   */
  group?: string;

  /**
   * Content expression defining allowed children
   * Uses ProseMirror content expression syntax
   *
   * @example 'inline*', 'block+', 'paragraph block*'
   */
  content?: string;

  /**
   * Whether this is an inline node
   * @default false
   */
  inline?: boolean;

  /**
   * Whether this node is an atom (no direct content editing)
   * Cursor moves around atoms, not into them
   *
   * @example true for images, mentions, emoji
   */
  atom?: boolean;

  /**
   * Whether the node can be selected as a whole
   * @default true for leaf nodes, false for others
   */
  selectable?: boolean;

  /**
   * Whether the node can be dragged
   * @default false
   */
  draggable?: boolean;

  /**
   * Whether this node represents code
   * Affects text input handling (disables smart quotes, etc.)
   */
  code?: boolean;

  /**
   * How whitespace is handled in this node
   * - 'pre': preserve whitespace (like <pre>)
   * - 'normal': collapse whitespace (default)
   */
  whitespace?: 'pre' | 'normal';

  /**
   * Whether this node isolates marks at its boundaries
   * Marks don't extend across isolating boundaries
   */
  isolating?: boolean;

  /**
   * Whether this is a top-level node (document root)
   * Only one node should have this set to true
   */
  topNode?: boolean;

  /**
   * Whether this node defines its own scope
   * Content and marks don't leak out of defining nodes
   */
  defining?: boolean;

  /**
   * Which marks are allowed in this node
   * Empty string means no marks allowed
   *
   * @example '', '_', 'bold italic'
   */
  marks?: string;

  /**
   * Custom text for leaf nodes
   * Used by getText() and textContent
   *
   * @example '\n' for hard break
   */
  leafText?: string | ((node: PMNode) => string);

  // === Node-specific Methods ===

  /**
   * Define node attributes
   * Returns attribute specifications
   *
   * @example
   * addAttributes() {
   *   return {
   *     level: { default: 1 },
   *   };
   * }
   */
  addAttributes?: () => AttributeSpecs;

  /**
   * Parse rules for converting HTML to this node
   * Each rule defines how to match and parse HTML elements
   *
   * @example
   * parseHTML() {
   *   return [
   *     { tag: 'p' },
   *     { tag: 'div', priority: 10 },
   *   ];
   * }
   */
  parseHTML?: () => NodeParseRule[];

  /**
   * Render this node to DOM
   * Returns DOMOutputSpec (tag, attributes, children)
   *
   * @example
   * renderHTML({ node, HTMLAttributes }) {
   *   return ['p', HTMLAttributes, 0];
   * }
   */
  renderHTML?: (props: NodeRenderHTMLProps) => DOMOutputSpec;

  /**
   * Custom node view constructor
   * For complex interactive nodes
   */
  addNodeView?: () => NodeViewConstructor;
}

/**
 * Configuration for Node extensions
 * Combines ExtensionConfig base with node-specific schema properties.
 * Uses ThisType<NodeContext> to provide proper typing for `this` in config methods.
 *
 * @typeParam Options - Node options type
 * @typeParam Storage - Node storage type
 *
 * @example
 * const Paragraph = Node.create({
 *   name: 'paragraph',
 *   group: 'block',
 *   content: 'inline*',
 *   parseHTML() {
 *     // `this` is properly typed here!
 *     return [{ tag: 'p' }];
 *   },
 *   renderHTML({ HTMLAttributes }) {
 *     return ['p', HTMLAttributes, 0];
 *   },
 * });
 */
export type NodeConfig<Options = unknown, Storage = unknown> =
  ExtensionConfigBase<Options, Storage> &
  NodeSchemaProperties &
  ThisType<NodeContext<Options, Storage>>;
