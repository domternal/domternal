/**
 * Link Click Plugin
 *
 * Handles click on links to open them.
 * When editable: opens on click.
 * When read-only: browser handles link clicks natively.
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
   * - true: Open on click
   * - false: Never open
   * - 'whenNotEditable': Only open when editor is read-only (browser handles natively)
   * @default true
   */
  openOnClick?: boolean | 'whenNotEditable';
}

/**
 * Plugin key for link click plugin
 */
export const linkClickPluginKey = new PluginKey('linkClick');

/**
 * Creates a plugin that handles clicking on links to open them.
 *
 * @param options - Plugin options
 * @returns ProseMirror Plugin
 */
export function linkClickPlugin(options: LinkClickPluginOptions): Plugin {
  const { type, openOnClick = true } = options;

  return new Plugin({
    key: linkClickPluginKey,

    props: {
      handleClick(view, _pos, event) {
        // Only left clicks
        if (event.button !== 0) {
          return false;
        }

        // When not editable, let browser handle natively (links navigate normally)
        if (!view.editable) {
          return false;
        }

        // Find the <a> element from the click target
        let link: HTMLAnchorElement | null = null;

        if (event.target instanceof HTMLAnchorElement) {
          link = event.target;
        } else {
          const target = event.target as HTMLElement | null;
          if (!target) {
            return false;
          }
          link = target.closest<HTMLAnchorElement>('a');
          if (link && !view.dom.contains(link)) {
            link = null;
          }
        }

        if (!link) {
          return false;
        }

        if (openOnClick) {
          // Get href/target from ProseMirror mark (validated by renderHTML), fallback to DOM
          const pos = view.posAtDOM(link, 0);
          const $pos = view.state.doc.resolve(pos);
          const linkMark = $pos.marks().find((m) => m.type === type);

          const href = (linkMark?.attrs['href'] as string | undefined) ?? link.href;
          const linkTarget = (linkMark?.attrs['target'] as string | undefined) ?? link.target;

          if (href) {
            window.open(href, linkTarget || '_blank');
            return true;
          }
        }

        return false;
      },
    },
  });
}
