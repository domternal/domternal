/**
 * Print Extension
 *
 * Sends the document to the browser's own print dialog, which is also the
 * one place a reader can save a PDF that looks exactly like the editor:
 * the same engine paints both, so floats, columns and fonts survive
 * untouched. What it cannot do is hand a file back to code, so it
 * complements a file exporter rather than replacing one.
 *
 * The paper styling itself lives in `@domternal/theme` (`_print.scss`) and
 * applies to the reader's own Ctrl/Cmd+P with no code involved. This
 * extension adds the two things CSS cannot do on its own: a button, and
 * isolating the document from the host application's chrome.
 *
 * @example
 * ```ts
 * import { Print } from '@domternal/core';
 *
 * const editor = new Editor({ extensions: [Print] });
 * editor.commands.printDocument();
 * ```
 */
import { Extension } from '../Extension.js';
import type { CommandSpec } from '../types/Commands.js';
import type { ExtensionEditor } from '../types/ExtensionConfig.js';
import type { ToolbarItem } from '../types/Toolbar.js';

/** Marks the element whose subtree is the document being printed. */
const ROOT_CLASS = 'dm-print-root';
/** Marks every ancestor of the root, so their other children collapse. */
const ANCESTOR_CLASS = 'dm-print-ancestor';
/** Marks the body while a print is in progress; the stylesheet gates on it. */
const PRINTING_CLASS = 'dm-printing';

/**
 * Exactly what was marked, so unmarking cannot miss anything. A
 * `querySelectorAll` sweep cannot see inside a shadow root, which would
 * strand the marks on an editor mounted in one; keeping the references also
 * makes unmarking cheap and independent of the document's current shape.
 */
const marked = new Set<Element>();

/**
 * True between mark() and unmark(). `window.print()` fires the window's own
 * `beforeprint` event, so without this the native listener runs INSIDE a
 * command-driven print and announces a second `beforePrint` to everyone
 * subscribed. The pro export package saves `document.title` on that event,
 * and a second save captures the already-replaced title, so the restore
 * afterwards puts the wrong one back.
 */
let printing = false;

export interface PrintOptions {
  /** Show the toolbar button. @default true */
  toolbar: boolean;
  /**
   * Resolve the element to print. Defaults to the editor's `.dm-editor`
   * wrapper, falling back to the ProseMirror element itself.
   */
  root: ((editor: ExtensionEditor) => HTMLElement | null) | null;
  /**
   * Also isolate the document when the reader presses Ctrl/Cmd+P instead of
   * using the command.
   *
   * Off by default, and deliberately: isolating means erasing everything
   * else on the page. That is obviously right for an app that IS the
   * editor, and obviously wrong for an article with an editor embedded in
   * it, and only the host knows which one it is. With it off, a native
   * print still gets the whole paper stylesheet, just not the erasure.
   *
   * @default false
   */
  isolateNativePrint: boolean;
}

export interface PrintStorage {
  /** Removes the native print listeners; set only when they were attached. */
  cleanup: (() => void) | null;
}

export const Print = Extension.create<PrintOptions, PrintStorage>({
  name: 'print',

  addOptions(): PrintOptions {
    return {
      toolbar: true,
      root: null,
      isolateNativePrint: false,
    };
  },

  addStorage(): PrintStorage {
    return { cleanup: null };
  },

  addCommands() {
    return {
      printDocument:
        () =>
        ({ dispatch }) => {
          // No transaction: the document is not changing, it is being read
          // out. Guarding on `dispatch` keeps `can().printDocument()` from
          // opening a dialog, which is what keeps the button enabled.
          if (!dispatch) return true;
          const editor = this.editor;
          if (!editor || typeof window === 'undefined') return false;

          const root = resolveRoot(editor, this.options.root);
          if (!root) return false;

          mark(root);
          try {
            // Inside the try as well: a listener that throws would otherwise
            // leave the page marked, and a marked page is one where
            // everything except the editor is hidden.
            emit(editor, 'beforePrint', { root });
            window.print();
          } finally {
            unmark();
            emit(editor, 'afterPrint', undefined);
          }
          return true;
        },
    };
  },

  addToolbarItems(): ToolbarItem[] {
    if (!this.options.toolbar) return [];
    return [
      {
        type: 'button',
        name: 'print',
        command: 'printDocument',
        icon: 'printer',
        label: 'Print',
        shortcut: 'Mod-P',
        group: 'document',
        priority: 100,
        // Reading a document out to paper is not editing it, so the button
        // stays live in a read-only editor.
        allowReadOnly: true,
      },
    ];
  },

  addKeyboardShortcuts() {
    return {
      // Only bound while the caret is in the editor, which is exactly when
      // the reader means "print this document" rather than "print this
      // page". Everywhere else the browser's own Ctrl/Cmd+P is untouched.
      'Mod-p': () => this.editor?.commands.printDocument() ?? false,
    };
  },

  onCreate() {
    if (!this.options.isolateNativePrint) return;
    if (typeof window === 'undefined') return;

    const editor = this.editor;
    if (!editor) return;

    const resolve = this.options.root;
    const before = (): void => {
      // `window.print()` fires this same event, so a command-driven print
      // would otherwise announce itself twice and unmark once.
      if (printing) return;
      const root = resolveRoot(editor, resolve);
      if (!root) return;
      mark(root);
      emit(editor, 'beforePrint', { root });
    };
    const after = (): void => {
      if (!printing) return;
      unmark();
      emit(editor, 'afterPrint', undefined);
    };

    // The events first, since they are the path that matters and the one
    // every browser has. The print media query is a Safari backstop, and it
    // is attached defensively: jsdom has no `matchMedia` at all, and an
    // exception here would take the two listeners above down with it.
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);

    let detachMedia: (() => void) | null = null;
    const onMediaChange = (event: MediaQueryListEvent): void => {
      // Harmless alongside the events: marking and unmarking are idempotent.
      if (event.matches) before();
      else after();
    };
    if (typeof window.matchMedia === 'function') {
      const media = window.matchMedia('print');
      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', onMediaChange);
        detachMedia = (): void => {
          media.removeEventListener('change', onMediaChange);
        };
      }
    }

    this.storage.cleanup = (): void => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
      detachMedia?.();
    };
  },

  onDestroy() {
    this.storage.cleanup?.();
    this.storage.cleanup = null;
    unmark();
  },
});

declare module '@domternal/core' {
  interface RawCommands {
    printDocument: CommandSpec;
  }
}

function resolveRoot(
  editor: ExtensionEditor,
  resolve: ((editor: ExtensionEditor) => HTMLElement | null) | null
): HTMLElement | null {
  if (resolve) return resolve(editor);
  const dom = editor.view.dom;
  return dom.closest<HTMLElement>('.dm-editor') ?? dom;
}

/**
 * Marks the root and its ancestor chain. The stylesheet then hides every
 * other child of every ancestor, which collapses the host application away
 * at each level without this package ever knowing one of its class names.
 */
function mark(root: HTMLElement): void {
  root.classList.add(ROOT_CLASS);
  marked.add(root);
  // `parentElement` stops at a shadow boundary, so an editor inside a shadow
  // tree gets its host chain walked too; without it the marks stop short and
  // the isolation rules never reach the document's real ancestors.
  let node = parentOf(root);
  while (node) {
    node.classList.add(ANCESTOR_CLASS);
    marked.add(node);
    node = parentOf(node);
  }
  document.body.classList.add(PRINTING_CLASS);
  printing = true;
}

function parentOf(node: Element): HTMLElement | null {
  if (node.parentElement) return node.parentElement;
  if (typeof ShadowRoot === 'undefined') return null;
  const root = node.getRootNode();
  return root instanceof ShadowRoot ? (root.host as HTMLElement) : null;
}

function unmark(): void {
  printing = false;
  if (typeof document === 'undefined') return;
  document.body.classList.remove(PRINTING_CLASS);
  for (const el of marked) {
    el.classList.remove(ROOT_CLASS, ANCESTOR_CLASS);
  }
  marked.clear();
}

function emit(editor: ExtensionEditor, name: string, payload: unknown): void {
  const bus = editor as unknown as { emit?: (event: string, data: unknown) => void };
  bus.emit?.(name, payload);
}
