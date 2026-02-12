/**
 * Mark - Base class for mark extensions
 *
 * Marks define inline formatting that can be applied to text.
 * Examples: Bold, Italic, Link, Code, etc.
 *
 * Three-tier model:
 * - Extension (type: 'extension') → Pure functionality (History, Placeholder, etc.)
 * - Node (type: 'node') → Schema nodes (Paragraph, Heading, etc.)
 * - Mark (type: 'mark') → Schema marks (Bold, Italic, etc.)
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

import type { MarkSpec, MarkType, ParseRule } from 'prosemirror-model';
import { Extension, type ExtensionEditorInterface, mergeConfigWithParentBinding } from './Extension.js';
import type { MarkConfig, MarkContext } from './types/MarkConfig.js';
import { callOrReturn } from './helpers/callOrReturn.js';

/**
 * Extended editor interface for Mark
 * Includes schema access for MarkType getter
 */
export interface MarkEditorInterface extends ExtensionEditorInterface {
  readonly schema: {
    marks: Record<string, MarkType>;
  };
}

/**
 * Base class for mark extensions
 *
 * @typeParam Options - Mark options type
 * @typeParam Storage - Mark storage type
 */
export class Mark<Options = unknown, Storage = unknown> extends Extension<
  Options,
  Storage
> {
  /**
   * Mark type identifier
   * Distinguishes marks from extensions and nodes
   */
  override readonly type = 'mark' as const;

  /**
   * The original configuration object
   * Typed as MarkConfig for mark-specific properties
   */
  declare readonly config: MarkConfig<Options, Storage>;

  /**
   * Editor instance with schema access
   * null until set by ExtensionManager
   */
  override editor: MarkEditorInterface | null = null;

  /**
   * Protected constructor - use Mark.create() instead
   */
  protected constructor(config: MarkConfig<Options, Storage>) {
    super(config);
  }

  /**
   * Get the ProseMirror MarkType from schema
   *
   * This is a lazy getter because schema doesn't exist at mark creation time.
   * Schema is built FROM marks by ExtensionManager.
   *
   * Returns null if editor is not yet initialized.
   * Always check editor is set before using markType.
   */
  get markType(): MarkType | null {
    if (!this.editor) {
      return null;
    }
    return this.editor.schema.marks[this.name] ?? null;
  }

  /**
   * Get MarkType or throw if not initialized.
   * Use in contexts where editor is guaranteed to be set (like addCommands).
   */
  get markTypeOrThrow(): MarkType {
    const type = this.markType;
    if (!type) {
      throw new Error(
        `Mark "${this.name}" is not initialized. ` +
        `Make sure the editor is created before accessing markType.`
      );
    }
    return type;
  }

  /**
   * Creates a new mark instance
   *
   * @param config - Mark configuration
   * @returns New mark instance
   *
   * @example
   * const Bold = Mark.create({
   *   name: 'bold',
   *   parseHTML() {
   *     return [{ tag: 'strong' }, { tag: 'b' }];
   *   },
   * });
   */
  static override create<O = unknown, S = unknown>(
    config: MarkConfig<O, S>
  ): Mark<O, S> {
    return new Mark(config);
  }

  /**
   * Creates a new mark with merged options
   * Original mark is not modified
   *
   * **Note:** Options are merged shallowly using object spread (`...`).
   * Nested objects are replaced entirely, not deeply merged.
   *
   * @param options - Options to merge with existing options
   * @returns New mark instance with merged options
   *
   * @example
   * const CustomBold = Bold.configure({ HTMLAttributes: { class: 'custom-bold' } });
   *
   * @example
   * // Shallow merge behavior with nested objects:
   * // Given: options = { HTMLAttributes: { class: 'a', id: 'b' } }
   * // configure({ HTMLAttributes: { class: 'c' } })
   * // Result: { HTMLAttributes: { class: 'c' } } — 'id' is lost!
   * // To preserve nested values, spread manually:
   * // configure({ HTMLAttributes: { ...original.options.HTMLAttributes, class: 'c' } })
   */
  override configure(options: Partial<Options>): Mark<Options, Storage> {
    const newConfig: MarkConfig<Options, Storage> = {
      ...this.config,
      addOptions: () => ({
        ...this.options,
        ...options,
      }),
    };

    return new Mark(newConfig);
  }

  /**
   * Creates a new mark with extended configuration
   * Original mark is not modified
   *
   * **Note:** Config is merged shallowly using object spread (`...`).
   * Config properties (like `addAttributes`, `parseHTML`) are
   * replaced entirely, not combined with the base mark's config.
   *
   * @param extendedConfig - Configuration to extend/override
   * @returns New mark instance with extended config
   *
   * @example
   * const CustomBold = Bold.extend({
   *   name: 'customBold',
   *   addAttributes() {
   *     return { ...this.parent?.(), weight: { default: 'bold' } };
   *   },
   * });
   *
   * @example
   * // To preserve base mark's parse rules while adding new ones:
   * const Extended = BaseMark.extend({
   *   parseHTML() {
   *     const baseRules = BaseMark.config.parseHTML?.call(this) ?? [];
   *     return [...baseRules, { tag: 'custom-tag' }];
   *   },
   * });
   */
  override extend<ExtendedOptions = Options, ExtendedStorage = Storage>(
    extendedConfig: Partial<MarkConfig<ExtendedOptions, ExtendedStorage>> &
      ThisType<MarkContext<ExtendedOptions, ExtendedStorage>>
  ): Mark<ExtendedOptions, ExtendedStorage> {
    const newConfig = mergeConfigWithParentBinding(this.config, extendedConfig);

    return new Mark(newConfig as MarkConfig<ExtendedOptions, ExtendedStorage>);
  }

  /**
   * Creates a ProseMirror MarkSpec from this mark's configuration
   *
   * Called by ExtensionManager when building the schema.
   * Converts our config format to ProseMirror's MarkSpec format.
   *
   * @returns ProseMirror MarkSpec
   */
  createMarkSpec(): MarkSpec {
    const spec: MarkSpec = {};

    // Schema properties - copy directly if defined
    if (this.config.inclusive !== undefined)
      spec.inclusive = callOrReturn(this.config.inclusive, this);
    if (this.config.excludes !== undefined)
      spec.excludes = this.config.excludes;
    if (this.config.group !== undefined) spec.group = this.config.group;
    if (this.config.spanning !== undefined)
      spec.spanning = this.config.spanning;

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
      // Build parseDOM array with proper typing
      const parseDOMRules = parseRules.map((rule) => {
        // Build parse rule object
        const parseRule: {
          tag?: string;
          style?: string;
          priority?: number;
          consuming?: boolean;
          getAttrs?: (
            node: HTMLElement | string
          ) => Record<string, unknown> | false | null;
        } = {};

        if (rule.tag) parseRule.tag = rule.tag;
        if (rule.style) parseRule.style = rule.style;
        if (rule.priority !== undefined) parseRule.priority = rule.priority;
        if (rule.consuming !== undefined) parseRule.consuming = rule.consuming;

        // Handle getAttrs - need to merge with attribute parseHTML
        if (rule.getAttrs || attributeSpecs) {
          parseRule.getAttrs = (node: HTMLElement | string) => {
            // Get attrs from rule
            const ruleAttrs = rule.getAttrs ? rule.getAttrs(node) : {};

            // If rule returned null or false, skip this rule
            if (ruleAttrs === null || ruleAttrs === false) {
              return ruleAttrs;
            }

            // Get attrs from attribute parseHTML functions
            const parsedAttrs: Record<string, unknown> = { ...ruleAttrs };

            // Only run attribute parseHTML for element-based rules
            // For style-based rules (where node is a string), the rule.getAttrs
            // already handles extracting values from the style string
            if (attributeSpecs && typeof node !== 'string') {
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

      // Cast required: Our MarkParseRule type is structurally compatible with
      // ProseMirror's ParseRule but TypeScript can't infer this due to
      // our custom getAttrs return type. The cast is safe.
      spec.parseDOM = parseDOMRules as unknown as readonly ParseRule[];
    }

    // Render - convert renderHTML to toDOM
    if (this.config.renderHTML) {
      const renderFn = this.config.renderHTML;
      const attrSpecs = attributeSpecs;

      spec.toDOM = (mark, _inline) => {
        // Build HTML attributes from mark attrs and renderHTML functions
        let htmlAttrs: Record<string, unknown> = {};

        if (attrSpecs) {
          for (const [name, attrSpec] of Object.entries(attrSpecs)) {
            // Skip if not rendered
            if (attrSpec.rendered === false) continue;

            // Use renderHTML if defined, otherwise add directly
            if (attrSpec.renderHTML) {
              const rendered = attrSpec.renderHTML(mark.attrs);
              if (rendered) {
                htmlAttrs = { ...htmlAttrs, ...rendered };
              }
            } else if (
              mark.attrs[name] !== undefined &&
              mark.attrs[name] !== null
            ) {
              // Default: use attribute value directly
              htmlAttrs[name] = mark.attrs[name];
            }
          }
        }

        return renderFn.call(this, { mark, HTMLAttributes: htmlAttrs });
      };
    }

    return spec;
  }
}
