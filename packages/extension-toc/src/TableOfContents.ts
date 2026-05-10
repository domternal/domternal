/**
 * TableOfContents extension - data layer for headings in the document.
 *
 * Two responsibilities (id assignment is NOT one of them — that lives in
 * `UniqueID` which TOC declares as a peer dependency):
 *
 *   1. Storage: `editor.storage.toc.content` exposes a snapshot of every
 *      heading-like node, sourced from the doc walk. The id field on
 *      each entry is read from the UniqueID-assigned attribute (default
 *      `id`, configurable via `UniqueID.configure({ attributeName })`).
 *
 *   2. Reactivity: a PM plugin's `view().update` recomputes storage
 *      whenever the doc changes; updates fan out via `onUpdate` (public
 *      consumer hook) and the internal `subscribers` Set (used by the
 *      floating outline and the inline `/toc` block NodeView).
 *
 * Peer dependency contract:
 *
 *   `UniqueID` from `@domternal/core` MUST be loaded in the editor's
 *   extensions array for TableOfContents to function. If absent, the
 *   plugin logs an error and returns an empty plugins array — the
 *   extension is inert (no storage updates, no scroll command, no
 *   hash navigation), but the editor itself is unaffected.
 *
 *   Recommended ordering: UniqueID before TableOfContents (TOC reads
 *   UniqueID's options at init; ordering does not affect functionality
 *   given ExtensionManager's last-wins dedup, but the conventional
 *   placement is parent-then-consumer).
 */
import { Extension } from '@domternal/core';
import type { Editor } from '@domternal/core';
import type { CommandSpec } from '@domternal/core';
import { Plugin, PluginKey, type EditorState } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import { walkHeadings } from './helpers/headingWalk.js';
import { scrollToHeading } from './helpers/scrollToHeading.js';
import type { HeadingEntry, TableOfContentsOptions, TocStorage } from './types.js';

declare module '@domternal/core' {
  interface RawCommands {
    /**
     * Scroll the editor view to the heading whose UniqueID-assigned
     * attribute (default `id`) matches. No-op if the ID is unknown
     * (returns false). Updates the URL hash via `history.replaceState`.
     */
    scrollToHeading: CommandSpec<[id: string]>;
  }
}

export const tocPluginKey = new PluginKey('toc');

/**
 * Resolve the UniqueID extension's `attributeName` option, defaulting
 * to `'id'`. Returns `null` if UniqueID is not loaded — the caller
 * should treat this as "TOC cannot function" and short-circuit.
 */
function resolveAttrName(editor: Editor): string | null {
  const ext = editor.extensionManager.extensions.find((e) => e.name === 'uniqueID');
  if (!ext) return null;
  const raw = (ext.options as { attributeName?: unknown }).attributeName;
  return typeof raw === 'string' && raw.length > 0 ? raw : 'id';
}

function buildContent(
  state: EditorState,
  options: TableOfContentsOptions,
  attrName: string,
): HeadingEntry[] {
  return walkHeadings(state.doc, {
    levels: options.levels,
    anchorTypes: options.anchorTypes,
    attrName,
  }).map((entry) => ({
    ...entry,
    domNode: null,
    isActive: false,
    isScrolledOver: false,
  }));
}

export const TableOfContents = Extension.create<TableOfContentsOptions, TocStorage>({
  name: 'toc',

  addOptions() {
    return {
      levels: [1, 2, 3],
      anchorTypes: ['heading'],
    };
  },

  addStorage() {
    return {
      content: [],
      activeId: null,
      subscribers: new Set<() => void>(),
    };
  },

  addCommands() {
    return {
      scrollToHeading:
        (id: string) =>
        ({ editor, dispatch }) => {
          // Pure DOM side-effect, no PM transaction. In dry-run mode
          // (`dispatch` undefined - happens during `editor.can()` checks
          // and chain validation), report the operation as available
          // without actually executing.
          if (!dispatch) return true;
          const view = (editor as { view?: EditorView }).view;
          if (!view) return false;
          const ed = editor as unknown as Editor;
          const attrName = resolveAttrName(ed) ?? 'id';
          return scrollToHeading(view, id, { attrName });
        },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor as Editor | null;
    const options = this.options;
    const storage = this.storage;

    if (!editor) return [];

    const attrName = resolveAttrName(editor);
    if (attrName === null) {
      // UniqueID is the source of truth for block ids. Without it,
      // TOC has nothing to read — emit a loud error and return an
      // empty plugin list so the editor still functions cleanly.
      // eslint-disable-next-line no-console
      console.error(
        '[TableOfContents] requires the UniqueID extension to be loaded. ' +
        'Add it to your extensions array:\n' +
        '  import { UniqueID } from "@domternal/core";\n' +
        '  extensions: [..., UniqueID, TableOfContents]',
      );
      return [];
    }

    // Surface a misconfiguration where UniqueID is loaded but its
    // `types` list omits anchor types TOC needs to navigate to. The
    // walk still succeeds, but anchored entries report id: '' and
    // outline links cannot scroll. console.warn is loud enough to
    // surface during development without crashing the editor.
    const uniqueIDExt = editor.extensionManager.extensions.find((e) => e.name === 'uniqueID');
    const uniqueIDTypes = (uniqueIDExt?.options as { types?: unknown }).types;
    if (Array.isArray(uniqueIDTypes)) {
      const missing = options.anchorTypes.filter((t) => !uniqueIDTypes.includes(t));
      if (missing.length > 0) {
        // eslint-disable-next-line no-console
        console.warn(
          `[TableOfContents] anchorTypes ${JSON.stringify(missing)} are not in ` +
          `UniqueID.types — outline navigation to those node types will fail. ` +
          `Either add them to UniqueID.configure({ types: [...] }) or remove ` +
          `them from TableOfContents.configure({ anchorTypes: [...] }).`,
        );
      }
    }

    const fanOut = (): void => {
      options.onUpdate?.(storage);
      // Copy to an array to make the iteration safe against subscribers
      // unsubscribing themselves during the callback.
      [...storage.subscribers].forEach((fn) => {
        try {
          fn();
        } catch (err) {
          // A misbehaving subscriber must not break the others. We log
          // and continue rather than swallowing silently so app authors
          // see the failure during development.
          // eslint-disable-next-line no-console
          console.error('[extension-toc] subscriber threw during fan-out:', err);
        }
      });
    };

    const refreshStorage = (state: EditorState): void => {
      storage.content = buildContent(state, options, attrName);
      fanOut();
    };

    return [
      new Plugin({
        key: tocPluginKey,
        view(editorView) {
          // Defer initial storage population to the next macrotask so we
          // don't observe state mid-init. UniqueID's own appendTransaction
          // will have stamped ids by the time this fires; the tick of
          // setTimeout(0) is enough for the initial dispatch ordering.
          let rafId: number | null = null;
          const timeoutId = setTimeout(() => {
            if (editor.isDestroyed) return;
            refreshStorage(editorView.state);

            // Initial-load hash navigation. Run AFTER UniqueID has stamped
            // ids and storage is populated. rAF gives one frame for the
            // browser to paint the first commit; the call is silent on
            // missing IDs (no scroll, no hash change), so a stray
            // `#section` from another part of the host app stays untouched.
            if (typeof window !== 'undefined' && window.location.hash) {
              // Decode the percent-encoding scrollToHeading writes back so
              // a round-trip (write hash -> reload -> read hash) finds the
              // same heading id it started from.
              let hash = window.location.hash.slice(1);
              try {
                hash = decodeURIComponent(hash);
              } catch {
                // Malformed encoding: fall back to the raw fragment.
              }
              rafId = requestAnimationFrame(() => {
                rafId = null;
                if (editor.isDestroyed) return;
                scrollToHeading(editorView, hash, { attrName });
              });
            }
          }, 0);

          return {
            update(view, prevState) {
              if (view.state.doc !== prevState.doc) {
                refreshStorage(view.state);
              }
            },
            destroy() {
              clearTimeout(timeoutId);
              if (rafId !== null) cancelAnimationFrame(rafId);
              storage.subscribers.clear();
            },
          };
        },
      }),
    ];
  },
});
