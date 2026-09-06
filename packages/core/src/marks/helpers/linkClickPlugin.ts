/**
 * Link Click Plugin
 *
 * Handles clicks on links in an editable editor. A read-only editor leaves
 * clicks to the browser, which follows the rendered anchor: Link renders one
 * only for an address the URL policy allows.
 */
import { Plugin, PluginKey, TextSelection } from '@domternal/pm/state';
import type { MarkType, Node as PMNode } from '@domternal/pm/model';
import type { EditorView } from '@domternal/pm/view';
import { checkUrl } from '../../helpers/checkUrl.js';
import { getExactMarkRange } from '../../helpers/getMarkRange.js';

/**
 * Options for the link click plugin
 */
export interface LinkClickPluginOptions {
  /**
   * The link mark type
   */
  type: MarkType;

  /**
   * When to open links on click while the editor is editable. A read-only
   * editor leaves clicks to the browser, which follows the rendered link.
   * - true: Open on click
   * - false: Never open
   * - 'whenNotEditable': Never open while editable
   * @default true
   */
  openOnClick?: boolean | 'whenNotEditable';

  /**
   * Select the full link text range when clicking a link
   * @default false
   */
  enableClickSelection?: boolean;

  /**
   * The schemes a link may open with, as for the Link `protocols` option. The
   * URL policy refuses script and data addresses, credentials and hidden
   * characters whatever this lists.
   * @default ['http:', 'https:', 'mailto:', 'tel:']
   */
  protocols?: readonly string[];

  /**
   * Allows relative references, as for the Link `allowRelative` option. A
   * fragment, such as `#intro`, scrolls to its target in place.
   * @default true
   */
  allowRelative?: boolean;

  /**
   * Opens a new tab without a referrer as well as without an opener. Without
   * it, only a link whose `rel` holds `noreferrer` hides the referrer.
   * @default true
   */
  noreferrer?: boolean;
}

/**
 * Plugin key for link click plugin
 */
export const linkClickPluginKey = new PluginKey('linkClick');

const DEFAULT_PROTOCOLS: readonly string[] = ['http:', 'https:', 'mailto:', 'tel:'];
/** Targets that name a browsing context of the page instead of a new one. */
const CONTEXT_TARGETS = new Set(['_self', '_parent', '_top']);
const hasToken = (value: string | null, token: string): boolean =>
  (value ?? '').split(/[\t\n\f\r ]+/).some(candidate => candidate.toLowerCase() === token);

/** The first inline node inside the anchor, whose marks are the anchor's own. */
function anchorNode(view: EditorView, anchor: Element): { node: PMNode; pos: number } | null {
  try {
    const pos = view.posAtDOM(anchor, 0);
    const node = view.state.doc.nodeAt(pos);
    return node ? { node, pos } : null;
  } catch {
    // The anchor lies outside the editable content, such as inside a node view's own DOM.
    return null;
  }
}

/**
 * Scrolls to the element a fragment names, in the editor first and then in
 * the page, and reports whether it found one. The location never changes, so
 * no history entry is added and a hash router is not triggered. The id is
 * compared as a value, never built into a selector.
 */
function scrollToFragment(view: EditorView, fragment: string): boolean {
  let id = fragment.slice(1);
  try {
    id = decodeURIComponent(id);
  } catch {
    // A malformed escape names the raw id, as browsers fall back to it.
  }
  if (id === '') return false;
  const target = Array.from(view.dom.querySelectorAll('[id]')).find(element => element.id === id)
    ?? view.dom.ownerDocument.getElementById(id);
  if (!target) return false;
  // Some environments, such as test DOMs, do not lay out or scroll.
  if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'start' });
  return true;
}

/**
 * Creates a plugin that handles clicking on links to open them.
 *
 * Only the clicked anchor's own link mark counts, and only an address the URL
 * policy allows opens. A new tab opens without `window.opener`, so the opened
 * page cannot navigate the editor's tab. `_self`, `_parent` and `_top` targets
 * navigate that browsing context; every other target opens a new tab.
 *
 * @param options - Plugin options
 * @returns ProseMirror Plugin
 */
export function linkClickPlugin(options: LinkClickPluginOptions): Plugin {
  const {
    type,
    openOnClick = true,
    enableClickSelection = false,
    protocols = DEFAULT_PROTOCOLS,
    allowRelative = true,
    noreferrer = true,
  } = options;

  return new Plugin({
    key: linkClickPluginKey,

    props: {
      handleClick(view, _pos, event) {
        // Only left clicks, and only while editable: a read-only editor leaves
        // the click to the browser, which follows only an allowed rendered href.
        if (event.button !== 0 || !view.editable) {
          return false;
        }

        const target = event.target as Element | null;
        const anchor = typeof target?.closest === 'function' ? target.closest('a') : null;
        if (!anchor || !view.dom.contains(anchor)) {
          return false;
        }

        // The mark of the anchor's own first node. The position before the
        // anchor would report the marks of the node before it, such as an
        // adjacent link, so it is never used. An anchor without a link mark,
        // such as one a node view renders, is not a link of this plugin.
        const found = anchorNode(view, anchor);
        const mark = found?.node.marks.find(candidate => candidate.type === type);
        if (!found || !mark) {
          return false;
        }

        if (enableClickSelection) {
          const { from, to } = getExactMarkRange(view.state.doc, found.pos, mark);
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
          return true;
        }

        // 'whenNotEditable' never opens while editable.
        if (openOnClick !== true) {
          return false;
        }

        const check = checkUrl(mark.attrs['href'], { protocols, allowRelative });
        if (check.status !== 'allowed') {
          return false;
        }

        // A link within the page scrolls there instead of opening a tab.
        if (check.url.startsWith('#')) {
          return scrollToFragment(view, check.url);
        }

        // The rendered target and rel, as a native click on the anchor would
        // read them: the Link renders only keyword targets, from the mark or
        // its HTMLAttributes option.
        const keyword = (anchor.getAttribute('target') ?? '').toLowerCase();
        if (CONTEXT_TARGETS.has(keyword)) {
          window.open(check.url, keyword);
          return true;
        }
        const hidesReferrer = noreferrer || hasToken(anchor.getAttribute('rel'), 'noreferrer');
        window.open(check.url, '_blank', hidesReferrer ? 'noopener,noreferrer' : 'noopener');
        return true;
      },
    },
  });
}
