/**
 * Data layer for headings. Storage snapshot at `editor.storage.toc.content`
 * is rebuilt by the plugin's `view().update`; updates fan out via `onUpdate`
 * (public) and the internal `subscribers` Set (outline + inline /toc block).
 *
 * Peer dependency: `UniqueID` from `@domternal/core` must be loaded. Without
 * it the plugin logs an error and returns no plugins (extension inert).
 */
import { Extension } from '@domternal/core';
import type { Editor } from '@domternal/core';
import type { CommandSpec } from '@domternal/core';
import { Plugin, PluginKey, type EditorState } from '@domternal/pm/state';
import type { EditorView } from '@domternal/pm/view';
import { walkHeadings } from './helpers/headingWalk.js';
import { scrollToHeading } from './helpers/scrollToHeading.js';
import { resolveUniqueIDAttrName } from './helpers/uniqueIDIntegration.js';
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
          const attrName = resolveUniqueIDAttrName(ed) ?? 'id';
          return scrollToHeading(view, id, { attrName });
        },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor as Editor | null;
    const options = this.options;
    const storage = this.storage;

    if (!editor) return [];

    const attrName = resolveUniqueIDAttrName(editor);
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
