import { coreMessages } from '../messages/core.js';
import { localizedLabel } from '../utils/localizeMessage.js';
import { localizedGroup } from '../messages/presentation.js';
/**
 * Hyperlink mark with `href` and `target` attributes.
 */
import { Plugin, PluginKey, TextSelection } from '@domternal/pm/state';
import { Mark } from '../Mark.js';
import type { CommandSpec } from '../types/Commands.js';
import { checkUrl, normalizeUrlProtocol, type UrlCheck, type UrlPolicyOptions } from '../helpers/checkUrl.js';
import { ExtensionConfigurationError } from '../ExtensionConfigurationError.js';
import { registerAttributeNormalizer } from '../utils/normalizedAttributes.js';
import { getMarkRange } from '../helpers/getMarkRange.js';
import { linkClickPlugin } from './helpers/linkClickPlugin.js';
import { linkPastePlugin } from './helpers/linkPastePlugin.js';
import { autolinkPlugin } from './helpers/autolinkPlugin.js';
import { linkExitPlugin } from './helpers/linkExitPlugin.js';
import type { Editor } from '../Editor.js';
import type { ToolbarItem } from '../types/Toolbar.js';

/**
 * A `protocols` entry written as Tiptap writes one: `{ scheme: 'tel' }`.
 * `optionalSlashes` is accepted for Tiptap configurations; a scheme matches
 * with or without slashes either way.
 */
export interface LinkProtocolOptions {
  scheme: string;
  optionalSlashes?: boolean;
}

export interface LinkOptions {
  /**
   * HTML attributes to add to the rendered element
   */
  HTMLAttributes: Record<string, unknown>;
  /**
   * The schemes a link may use, such as `'https:'`, in any case, with or
   * without the colon or slashes (`'https'`, `'https://'`), or as Tiptap's
   * `{ scheme: 'tel' }`. Left unset (`undefined` or `null`), the default. The URL policy refuses credentials in web, mail and
   * phone addresses and hidden characters whatever this lists; a user stays
   * allowed where it is the standard form of a listed scheme, such as
   * `ssh://git@host/repo.git`. `javascript:`, `vbscript:` and `data:`
   * fail editor creation with an ExtensionConfigurationError.
   * @default ['http:', 'https:', 'mailto:', 'tel:']
   */
  protocols: readonly (string | LinkProtocolOptions)[] | null;
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
   * either way. `false` refuses every relative link, as 1.2 did. Optional in
   * the type, so an options object written in full for 1.2 still compiles.
   * @default true
   */
  allowRelative?: boolean;
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
const DEFAULT_PROTOCOLS: readonly string[] = Object.freeze(['http:', 'https:', 'mailto:', 'tel:']);
interface CheckedProtocols {
  readonly values: readonly unknown[];
  readonly schemes: readonly string[];
}
const checkedProtocols = new WeakMap<object, CheckedProtocols>();

/** An entry's current scheme, including changes to an object entry in place. */
function protocolValue(entry: unknown): unknown {
  return entry !== null && typeof entry === 'object' ? (entry as { scheme?: unknown }).scheme : entry;
}

/**
 * @internal The scheme a `protocols` entry names, spelled as the URL parser
 * reports it, or null: a scheme in any case, with or without its colon or
 * slashes (`'https'`, `'HTTPS:'`, `'https://'`), or an object with a
 * `scheme`, as Tiptap's `{ scheme: 'tel', optionalSlashes: true }` writes it.
 */
export function protocolScheme(entry: unknown): string | null {
  const scheme = protocolValue(entry);
  if (typeof scheme !== 'string') return null;
  const name = /^([a-z][a-z0-9+.-]*)(?::(?:\/\/)?)?$/i.exec(scheme)?.[1];
  return name === undefined ? null : normalizeUrlProtocol(name);
}

/**
 * Checks the `protocols` option and spells each entry as the URL parser
 * reports a scheme, so `'HTTPS'` and `'https://'` mean `https:`. An unset
 * option, such as `Link.configure({ protocols: props.protocols })` without the
 * prop, means the default schemes. A value that is not a list of schemes, or
 * that names a script or data scheme, fails loudly: silently ignoring it would
 * leave links the application expects, or allow ones it never should.
 */
function configuredProtocols(protocols: unknown): readonly string[] {
  if (protocols === undefined || protocols === null) return DEFAULT_PROTOCOLS;
  if (!Array.isArray(protocols)) {
    throw new ExtensionConfigurationError("Link: protocols must be a list of schemes, such as ['https:']");
  }
  const cached = checkedProtocols.get(protocols);
  if (cached?.values.length === protocols.length
    && cached.values.every((value, index) => value === protocolValue(protocols[index]))) return cached.schemes;
  const schemes = (protocols as unknown[]).map(entry => {
    const scheme = protocolScheme(entry);
    if (scheme === null) {
      throw new ExtensionConfigurationError(`Link: protocols entry ${JSON.stringify(entry)} is not a URL scheme`);
    }
    if (FORBIDDEN_PROTOCOLS.has(scheme)) {
      throw new ExtensionConfigurationError(`Link: protocols cannot allow ${scheme}, which can run script`);
    }
    return scheme;
  });
  checkedProtocols.set(protocols, { values: protocols.map(protocolValue), schemes });
  return schemes;
}

/**
 * The URL checks of string hrefs per Link policy, for rendering and for loading JSON content:
 * the wrappers call getHTML on every update, which renders every link of the document again, a
 * controlled editor sets the same content again after every change, and generateHTML builds a
 * new schema, with a new copy of the default schemes, on every call. Keyed by what a check reads
 * of a Link policy, its schemes and `allowRelative`, so equal policies share their checks.
 * Bounded, and cleared when full, so a document of many distinct links cannot grow it without limit.
 * An href over 2,048 characters is checked each time instead of kept, so content with huge hrefs,
 * refused or not, cannot keep megabytes alive for as long as the module lives.
 */
const policyChecks = new Map<string, Map<string, UrlCheck>>();
/** The shared checks of each checked scheme list, which is one array per `protocols` value, without and with relative links. */
const protocolChecks = new WeakMap<object, readonly [Map<string, UrlCheck>, Map<string, UrlCheck>]>();
const POLICY_CHECKS_LIMIT = 4096;
const POLICIES_LIMIT = 64;
const POLICY_CHECKS_HREF_LENGTH = 2048;

/** The URL check of an href under a Link policy, remembered for a string. */
function policyCheck(policy: UrlPolicyOptions, href: unknown): UrlCheck {
  const { protocols } = policy;
  if (typeof href !== 'string' || href.length > POLICY_CHECKS_HREF_LENGTH || typeof protocols !== 'object') return checkUrl(href, policy);
  let byRelative = protocolChecks.get(protocols);
  if (byRelative === undefined) {
    // Scheme names hold no space, so the joined list names the schemes exactly.
    const shared = (relative: boolean): Map<string, UrlCheck> => {
      const key = `${relative ? '1' : '0'} ${protocols.join(' ')}`;
      let checks = policyChecks.get(key);
      if (checks === undefined) {
        if (policyChecks.size >= POLICIES_LIMIT) policyChecks.clear();
        checks = new Map();
        policyChecks.set(key, checks);
      }
      return checks;
    };
    byRelative = [shared(false), shared(true)];
    protocolChecks.set(protocols, byRelative);
  }
  const checks = byRelative[policy.allowRelative === true ? 1 : 0];
  let check = checks.get(href);
  if (check === undefined) {
    check = checkUrl(href, policy);
    if (checks.size >= POLICY_CHECKS_LIMIT) checks.clear();
    checks.set(href, check);
  }
  return check;
}

/** The URL check of an href a Link renders. */
function renderedCheck(options: LinkOptions, href: unknown): UrlCheck {
  return policyCheck(linkPolicy(options), href);
}

/** The URL policy of a Link configuration. */
function linkPolicy(options: LinkOptions): UrlPolicyOptions {
  return { protocols: configuredProtocols(options.protocols), allowRelative: options.allowRelative !== false };
}

/**
 * @internal The URL policy of a link extension's options, for a UI that
 * stores links itself, such as LinkPopover: the Link's `protocols` and
 * `allowRelative` when the options carry them, or null for a custom link mark
 * without them. It holds whatever the schema's href attribute looks like, such
 * as an extended Link that redefines it without the parent's validator.
 */
export function linkUrlPolicy(options: unknown): UrlPolicyOptions | null {
  if (options === null || typeof options !== 'object' || !('protocols' in options)) return null;
  // An options object written in full for 1.2 has no allowRelative, which means the default.
  return { protocols: configuredProtocols(options.protocols), allowRelative: (options as { allowRelative?: unknown }).allowRelative !== false };
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
      protocols: [...DEFAULT_PROTOCOLS],
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
      codeFor: value => (policyCheck(policy, value).status === 'unsafe' ? 'unsafe-url' : 'unsupported-url'),
      invalid,
      unsupported: value => policyCheck(policy, value).status !== 'allowed',
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
    const check = renderedCheck(this.options, { ...this.options.HTMLAttributes, ...HTMLAttributes }['href']);
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
        allowRelative: this.options.allowRelative !== false,
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
