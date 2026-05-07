/**
 * TableOfContents extension - data layer for headings in the document.
 *
 * Three responsibilities, all opt-in via this single extension:
 *
 *   1. Schema: declare a `tocId` attribute on heading nodes (rendered to
 *      DOM as `data-toc-id`). Existing heading attrs (`level`) are
 *      preserved by the framework's `addGlobalAttributes` merge.
 *
 *   2. ID lifecycle: a PM plugin's `appendTransaction` assigns IDs to
 *      anchors that lack one (predicate-skip pattern). `view().init`
 *      seeds the doc on first mount via a deferred dispatch.
 *
 *   3. Storage: `editor.storage.toc.content` exposes a snapshot of
 *      every heading-like node. Updates fan out via `onUpdate` (public
 *      consumer hook) and the internal `subscribers` Set (used by the
 *      floating outline plugin and the inline `/toc` block NodeView in
 *      later phases).
 *
 * Phase 5 will fill in `isActive` / `isScrolledOver` when the active-
 * state tracker (IntersectionObserver) feeds the storage.
 */
import { Extension } from '@domternal/core';
import type { Editor } from '@domternal/core';
import { Plugin, PluginKey, type EditorState } from '@domternal/pm/state';
import { walkHeadings } from './helpers/headingWalk.js';
import { assignMissingTocIds } from './helpers/tocIdAttribute.js';
import type { HeadingEntry, TableOfContentsOptions, TocStorage } from './types.js';

export const tocPluginKey = new PluginKey('toc');

/**
 * 8-char base36 default ID generator.
 *
 * `Math.random().toString(36)` can produce shorter strings when the
 * RNG happens to return a value with few significant digits, so we
 * concatenate until we have enough characters. Collisions are detected
 * and retried by `assignMissingTocIds`, but a stable length keeps
 * generated IDs visually consistent and predictable in tests.
 */
function defaultGenerateId(): string {
  let id = '';
  while (id.length < 8) {
    id += Math.random().toString(36).slice(2);
  }
  return id.slice(0, 8);
}

function buildContent(state: EditorState, options: TableOfContentsOptions): HeadingEntry[] {
  return walkHeadings(state.doc, {
    levels: options.levels,
    anchorTypes: options.anchorTypes,
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
      generateId: defaultGenerateId,
    };
  },

  addStorage() {
    return {
      content: [],
      activeId: null,
      subscribers: new Set<() => void>(),
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.anchorTypes,
        attributes: {
          tocId: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute('data-toc-id'),
            renderHTML: (attributes: Record<string, unknown>) => {
              const id = attributes['tocId'];
              return typeof id === 'string' && id.length > 0
                ? { 'data-toc-id': id }
                : null;
            },
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    const editor = this.editor as Editor | null;
    const options = this.options;
    const storage = this.storage;

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
      storage.content = buildContent(state, options);
      fanOut();
    };

    return [
      new Plugin({
        key: tocPluginKey,
        view(editorView) {
          // Initial pass: assign IDs and populate storage. Deferred to
          // the next tick so we don't dispatch during plugin init
          // (matches the UniqueID precedent). Re-reading from
          // `editorView.state` inside the timer avoids any stale
          // snapshot if the doc was replaced before the timer fires.
          const timeoutId = setTimeout(() => {
            if (editor?.isDestroyed) return;
            const tr = editorView.state.tr;
            assignMissingTocIds(editorView.state.doc, tr, {
              anchorTypes: options.anchorTypes,
              generateId: options.generateId,
            });
            if (tr.docChanged) {
              editorView.dispatch(tr);
            } else {
              // No IDs needed assigning, but storage still needs the
              // first snapshot so consumers see the initial doc.
              refreshStorage(editorView.state);
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
              storage.subscribers.clear();
            },
          };
        },
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const tr = newState.tr;
          assignMissingTocIds(newState.doc, tr, {
            anchorTypes: options.anchorTypes,
            generateId: options.generateId,
          });
          return tr.docChanged ? tr : null;
        },
      }),
    ];
  },
});
