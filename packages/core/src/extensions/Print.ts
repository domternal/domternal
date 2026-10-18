import { coreMessages } from '../messages/core.js';
import { localizedLabel } from '../utils/localizeMessage.js';
import { localizedGroup } from '../messages/presentation.js';
/**
 * Print Extension
 *
 * Sends the document to the browser's own print dialog. The browser lays
 * out editor content with its print CSS, including the theme's paper rules.
 * A reader can save that layout as a PDF where the browser supports it;
 * the command itself cannot return a generated file to application code.
 *
 * The paper styling itself lives in `@domternal/theme` (`_print.scss`) and
 * applies to the reader's own Ctrl/Cmd+P with no code involved. This
 * extension adds a button, optional resource preparation, repeated table
 * header groups and isolation from the host application's chrome.
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
import { preparePrintTableHeaders } from './printTableHeaders.js';
import { waitForPrintResources } from './printResources.js';
import type { PrintPreparationResult, PrintResourceOptions } from './printResources.js';
export type { PrintPreparationResult, PrintResourceOptions } from './printResources.js';

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
let commandPrinting = false;
let printOwner: ExtensionEditor | null = null;
let printingDocument: Document | null = null;
const nativeTargets = new Set<ExtensionEditor>();
const preparations = new WeakMap<ExtensionEditor, AbortController>();

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
  /**
   * Wait for the live root's fonts and images before a command-driven print.
   * The command still returns a boolean indicating acceptance. Await
   * storage.print.preparation for completion, or listen for printPreparationError.
   * Native browser printing cannot wait for asynchronous preparation.
   * @default false
   */
  prepareResources?: boolean | PrintResourceOptions;
}

export interface PrintStorage {
  /** Removes the native print listeners; set only when they were attached. */
  cleanup: (() => void) | null;
  /** Completion of the last accepted asynchronous print, or null before the first request. */
  preparation?: Promise<PrintPreparationResult> | null;
}

export const Print = Extension.create<PrintOptions, PrintStorage>({
  name: 'print',

  addOptions(): PrintOptions {
    return {
      toolbar: true,
      root: null,
      isolateNativePrint: false,
      prepareResources: false,
    };
  },

  addStorage(): PrintStorage {
    return { cleanup: null, preparation: null };
  },

  addCommands() {
    return {
      printDocument:
        () =>
        ({ dispatch }) => {
          const editor = this.editor;
          if (editor && preparations.has(editor)) return false;
          // Dry runs preserve the existing synchronous command contract.
          if (!dispatch) return true;
          if (!editor || typeof window === 'undefined' || editor.view.isDestroyed) return false;
          const root = resolveRoot(editor, this.options.root);
          if (!root) return false;
          if (!this.options.prepareResources) return printNow(editor, root);
          if (!root.isConnected) return false;

          const controller = new AbortController();
          preparations.set(editor, controller);
          const options = this.options.prepareResources === true ? {} : this.options.prepareResources;
          this.storage.preparation = (async (): Promise<PrintPreparationResult> => {
            try {
              await waitForPrintResources(root, options, controller.signal);
              if (controller.signal.aborted || editor.view.isDestroyed || !root.isConnected || resolveRoot(editor, this.options.root) !== root) return { status: 'cancelled' };
              if (!printNow(editor, root)) return { status: 'cancelled' };
              return { status: 'printed' };
            } catch (cause) {
              if (controller.signal.aborted || editor.view.isDestroyed || !root.isConnected) return { status: 'cancelled' };
              const error = cause instanceof Error ? cause : new Error('Print preparation failed');
              // The completion promise always settles, even if an application error listener throws.
              try { emit(editor, 'printPreparationError', { root, error }); } catch { /* The original error remains the result. */ }
              return { status: 'failed', error };
            } finally {
              if (preparations.get(editor) === controller) preparations.delete(editor);
            }
          })();
          return true;
        },
      cancelPrintPreparation: () => ({ dispatch }) => {
        const controller = this.editor ? preparations.get(this.editor) : undefined;
        if (!controller) return false;
        if (dispatch) controller.abort();
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
        ...localizedLabel(this.editor?.i18n, coreMessages.print),
        shortcut: 'Mod-P',
        group: 'document',
        ...localizedGroup(this.editor?.i18n, coreMessages.groupDocument),
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
    if (typeof window === 'undefined') return;
    const editor = this.editor;
    if (!editor) return;
    const hostWindow = editor.view.dom.ownerDocument.defaultView;
    if (!hostWindow) return;
    nativeTargets.add(editor);
    let restoreHeaders: (() => void) | null = null;
    const resolve = this.options.root;
    const before = (): void => {
      // `window.print()` fires this same event, so a command-driven print
      // would otherwise announce itself twice and unmark once.
      if (printing) return;
      const root = resolveRoot(editor, resolve);
      if (!root) return;
      restoreHeaders?.();
      const restoreCurrentHeaders = preparePrintTableHeaders(root);
      restoreHeaders = restoreCurrentHeaders;
      if (!this.options.isolateNativePrint) return;
      const focused = Array.from(nativeTargets).find(candidate => !candidate.view.isDestroyed
        && candidate.view.dom.ownerDocument === root.ownerDocument && candidate.view.hasFocus());
      if (focused && focused !== editor) return;
      mark(root, editor);
      try { emit(editor, 'beforePrint', { root }); }
      catch (error) {
        restoreCurrentHeaders(); restoreHeaders = null; unmark();
        try { emit(editor, 'afterPrint', undefined); } catch { /* Preserve the original beforePrint failure. */ }
        throw error;
      }
    };
    const after = (): void => {
      restoreHeaders?.(); restoreHeaders = null;
      if (!printing || printOwner !== editor || commandPrinting) return;
      unmark();
      emit(editor, 'afterPrint', undefined);
    };

    // A queued print-media entry can arrive after the native dialog has already
    // closed. It must not recreate headers or isolation until the next cycle.
    let nativePrintClosed = false;
    const beforeNative = (): void => { nativePrintClosed = false; before(); };
    const afterNative = (): void => { nativePrintClosed = true; after(); };

    // The events first, since they are the path that matters and the one
    // every browser has. The print media query is a Safari backstop, and it
    // is attached defensively: jsdom has no `matchMedia` at all, and an
    // exception here would take the two listeners above down with it.
    hostWindow.addEventListener('beforeprint', beforeNative);
    hostWindow.addEventListener('afterprint', afterNative);

    let detachMedia: (() => void) | null = null;
    const onMediaChange = (event: MediaQueryListEvent): void => {
      // Harmless alongside the events: marking and unmarking are idempotent.
      if (event.matches) { if (!nativePrintClosed) before(); }
      else { nativePrintClosed = false; after(); }
    };
    try {
      if (typeof hostWindow.matchMedia === 'function') {
        const media = hostWindow.matchMedia('print');
        if (typeof media.addEventListener === 'function') {
          media.addEventListener('change', onMediaChange);
          detachMedia = (): void => { media.removeEventListener('change', onMediaChange); };
        }
      }
    } catch { /* Native print events remain available when media-query registration is refused. */ }

    this.storage.cleanup = (): void => {
      nativeTargets.delete(editor);
      restoreHeaders?.(); restoreHeaders = null;
      hostWindow.removeEventListener('beforeprint', beforeNative);
      hostWindow.removeEventListener('afterprint', afterNative);
      detachMedia?.();
    };
  },

  onDestroy() {
    this.storage.cleanup?.();
    this.storage.cleanup = null;
    if (this.editor) preparations.get(this.editor)?.abort();
    if (printOwner === this.editor) unmark();
  },
});

declare module '@domternal/core' {
  interface RawCommands {
    printDocument: CommandSpec;
    cancelPrintPreparation: CommandSpec;
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
function mark(root: HTMLElement, owner: ExtensionEditor): void {
  printOwner = owner;
  printingDocument = root.ownerDocument;
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
  printingDocument.body.classList.add(PRINTING_CLASS);
  printing = true;
}

function parentOf(node: Element): HTMLElement | null {
  if (node.parentElement) return node.parentElement;
  const Shadow = node.ownerDocument.defaultView?.ShadowRoot;
  const root = node.getRootNode();
  return Shadow && root instanceof Shadow ? (root.host as HTMLElement) : null;
}

function unmark(): void {
  printing = false;
  printOwner = null;
  printingDocument?.body.classList.remove(PRINTING_CLASS);
  printingDocument = null;
  for (const el of marked) {
    el.classList.remove(ROOT_CLASS, ANCESTOR_CLASS);
  }
  marked.clear();
}

function emit(editor: ExtensionEditor, name: string, payload: unknown): void {
  const bus = editor as unknown as { emit?: (event: string, data: unknown) => void };
  bus.emit?.(name, payload);
}

/** The default path remains synchronous, including exception propagation. */
function printNow(editor: ExtensionEditor, root: HTMLElement): boolean {
  if (printing) return false;
  commandPrinting = true;
  mark(root, editor);
  let restoreHeaders: (() => void) | undefined;
  try {
    restoreHeaders = preparePrintTableHeaders(root);
    emit(editor, 'beforePrint', { root });
    if (editor.view.isDestroyed) return false;
    root.ownerDocument.defaultView?.print();
  } finally {
    restoreHeaders?.();
    unmark();
    commandPrinting = false;
    emit(editor, 'afterPrint', undefined);
  }
  return true;
}
