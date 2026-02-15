/**
 * Details Node
 *
 * Block-level accordion/collapsible container using HTML <details>/<summary>.
 * Contains exactly one DetailsSummary followed by one DetailsContent.
 *
 * Commands:
 * - setDetails: Wraps selected content in a details structure
 * - unsetDetails: Lifts content out of details (preserves summary as paragraph)
 * - toggleDetails: Toggles between wrapped/unwrapped
 * - openDetails: Programmatically opens the details
 * - closeDetails: Programmatically closes the details
 *
 * Improvements over Tiptap:
 * - toggleDetails command (Tiptap doesn't have this)
 * - openDetails / closeDetails commands (Tiptap doesn't have these)
 * - Semantic <details> in renderHTML (Tiptap uses <div data-type="details">)
 * - Parses both native <details> and <div data-type="details"> for compatibility
 * - Summary supports inline marks (bold, italic) via inline* content spec
 */

import { Node, findParentNode, findChildren, defaultBlockAt } from '@domternal/core';
import type { CommandSpec } from '@domternal/core';
import { Plugin, PluginKey, Selection, TextSelection } from 'prosemirror-state';
import type { ViewMutationRecord } from 'prosemirror-view';
import { isNodeVisible } from './helpers/isNodeVisible.js';
import { findClosestVisibleNode } from './helpers/findClosestVisibleNode.js';
import { setGapCursor } from './helpers/setGapCursor.js';

declare module '@domternal/core' {
  interface RawCommands {
    setDetails: CommandSpec;
    unsetDetails: CommandSpec;
    toggleDetails: CommandSpec;
    openDetails: CommandSpec;
    closeDetails: CommandSpec;
  }
}

export interface DetailsOptions {
  /**
   * Whether the open/closed state should be persisted in the document.
   * When true, the `open` attribute is saved and restored.
   * @default false
   */
  persist: boolean;

  /**
   * CSS class name applied when the details is open.
   * @default 'is-open'
   */
  openClassName: string;

  /**
   * Custom HTML attributes for the rendered element.
   */
  HTMLAttributes: Record<string, unknown>;
}

const detailsSelectionPluginKey = new PluginKey('detailsSelection');

export const Details = Node.create<DetailsOptions>({
  name: 'details',
  group: 'block',
  content: 'detailsSummary detailsContent',
  defining: true,
  isolating: true,
  allowGapCursor: false,

  addOptions() {
    return {
      persist: false,
      openClassName: 'is-open',
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    if (!this.options.persist) {
      return {};
    }

    return {
      open: {
        default: false,
        parseHTML: (element: HTMLElement) => element.hasAttribute('open'),
        renderHTML: (attrs: Record<string, unknown>) => {
          if (!attrs['open']) {
            return {};
          }
          return { open: '' };
        },
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'details' },
      { tag: 'div[data-type="details"]' },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['details', { ...this.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },

  addNodeView() {
    const options = this.options;
    const editor = this.editor;
    const nodeType = this.nodeType;

    return (node, _view, getPos) => {
      const dom = document.createElement('div');
      dom.setAttribute('data-type', 'details');

      for (const [key, value] of Object.entries(options.HTMLAttributes)) {
        if (value !== null && value !== undefined) {
          dom.setAttribute(key, typeof value === 'string' ? value : JSON.stringify(value));
        }
      }

      const toggle = document.createElement('button');
      toggle.type = 'button';
      dom.append(toggle);

      const content = document.createElement('div');
      dom.append(content);

      const toggleDetailsContent = (setToValue?: boolean): void => {
        if (setToValue !== undefined) {
          if (setToValue) {
            if (dom.classList.contains(options.openClassName)) return;
            dom.classList.add(options.openClassName);
          } else {
            if (!dom.classList.contains(options.openClassName)) return;
            dom.classList.remove(options.openClassName);
          }
        } else {
          dom.classList.toggle(options.openClassName);
        }

        const event = new Event('toggleDetailsContent');
        const detailsContentEl = content.querySelector(
          ':scope > div[data-type="detailsContent"]',
        );
        detailsContentEl?.dispatchEvent(event);
      };

      if (node.attrs['open']) {
        setTimeout(() => { toggleDetailsContent(); });
      }

      toggle.addEventListener('click', () => {
        toggleDetailsContent();

        if (!options.persist) {
          if (editor) {
            editor.commands['focus']?.(undefined, { scrollIntoView: false });
          }
          return;
        }

        if (editor && typeof getPos === 'function') {
          const pos = getPos();
          if (pos === undefined) return;

          const { state, view } = editor;
          const { from, to } = state.selection;
          const currentNode = state.doc.nodeAt(pos);

          if (currentNode?.type !== nodeType) return;

          const tr = state.tr.setNodeMarkup(pos, undefined, {
            open: !currentNode.attrs['open'],
          });
          tr.setSelection(TextSelection.create(tr.doc, from, to));
          view.dispatch(tr);
          editor.commands['focus']?.(undefined, { scrollIntoView: false });
        }
      });

      return {
        dom,
        contentDOM: content,
        ignoreMutation(mutation: ViewMutationRecord) {
          if (mutation.type === 'selection') {
            return false;
          }
          return !dom.contains(mutation.target) || dom === mutation.target;
        },
        update: (updatedNode) => {
          if (updatedNode.type !== nodeType) {
            return false;
          }
          if (updatedNode.attrs['open'] !== undefined) {
            toggleDetailsContent(updatedNode.attrs['open'] as boolean);
          }
          return true;
        },
      };
    };
  },

  addCommands() {
    return {
      setDetails:
        () =>
        ({ state, tr, dispatch }) => {
          const { schema } = state;
          const { $from, $to } = tr.selection;
          const range = $from.blockRange($to);

          if (!range) return false;

          const detailsType = schema.nodes['details'];
          const summaryType = schema.nodes['detailsSummary'];
          const contentType = schema.nodes['detailsContent'];
          if (!detailsType || !summaryType || !contentType) return false;

          // Check if already inside a details node
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type === detailsType) return false;
          }

          if (!dispatch) return true;

          // Collect selected blocks
          const selectedContent = [];
          for (let i = range.startIndex; i < range.endIndex; i++) {
            selectedContent.push(range.parent.child(i));
          }
          if (selectedContent.length === 0) return false;

          const summary = summaryType.create(null);
          const content = contentType.create(null, selectedContent);
          const details = detailsType.create(null, [summary, content]);

          tr.replaceWith(range.start, range.end, details);
          // Place cursor in the summary (range.start + 1 = inside details, + 1 = inside summary)
          tr.setSelection(TextSelection.create(tr.doc, range.start + 2));
          dispatch(tr.scrollIntoView());
          return true;
        },

      unsetDetails:
        () =>
        ({ state, tr, dispatch }) => {
          const { schema } = state;
          const detailsType = schema.nodes['details'];
          if (!detailsType) return false;

          const details = findParentNode(
            (node) => node.type === detailsType,
          )(tr.selection);

          if (!details) return false;
          if (!dispatch) return true;

          const summaries = findChildren(
            details.node,
            (node) => node.type === schema.nodes['detailsSummary'],
          );
          const contents = findChildren(
            details.node,
            (node) => node.type === schema.nodes['detailsContent'],
          );

          if (!summaries.length || !contents.length) return false;

          const detailsSummary = summaries[0];
          const detailsContent = contents[0];
          if (!detailsSummary || !detailsContent) return false;
          const from = details.pos;
          const $from = state.doc.resolve(from);
          const to = from + details.node.nodeSize;

          // Convert summary content to a paragraph (or default block type)
          const defaultType = $from.parent.type.contentMatch.defaultType;
          const blocks = [];

          if (defaultType && detailsSummary.node.content.size > 0) {
            blocks.push(defaultType.create(null, detailsSummary.node.content));
          }

          // Extract all content blocks
          detailsContent.node.forEach((child) => blocks.push(child));

          tr.replaceWith(from, to, blocks);
          tr.setSelection(TextSelection.create(tr.doc, from + 1));
          dispatch(tr.scrollIntoView());
          return true;
        },

      toggleDetails:
        () =>
        ({ state, commands }) => {
          const detailsType = state.schema.nodes['details'];
          if (!detailsType) return false;

          const { $from } = state.selection;

          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type === detailsType) {
              return commands.unsetDetails();
            }
          }

          return commands.setDetails();
        },

      openDetails:
        () =>
        ({ state, tr, dispatch }) => {
          if (!this.options.persist) return false;

          const detailsType = state.schema.nodes['details'];
          if (!detailsType) return false;

          const details = findParentNode(
            (node) => node.type === detailsType,
          )(state.selection);

          if (!details) return false;
          if (details.node.attrs['open']) return false; // already open

          if (dispatch) {
            tr.setNodeMarkup(details.pos, undefined, {
              ...details.node.attrs,
              open: true,
            });
            dispatch(tr);
          }
          return true;
        },

      closeDetails:
        () =>
        ({ state, tr, dispatch }) => {
          if (!this.options.persist) return false;

          const detailsType = state.schema.nodes['details'];
          if (!detailsType) return false;

          const details = findParentNode(
            (node) => node.type === detailsType,
          )(state.selection);

          if (!details) return false;
          if (!details.node.attrs['open']) return false; // already closed

          if (dispatch) {
            tr.setNodeMarkup(details.pos, undefined, {
              ...details.node.attrs,
              open: false,
            });
            dispatch(tr);
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const editor = this.editor;
        if (!editor) return false;

        const { schema, selection } = editor.state;
        const { empty, $anchor } = selection;
        const summaryType = schema.nodes['detailsSummary'];

        if (!empty || !summaryType || $anchor.parent.type !== summaryType) {
          return false;
        }

        // Safari bug: backspace removes all text in <summary>
        // Handle manually by deleting one char
        if ($anchor.parentOffset !== 0) {
          return editor.commands['command']?.(({ tr }: { tr: { delete: (from: number, to: number) => void } }) => {
            const from = $anchor.pos - 1;
            const to = $anchor.pos;
            tr.delete(from, to);
            return true;
          }) ?? false;
        }

        // At start of summary — unset details
        return editor.commands['unsetDetails']?.() ?? false;
      },

      Enter: () => {
        const editor = this.editor;
        if (!editor) return false;

        const { state, view } = editor;
        const { schema, selection } = state;
        const { $head } = selection;
        const summaryType = schema.nodes['detailsSummary'];

        if (!summaryType || $head.parent.type !== summaryType) {
          return false;
        }

        const isVisible = isNodeVisible($head.after() + 1, editor);

        // If content is hidden, open it first, then fall through to visible logic
        if (!isVisible) {
          const detailsPos = $head.before(-1);
          const detailsDom = view.nodeDOM(detailsPos);

          if (detailsDom instanceof HTMLElement) {
            detailsDom.classList.add(this.options.openClassName);
            const contentEl = detailsDom.querySelector('[data-type="detailsContent"]');
            if (contentEl) {
              contentEl.dispatchEvent(new Event('toggleDetailsContent'));
            }
          }

          if (this.options.persist) {
            const detailsNode = state.doc.nodeAt(detailsPos);
            if (detailsNode) {
              const { tr } = state;
              tr.setNodeMarkup(detailsPos, undefined, {
                ...detailsNode.attrs,
                open: true,
              });
              const contentStartPos = $head.after() + 1;
              tr.setSelection(Selection.near(tr.doc.resolve(contentStartPos), 1));
              tr.scrollIntoView();
              view.dispatch(tr);
              return true;
            }
          }
        }

        // Content is (now) visible — create new block at start of detailsContent
        const above = state.doc.nodeAt($head.after());

        if (!above) return false;

        const type = defaultBlockAt(above.contentMatchAt(0));

        if (!type || !above.canReplaceWith(0, 0, type)) {
          return false;
        }

        const node = type.createAndFill();
        if (!node) return false;

        const pos = $head.after() + 1;
        const tr = state.tr.replaceWith(pos, pos, node);
        const $pos = tr.doc.resolve(pos);
        const newSelection = Selection.near($pos, 1);

        tr.setSelection(newSelection);
        tr.setMeta('detailsEnterOpen', true);
        tr.scrollIntoView();
        view.dispatch(tr);

        return true;
      },

      ArrowRight: () => {
        const editor = this.editor;
        if (!editor) return false;
        return setGapCursor(editor, 'right');
      },

      ArrowDown: () => {
        const editor = this.editor;
        if (!editor) return false;
        return setGapCursor(editor, 'down');
      },
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const nodeType = this.nodeType;

    return [
      // Prevent text selections within hidden content
      new Plugin({
        key: detailsSelectionPluginKey,
        appendTransaction: (transactions, oldState, newState) => {
          if (!editor) return;

          const isComposing = editor.view.composing;
          if (isComposing) return;

          const selectionSet = transactions.some((t) => t.selectionSet);
          if (!selectionSet || !oldState.selection.empty || !newState.selection.empty) {
            return;
          }

          // Skip when Enter handler intentionally placed cursor into just-opened content
          if (transactions.some((t) => t.getMeta('detailsEnterOpen'))) {
            return;
          }

          if (!nodeType) return;

          // Check if cursor is inside a details node
          const { $from } = newState.selection;
          let inDetails = false;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type === nodeType) {
              inDetails = true;
              break;
            }
          }
          if (!inDetails) return;

          const visible = isNodeVisible($from.pos, editor);
          if (visible) return;

          const details = findClosestVisibleNode(
            $from,
            (node) => node.type === nodeType,
            editor,
          );

          if (!details) return;

          const detailsSummaries = findChildren(
            details.node,
            (node) => node.type === newState.schema.nodes['detailsSummary'],
          );

          if (!detailsSummaries.length) return;

          const detailsSummary = detailsSummaries[0];
          if (!detailsSummary) return;

          const selectionDirection =
            oldState.selection.from < newState.selection.from ? 'forward' : 'backward';
          const correctedPosition =
            selectionDirection === 'forward'
              ? details.start + detailsSummary.pos
              : details.pos + detailsSummary.pos + detailsSummary.node.nodeSize;
          const correctedSelection = TextSelection.create(newState.doc, correctedPosition);

          return newState.tr.setSelection(correctedSelection);
        },
      }),
    ];
  },
});
