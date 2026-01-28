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
   * Whether to open links in a new tab by default
   * @default true
   */
  openOnClick: boolean;
  /**
   * Whether to add rel="noopener noreferrer" to links
   * @default true
   */
  addRelNoopener: boolean;
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

  addOptions() {
    return {
      HTMLAttributes: {},
      protocols: ['http:', 'https:', 'mailto:', 'tel:'],
      openOnClick: true,
      addRelNoopener: true,
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
          const element = node as HTMLElement;
          const href = element.getAttribute('href');

          // Validate URL
          if (!href || !isValidUrl(href, { protocols: this.options.protocols })) {
            return false;
          }

          return {
            href,
            target: element.getAttribute('target'),
            rel: element.getAttribute('rel'),
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
});
