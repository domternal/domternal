import { coreMessages } from '../messages/core.js';
import { localizedLabel } from '../utils/localizeMessage.js';
import { localizedGroup } from '../messages/presentation.js';
/**
 * Hyperlink mark with `href` and `target` attributes.
 */
import { Plugin, PluginKey, TextSelection } from '@domternal/pm/state';
import { Mark } from '../Mark.js';
import type { CommandSpec } from '../types/Commands.js';
import { checkUrl, normalizeUrlProtocol, type UrlPolicyOptions } from '../helpers/checkUrl.js';
import { ExtensionConfigurationError } from '../ExtensionConfigurationError.js';
import { registerAttributeNormalizer } from '../utils/normalizedAttributes.js';
import { getMarkRange } from '../helpers/getMarkRange.js';
import { linkClickPlugin } from './helpers/linkClickPlugin.js';
import { linkPastePlugin } from './helpers/linkPastePlugin.js';
import { autolinkPlugin } from './helpers/autolinkPlugin.js';
import { linkExitPlugin } from './helpers/linkExitPlugin.js';
import type { Editor } from '../Editor.js';
import type { ToolbarItem } from '../types/Toolbar.js';

export interface LinkOptions {
  /**
   * HTML attributes to add to the rendered element
   */
  HTMLAttributes: Record<string, unknown>;
  /**
   * The schemes a link may use, such as `'https:'`, in any case, with or
   * without the colon. The URL policy refuses credentials in web, mail and
   * phone addresses and hidden characters whatever this lists; a user stays
   * allowed where it is the standard form of a listed scheme, such as
   * `ssh://git@host/repo.git`. `javascript:`, `vbscript:` and `data:`
   * fail editor creation with an ExtensionConfigurationError.
   * @default ['http:', 'https:', 'mailto:', 'tel:']
   */
  protocols: string[];
  /**
   * When an editable editor opens links on click. A read-only editor leaves
   * clicks to the browser, which follows the rendered link.
   * - true: Open on click (when editable)
   * - false: Never open
   * - 'whenNotEditable': Never open while editable, so only a read-only editor opens links
   * @default true
   */
  openOnClick: boolean | 'whenNotEditable';
  /**
   * Whether a link that opens a new tab (target `_blank`) renders with
   * `noopener noreferrer` merged into its `rel`, without `opener`, and whether
   * a click opens it without a referrer. A click never gives the new tab an
   * opener either way.
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
   * Allows relative links: `/path`, `./page`, `../page`, `page.html`,
   * `?query` and `#fragment`. They render with their href and open resolved
   * against the page; a fragment scrolls to its target. A network path
   * (`//host`), a backslash and a colon in the first segment are refused
   * either way. `false` refuses every relative link, as 1.2 did.
   * @default true
   */
  allowRelative: boolean;
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

/** Schemes no Link configuration may allow: each can run script or show a document of its own. */
const FORBIDDEN_PROTOCOLS = new Set(['javascript:', 'vbscript:', 'data:']);
const checkedProtocols = new WeakMap<object, readonly string[]>();

/**
 * Checks the `protocols` option and spells each entry as the URL parser
 * reports a scheme, so `'HTTPS'` means `https:`. A list that is not a list of
 * schemes, or that names a script or data scheme, fails loudly: silently
 * ignoring it would leave links the application expects, or allow ones it
 * never should.
 */
function configuredProtocols(protocols: unknown): readonly string[] {
  if (!Array.isArray(protocols)) {
    throw new ExtensionConfigurationError("Link: protocols must be a list of schemes, such as ['https:']");
  }
  const cached = checkedProtocols.get(protocols);
  if (cached) return cached;
  const schemes = (protocols as unknown[]).map(entry => {
    if (typeof entry !== 'string' || !/^[a-z][a-z0-9+.-]*:?$/i.test(entry)) {
      throw new ExtensionConfigurationError(`Link: protocols entry ${JSON.stringify(entry)} is not a URL scheme`);
    }
    const scheme = normalizeUrlProtocol(entry);
    if (FORBIDDEN_PROTOCOLS.has(scheme)) {
      throw new ExtensionConfigurationError(`Link: protocols cannot allow ${scheme}, which can run script`);
    }
    return scheme;
  });
  checkedProtocols.set(protocols, schemes);
  return schemes;
}

/** The URL policy of a Link configuration. */
function linkPolicy(options: LinkOptions): UrlPolicyOptions {
  return { protocols: configuredProtocols(options.protocols), allowRelative: options.allowRelative };
}

/** The Link's own attributes, which a refused link does not render. */
const LINK_ATTRIBUTES = ['href', 'target', 'rel', 'title', 'class'];

/** Targets a link renders: the browsing context keywords. A named target is dropped. */
const LINK_TARGETS = new Set(['_blank', '_self', '_parent', '_top']);

/** The keyword target a value names, in lower case, or null. */
function linkTarget(value: unknown): string | null {
  const target = typeof value === 'string' ? value.toLowerCase() : null;
  return target !== null && LINK_TARGETS.has(target) ? target : null;
}

/**
 * The rel of a link that opens a new tab: the stored tokens without `opener`,
 * which would hand the editor's page to the opened one, plus `noopener` and
 * `noreferrer` when missing.
 */
function newTabRel(value: unknown): string {
  const tokens = (typeof value === 'string' ? value.split(/[\t\n\f\r ]+/) : [])
    .filter(token => token !== '' && token.toLowerCase() !== 'opener');
  for (const required of ['noopener', 'noreferrer']) {
    if (!tokens.some(token => token.toLowerCase() === required)) tokens.push(required);
  }
  return tokens.join(' ');
}

/**
 * Link mark for hyperlinks
 */
export const Link = Mark.create<LinkOptions>({
  name: 'link',

  // Links are semantic data, not visual formatting.
  // They survive `unsetAllMarks` (clear formatting).
  // Override with: Link.configure({ isFormatting: true })
  isFormatting: false,

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
      allowRelative: true,
      enableClickSelection: false,
    };
  },

  addAttributes() {
    // Checked while the schema is built, so a misconfiguration fails the editor or SSR helper.
    const policy = linkPolicy(this.options);
    // Validation rejects only what no configuration can hold, a value that is
    // not a string, so a document written by a collaborator with wider
    // protocols still loads in Node.fromJSON, Node.check and Step.fromJSON.
    // The JSON entry points remove a link whose href this policy refuses and
    // report it; rendering shows its text without changing the document.
    const invalid = (value: unknown): boolean => value !== null && typeof value !== 'string';
    const validate = (value: unknown): void => {
      if (invalid(value)) throw new RangeError('Invalid link href');
    };
    registerAttributeNormalizer(validate, {
      code: 'unsupported-url',
      codeFor: value => (checkUrl(value, policy).status === 'unsafe' ? 'unsafe-url' : 'unsupported-url'),
      invalid,
      unsupported: value => checkUrl(value, policy).status !== 'allowed',
      replacement: () => null,
      removesMark: true,
    });
    return {
      href: {
        default: null,
        validate,
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
          // Only an address the URL policy allows, stored as the browser reads it.
          const check = checkUrl(node.getAttribute('href'), linkPolicy(this.options));
          if (check.status !== 'allowed') {
            return false;
          }

          return {
            href: check.url,
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
    // A stored href the URL policy refuses, such as a script address or a
    // value that is not a string, renders as plain text: no anchor to follow
    // or copy, and none that styles would show as a link. Attributes other
    // extensions add stay. The document keeps the stored value.
    const check = checkUrl({ ...this.options.HTMLAttributes, ...HTMLAttributes }['href'], linkPolicy(this.options));
    if (check.status !== 'allowed') {
      const rest = Object.fromEntries(Object.entries(HTMLAttributes).filter(([name]) => !LINK_ATTRIBUTES.includes(name)));
      return ['span', rest, 0];
    }

    const attrs: Record<string, unknown> = { ...this.options.HTMLAttributes };
    for (const [name, value] of Object.entries(HTMLAttributes)) {
      // An array or object would be joined into the attribute; only strings render.
      if ((name === 'title' || name === 'class') && typeof value !== 'string') continue;
      attrs[name] = value;
    }
    attrs['href'] = check.url;

    const target = linkTarget(attrs['target']);
    if (target === null) delete attrs['target'];
    else attrs['target'] = target;

    // A new tab never gets the editor's page as its opener.
    if (this.options.addRelNoopener && target === '_blank') attrs['rel'] = newTabRel(attrs['rel']);
    else if (typeof attrs['rel'] !== 'string') delete attrs['rel'];

    return ['a', attrs, 0];
  },

  addCommands() {
    return {
      setLink:
        (attributes: LinkAttributes) =>
        ({ commands }) => {
          const check = checkUrl(attributes.href, linkPolicy(this.options));
          if (check.status !== 'allowed') {
            return false;
          }
          return commands.setMark('link', { ...attributes, href: check.url });
        },
      unsetLink:
        () =>
        ({ tr, state, dispatch }) => {
          const markType = state.schema.marks['link'];
          if (!markType) return false;

          const { empty, ranges } = tr.selection;

          if (empty) {
            // Extend to full link range around cursor
            const $pos = tr.doc.resolve(tr.selection.from);
            const range = getMarkRange($pos, markType);
            if (!range) return false;
            if (!dispatch) return true;
            tr.removeMark(range.from, range.to, markType);
          } else {
            // Check that at least one text node in the selection is in a context that allows links.
            // This correctly handles CellSelection (multiple ranges) and code blocks (marks: '').
            const ctx = { hasApplicableText: false };
            for (const range of ranges) {
              tr.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, _pos, parent) => {
                if (node.isText && parent?.type.allowsMarkType(markType)
                  && !node.marks.some((m) => m.type.excludes(markType) && m.type !== markType)) {
                  ctx.hasApplicableText = true;
                }
              });
            }
            if (!ctx.hasApplicableText) return false;
            if (!dispatch) return true;
            // Iterate over selection ranges (handles CellSelection with multiple ranges)
            for (const range of ranges) {
              tr.removeMark(range.$from.pos, range.$to.pos, markType);
            }
          }

          dispatch(tr);
          return true;
        },
      toggleLink:
        (attributes: LinkAttributes) =>
        ({ tr, state, dispatch }) => {
          const check = checkUrl(attributes.href, linkPolicy(this.options));
          if (check.status !== 'allowed') {
            return false;
          }
          const linkAttributes = { ...attributes, href: check.url };

          const markType = state.schema.marks['link'];
          if (!markType) return false;

          const { empty, ranges } = tr.selection;

          if (empty) {
            // Extend to full link range around cursor
            const $pos = tr.doc.resolve(tr.selection.from);
            const range = getMarkRange($pos, markType);

            if (range && tr.doc.rangeHasMark(range.from, range.to, markType)) {
              // Has link - remove it from the full range
              if (!dispatch) return true;
              tr.removeMark(range.from, range.to, markType);
            } else {
              // No link - toggle stored mark for cursor
              if (!dispatch) return true;
              const cursorMarks = tr.storedMarks ?? state.storedMarks ?? $pos.marks();
              if (markType.isInSet(cursorMarks)) {
                tr.removeStoredMark(markType);
              } else {
                tr.addStoredMark(markType.create(linkAttributes));
              }
            }
          } else {
            if (!dispatch) return true;
            // Iterate over selection ranges (handles CellSelection with multiple ranges)
            const hasMark = ranges.every(range =>
              tr.doc.rangeHasMark(range.$from.pos, range.$to.pos, markType),
            );
            for (const range of ranges) {
              if (hasMark) {
                tr.removeMark(range.$from.pos, range.$to.pos, markType);
              } else {
                tr.addMark(range.$from.pos, range.$to.pos, markType.create(linkAttributes));
              }
            }
          }

          dispatch(tr);
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        (this.editor as unknown as Editor).emit('linkEdit', {});
        return true;
      },
    };
  },

  addToolbarItems(): ToolbarItem[] {
    return [
      {
        type: 'button',
        name: 'link',
        command: 'unsetLink',
        emitEvent: 'linkEdit',
        isActive: 'link',
        icon: 'link',
        ...localizedLabel(this.editor?.i18n, coreMessages.link),
        shortcut: 'Mod-K',
        group: 'format',
        ...localizedGroup(this.editor?.i18n, coreMessages.groupFormat),
        priority: 120,
      },
    ];
  },

  addProseMirrorPlugins() {
    const markType = this.markType;
    if (!markType) return [];

    const plugins = [];

    // Click plugin - always added (handles link opening on click while
    // editable; the browser follows read-only links natively)
    plugins.push(
      linkClickPlugin({
        type: markType,
        openOnClick: this.options.openOnClick,
        enableClickSelection: this.options.enableClickSelection,
        protocols: configuredProtocols(this.options.protocols),
        allowRelative: this.options.allowRelative,
        noreferrer: this.options.addRelNoopener,
      })
    );

    // Paste plugin - wraps selection or inserts URL as link
    if (this.options.linkOnPaste) {
      plugins.push(
        linkPastePlugin({
          type: markType,
          protocols: configuredProtocols(this.options.protocols),
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
          protocols: configuredProtocols(this.options.protocols),
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

declare module '@domternal/core' {
  interface RawCommands {
    setLink: CommandSpec<[attributes: LinkAttributes]>;
    unsetLink: CommandSpec;
    toggleLink: CommandSpec<[attributes: LinkAttributes]>;
  }
}
