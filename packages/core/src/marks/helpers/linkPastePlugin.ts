/**
 * Link Paste Plugin
 *
 * Handles pasting URLs:
 * - If text is selected: wraps selection in a link
 * - If no selection: inserts URL as clickable link text
 */
import { Plugin, PluginKey } from '@domternal/pm/state';
import type { MarkType } from '@domternal/pm/model';

/**
 * Options for the link paste plugin
 */
export interface LinkPastePluginOptions {
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
   * Custom URL validation function
   * Return false to prevent linking specific URLs
   */
  validate?: (url: string) => boolean;
}

/**
 * Plugin key for link paste plugin
 */
export const linkPastePluginKey = new PluginKey('linkPaste');

/**
 * Creates a plugin that handles pasting URLs.
 *
 * Behavior:
 * - Text selected + paste URL = wrap selection in link
 * - No selection + paste URL = insert URL as link
 *
 * @param options - Plugin options
 * @returns ProseMirror Plugin
 */
export function linkPastePlugin(options: LinkPastePluginOptions): Plugin {
  const { type, protocols = ['http:', 'https:'], validate } = options;

  return new Plugin({
    key: linkPastePluginKey,

    props: {
      handlePaste(view, event) {
        // Get pasted text
        const text = event.clipboardData?.getData('text/plain').trim();
        if (!text) return false;

        // Check if pasted text is a URL
        let url: URL;
        try {
          url = new URL(text);
        } catch {
          return false; // Not a URL, let default paste handling continue
        }

        // Validate protocol
        if (!protocols.includes(url.protocol)) {
          return false;
        }

        // Custom validation
        if (validate && !validate(text)) {
          return false;
        }

        const { state, dispatch } = view;
        const { from, to, empty } = state.selection;
        const tr = state.tr;

        if (empty) {
          // No selection - insert URL as linked text
          tr.insertText(text, from, to);
          tr.addMark(from, from + text.length, type.create({ href: text }));
        } else {
          // Has selection - wrap selection in link
          tr.addMark(from, to, type.create({ href: text }));
        }

        dispatch(tr);
        return true;
      },
    },
  });
}
