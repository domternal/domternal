/**
 * useNotionColorPicker
 *
 * State and effect plumbing for the Notion-style inline color picker. Listens
 * for the `notionColorOpen` event emitted by the bubble menu's "A" trigger,
 * tracks the active text/background tokens, and exposes the imperative
 * commands consumers need (`applyText`, `applyBg`, `close`).
 *
 * The default component (`DomternalNotionColorPicker`) consumes this composable
 * and renders the panel via `<Teleport>`. Consumers building custom UIs can
 * call this composable directly.
 */
import { ref, shallowRef, watch } from 'vue';
import type { Ref, ShallowRef } from 'vue';
import type { Editor } from '@domternal/core';

interface NotionColorPickerStorage {
  isOpen: boolean;
}

interface NotionColorPickerExtensionOptions {
  palette?: readonly string[];
}

interface NotionColorOpenDetail {
  anchorElement?: HTMLElement;
}

/**
 * Display labels for the named-token palette. Used in tooltips / aria labels;
 * unknown tokens fall back to a title-cased version of the raw key.
 */
const TOKEN_LABELS: Record<string, string> = {
  gray: 'Gray',
  brown: 'Brown',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  pink: 'Pink',
  red: 'Red',
};

export interface UseNotionColorPickerOptions {
  editor: ShallowRef<Editor | null>;
}

export interface UseNotionColorPickerResult {
  /** Whether the picker panel is currently open. */
  isOpen: Ref<boolean>;
  /** Editor host element (`.dm-editor`) used as the Teleport target. Null until the editor is ready. */
  hostEl: ShallowRef<HTMLElement | null>;
  /** Anchor element the picker positions against (the bubble-menu "A" trigger button). */
  anchorEl: ShallowRef<HTMLElement | null>;
  /** Ref to the panel root, used by the picker UI for positioning + focus management. */
  panelRef: Ref<HTMLDivElement | undefined>;
  /** Currently applied text token at the cursor, or null when default. */
  currentTextToken: Ref<string | null>;
  /** Currently applied background token at the cursor, or null when default. */
  currentBgToken: Ref<string | null>;
  /** Named-token palette (read from the NotionColorPicker extension options). */
  palette: ShallowRef<readonly string[]>;
  /** Apply a text color token to the current selection. Picker stays open. */
  applyText: (token: string | null) => void;
  /** Apply a background color token to the current selection. Picker stays open. */
  applyBg: (token: string | null) => void;
  /** Close the picker. When `refocus` is true, returns focus to the editor view. */
  close: (opts?: { refocus?: boolean }) => void;
  /** Display label for a palette token (defaults to title-case fallback). */
  tokenLabel: (token: string) => string;
  /** Arrow / Home / End keyboard navigation across the 5-column swatch grid. */
  onPanelKeydown: (event: KeyboardEvent) => void;
}

export function useNotionColorPicker(
  options: UseNotionColorPickerOptions,
): UseNotionColorPickerResult {
  const { editor } = options;

  const isOpen = ref(false);
  const anchorEl = shallowRef<HTMLElement | null>(null);
  const hostEl = shallowRef<HTMLElement | null>(null);
  const panelRef = ref<HTMLDivElement>();
  const currentTextToken = ref<string | null>(null);
  const currentBgToken = ref<string | null>(null);
  const palette = shallowRef<readonly string[]>([]);

  const setStorageOpen = (open: boolean): void => {
    const ed = editor.value;
    if (!ed) return;
    const slot = ed.storage['notionColorPicker'];
    if (slot && typeof slot === 'object') {
      (slot as NotionColorPickerStorage).isOpen = open;
    }
  };

  /**
   * Inspect the current selection and update active-state indicators. Reads
   * stored marks at empty cursor; walks text nodes for non-empty selections
   * (since `$from.nodeAfter` can land on a block at boundary positions).
   */
  const syncFromSelection = (): void => {
    const ed = editor.value;
    if (!ed) return;
    const { selection } = ed.state;

    let mark: { attrs: Record<string, unknown> } | null = null;
    if (selection.empty) {
      mark = selection.$from.marks().find((m) => m.type.name === 'textStyle') ?? null;
    } else {
      ed.state.doc.nodesBetween(selection.from, selection.to, (node) => {
        if (mark) return false;
        if (node.isText) {
          const found = node.marks.find((m) => m.type.name === 'textStyle');
          if (found) mark = found;
        }
        return true;
      });
    }

    const attrs = (mark?.attrs ?? {}) as { colorToken?: string | null; backgroundColorToken?: string | null };
    currentTextToken.value = attrs.colorToken ?? null;
    currentBgToken.value = attrs.backgroundColorToken ?? null;
  };

  const close = (opts: { refocus?: boolean } = {}): void => {
    if (!isOpen.value) return;
    isOpen.value = false;
    setStorageOpen(false);
    if (opts.refocus) {
      // Focus the editor view, not the trigger button: trigger focus would
      // leave the user without a caret.
      editor.value?.view.focus();
    }
    anchorEl.value = null;
  };

  // Editor-scoped subscription: open event + selection updates. Re-attaches
  // when the editor reference changes (i.e. HMR / route remount).
  watch(
    editor,
    (ed, _oldEd, onCleanup) => {
      if (!ed || ed.isDestroyed) return;

      // Cache the `.dm-editor` host once per editor instance (it doesn't move).
      hostEl.value = ed.view.dom.closest<HTMLElement>('.dm-editor');

      // Read palette from the extension options. Extension list is immutable
      // after editor construction, so this only runs once per editor.
      const ext = ed.extensionManager.extensions.find((e) => e.name === 'notionColorPicker');
      const extOptions = (ext?.options ?? null) as NotionColorPickerExtensionOptions | null;
      palette.value = extOptions?.palette ? [...extOptions.palette] : [];

      const onOpen = (...args: unknown[]): void => {
        const detail = args[0] as NotionColorOpenDetail | undefined;
        const incomingAnchor = detail?.anchorElement;
        if (!incomingAnchor) return;
        // Toggle: clicking the same anchor while open closes the picker.
        if (isOpen.value && anchorEl.value === incomingAnchor) {
          close({ refocus: true });
          return;
        }
        anchorEl.value = incomingAnchor;
        syncFromSelection();
        isOpen.value = true;
        setStorageOpen(true);
      };

      const onSelectionUpdate = (): void => {
        if (!isOpen.value) return;
        // Anchor vanished (bubble menu hidden by selection becoming empty,
        // or by any other reason). Close defensively.
        if (!anchorEl.value?.isConnected) {
          close();
          return;
        }
        if (ed.state.selection.empty) {
          close();
        } else {
          // Selection changed but stays non-empty (e.g. shift+arrow). Refresh
          // active-state indicators against the new mark set.
          syncFromSelection();
        }
      };

      (ed.on as (e: string, h: (...args: unknown[]) => void) => void)('notionColorOpen', onOpen);
      (ed.on as (e: string, h: () => void) => void)('selectionUpdate', onSelectionUpdate);

      onCleanup(() => {
        (ed.off as (e: string, h: (...args: unknown[]) => void) => void)('notionColorOpen', onOpen);
        (ed.off as (e: string, h: () => void) => void)('selectionUpdate', onSelectionUpdate);
        // Only flip storage when the picker was actually open. Unconditional
        // reset would race a dev-mode double-mount: the first mount's
        // cleanup would clobber an `isOpen=true` set by the second mount's
        // open handler that landed between teardown and re-mount.
        if (isOpen.value) setStorageOpen(false);
      });
    },
    { immediate: true },
  );

  // Document-level listeners (outside-click + Escape) scoped to the open
  // window via a single AbortController.
  watch(isOpen, (open, _old, onCleanup) => {
    if (!open) return;
    const controller = new AbortController();
    const { signal } = controller;

    document.addEventListener('mousedown', (e: MouseEvent) => {
      // No redundant `isOpen` guard: this effect only runs when `isOpen === true`
      // and the AbortController detaches the listener as soon as it flips false.
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.value?.contains(target)) return;
      if (anchorEl.value?.contains(target)) return;
      close({ refocus: false });
    }, { signal });

    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen.value) {
        e.preventDefault();
        close({ refocus: true });
      }
    }, { signal });

    onCleanup(() => { controller.abort(); });
  });

  const applyText = (token: string | null): void => {
    const ed = editor.value;
    if (!ed) return;
    (ed.commands as unknown as { setTextColorToken: (t: string | null) => boolean })
      .setTextColorToken(token);
    syncFromSelection();
  };

  const applyBg = (token: string | null): void => {
    const ed = editor.value;
    if (!ed) return;
    (ed.commands as unknown as { setBackgroundColorToken: (t: string | null) => boolean })
      .setBackgroundColorToken(token);
    syncFromSelection();
  };

  const tokenLabel = (token: string): string => {
    return TOKEN_LABELS[token] ?? token.charAt(0).toUpperCase() + token.slice(1);
  };

  /**
   * Arrow / Home / End nav across the 5-column swatch grid. Sequential focus
   * walks both Text and Background sections so keyboard users can reach any
   * swatch without re-grabbing Tab.
   */
  const onPanelKeydown = (event: KeyboardEvent): void => {
    const cols = 5;
    const root = panelRef.value;
    if (!root) return;
    const swatches = Array.from(
      root.querySelectorAll<HTMLElement>('.dm-ncp-swatch'),
    );
    if (!swatches.length) return;

    const active = document.activeElement as HTMLElement | null;
    const idx = active ? swatches.indexOf(active) : -1;
    if (idx === -1) return;

    let next = idx;
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        next = Math.min(idx + 1, swatches.length - 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        next = Math.max(idx - 1, 0);
        break;
      case 'ArrowDown':
        event.preventDefault();
        next = Math.min(idx + cols, swatches.length - 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        next = Math.max(idx - cols, 0);
        break;
      case 'Home':
        event.preventDefault();
        next = 0;
        break;
      case 'End':
        event.preventDefault();
        next = swatches.length - 1;
        break;
      default:
        return;
    }
    swatches[next]?.focus();
  };

  return {
    isOpen,
    hostEl,
    anchorEl,
    panelRef,
    currentTextToken,
    currentBgToken,
    palette,
    applyText,
    applyBg,
    close,
    tokenLabel,
    onPanelKeydown,
  };
}
