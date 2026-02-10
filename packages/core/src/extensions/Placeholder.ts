/**
 * Placeholder Extension
 *
 * Shows placeholder text when the editor is empty.
 * Supports both static and dynamic (function-based) placeholders.
 */
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
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

            const decorations: Decoration[] = [];
            const currentNodePos = selection.$anchor.depth > 0
              ? selection.$anchor.before(selection.$anchor.depth)
              : -1;

            // Check if document is empty (for editor-level class)
            const isDocEmpty =
              doc.childCount === 1 &&
              doc.firstChild?.isTextblock &&
              doc.firstChild.content.size === 0;

            doc.descendants((node, pos) => {
              // Skip non-textblocks
              if (!node.isTextblock) return;

              // Check if node is empty
              const isEmpty = this.options.includeChildren
                ? node.content.size === 0
                : node.childCount === 0 ||
                  (node.childCount === 1 &&
                    node.firstChild?.isText &&
                    !node.firstChild.text);

              if (!isEmpty) return;

              // If showOnlyCurrent, only show for current node
              if (this.options.showOnlyCurrent && pos !== currentNodePos) {
                return;
              }

              // Get placeholder text
              const placeholderText =
                typeof this.options.placeholder === 'function'
                  ? this.options.placeholder({ node, pos })
                  : this.options.placeholder;

              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  class: `${this.options.emptyNodeClass}${isDocEmpty ? ` ${this.options.emptyEditorClass}` : ''}`,
                  'data-placeholder': placeholderText,
                })
              );
            });

            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
});
