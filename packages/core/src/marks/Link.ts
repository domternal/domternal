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
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Mark } from '../Mark.js';
import { isValidUrl } from '../helpers/isValidUrl.js';
import { linkClickPlugin } from './helpers/linkClickPlugin.js';
import { linkPastePlugin } from './helpers/linkPastePlugin.js';
import { autolinkPlugin } from './helpers/autolinkPlugin.js';
import { linkExitPlugin } from './helpers/linkExitPlugin.js';

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
  /**
   * Select the full link text range when clicking a link
   * @default false
   */
  enableClickSelection: boolean;
}

/**
 * Attributes for the Link mark
 */
export interface LinkAttributes {
  href: string;
  target?: string | null;
  rel?: string | null;
  title?: string | null;
  class?: string | null;
}

/**
 * Link mark for hyperlinks
 */
export const Link = Mark.create<LinkOptions>({
  name: 'link',

  // Links have lower priority than other marks
  priority: 1000,

  // When autolink is enabled, the mark is inclusive so that typing at
  // the end of a link naturally extends it (e.g. adding path segments
  // to an autolinked URL). When autolink is off, links are set manually
  // and should not extend on typing.
  inclusive() {
    return this.options.autolink;
  },

  addOptions(): LinkOptions {
    return {
      HTMLAttributes: {},
      protocols: ['http:', 'https:', 'mailto:', 'tel:'],
      openOnClick: true,
      addRelNoopener: true,
      autolink: true,
      linkOnPaste: true,
      defaultProtocol: 'https',
      enableClickSelection: false,
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
      title: {
        default: null,
      },
      class: {
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
            title: node.getAttribute('title'),
            class: node.getAttribute('class'),
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
          if (!isValidUrl(attributes.href, { protocols: this.options.protocols })) {
            return false;
          }
          return commands.setMark('link', attributes);
        },
      unsetLink:
        () =>
        ({ commands }) => commands.unsetMark('link'),
      toggleLink:
        (attributes: LinkAttributes) =>
        ({ commands }) => {
          if (!isValidUrl(attributes.href, { protocols: this.options.protocols })) {
            return false;
          }
          return commands.toggleMark('link', attributes);
        },
    };
  },

  // No keyboard shortcuts for links (requires dialog for URL input)
  // No input rules for links (too complex, requires URL validation)

  addProseMirrorPlugins() {
    const markType = this.markType;
    if (!markType) return [];

    const plugins = [];

    // Click plugin - always added (handles link opening on click)
    // 'whenNotEditable' → true: browser handles read-only links natively
    plugins.push(
      linkClickPlugin({
        type: markType,
        openOnClick: this.options.openOnClick === 'whenNotEditable'
          ? true
          : this.options.openOnClick,
        enableClickSelection: this.options.enableClickSelection,
      })
    );

    // Paste plugin - wraps selection or inserts URL as link
    if (this.options.linkOnPaste) {
      plugins.push(
        linkPastePlugin({
          type: markType,
          protocols: this.options.protocols,
        })
      );
    }

    // Exit plugin - ArrowRight at end of link exits the mark
    plugins.push(linkExitPlugin({ type: markType }));

    // keepOnSplit: strip link from storedMarks after a block split so that
    // pressing Enter at the end of a link does not carry it to the new line.
    plugins.push(
      new Plugin({
        key: new PluginKey('linkKeepOnSplit'),
        appendTransaction(transactions, _oldState, newState) {
          const docChanged = transactions.some((tr) => tr.docChanged);
          if (!docChanged) return null;

          const { selection } = newState;
          if (!(selection instanceof TextSelection) || !selection.empty) return null;

          const $cursor = selection.$cursor;
          if ($cursor?.parentOffset !== 0) return null;

          const stored = newState.storedMarks;
          if (!stored) return null;

          const hasLink = stored.some((m) => m.type === markType);
          if (!hasLink) return null;

          return newState.tr.setStoredMarks(stored.filter((m) => m.type !== markType));
        },
      })
    );

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

declare module '../types/Commands.js' {
  interface RawCommands {
    setLink: CommandSpec<[attributes: LinkAttributes]>;
    unsetLink: CommandSpec;
    toggleLink: CommandSpec<[attributes: LinkAttributes]>;
  }
}
