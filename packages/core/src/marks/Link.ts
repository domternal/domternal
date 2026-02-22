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
import type { MarkType } from 'prosemirror-model';
import { Mark } from '../Mark.js';
import { isValidUrl } from '../helpers/isValidUrl.js';
import { getMarkRange } from '../helpers/getMarkRange.js';
import { linkClickPlugin } from './helpers/linkClickPlugin.js';
import { linkPastePlugin } from './helpers/linkPastePlugin.js';
import { autolinkPlugin } from './helpers/autolinkPlugin.js';
import { linkExitPlugin } from './helpers/linkExitPlugin.js';
import { defaultIcons } from '../icons/index.js';
import type { Editor } from '../Editor.js';
import type { ToolbarItem } from '../types/Toolbar.js';

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
   * - true: Open on click (when editable)
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

// =============================================================================
// Link Popover Plugin
// =============================================================================

interface LinkPopoverOptions {
  editor: Editor;
  markType: MarkType;
  protocols: string[];
}

function linkPopoverPlugin({ editor, markType, protocols }: LinkPopoverOptions): Plugin {
  // Build DOM elements
  const el = document.createElement('div');
  el.className = 'dm-link-popover';

  const input = document.createElement('input');
  input.type = 'url';
  input.placeholder = 'Enter URL...';
  input.className = 'dm-link-popover-input';

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'dm-link-popover-btn dm-link-popover-apply';
  applyBtn.title = 'Apply link';
  applyBtn.innerHTML = defaultIcons['check'] ?? '';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'dm-link-popover-btn dm-link-popover-remove';
  removeBtn.title = 'Remove link';
  removeBtn.innerHTML = defaultIcons['linkBreak'] ?? '';

  el.appendChild(input);
  el.appendChild(applyBtn);
  el.appendChild(removeBtn);

  let isOpen = false;
  let hasExistingLink = false;

  const show = (anchorElement?: HTMLElement): void => {
    // Detect existing link at cursor
    const { state } = editor.view;
    const { from, empty } = state.selection;
    let existingHref: string | null = null;

    if (empty) {
      const $pos = state.doc.resolve(from);
      const linkMark = $pos.marks().find((m: { type: { name: string } }) => m.type === markType);
      existingHref = linkMark ? (linkMark.attrs as Record<string, unknown>)['href'] as string : null;
    } else {
      // Check marks in selection
      const { to } = state.selection;
      state.doc.nodesBetween(from, to, (node) => {
        if (existingHref) return false;
        const linkMark = node.marks.find((m: { type: { name: string } }) => m.type === markType);
        if (linkMark) existingHref = (linkMark.attrs as Record<string, unknown>)['href'] as string;
        return true;
      });
    }

    hasExistingLink = existingHref !== null;
    input.value = existingHref ?? '';
    removeBtn.style.display = hasExistingLink ? '' : 'none';

    // Position below the anchor element (toolbar/bubble-menu button) or cursor
    if (anchorElement) {
      const anchorRect = anchorElement.getBoundingClientRect();
      el.style.top = `${String(anchorRect.bottom + 4)}px`;
      el.style.left = `${String(anchorRect.left)}px`;
    } else {
      const coords = editor.view.coordsAtPos(from);
      el.style.top = `${String(coords.bottom + 4)}px`;
      el.style.left = `${String(coords.left)}px`;
    }

    el.setAttribute('data-show', '');
    isOpen = true;

    // Focus input after a microtask so the attribute is applied
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  };

  const hide = (): void => {
    if (!isOpen) return;
    el.removeAttribute('data-show');
    isOpen = false;
    input.value = '';
  };

  const applyLink = (): void => {
    let href = input.value.trim();
    if (!href) {
      hide();
      editor.view.focus();
      return;
    }

    // Auto-prepend https:// if no protocol
    if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      href = 'https://' + href;
    }

    if (!isValidUrl(href, { protocols })) {
      hide();
      editor.view.focus();
      return;
    }

    // If cursor is on existing link with no selection, select the full link range first
    const { state } = editor.view;
    const { from, empty } = state.selection;

    if (empty && hasExistingLink) {
      const $pos = state.doc.resolve(from);
      const range = getMarkRange($pos, markType);
      if (range) {
        // Select the link range, then set the mark
        const tr = state.tr.setSelection(
          TextSelection.create(state.doc, range.from, range.to)
        );
        editor.view.dispatch(tr);
      }
    }

    (editor.commands as Record<string, (...args: unknown[]) => boolean>)['setLink']?.({ href });
    hide();
    editor.view.focus();
  };

  const removeLink = (): void => {
    (editor.commands as Record<string, (...args: unknown[]) => boolean>)['unsetLink']?.();
    hide();
    editor.view.focus();
  };

  // Event handlers
  const onLinkEdit = (data: { anchorElement?: HTMLElement }): void => {
    if (isOpen) {
      hide();
      editor.view.focus();
    } else {
      show(data.anchorElement);
    }
  };

  const onInputKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyLink();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hide();
      editor.view.focus();
    }
  };

  const onClickOutside = (e: MouseEvent): void => {
    if (!isOpen || el.contains(e.target as Node)) return;
    // Delay so toggle handlers (toolbar click → linkEdit) execute first.
    // If the toggle closes the popover, isOpen will be false and we skip.
    requestAnimationFrame(() => {
      if (isOpen) hide();
    });
  };

  const onPreventBlur = (e: MouseEvent): void => {
    e.preventDefault();
  };

  const onScroll = (): void => {
    if (isOpen) hide();
  };

  return new Plugin({
    key: new PluginKey('linkPopover'),

    view: () => {
      // Append to document.body so it's not clipped by .dm-editor overflow:hidden
      document.body.appendChild(el);

      // Register all event listeners here — ProseMirror calls destroy()/view()
      // on plugin view rebuilds, so listeners must be re-attached each time.
      input.addEventListener('keydown', onInputKeydown);
      applyBtn.addEventListener('mousedown', onPreventBlur);
      applyBtn.addEventListener('click', applyLink);
      removeBtn.addEventListener('mousedown', onPreventBlur);
      removeBtn.addEventListener('click', removeLink);
      document.addEventListener('mousedown', onClickOutside);
      window.addEventListener('scroll', onScroll, true);
      editor.on('linkEdit', onLinkEdit);

      return {
        destroy: () => {
          hide();
          input.removeEventListener('keydown', onInputKeydown);
          applyBtn.removeEventListener('mousedown', onPreventBlur);
          applyBtn.removeEventListener('click', applyLink);
          removeBtn.removeEventListener('mousedown', onPreventBlur);
          removeBtn.removeEventListener('click', removeLink);
          document.removeEventListener('mousedown', onClickOutside);
          window.removeEventListener('scroll', onScroll, true);
          editor.off('linkEdit', onLinkEdit);
          el.remove();
        },
      };
    },
  });
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
        ({ tr, state, dispatch }) => {
          const markType = state.schema.marks['link'];
          if (!markType) return false;

          const { from, to, empty } = tr.selection;

          if (empty) {
            // Extend to full link range around cursor
            const $pos = tr.doc.resolve(from);
            const range = getMarkRange($pos, markType);
            if (!range) return false;
            if (!dispatch) return true;
            tr.removeMark(range.from, range.to, markType);
          } else {
            if (!dispatch) return true;
            tr.removeMark(from, to, markType);
          }

          dispatch(tr);
          return true;
        },
      toggleLink:
        (attributes: LinkAttributes) =>
        ({ tr, state, dispatch }) => {
          if (!isValidUrl(attributes.href, { protocols: this.options.protocols })) {
            return false;
          }

          const markType = state.schema.marks['link'];
          if (!markType) return false;

          const { from, to, empty } = tr.selection;

          if (empty) {
            // Extend to full link range around cursor
            const $pos = tr.doc.resolve(from);
            const range = getMarkRange($pos, markType);

            if (range && tr.doc.rangeHasMark(range.from, range.to, markType)) {
              // Has link — remove it from the full range
              if (!dispatch) return true;
              tr.removeMark(range.from, range.to, markType);
            } else {
              // No link — toggle stored mark for cursor
              if (!dispatch) return true;
              const cursorMarks = tr.storedMarks ?? state.storedMarks ?? $pos.marks();
              if (markType.isInSet(cursorMarks)) {
                tr.removeStoredMark(markType);
              } else {
                tr.addStoredMark(markType.create(attributes));
              }
            }
          } else {
            if (!dispatch) return true;
            if (tr.doc.rangeHasMark(from, to, markType)) {
              tr.removeMark(from, to, markType);
            } else {
              tr.addMark(from, to, markType.create(attributes));
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
        label: 'Link',
        shortcut: 'Mod-K',
        group: 'format',
        priority: 120,
      },
    ];
  },

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

    // Link popover plugin — creates and manages a floating URL input
    const editor = this.editor as unknown as Editor;
    const protocols = this.options.protocols;
    plugins.push(
      linkPopoverPlugin({ editor, markType, protocols })
    );

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
