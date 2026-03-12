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

import type { NodeSpec, NodeType, TagParseRule } from '@domternal/pm/model';
import { Extension, type ExtensionEditorInterface, mergeConfigWithParentBinding } from './Extension.js';
import type { NodeConfig, NodeContext } from './types/NodeConfig.js';
import { callOrReturn } from './helpers/callOrReturn.js';
import { buildProseMirrorAttrs, buildHTMLAttributes } from './helpers/specBuilder.js';

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
  override readonly type = 'node' as const;

  /**
   * The original configuration object
   * Typed as NodeConfig for node-specific properties
   */
  declare readonly config: NodeConfig<Options, Storage>;

  /**
   * Editor instance with schema access
   * null until set by ExtensionManager
   */
  override editor: NodeEditorInterface | null = null;

  /**
   * Protected constructor - use Node.create() instead
   */
  protected constructor(config: NodeConfig<Options, Storage>) {
    super(config);
  }

  /**
   * Get the ProseMirror NodeType from schema
   *
   * This is a lazy getter because schema doesn't exist at node creation time.
   * Schema is built FROM nodes by ExtensionManager.
   *
   * Returns null if editor is not yet initialized.
   * Always check editor is set before using nodeType.
   */
  get nodeType(): NodeType | null {
    if (!this.editor) {
      return null;
    }
    return this.editor.schema.nodes[this.name] ?? null;
  }

  /**
   * Get NodeType or throw if not initialized.
   * Use in contexts where editor is guaranteed to be set (like addCommands).
   */
  get nodeTypeOrThrow(): NodeType {
    const type = this.nodeType;
    if (!type) {
      throw new Error(
        `Node "${this.name}" is not initialized. ` +
        `Make sure the editor is created before accessing nodeType.`
      );
    }
    return type;
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
  static override create<O = unknown, S = unknown>(
    config: NodeConfig<O, S>
  ): Node<O, S> {
    return new Node(config);
  }

  /**
   * Creates a new node with merged options
   * Original node is not modified
   *
   * **Note:** Options are merged shallowly using object spread (`...`).
   * Nested objects are replaced entirely, not deeply merged.
   *
   * @param options - Options to merge with existing options
   * @returns New node instance with merged options
   *
   * @example
   * const CustomParagraph = Paragraph.configure({ HTMLAttributes: { class: 'custom' } });
   *
   * @example
   * // Shallow merge behavior with nested objects:
   * // Given: options = { HTMLAttributes: { class: 'a', id: 'b' } }
   * // configure({ HTMLAttributes: { class: 'c' } })
   * // Result: { HTMLAttributes: { class: 'c' } } — 'id' is lost!
   * // To preserve nested values, spread manually:
   * // configure({ HTMLAttributes: { ...original.options.HTMLAttributes, class: 'c' } })
   */
  override configure(options: Partial<Options>): Node<Options, Storage> {
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
   * **Note:** Config is merged shallowly using object spread (`...`).
   * Config properties (like `addAttributes`, `parseHTML`) are
   * replaced entirely, not combined with the base node's config.
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
   *
   * @example
   * // To preserve base node's parse rules while adding new ones:
   * const Extended = BaseNode.extend({
   *   parseHTML() {
   *     const baseRules = BaseNode.config.parseHTML?.call(this) ?? [];
   *     return [...baseRules, { tag: 'custom-tag' }];
   *   },
   * });
   */
  override extend<ExtendedOptions = Options, ExtendedStorage = Storage>(
    extendedConfig: Partial<NodeConfig<ExtendedOptions, ExtendedStorage>> &
      ThisType<NodeContext<ExtendedOptions, ExtendedStorage>>
  ): Node<ExtendedOptions, ExtendedStorage> {
    const newConfig = mergeConfigWithParentBinding(this.config, extendedConfig);

    return new Node(newConfig as NodeConfig<ExtendedOptions, ExtendedStorage>);
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

    // Schema properties - use callOrReturn for group/inline to support dynamic values
    if (this.config.group !== undefined) spec.group = callOrReturn(this.config.group, this);
    if (this.config.content !== undefined) spec.content = this.config.content;
    if (this.config.inline !== undefined) spec.inline = callOrReturn(this.config.inline, this);
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
    if (this.config.allowGapCursor !== undefined)
      (spec as Record<string, unknown>)['allowGapCursor'] =
        this.config.allowGapCursor;
    if (this.config.tableRole !== undefined)
      (spec as Record<string, unknown>)['tableRole'] =
        this.config.tableRole;

    // Top node (only for document)
    if (this.config.topNode) {
      // ProseMirror doesn't have a topNode property on NodeSpec
      // This is handled by Schema constructor's topNode option
      // We'll handle this in ExtensionManager
    }

    // Leaf text - bind to extension instance so this.storage etc. are available
    if (this.config.leafText !== undefined) {
      if (typeof this.config.leafText === 'function') {
        const leafTextFn = this.config.leafText;
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const instance = this;
        spec.leafText = (node) => leafTextFn.call(instance, node);
      } else {
        spec.leafText = () => this.config.leafText as string;
      }
    }

    // Attributes - convert AttributeSpecs to ProseMirror attrs
    const attributeSpecs = callOrReturn(this.config.addAttributes, this);
    if (attributeSpecs) {
      spec.attrs = buildProseMirrorAttrs(attributeSpecs);
    }

    // Parse rules - convert to parseDOM
    const parseRules = callOrReturn(this.config.parseHTML, this);
    if (parseRules && parseRules.length > 0) {
      // Build parseDOM array with proper typing
      // ProseMirror's TagParseRule type is strict, so we cast through unknown
      const parseDOMRules = parseRules.map((rule) => {
        // Build parse rule object using object literal to avoid index signature issues
        const parseRule: {
          tag?: string;
          style?: string;
          priority?: number;
          consuming?: boolean;
          context?: string;
          preserveWhitespace?: boolean | 'full';
          getAttrs?: (
            node: HTMLElement | string
          ) => Record<string, unknown> | false | null;
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
              return rule.getAttrs
                ? rule.getAttrs(node as unknown as HTMLElement) ?? {}
                : {};
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

      // Cast required: Our NodeParseRule type is structurally compatible with
      // ProseMirror's TagParseRule but TypeScript can't infer this due to
      // our custom getAttrs return type. The cast is safe.
      spec.parseDOM = parseDOMRules as unknown as readonly TagParseRule[];
    }

    // Render - convert renderHTML to toDOM
    if (this.config.renderHTML) {
      const renderFn = this.config.renderHTML;
      const attrSpecs = attributeSpecs;
      // Capture 'this' (the Node instance) for use in toDOM
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const nodeInstance = this;

      spec.toDOM = (node) => {
        const htmlAttrs = attrSpecs
          ? buildHTMLAttributes(node.attrs, attrSpecs)
          : {};

        // Call renderFn with Node instance as 'this' context
        return renderFn.call(nodeInstance, { node, HTMLAttributes: htmlAttrs });
      };
    }

    return spec;
  }
}
