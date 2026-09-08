/**
 * LinkPopover Extension
 *
 * Provides a floating URL input popover for editing links.
 * This is a UI extension - it creates DOM elements and should only be used
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
import type { Mark as PMMark, MarkType } from '@domternal/pm/model';
import { Decoration, DecorationSet } from '@domternal/pm/view';
import { Extension } from '../Extension.js';
import { checkUrl, cleanUrl, normalizeUrlProtocol } from '../helpers/checkUrl.js';
import { linkUrlPolicy, protocolScheme } from '../marks/Link.js';
import { ExtensionConfigurationError } from '../ExtensionConfigurationError.js';
import { getExactMarkRange } from '../helpers/getMarkRange.js';
import { isSupportedAttributeValue } from '../utils/normalizedAttributes.js';
import { defaultIcons } from '../icons/index.js';
import { positionFloating } from '../utils/positionFloating.js';
import { copyThemeClass } from '../utils/copyThemeClass.js';
import type { Editor } from '../Editor.js';
import { coreMessages } from '../messages/core.js';

export interface LinkPopoverOptions {
  /**
   * Schemes the popover accepts, narrowing the Link's own policy, such as
   * `['https:']` to offer only web links in the popover. `null` accepts every
   * address the Link accepts. Relative references follow the Link's
   * `allowRelative` either way.
   * @default null
   */
  protocols: string[] | null;
}

interface LinkPopoverPluginOptions {
  editor: Editor;
  markType: MarkType;
  protocols: string[] | null;
}

/** A relative reference as typed: a fragment, a path, a dot path or a query. */
const RELATIVE_INPUT = /^(?:#|\/(?!\/)|\.\.?\/|\?)/;
/** Every address that can run no script and hides nothing: the floor under any link mark. */
const SCRIPT_FLOOR = { protocols: 'any', allowRelative: true, allowNetworkPath: true } as const;
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/**
 * The address a typed value stands for. A relative reference stays as typed,
 * a network path and a bare host get the Link's default protocol, a bare
 * email address becomes a `mailto:` link, and anything with a scheme stays as
 * typed, except a host and port such as `localhost:3000`.
 */
function addressFor(value: string, defaultProtocol: string): string {
  if (RELATIVE_INPUT.test(value)) return value;
  if (value.startsWith('//')) return `${defaultProtocol}:${value}`;
  const scheme = SCHEME.exec(value)?.[1];
  const hostAndPort = scheme !== undefined && /^[^:]+:\d+(?:[/?#]|$)/.test(value)
    && (scheme.includes('.') || scheme.toLowerCase() === 'localhost');
  if (scheme !== undefined && !hostAndPort) return value;
  if (/^[^\s@/:]+@[^\s@/:]+$/.test(value)) return `mailto:${value}`;
  return `${defaultProtocol}://${value}`;
}

const linkPopoverPluginKey = new PluginKey('linkPopover');

/**
 * The popover's own schemes, read the way the Link reads its `protocols`, or
 * null to accept every scheme the Link accepts. A value that names no scheme
 * fails editor creation, as it does for the Link.
 */
function narrowingSchemes(protocols: unknown): string[] | null {
  if (protocols === undefined || protocols === null) return null;
  if (!Array.isArray(protocols)) {
    throw new ExtensionConfigurationError("LinkPopover: protocols must be null or a list of schemes, such as ['https:']");
  }
  return (protocols as unknown[]).map(entry => {
    const scheme = protocolScheme(entry);
    if (scheme === null) {
      throw new ExtensionConfigurationError(`LinkPopover: protocols entry ${JSON.stringify(entry)} is not a URL scheme`);
    }
    return scheme;
  });
}

function linkPopoverPlugin({ editor, markType, protocols }: LinkPopoverPluginOptions): Plugin {
  const narrowed = narrowingSchemes(protocols);
  const linkOptions = editor.extensionManager.extensions.find(extension => extension.name === markType.name)?.options as
    { defaultProtocol?: unknown } | undefined;
  const defaultProtocol = typeof linkOptions?.defaultProtocol === 'string' && /^[a-z][a-z0-9+.-]*$/i.test(linkOptions.defaultProtocol)
    ? linkOptions.defaultProtocol
    : 'https';

  const policy = linkUrlPolicy(linkOptions);

  /**
   * Whether the Link stores this address: its URL policy, as loading JSON
   * content applies it, the policy of its options again, which holds when an
   * extension redefines the href attribute, no script address for a custom
   * link mark, and the popover's own scheme list when one narrows it.
   */
  const accepts = (href: string): boolean => {
    if (!isSupportedAttributeValue(editor.schema, markType.name, 'href', href)) return false;
    if (policy !== null && checkUrl(href, policy).status !== 'allowed') return false;
    if (checkUrl(href, SCRIPT_FLOOR).status === 'unsafe') return false;
    const scheme = SCHEME.exec(href)?.[1];
    return narrowed === null || scheme === undefined || narrowed.includes(normalizeUrlProtocol(scheme));
  };

  // Build DOM elements
  const el = document.createElement('div');
  el.className = 'dm-link-popover';
  el.setAttribute('data-dm-editor-ui', '');
  el.style.display = 'none';

  const input = document.createElement('input');
  input.type = 'url';
  input.className = 'dm-link-popover-input';

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'dm-link-popover-btn dm-link-popover-apply';
  applyBtn.innerHTML = defaultIcons['check'] ?? '';

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'dm-link-popover-btn dm-link-popover-remove';
  removeBtn.innerHTML = defaultIcons['linkBreak'] ?? '';

  const updateLabels = (): void => {
    const url = editor.i18n.resolve(coreMessages.linkUrlLabel);
    const apply = editor.i18n.resolve(coreMessages.linkApply);
    const remove = editor.i18n.resolve(coreMessages.linkRemove);
    el.lang = editor.i18n.getSnapshot().locale;
    input.placeholder = editor.i18n.t(coreMessages.linkUrlPlaceholder);
    input.setAttribute('aria-label', url.text);
    input.lang = url.language;
    applyBtn.title = apply.text;
    applyBtn.setAttribute('aria-label', apply.text);
    applyBtn.lang = apply.language;
    removeBtn.title = remove.text;
    removeBtn.setAttribute('aria-label', remove.text);
    removeBtn.lang = remove.language;
  };

  el.appendChild(input);
  el.appendChild(applyBtn);
  el.appendChild(removeBtn);

  /** Marks the input invalid with a localized reason, which the browser announces with the field. */
  const markInvalid = (report: boolean): void => {
    input.setAttribute('aria-invalid', 'true');
    input.setCustomValidity(editor.i18n.t(coreMessages.linkInvalidUrl));
    if (report) input.reportValidity();
  };
  const clearInvalid = (): void => {
    input.removeAttribute('aria-invalid');
    input.setCustomValidity('');
  };

  let isOpen = false;
  let hasExistingLink = false;
  let existingMark: PMMark | null = null;
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
    let linkMark: PMMark | null = null;

    if (empty) {
      linkMark = state.doc.resolve(from).marks().find(mark => mark.type === markType) ?? null;
    } else {
      // Check marks in selection
      const { to } = state.selection;
      state.doc.nodesBetween(from, to, (node) => {
        if (linkMark) return false;
        linkMark = node.marks.find(mark => mark.type === markType) ?? null;
        return true;
      });
    }

    existingMark = linkMark;
    hasExistingLink = linkMark !== null;
    const existingHref: unknown = existingMark?.attrs['href'];
    // Only a string can be shown; a stored value that is not one, or that the
    // Link would not keep, opens marked invalid so Apply cannot store it again.
    input.value = typeof existingHref === 'string' ? existingHref : '';
    clearInvalid();
    if (hasExistingLink && !(typeof existingHref === 'string' && accepts(existingHref))) markInvalid(false);
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

    // When the popover was triggered from a bubble-menu / toolbar button
    // (anchor present), reparent into the editor wrapper so it inherits
    // `.dm-editor` CSS custom properties and aligns visually with the
    // anchor button - mirrors NotionColorPicker. Without an anchor (Mod-K
    // shortcut path) keep the popover in document.body to avoid
    // overflow-clip from the editor wrapper.
    if (anchorElement) {
      const editorEl = anchorElement.closest<HTMLElement>('.dm-editor');
      if (editorEl && el.parentElement !== editorEl) {
        editorEl.appendChild(el);
      }
    } else if (el.parentElement !== document.body) {
      document.body.appendChild(el);
    }
    // Refresh on every show so runtime theme toggles propagate. Reparenting
    // back into .dm-editor (anchor path) does not need this since the editor's
    // own classes cascade, but the body-portaled path otherwise misses
    // the `dm-theme-dark` token cascade.
    copyThemeClass(editor.view, el);

    cleanupFloating?.();
    cleanupFloating = positionFloating(reference, el, {
      placement: anchorElement ? 'bottom-start' : 'bottom',
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
    // Clear pending-link decoration - dispatch AFTER setting storage['isOpen']
    // so the toolbar transaction handler sees the updated value.
    editor.view.dispatch(editor.view.state.tr.setMeta(linkPopoverPluginKey, null));
    input.value = '';
    clearInvalid();
    existingMark = null;
  };

  const applyLink = (): void => {
    const value = input.value.trim();
    if (!value) {
      hide();
      editor.view.focus();
      return;
    }

    // A refused address keeps the popover open with the reason, so the
    // typed value is never lost silently.
    const href = cleanUrl(addressFor(value, defaultProtocol));
    if (!accepts(href)) {
      markInvalid(true);
      input.focus();
      return;
    }

    // If cursor is on existing link with no selection, select the full link range
    // and apply the mark in a single transaction to avoid visual flash. Only
    // the href changes: the title, target, rel and class stay.
    const { state } = editor.view;
    const { from, empty } = state.selection;

    if (empty && hasExistingLink && existingMark) {
      // The node beside the cursor that carries the shown link, never an adjacent one.
      const $pos = state.doc.resolve(from);
      const after = $pos.parent.childAfter($pos.parentOffset);
      const before = $pos.parent.childBefore($pos.parentOffset);
      const holder = after.node && existingMark.isInSet(after.node.marks) ? after
        : before.node && existingMark.isInSet(before.node.marks) ? before : null;
      if (holder) {
        const range = getExactMarkRange(state.doc, $pos.start() + holder.offset, existingMark);
        const tr = state.tr
          .setSelection(TextSelection.create(state.doc, range.from, range.to))
          .removeMark(range.from, range.to, markType)
          .addMark(range.from, range.to, markType.create({ ...existingMark.attrs, href }));
        editor.view.dispatch(tr);
        hide();
        editor.view.focus();
        return;
      }
    }

    // setLink keeps each linked node's other attributes and stores the href
    // only when the Link's URL policy allows it, as checked above.
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
    // Skip if clicking the toolbar button that toggles this popover -
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
      updateLabels();
      const unsubscribeI18n = editor.i18n.subscribe(updateLabels);
      // Append to document.body so it's not clipped by .dm-editor overflow:hidden
      document.body.appendChild(el);

      // Register all event listeners here - ProseMirror calls destroy()/view()
      // on plugin view rebuilds, so listeners must be re-attached each time.
      input.addEventListener('keydown', onInputKeydown);
      input.addEventListener('input', clearInvalid);
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
          unsubscribeI18n();
          hide();
          input.removeEventListener('keydown', onInputKeydown);
          input.removeEventListener('input', clearInvalid);
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

export const LinkPopover = Extension.create<LinkPopoverOptions>({
  name: 'linkPopover',

  dependencies: ['link'],

  addOptions() {
    return {
      protocols: null,
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
