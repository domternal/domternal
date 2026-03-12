/**
 * Placeholder Extension
 *
 * Shows placeholder text when the editor is empty.
 * Supports both static and dynamic (function-based) placeholders.
 */
import { Plugin, PluginKey } from '@domternal/pm/state';
import { Decoration, DecorationSet } from '@domternal/pm/view';
import type { Node as PMNode } from '@domternal/pm/model';
import { Extension } from '../Extension.js';

export interface PlaceholderOptions {
  /**
   * Placeholder text to show. Can be a string or function for per-node placeholders.
   * @default 'Write something …'
   */
  placeholder: string | ((props: { node: PMNode; pos: number }) => string);

  /**
   * Only show placeholder when editor is editable.
   * @default true
   */
  showOnlyWhenEditable: boolean;

  /**
   * CSS class applied to empty nodes.
   * @default 'is-empty'
   */
  emptyNodeClass: string;

  /**
   * CSS class applied when entire editor is empty.
   * @default 'is-editor-empty'
   */
  emptyEditorClass: string;

  /**
   * Show placeholder only in the currently focused/selected node.
   * @default true
   */
  showOnlyCurrent: boolean;

  /**
   * Include children when checking if a node is empty.
   * @default false
   */
  includeChildren: boolean;
}

export const placeholderPluginKey = new PluginKey('placeholder');

export const Placeholder = Extension.create<PlaceholderOptions>({
  name: 'placeholder',

  addOptions() {
    return {
      placeholder: 'Write something …',
      showOnlyWhenEditable: true,
      emptyNodeClass: 'is-empty',
      emptyEditorClass: 'is-editor-empty',
      showOnlyCurrent: true,
      includeChildren: false,
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: placeholderPluginKey,
        props: {
          decorations: ({ doc, selection }) => {
            const editor = this.editor;
            if (!editor?.view) return DecorationSet.empty;
            const isEditable = editor.view.editable;

            if (!isEditable && this.options.showOnlyWhenEditable) {
              return DecorationSet.empty;
            }

            // Check if document is empty (for editor-level class)
            const isDocEmpty =
              doc.childCount === 1 &&
              doc.firstChild?.isTextblock &&
              doc.firstChild.content.size === 0;

            const { includeChildren, showOnlyCurrent, emptyNodeClass, emptyEditorClass } = this.options;

            const isNodeEmpty = (node: PMNode): boolean =>
              includeChildren
                ? node.content.size === 0
                : node.childCount === 0 ||
                  (node.childCount === 1 &&
                    !!node.firstChild?.isText &&
                    !node.firstChild.text);

            const getPlaceholderText = (node: PMNode, pos: number): string =>
              typeof this.options.placeholder === 'function'
                ? this.options.placeholder({ node, pos })
                : this.options.placeholder;

            const makeDecoration = (node: PMNode, pos: number): Decoration =>
              Decoration.node(pos, pos + node.nodeSize, {
                class: `${emptyNodeClass}${isDocEmpty ? ` ${emptyEditorClass}` : ''}`,
                'data-placeholder': getPlaceholderText(node, pos),
              });

            // Fast path: showOnlyCurrent (default) — O(1), check only the anchor node
            if (showOnlyCurrent) {
              const { $anchor } = selection;
              if ($anchor.depth === 0) return DecorationSet.empty;
              const node = $anchor.parent;
              if (!node.isTextblock || !isNodeEmpty(node)) return DecorationSet.empty;
              const pos = $anchor.before($anchor.depth);
              return DecorationSet.create(doc, [makeDecoration(node, pos)]);
            }

            // Slow path: show placeholder in all empty textblocks
            const decorations: Decoration[] = [];
            doc.descendants((node, pos) => {
              if (!node.isTextblock) return;
              if (!isNodeEmpty(node)) return;
              decorations.push(makeDecoration(node, pos));
            });

            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
});
