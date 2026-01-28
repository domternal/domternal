/**
 * Link Mark
 *
 * Applies hyperlink formatting to text. Supports href and target attributes.
 *
 * @example
 * ```ts
 * import { Link } from '@domternal/core';
 *
 * const editor = new Editor({
 *   extensions: [Document, Paragraph, Text, Link],
 * });
 *
 * // Set a link
 * editor.commands.setLink({ href: 'https://example.com' });
 *
 * // Remove a link
 * editor.commands.unsetLink();
 * ```
 */
import { Mark } from '../Mark.js';
import { isValidUrl } from '../helpers/isValidUrl.js';
import { linkClickPlugin } from './helpers/linkClickPlugin.js';
import { linkPastePlugin } from './helpers/linkPastePlugin.js';
import { autolinkPlugin } from './helpers/autolinkPlugin.js';

/**
 * Options for the Link mark
 */
export interface LinkOptions {
  /**
   * HTML attributes to add to the rendered element
   */
  HTMLAttributes: Record<string, unknown>;
  /**
   * List of allowed URL protocols
   * @default ['http:', 'https:', 'mailto:', 'tel:']
   */
  protocols: string[];
  /**
   * When to open links on click
   * - true: Open on Mod+click (when editable) or click (when not editable)
   * - false: Never open
   * - 'whenNotEditable': Only open when editor is read-only
   * @default true
   */
  openOnClick: boolean | 'whenNotEditable';
  /**
   * Whether to add rel="noopener noreferrer" to links
   * @default true
   */
  addRelNoopener: boolean;
  /**
   * Auto-convert typed URLs to links
   * @default true
   */
  autolink: boolean;
  /**
   * Convert pasted URLs to links (wraps selection or inserts as link)
   * @default true
   */
  linkOnPaste: boolean;
  /**
   * Default protocol for bare URLs (e.g., 'example.com' → 'https://example.com')
   * @default 'https'
   */
  defaultProtocol: string;
  /**
   * Custom validation for autolink
   * Return false to prevent auto-linking specific URLs
   */
  shouldAutoLink?: (url: string) => boolean;
}

/**
 * Attributes for the Link mark
 */
export interface LinkAttributes {
  href: string;
  target?: string | null;
  rel?: string | null;
}

/**
 * Link mark for hyperlinks
 */
export const Link = Mark.create<LinkOptions>({
  name: 'link',

  // Links have lower priority than other marks
  priority: 1000,

  // Links can contain other marks
  inclusive: false,

  addOptions(): LinkOptions {
    return {
      HTMLAttributes: {},
      protocols: ['http:', 'https:', 'mailto:', 'tel:'],
      openOnClick: true,
      addRelNoopener: true,
      autolink: true,
      linkOnPaste: true,
      defaultProtocol: 'https',
    };
  },

  addAttributes() {
    return {
      href: {
        default: null,
      },
      target: {
        default: null,
      },
      rel: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'a[href]',
        getAttrs: (node) => {
          if (typeof node === 'string') return false;
          const href = node.getAttribute('href');

          // Validate URL
          if (!href || !isValidUrl(href, { protocols: this.options.protocols })) {
            return false;
          }

          return {
            href,
            target: node.getAttribute('target'),
            rel: node.getAttribute('rel'),
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = { ...this.options.HTMLAttributes, ...HTMLAttributes };

    // Validate href before rendering
    if (
      typeof attrs['href'] === 'string' &&
      !isValidUrl(attrs['href'], { protocols: this.options.protocols })
    ) {
      // Remove the href if invalid, keeping other attributes
      const { href: _, ...rest } = attrs;
      return ['a', rest, 0];
    }

    // Add rel="noopener noreferrer" for external links
    if (
      this.options.addRelNoopener &&
      attrs['target'] === '_blank' &&
      !attrs['rel']
    ) {
      attrs['rel'] = 'noopener noreferrer';
    }

    return ['a', attrs, 0];
  },

  addCommands() {
    return {
      setLink:
        (attributes: LinkAttributes) =>
        ({ commands }) => {
          // Validate URL before setting
          if (!isValidUrl(attributes.href, { protocols: this.options.protocols })) {
            return false;
          }

          const cmd = commands as Record<string, (name: string, attrs?: unknown) => boolean>;
          return cmd['setMark']?.('link', attributes) ?? false;
        },
      unsetLink:
        () =>
        ({ commands }) => {
          const cmd = commands as Record<string, (name: string) => boolean>;
          return cmd['unsetMark']?.('link') ?? false;
        },
      toggleLink:
        (attributes: LinkAttributes) =>
        ({ commands }) => {
          // Validate URL before toggling
          if (!isValidUrl(attributes.href, { protocols: this.options.protocols })) {
            return false;
          }

          const cmd = commands as Record<string, (name: string, attrs?: unknown) => boolean>;
          return cmd['toggleMark']?.('link', attributes) ?? false;
        },
    };
  },

  // No keyboard shortcuts for links (requires dialog for URL input)
  // No input rules for links (too complex, requires URL validation)

  addProseMirrorPlugins() {
    const markType = this.markType;
    if (!markType) return [];

    const plugins = [];

    // Click plugin - always enabled unless openOnClick is false
    if (this.options.openOnClick !== false) {
      plugins.push(
        linkClickPlugin({
          type: markType,
          openOnClick: this.options.openOnClick,
        })
      );
    }

    // Paste plugin - wraps selection or inserts URL as link
    if (this.options.linkOnPaste) {
      plugins.push(
        linkPastePlugin({
          type: markType,
          protocols: this.options.protocols,
        })
      );
    }

    // Autolink plugin - converts typed URLs to links
    if (this.options.autolink) {
      plugins.push(
        autolinkPlugin({
          type: markType,
          protocols: this.options.protocols,
          defaultProtocol: this.options.defaultProtocol,
          ...(this.options.shouldAutoLink && {
            shouldAutoLink: this.options.shouldAutoLink,
          }),
        })
      );
    }

    return plugins;
  },
});
