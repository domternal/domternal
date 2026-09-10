/**
 * Link Paste Plugin
 *
 * Handles pasting URLs:
 * - If text is selected: wraps selection in a link
 * - If no selection: inserts URL as clickable link text
 */
import { Plugin, PluginKey } from '@domternal/pm/state';
import type { MarkType } from '@domternal/pm/model';
import { checkUrl } from '../../helpers/checkUrl.js';
import { pasteClipboardImageFiles } from '../../helpers/clipboardImageFiles.js';

/**
 * Options for the link paste plugin
 */
export interface LinkPastePluginOptions {
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
   * Custom URL validation function, called only for an address the URL policy allows.
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
      handlePaste(view, event, slice) {
        // Get pasted text: one line only, since a browser would remove the
        // line breaks inside an address and link something else than it shows.
        const pasted = event.clipboardData?.getData('text/plain').trim();
        if (!pasted || /[\t\n\r]/.test(pasted)) return false;

        // Only an absolute address the URL policy allows is a link paste;
        // anything else continues as a default paste.
        const check = checkUrl(pasted, { protocols });
        if (check.status !== 'allowed') {
          return false;
        }
        const text = check.url;

        // An image-only paste whose text is the image's address, as a browser's
        // Copy image writes it, inserts the image file instead of a link.
        if (pasteClipboardImageFiles(view, event, slice)) return true;

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

        dispatch(tr.setMeta('paste', true).setMeta('uiEvent', 'paste'));
        return true;
      },
    },
  });
}
