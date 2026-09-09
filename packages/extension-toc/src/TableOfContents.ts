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
import { createActiveStateTracker, type ActiveStateSnapshot } from './helpers/activeStateTracker.js';
import { navigateToc, registerTocNavigation, resolveTocTrackingOptions } from './helpers/tocTracking.js';
import { isUniqueIDLoaded, resolveUniqueIDAttrName } from './helpers/uniqueIDIntegration.js';
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
          const attrName = resolveUniqueIDAttrName(ed);
          return navigateToc(view, id, { attrName });
        },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor as Editor | null;
    const options = this.options;
    const storage = this.storage;

    if (!editor) return [];

    if (!isUniqueIDLoaded(editor)) {
      // UniqueID is the source of truth for block ids. Without it,
      // TOC has nothing to read - emit a loud error and return an
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
    const attrName = resolveUniqueIDAttrName(editor);

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
          `UniqueID.types - outline navigation to those node types will fail. ` +
          `Either add them to UniqueID.configure({ types: [...] }) or remove ` +
          `them from TableOfContents.configure({ anchorTypes: [...] }).`,
        );
      }
    }

    const fanOut = (): void => {
      try {
        options.onUpdate?.(storage);
      } catch (err) {
        // Keep UI subscribers usable even when the public callback fails.
        // eslint-disable-next-line no-console
        console.error('[extension-toc] onUpdate threw during fan-out:', err);
      }
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

    return [
      new Plugin({
        key: tocPluginKey,
        view(editorView) {
          const trackingOptions = resolveTocTrackingOptions(editor);
          const scrollParent = trackingOptions.activeScrollParent?.nodeType === 1
            ? trackingOptions.activeScrollParent as Element
            : null;
          let destroyed = false;
          let refreshing = false;
          let activityRevision = 0;
          let manualId: string | null = null;
          let manualOverrideUntil = 0;
          let overrideTimer: ReturnType<typeof setTimeout> | null = null;
          let latestSnapshot: ActiveStateSnapshot = { activeId: null, scrolledOverIds: [] };
          let headingDoms: HTMLElement[] = [];
          let rafId: number | null = null;
          let pendingHash: string | null = null;

          const applyActivity = (): void => {
            const validIds = new Set(storage.content.filter((entry) => entry.domNode).map((entry) => entry.id));
            const activeId = manualId && Date.now() < manualOverrideUntil && validIds.has(manualId)
              ? manualId
              : latestSnapshot.activeId && validIds.has(latestSnapshot.activeId)
                ? latestSnapshot.activeId
                : null;
            const passed = new Set(latestSnapshot.scrolledOverIds);
            let changed = storage.activeId !== activeId;
            storage.activeId = activeId;
            for (const entry of storage.content) {
              const isActive = entry.id !== '' && entry.id === activeId;
              const isScrolledOver = entry.domNode !== null && passed.has(entry.id);
              changed ||= entry.isActive !== isActive || entry.isScrolledOver !== isScrolledOver;
              entry.isActive = isActive;
              entry.isScrolledOver = isScrolledOver;
            }
            if (!changed) return;
            activityRevision += 1;
            if (!refreshing) fanOut();
          };

          const tracker = createActiveStateTracker({
            scrollParent: trackingOptions.activeScrollParent,
            rootMargin: trackingOptions.activeRootMargin,
            offset: trackingOptions.activeOffset,
            attrName,
            onChange: () => undefined,
            onUpdate: (snapshot) => {
              latestSnapshot = snapshot;
              applyActivity();
            },
          });

          const refreshStorage = (rebuild: boolean): void => {
            if (destroyed || editor.isDestroyed) return;
            refreshing = true;
            const previousActivityRevision = activityRevision;
            if (rebuild) storage.content = buildContent(editorView.state, options, attrName);
            let domChanged = false;
            headingDoms = [];
            for (const entry of storage.content) {
              let domNode: HTMLElement | null = null;
              if (editorView.dom.isConnected && entry.id) {
                const candidate = editorView.nodeDOM(entry.pos);
                if (candidate?.nodeType === 1 && editorView.dom.contains(candidate)) {
                  const element = candidate as HTMLElement;
                  if (element.getAttribute(attrName) === entry.id) domNode = element;
                  else {
                    // A custom heading NodeView can wrap the attributed element.
                    domNode = Array.from(element.querySelectorAll<HTMLElement>('*'))
                      .find((child) => child.getAttribute(attrName) === entry.id) ?? null;
                  }
                }
              }
              domChanged ||= entry.domNode !== domNode;
              entry.domNode = domNode;
              if (domNode) headingDoms.push(domNode);
            }
            tracker.observe(headingDoms);
            applyActivity();
            refreshing = false;
            if (rebuild || domChanged || activityRevision !== previousActivityRevision) fanOut();
          };

          const navigate = (id: string): boolean => {
            if (destroyed) return false;
            const scrolled = scrollToHeading(editorView, id, { attrName, scrollParent });
            if (!scrolled) return false;
            manualId = id;
            manualOverrideUntil = Date.now() + trackingOptions.clickOverrideMs;
            refreshStorage(false);
            if (overrideTimer !== null) clearTimeout(overrideTimer);
            if (trackingOptions.clickOverrideMs > 0) {
              overrideTimer = setTimeout(() => {
                overrideTimer = null;
                manualId = null;
                refreshStorage(false);
              }, trackingOptions.clickOverrideMs);
            }
            return true;
          };
          const unregisterNavigation = registerTocNavigation(editorView, navigate);

          const scheduleInitialHash = (): void => {
            if (!pendingHash || !editorView.dom.isConnected || rafId !== null) return;
            const hash = pendingHash;
            pendingHash = null;
            rafId = requestAnimationFrame(() => {
              rafId = null;
              if (!destroyed && !editor.isDestroyed) navigate(hash);
            });
          };
          const onAdopt = (): void => {
            refreshStorage(false);
            scheduleInitialHash();
          };
          editor.on('adopt', onAdopt);
          const onLayoutChange = (): void => { refreshStorage(false); };
          editorView.dom.addEventListener('load', onLayoutChange, true);
          editorView.dom.addEventListener('toggle', onLayoutChange, true);

          // Wait for UniqueID's initial transaction before reading heading IDs.
          const timeoutId = setTimeout(() => {
            if (destroyed || editor.isDestroyed) return;
            refreshStorage(true);
            if (typeof window !== 'undefined' && window.location.hash) {
              pendingHash = window.location.hash.slice(1);
              try {
                pendingHash = decodeURIComponent(pendingHash);
              } catch {
                // Preserve malformed fragments as literal IDs.
              }
              scheduleInitialHash();
            }
          }, 0);

          return {
            update(view, prevState) {
              refreshStorage(view.state.doc !== prevState.doc);
            },
            destroy() {
              destroyed = true;
              editor.off('adopt', onAdopt);
              editorView.dom.removeEventListener('load', onLayoutChange, true);
              editorView.dom.removeEventListener('toggle', onLayoutChange, true);
              clearTimeout(timeoutId);
              if (overrideTimer !== null) clearTimeout(overrideTimer);
              if (rafId !== null) cancelAnimationFrame(rafId);
              unregisterNavigation();
              tracker.destroy();
              storage.activeId = null;
              for (const entry of storage.content) {
                entry.domNode = null;
                entry.isActive = false;
                entry.isScrolledOver = false;
              }
              storage.subscribers.clear();
            },
          };
        },
      }),
    ];
  },
});
