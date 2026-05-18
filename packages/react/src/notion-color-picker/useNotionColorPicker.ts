/**
 * useNotionColorPicker
 *
 * State and effect plumbing for the Notion-style inline color picker. Listens
 * for the `notionColorOpen` event emitted by the bubble menu's "A" trigger,
 * tracks the active text/background tokens, and exposes the imperative
 * commands consumers need (`applyText`, `applyBg`, `close`).
 *
 * The default component (`DomternalNotionColorPicker`) consumes this hook and
 * renders the panel via `createPortal`. Consumers building custom UIs can
 * call this hook directly.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
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
  editor: Editor | null;
}

export interface UseNotionColorPickerResult {
  /** Whether the picker panel is currently open. */
  isOpen: boolean;
  /** Editor host element (`.dm-editor`) used as the portal target. Null until the editor is ready. */
  hostEl: HTMLElement | null;
  /** Anchor element the picker positions against (the bubble-menu "A" trigger button). */
  anchorEl: HTMLElement | null;
  /** Ref to the panel root, used by the picker UI for positioning + focus management. */
  panelRef: RefObject<HTMLDivElement | null>;
  /** Currently applied text token at the cursor, or null when default. */
  currentTextToken: string | null;
  /** Currently applied background token at the cursor, or null when default. */
  currentBgToken: string | null;
  /** Named-token palette (read from the NotionColorPicker extension options). */
  palette: readonly string[];
  /** Apply a text color token to the current selection. Picker stays open. */
  applyText: (token: string | null) => void;
  /** Apply a background color token to the current selection. Picker stays open. */
  applyBg: (token: string | null) => void;
  /** Close the picker. When `refocus` is true, returns focus to the anchor button. */
  close: (opts?: { refocus?: boolean }) => void;
  /** Display label for a palette token (defaults to title-case fallback). */
  tokenLabel: (token: string) => string;
  /** Arrow / Home / End keyboard navigation across the 5-column swatch grid. */
  onPanelKeydown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
}

export function useNotionColorPicker(
  options: UseNotionColorPickerOptions,
): UseNotionColorPickerResult {
  const { editor } = options;

  const [isOpen, setIsOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [hostEl, setHostEl] = useState<HTMLElement | null>(null);
  const [currentTextToken, setCurrentTextToken] = useState<string | null>(null);
  const [currentBgToken, setCurrentBgToken] = useState<string | null>(null);
  const [palette, setPalette] = useState<readonly string[]>([]);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const isOpenRef = useRef(false);
  isOpenRef.current = isOpen;
  // Avoid stale-closure reads of the editor inside long-lived callbacks
  // returned to the consumer. The big `[editor]` effect already handles
  // listener re-attachment; this ref is for the apply/close commands.
  // The mutation lives in an effect so React concurrent rendering can
  // discard a render without leaking ref state.
  const editorRef = useRef<Editor | null>(editor);
  useEffect(() => { editorRef.current = editor; }, [editor]);
  const anchorRef = useRef<HTMLElement | null>(null);
  anchorRef.current = anchorEl;

  const setStorageOpen = useCallback((open: boolean): void => {
    const ed = editorRef.current;
    if (!ed) return;
    const slot = ed.storage['notionColorPicker'];
    if (slot && typeof slot === 'object') {
      (slot as NotionColorPickerStorage).isOpen = open;
    }
  }, []);

  /**
   * Inspect the current selection and update active-state indicators. Reads
   * stored marks at empty cursor; walks text nodes for non-empty selections
   * (since `$from.nodeAfter` can land on a block at boundary positions).
   */
  const syncFromSelection = useCallback((): void => {
    const ed = editorRef.current;
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
    setCurrentTextToken(attrs.colorToken ?? null);
    setCurrentBgToken(attrs.backgroundColorToken ?? null);
  }, []);

  const close = useCallback((opts: { refocus?: boolean } = {}): void => {
    if (!isOpenRef.current) return;
    setIsOpen(false);
    setStorageOpen(false);
    if (opts.refocus) {
      // Focus the editor view, not the trigger button: trigger focus would
      // leave the user without a caret.
      editorRef.current?.view.focus();
    }
    setAnchorEl(null);
  }, [setStorageOpen]);

  // Editor-scoped subscription: open event + selection updates. Re-attaches
  // when the editor reference changes (i.e. HMR / route remount).
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    // Cache the `.dm-editor` host once per editor instance (it doesn't move).
    const host = editor.view.dom.closest<HTMLElement>('.dm-editor') ?? null;
    setHostEl(host);

    // Read palette from the extension options. Extension list is immutable
    // after editor construction, so this only runs once per editor.
    const ext = editor.extensionManager.extensions.find((e) => e.name === 'notionColorPicker');
    const extOptions = (ext?.options ?? null) as NotionColorPickerExtensionOptions | null;
    setPalette(extOptions?.palette ? [...extOptions.palette] : []);

    const onOpen = (...args: unknown[]): void => {
      const detail = args[0] as NotionColorOpenDetail | undefined;
      const incomingAnchor = detail?.anchorElement;
      if (!incomingAnchor) return;
      // Toggle: clicking the same anchor while open closes the picker.
      if (isOpenRef.current && anchorRef.current === incomingAnchor) {
        close({ refocus: true });
        return;
      }
      setAnchorEl(incomingAnchor);
      syncFromSelection();
      setIsOpen(true);
      setStorageOpen(true);
    };

    const onSelectionUpdate = (): void => {
      if (!isOpenRef.current) return;
      // Anchor vanished (bubble menu hidden by selection becoming empty,
      // or by any other reason). Close defensively.
      if (!anchorRef.current?.isConnected) {
        close();
        return;
      }
      if (editor.state.selection.empty) {
        close();
      } else {
        // Selection changed but stays non-empty (e.g. shift+arrow). Refresh
        // active-state indicators against the new mark set.
        syncFromSelection();
      }
    };

    // Editor event API is not AbortSignal-aware; explicit off in cleanup.
    editor.on('notionColorOpen', onOpen);
    editor.on('selectionUpdate', onSelectionUpdate);

    return () => {
      editor.off('notionColorOpen', onOpen);
      editor.off('selectionUpdate', onSelectionUpdate);
      // Only flip storage when the picker was actually open. Unconditional
      // reset would race a StrictMode double-mount: the first mount's
      // cleanup would clobber an `isOpen=true` set by the second mount's
      // open handler that landed between teardown and re-mount.
      if (isOpenRef.current) setStorageOpen(false);
    };
  }, [editor, close, syncFromSelection, setStorageOpen]);

  // Document-level listeners (outside-click + Escape) scoped to the open
  // window via a single AbortController.
  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    const { signal } = controller;

    document.addEventListener('mousedown', (e: MouseEvent) => {
      // No redundant `isOpen` guard: this effect only runs when `isOpen === true`
      // and the AbortController detaches the listener as soon as it flips false.
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      close({ refocus: false });
    }, { signal });

    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpenRef.current) {
        e.preventDefault();
        close({ refocus: true });
      }
    }, { signal });

    return () => { controller.abort(); };
  }, [isOpen, close]);

  const applyText = useCallback((token: string | null): void => {
    const ed = editorRef.current;
    if (!ed) return;
    (ed.commands as unknown as { setTextColorToken: (t: string | null) => boolean })
      .setTextColorToken(token);
    syncFromSelection();
  }, [syncFromSelection]);

  const applyBg = useCallback((token: string | null): void => {
    const ed = editorRef.current;
    if (!ed) return;
    (ed.commands as unknown as { setBackgroundColorToken: (t: string | null) => boolean })
      .setBackgroundColorToken(token);
    syncFromSelection();
  }, [syncFromSelection]);

  const tokenLabel = useCallback((token: string): string => {
    return TOKEN_LABELS[token] ?? token.charAt(0).toUpperCase() + token.slice(1);
  }, []);

  /**
   * Arrow / Home / End nav across the 5-column swatch grid. Sequential focus
   * walks both Text and Background sections so keyboard users can reach any
   * swatch without re-grabbing Tab.
   */
  const onPanelKeydown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const cols = 5;
    const root = panelRef.current;
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
  }, []);

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
