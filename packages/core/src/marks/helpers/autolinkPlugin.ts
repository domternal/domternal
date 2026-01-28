/**
 * Autolink Plugin
 *
 * Automatically converts typed URLs into clickable links.
 * Triggers when user types a space, punctuation, or presses Enter after a URL.
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import type { MarkType } from 'prosemirror-model';

/**
 * Options for the autolink plugin
 */
export interface AutolinkPluginOptions {
  /**
   * The link mark type
   */
  type: MarkType;

  /**
   * Allowed URL protocols
   * @default ['http:', 'https:']
   */
  protocols?: string[];

  /**
   * Default protocol to add to bare URLs (e.g., 'example.com' → 'https://example.com')
   * @default 'https'
   */
  defaultProtocol?: string;

  /**
   * Custom validation function
   * Return false to prevent auto-linking specific URLs
   */
  shouldAutoLink?: (url: string) => boolean;
}

/**
 * Plugin key for autolink plugin
 */
export const autolinkPluginKey = new PluginKey('autolink');

/**
 * Regex to detect URLs in text.
 * Matches:
 * - http://example.com
 * - https://example.com
 * - www.example.com
 * - example.com (with common TLDs)
 */
const URL_REGEX =
  /(?:https?:\/\/|www\.)[^\s<>[\](){}'"]+|(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+(?:com|org|net|edu|gov|io|co|dev|app|me|info|biz|xyz)(?:\/[^\s<>[\](){}'"]*)?/gi;

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
        const textBefore = $from.parent.textBetween(
          Math.max(0, $from.parentOffset - 500), // Look back max 500 chars
          $from.parentOffset,
          undefined,
          '\ufffc'
        );

        // Find URLs in the text before cursor
        const matches: { start: number; end: number; url: string }[] = [];
        let match: RegExpExecArray | null;

        // Reset regex
        URL_REGEX.lastIndex = 0;

        while ((match = URL_REGEX.exec(textBefore)) !== null) {
          matches.push({
            start: match.index,
            end: match.index + match[0].length,
            url: match[0],
          });
        }

        // Get the last match (most recent URL)
        const lastMatch = matches[matches.length - 1];
        if (!lastMatch) {
          return false;
        }

        // Check if URL ends right before the trigger character
        if (lastMatch.end !== textBefore.length) {
          return false;
        }

        // Build full URL with protocol if needed
        let href = lastMatch.url;
        if (href.startsWith('www.')) {
          href = `${defaultProtocol}://${href}`;
        } else if (!href.startsWith('http://') && !href.startsWith('https://')) {
          href = `${defaultProtocol}://${href}`;
        }

        // Validate protocol
        try {
          const url = new URL(href);
          if (!protocols.includes(url.protocol)) {
            return false;
          }
        } catch {
          return false;
        }

        // Custom validation
        if (shouldAutoLink && !shouldAutoLink(href)) {
          return false;
        }

        // Calculate positions in document
        const blockStart = from - $from.parentOffset;
        const linkStart = blockStart + lastMatch.start;
        const linkEnd = blockStart + lastMatch.end;

        // Check if already has link mark
        const $linkStart = state.doc.resolve(linkStart);
        if ($linkStart.marks().some((m) => m.type === type)) {
          return false;
        }

        // Apply link mark and insert trigger character
        const tr = state.tr;
        tr.addMark(linkStart, linkEnd, type.create({ href }));
        tr.insertText(text, from, to);

        view.dispatch(tr);
        return true;
      },
    },
  });
}
