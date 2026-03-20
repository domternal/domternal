/**
 * LinkPopover Extension
 *
 * Provides a floating URL input popover for editing links.
 * This is a UI extension — it creates DOM elements and should only be used
 * when a visual link-editing UI is desired. In headless (core-only) setups
 * this extension can be omitted; users build their own link UI instead.
 *
 * Listens for the `linkEdit` editor event (emitted by Link's Mod-K shortcut
 * and the toolbar link button) to toggle the popover.
 *
 * Included in StarterKit by default. Disable with:
 * ```ts
 * StarterKit.configure({ linkPopover: false })
 * ```
 */
import { Plugin, PluginKey, TextSelection } from '@domternal/pm/state';
import type { MarkType } from '@domternal/pm/model';
import { Decoration, DecorationSet } from '@domternal/pm/view';
import { Extension } from '../Extension.js';
import { isValidUrl } from '../helpers/isValidUrl.js';
import { getMarkRange } from '../helpers/getMarkRange.js';
import { defaultIcons } from '../icons/index.js';
import { positionFloating } from '../utils/positionFloating.js';
import type { Editor } from '../Editor.js';

export interface LinkPopoverOptions {
  /**
   * List of allowed URL protocols (should match Link mark's protocols)
   * @default ['http:', 'https:', 'mailto:', 'tel:']
   */
  protocols: string[];
}

// =============================================================================
// Plugin implementation
// =============================================================================

interface LinkPopoverPluginOptions {
  editor: Editor;
  markType: MarkType;
  protocols: string[];
}

const linkPopoverPluginKey = new PluginKey('linkPopover');

function linkPopoverPlugin({ editor, markType, protocols }: LinkPopoverPluginOptions): Plugin {
  // Build DOM elements
  const el = document.createElement('div');
  el.className = 'dm-link-popover';
  el.setAttribute('data-dm-editor-ui', '');
  el.style.display = 'none';

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
  let cleanupFloating: (() => void) | null = null;
  let toggleAnchor: HTMLElement | null = null;

  /** Write isOpen state to the Link mark's storage for toolbar expanded state */
  const setLinkStorageOpen = (value: boolean): void => {
    const linkStorage = editor.storage['link'] as Record<string, unknown> | undefined;
    if (linkStorage) linkStorage['isOpen'] = value;
  };

  const show = (anchorElement?: HTMLElement): void => {
    toggleAnchor = anchorElement ?? null;
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

    el.style.display = '';
    el.setAttribute('data-show', '');
    isOpen = true;
    setLinkStorageOpen(true);

    // Show a visual decoration on the selected range while the popover is
    // open. The browser removes native selection highlight when the input
    // takes focus, so we render our own via ProseMirror DecorationSet.
    // Dispatch AFTER setting storage['isOpen'] so the toolbar transaction
    // handler sees the updated value.
    if (!empty) {
      const { to } = state.selection;
      editor.view.dispatch(state.tr.setMeta(linkPopoverPluginKey, { from, to }));
    } else {
      // No decoration needed but still trigger toolbar active-state refresh
      editor.view.dispatch(editor.view.state.tr);
    }

    // Position below the anchor element (toolbar/bubble-menu button) or cursor
    const reference: Element | { getBoundingClientRect: () => DOMRect } = anchorElement ?? {
      getBoundingClientRect: () => {
        const coords = editor.view.coordsAtPos(from);
        return new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top);
      },
    };

    cleanupFloating?.();
    cleanupFloating = positionFloating(reference, el, {
      placement: 'bottom',
      offsetValue: 4,
    });

    input.focus();
    input.select();
  };

  const hide = (): void => {
    if (!isOpen) return;
    toggleAnchor = null;
    cleanupFloating?.();
    cleanupFloating = null;
    el.removeAttribute('data-show');
    el.style.display = 'none';
    isOpen = false;
    setLinkStorageOpen(false);
    // Clear pending-link decoration — dispatch AFTER setting storage['isOpen']
    // so the toolbar transaction handler sees the updated value.
    editor.view.dispatch(editor.view.state.tr.setMeta(linkPopoverPluginKey, null));
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

    // If cursor is on existing link with no selection, select the full link range
    // and apply the mark in a single transaction to avoid visual flash
    const { state } = editor.view;
    const { from, empty } = state.selection;

    if (empty && hasExistingLink) {
      const $pos = state.doc.resolve(from);
      const range = getMarkRange($pos, markType);
      if (range) {
        const tr = state.tr
          .setSelection(TextSelection.create(state.doc, range.from, range.to))
          .addMark(range.from, range.to, markType.create({ href }));
        editor.view.dispatch(tr);
        hide();
        editor.view.focus();
        return;
      }
    }

    editor.commands.setLink({ href });
    hide();
    editor.view.focus();
  };

  const removeLink = (): void => {
    editor.commands.unsetLink();
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
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        (hasExistingLink ? removeBtn : applyBtn).focus();
      } else {
        applyBtn.focus();
      }
    }
  };

  const onButtonKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      hide();
      editor.view.focus();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const target = e.target as HTMLElement;
      if (e.shiftKey) {
        if (target === applyBtn) {
          input.focus();
        } else {
          applyBtn.focus();
        }
      } else {
        if (target === applyBtn && hasExistingLink) {
          removeBtn.focus();
        } else {
          input.focus();
        }
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      (e.target as HTMLElement).click();
    }
  };

  const onClickOutside = (e: MouseEvent): void => {
    if (!isOpen || el.contains(e.target as Node)) return;
    // Skip if clicking the toolbar button that toggles this popover —
    // the button's click handler will fire onLinkEdit to toggle.
    if (toggleAnchor && (toggleAnchor === e.target || toggleAnchor.contains(e.target as Node))) return;
    hide();
  };

  const onPreventBlur = (e: MouseEvent): void => {
    e.preventDefault();
  };

  return new Plugin({
    key: linkPopoverPluginKey,

    state: {
      init() {
        return DecorationSet.empty;
      },
      apply(tr, decorations) {
        const meta = tr.getMeta(linkPopoverPluginKey) as { from: number; to: number } | null | undefined;
        if (meta === null) return DecorationSet.empty;
        if (meta) {
          return DecorationSet.create(tr.doc, [
            Decoration.inline(meta.from, meta.to, { class: 'dm-link-pending' }),
          ]);
        }
        return decorations.map(tr.mapping, tr.doc);
      },
    },

    props: {
      decorations(state) {
        return linkPopoverPluginKey.getState(state) as DecorationSet;
      },
    },

    view: () => {
      // Append to document.body so it's not clipped by .dm-editor overflow:hidden
      document.body.appendChild(el);

      // Register all event listeners here — ProseMirror calls destroy()/view()
      // on plugin view rebuilds, so listeners must be re-attached each time.
      input.addEventListener('keydown', onInputKeydown);
      applyBtn.addEventListener('mousedown', onPreventBlur);
      applyBtn.addEventListener('click', applyLink);
      applyBtn.addEventListener('keydown', onButtonKeydown);
      removeBtn.addEventListener('mousedown', onPreventBlur);
      removeBtn.addEventListener('click', removeLink);
      removeBtn.addEventListener('keydown', onButtonKeydown);
      document.addEventListener('mousedown', onClickOutside);
      editor.on('linkEdit', onLinkEdit);

      return {
        destroy: () => {
          hide();
          input.removeEventListener('keydown', onInputKeydown);
          applyBtn.removeEventListener('mousedown', onPreventBlur);
          applyBtn.removeEventListener('click', applyLink);
          applyBtn.removeEventListener('keydown', onButtonKeydown);
          removeBtn.removeEventListener('mousedown', onPreventBlur);
          removeBtn.removeEventListener('click', removeLink);
          removeBtn.removeEventListener('keydown', onButtonKeydown);
          document.removeEventListener('mousedown', onClickOutside);
          editor.off('linkEdit', onLinkEdit);
          el.remove();
        },
      };
    },
  });
}

// =============================================================================
// Extension
// =============================================================================

export const LinkPopover = Extension.create<LinkPopoverOptions>({
  name: 'linkPopover',

  dependencies: ['link'],

  addOptions() {
    return {
      protocols: ['http:', 'https:', 'mailto:', 'tel:'],
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor as unknown as Editor;
    const markType = editor.schema.marks['link'];
    if (!markType) return [];

    return [
      linkPopoverPlugin({
        editor,
        markType,
        protocols: this.options.protocols,
      }),
    ];
  },
});
