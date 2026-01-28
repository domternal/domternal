/**
 * Link Click Plugin
 *
 * Handles Cmd/Ctrl+click on links to open them in a new tab.
 * Standard behavior expected by users in modern editors.
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import type { MarkType } from 'prosemirror-model';

/**
 * Options for the link click plugin
 */
export interface LinkClickPluginOptions {
  /**
   * The link mark type
   */
  type: MarkType;

  /**
   * When to open links on click
   * - true: Open on Mod+click (when editable) or click (when not editable)
   * - false: Never open
   * - 'whenNotEditable': Only open when editor is read-only
   * @default true
   */
  openOnClick?: boolean | 'whenNotEditable';
}

/**
 * Plugin key for link click plugin
 */
export const linkClickPluginKey = new PluginKey('linkClick');

/**
 * Creates a plugin that handles clicking on links.
 *
 * - When editor is editable: requires Cmd/Ctrl+click
 * - When editor is read-only: click opens link directly
 *
 * @param options - Plugin options
 * @returns ProseMirror Plugin
 */
export function linkClickPlugin(options: LinkClickPluginOptions): Plugin {
  const { type, openOnClick = true } = options;

  return new Plugin({
    key: linkClickPluginKey,

    props: {
      handleClick(view, pos, event) {
        // Check if we should handle clicks
        if (openOnClick === false) {
          return false;
        }

        if (openOnClick === 'whenNotEditable' && view.editable) {
          return false;
        }

        // Require Mod key when editable (Cmd on Mac, Ctrl on Windows/Linux)
        if (view.editable && !event.metaKey && !event.ctrlKey) {
          return false;
        }

        // Find link mark at click position
        const $pos = view.state.doc.resolve(pos);
        const marks = $pos.marks();
        const linkMark = marks.find((m) => m.type === type);

        if (!linkMark) {
          return false;
        }

        const href = linkMark.attrs['href'] as string | undefined;
        if (!href) {
          return false;
        }

        // Open link in new tab with security attributes
        window.open(href, '_blank', 'noopener,noreferrer');

        // Prevent default behavior and stop propagation
        event.preventDefault();
        return true;
      },
    },
  });
}
