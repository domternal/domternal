/**
 * Node - Base class for node extensions
 *
 * Nodes define document structure elements that contribute to the schema.
 * Examples: Paragraph, Heading, List, Image, etc.
 *
 * Three-tier model:
 * - Extension (type: 'extension') → Pure functionality (History, Placeholder, etc.)
 * - Node (type: 'node') → Schema nodes (Paragraph, Heading, etc.)
 * - Mark (type: 'mark') → Schema marks (Bold, Italic, etc.)
 *
 * @example
 * const Paragraph = Node.create({
 *   name: 'paragraph',
 *   group: 'block',
 *   content: 'inline*',
 *   parseHTML() {
 *     return [{ tag: 'p' }];
 *   },
 *   renderHTML({ HTMLAttributes }) {
 *     return ['p', HTMLAttributes, 0];
 *   },
 * });
 */

import type { NodeSpec, NodeType } from 'prosemirror-model';
import { Extension, type ExtensionEditorInterface } from './Extension.js';
import type { NodeConfig } from './types/NodeConfig.js';
import { callOrReturn } from './helpers/callOrReturn.js';

/**
 * Extended editor interface for Node
 * Includes schema access for NodeType getter
 */
export interface NodeEditorInterface extends ExtensionEditorInterface {
  readonly schema: {
    nodes: Record<string, NodeType>;
  };
}

/**
 * Base class for node extensions
 *
 * @typeParam Options - Node options type
 * @typeParam Storage - Node storage type
 */
export class Node<Options = unknown, Storage = unknown> extends Extension<
  Options,
  Storage
> {
  /**
   * Node type identifier
   * Distinguishes nodes from extensions and marks
   */
  declare readonly type: 'node';

  /**
   * The original configuration object
   * Typed as NodeConfig for node-specific properties
   */
  declare readonly config: NodeConfig<Options, Storage>;

  /**
   * Editor instance with schema access
   */
  declare editor: NodeEditorInterface;

  /**
   * Protected constructor - use Node.create() instead
   */
  protected constructor(config: NodeConfig<Options, Storage>) {
    super(config);
    // Override type after super() call
    (this as { type: 'node' }).type = 'node';
  }

  /**
   * Get the ProseMirror NodeType from schema
   *
   * This is a lazy getter because schema doesn't exist at node creation time.
   * Schema is built FROM nodes by ExtensionManager.
   *
   * @throws Error if accessed before editor is set
   */
  get nodeType(): NodeType {
    if (!this.editor) {
      throw new Error(
        `Cannot access nodeType for "${this.name}" - editor not initialized. ` +
          `nodeType is available after ExtensionManager binds the editor.`
      );
    }
    return this.editor.schema.nodes[this.name];
  }

  /**
   * Creates a new node instance
   *
   * @param config - Node configuration
   * @returns New node instance
   *
   * @example
   * const Paragraph = Node.create({
   *   name: 'paragraph',
   *   group: 'block',
   *   content: 'inline*',
   * });
   */
  static create<O = unknown, S = unknown>(
    config: NodeConfig<O, S>
  ): Node<O, S> {
    return new Node(config);
  }

  /**
   * Creates a new node with merged options
   * Original node is not modified
   *
   * @param options - Options to merge with existing options
   * @returns New node instance with merged options
   *
   * @example
   * const CustomParagraph = Paragraph.configure({ HTMLAttributes: { class: 'custom' } });
   */
  configure(options: Partial<Options>): Node<Options, Storage> {
    const newConfig: NodeConfig<Options, Storage> = {
      ...this.config,
      addOptions: () => ({
        ...this.options,
        ...options,
      }),
    };

    return new Node(newConfig);
  }

  /**
   * Creates a new node with extended configuration
   * Original node is not modified
   *
   * @param extendedConfig - Configuration to extend/override
   * @returns New node instance with extended config
   *
   * @example
   * const CustomParagraph = Paragraph.extend({
   *   name: 'customParagraph',
   *   addAttributes() {
   *     return { ...this.parent?.(), align: { default: 'left' } };
   *   },
   * });
   */
  extend<ExtendedOptions = Options, ExtendedStorage = Storage>(
    extendedConfig: Partial<NodeConfig<ExtendedOptions, ExtendedStorage>>
  ): Node<ExtendedOptions, ExtendedStorage> {
    const newConfig = {
      ...this.config,
      ...extendedConfig,
    } as NodeConfig<ExtendedOptions, ExtendedStorage>;

    return new Node(newConfig);
  }

  /**
   * Creates a ProseMirror NodeSpec from this node's configuration
   *
   * Called by ExtensionManager when building the schema.
   * Converts our config format to ProseMirror's NodeSpec format.
   *
   * @returns ProseMirror NodeSpec
   */
  createNodeSpec(): NodeSpec {
    const spec: NodeSpec = {};

    // Schema properties - copy directly if defined
    if (this.config.group !== undefined) spec.group = this.config.group;
    if (this.config.content !== undefined) spec.content = this.config.content;
    if (this.config.inline !== undefined) spec.inline = this.config.inline;
    if (this.config.atom !== undefined) spec.atom = this.config.atom;
    if (this.config.selectable !== undefined)
      spec.selectable = this.config.selectable;
    if (this.config.draggable !== undefined)
      spec.draggable = this.config.draggable;
    if (this.config.code !== undefined) spec.code = this.config.code;
    if (this.config.whitespace !== undefined)
      spec.whitespace = this.config.whitespace;
    if (this.config.isolating !== undefined)
      spec.isolating = this.config.isolating;
    if (this.config.defining !== undefined)
      spec.defining = this.config.defining;
    if (this.config.marks !== undefined) spec.marks = this.config.marks;

    // Top node (only for document)
    if (this.config.topNode) {
      // ProseMirror doesn't have a topNode property on NodeSpec
      // This is handled by Schema constructor's topNode option
      // We'll handle this in ExtensionManager
    }

    // Leaf text
    if (this.config.leafText !== undefined) {
      spec.leafText =
        typeof this.config.leafText === 'function'
          ? this.config.leafText
          : () => this.config.leafText as string;
    }

    // Attributes - convert AttributeSpecs to ProseMirror attrs
    const attributeSpecs = callOrReturn(this.config.addAttributes, this);
    if (attributeSpecs) {
      spec.attrs = {};
      for (const [name, attrSpec] of Object.entries(attributeSpecs)) {
        spec.attrs[name] = {
          default: attrSpec.default,
        };
        // Add validate if defined (ProseMirror 1.22.0+)
        if (attrSpec.validate) {
          (spec.attrs[name] as { validate?: unknown }).validate =
            attrSpec.validate;
        }
      }
    }

    // Parse rules - convert to parseDOM
    const parseRules = callOrReturn(this.config.parseHTML, this);
    if (parseRules && parseRules.length > 0) {
      spec.parseDOM = parseRules.map((rule) => {
        const parseRule: {
          tag?: string;
          style?: string;
          priority?: number;
          consuming?: boolean;
          context?: string;
          preserveWhitespace?: boolean | 'full';
          getAttrs?: (node: HTMLElement | string) => Record<string, unknown> | false | null;
        } = {};

        if (rule.tag) parseRule.tag = rule.tag;
        if (rule.style) parseRule.style = rule.style;
        if (rule.priority !== undefined) parseRule.priority = rule.priority;
        if (rule.consuming !== undefined) parseRule.consuming = rule.consuming;
        if (rule.context) parseRule.context = rule.context;
        if (rule.preserveWhitespace !== undefined)
          parseRule.preserveWhitespace = rule.preserveWhitespace;

        // Handle getAttrs - need to merge with attribute parseHTML
        if (rule.getAttrs || attributeSpecs) {
          parseRule.getAttrs = (node: HTMLElement | string) => {
            // If node is string (for style rules), skip attribute parsing
            if (typeof node === 'string') {
              return rule.getAttrs ? rule.getAttrs(node as unknown as HTMLElement) ?? {} : {};
            }

            // Get attrs from rule
            const ruleAttrs = rule.getAttrs ? rule.getAttrs(node) : {};

            // If rule returned null, skip this rule
            if (ruleAttrs === null || ruleAttrs === undefined) {
              return false;
            }

            // Get attrs from attribute parseHTML functions
            const parsedAttrs: Record<string, unknown> = { ...ruleAttrs };
            if (attributeSpecs) {
              for (const [name, attrSpec] of Object.entries(attributeSpecs)) {
                if (attrSpec.parseHTML) {
                  parsedAttrs[name] = attrSpec.parseHTML(node);
                }
              }
            }

            return parsedAttrs;
          };
        }

        return parseRule;
      });
    }

    // Render - convert renderHTML to toDOM
    if (this.config.renderHTML) {
      const renderFn = this.config.renderHTML;
      const attrSpecs = attributeSpecs;

      spec.toDOM = (node) => {
        // Build HTML attributes from node attrs and renderHTML functions
        let htmlAttrs: Record<string, unknown> = {};

        if (attrSpecs) {
          for (const [name, attrSpec] of Object.entries(attrSpecs)) {
            // Skip if not rendered
            if (attrSpec.rendered === false) continue;

            // Use renderHTML if defined, otherwise add directly
            if (attrSpec.renderHTML) {
              const rendered = attrSpec.renderHTML(node.attrs);
              if (rendered) {
                htmlAttrs = { ...htmlAttrs, ...rendered };
              }
            } else if (node.attrs[name] !== undefined && node.attrs[name] !== null) {
              // Default: use attribute value directly
              htmlAttrs[name] = node.attrs[name];
            }
          }
        }

        return renderFn({ node, HTMLAttributes: htmlAttrs });
      };
    }

    return spec;
  }
}
