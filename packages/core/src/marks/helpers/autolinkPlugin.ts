/**
 * Autolink Plugin
 *
 * Automatically converts typed URLs into clickable links.
 * Triggers when user types a space, punctuation, or presses Enter after a URL.
 * Uses linkifyjs for robust URL detection.
 */
import { Plugin, PluginKey } from '@domternal/pm/state';
import type { MarkType } from '@domternal/pm/model';
import { find } from 'linkifyjs';
import { checkUrl } from '../../helpers/checkUrl.js';

/**
 * Options for the autolink plugin
 */
export interface AutolinkPluginOptions {
  /**
   * The link mark type
   */
  type: MarkType;

  /**
   * Allowed URL protocols. The URL policy also refuses credentials in web,
   * mail and phone addresses and hidden characters, whatever this lists.
   * @default ['http:', 'https:']
   */
  protocols?: readonly string[];

  /**
   * Default protocol to add to bare URLs (e.g., 'example.com' → 'https://example.com')
   * @default 'https'
   */
  defaultProtocol?: string;

  /**
   * Custom validation function, called only for an address the URL policy allows.
   * Return false to prevent auto-linking specific URLs
   */
  shouldAutoLink?: (url: string) => boolean;
}

/**
 * Plugin key for autolink plugin
 */
export const autolinkPluginKey = new PluginKey('autolink');

/**
 * Characters that trigger autolink detection
 */
const TRIGGER_CHARS = /[\s.,!?;:\n]/;

/**
 * Creates a plugin that auto-converts typed URLs to links.
 *
 * When user types a URL followed by space/punctuation, the URL
 * is automatically wrapped in a link mark.
 *
 * @param options - Plugin options
 * @returns ProseMirror Plugin
 */
export function autolinkPlugin(options: AutolinkPluginOptions): Plugin {
  const {
    type,
    protocols = ['http:', 'https:'],
    defaultProtocol = 'https',
    shouldAutoLink,
  } = options;

  return new Plugin({
    key: autolinkPluginKey,

    props: {
      handleTextInput(view, from, to, text) {
        // Only trigger on space, punctuation, or newline
        if (!TRIGGER_CHARS.test(text)) {
          return false;
        }

        const { state } = view;
        const $from = state.doc.resolve(from);

        // Get text before cursor in current text block
        const lookbackStart = Math.max(0, $from.parentOffset - 500);
        const textBefore = $from.parent.textBetween(
          lookbackStart,
          $from.parentOffset,
          undefined,
          '\ufffc'
        );

        // Use linkifyjs to find URLs in the text
        const matches = find(textBefore, {
          defaultProtocol: defaultProtocol,
        });

        // Get the last match (most recent URL)
        const lastMatch = matches[matches.length - 1];
        if (!lastMatch) {
          return false;
        }

        // Only process URL types (not email, etc.)
        if (lastMatch.type !== 'url') {
          return false;
        }

        // Check if URL ends right before the trigger character
        if (lastMatch.end !== textBefore.length) {
          return false;
        }

        // The URL policy first: an allowed scheme, no credentials in a web
        // address, no hidden characters. Custom validation only sees an address the policy allows.
        const check = checkUrl(lastMatch.href, { protocols });
        const href = check.status === 'allowed' ? check.url : null;
        const linked = href !== null && (!shouldAutoLink || shouldAutoLink(href));

        // Calculate positions in document
        const blockStart = from - $from.parentOffset;
        const linkStart = blockStart + lookbackStart + lastMatch.start;
        const linkEnd = blockStart + lookbackStart + lastMatch.end;

        // Keep existing link attributes and ordinary editing inside a link.
        const $linkStart = state.doc.resolve(linkStart);
        const existingLink = $linkStart.marks().find((mark) => mark.type === type);
        if (existingLink && state.doc.resolve(to).nodeAfter?.marks.some(mark => mark.eq(existingLink))) {
          return false;
        }

        // Punctuation can be both a delimiter and part of a URL. A period may
        // have linked `https://example` before the user finished `.com`. That
        // link covers a prefix of the token and points where its own text
        // does, unlike a manually assigned destination.
        let autolinkedPrefix = false;
        if (existingLink) {
          let markedEnd = linkStart;
          state.doc.nodesBetween(linkStart, linkEnd, (node, pos) => {
            if (node.isText && pos <= markedEnd && node.marks.some(mark => mark.eq(existingLink))) {
              markedEnd = Math.min(pos + node.nodeSize, linkEnd);
            }
          });
          if (markedEnd > linkStart && markedEnd < linkEnd) {
            const prefix = state.doc.textBetween(linkStart, markedEnd);
            const prefixMatch = find(prefix, { defaultProtocol })[0];
            autolinkedPrefix = prefixMatch?.start === 0 && prefixMatch.end === prefix.length
              && prefixMatch.href === existingLink.attrs['href'];
          }
        }
        if (!linked && !autolinkedPrefix) {
          return false;
        }

        // End an auto-detected URL before its delimiter, keeping other formatting.
        const tr = state.tr;
        if (existingLink && autolinkedPrefix) {
          // Extend the prefix link over the complete token, or remove it when
          // the complete token is not linked, such as one with credentials.
          tr.removeMark(linkStart, linkEnd, existingLink);
          if (linked) tr.addMark(linkStart, linkEnd, type.create({ ...existingLink.attrs, href }));
        } else if (!existingLink && linked) {
          tr.addMark(linkStart, linkEnd, type.create({ href }));
        }
        const insertionMarks = type.removeFromSet(state.storedMarks ?? $from.marks());
        tr.setStoredMarks(insertionMarks);
        tr.insertText(text, from, to);
        tr.setStoredMarks(insertionMarks);

        view.dispatch(tr);
        return true;
      },
    },
  });
}
