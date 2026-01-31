/**
 * UniqueID Extension
 *
 * Automatically assigns unique IDs to specified node types.
 * Useful for collaborative editing, linking, and history tracking.
 *
 * @example
 * ```ts
 * import { UniqueID } from '@domternal/core';
 *
 * const editor = new Editor({
 *   extensions: [
 *     // ... other extensions
 *     UniqueID.configure({
 *       types: ['paragraph', 'heading'],
 *       attributeName: 'id',
 *     }),
 *   ],
 * });
 * ```
 */
import { Extension } from '../Extension.js';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Fragment, Slice, Node as PMNode } from 'prosemirror-model';
import type { Editor } from '../Editor.js';

/**
 * Simple UUID generator (no external dependency)
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const uniqueIDPluginKey = new PluginKey('uniqueID');

export interface UniqueIDOptions {
  /**
   * Node types that should receive unique IDs.
   * @default ['paragraph', 'heading', 'blockquote', 'codeBlock', 'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem', 'image', 'horizontalRule']
   */
  types: string[];

  /**
   * Attribute name to store the unique ID.
   * @default 'id'
   */
  attributeName: string;

  /**
   * Function to generate unique IDs.
   * @default generateUUID
   */
  generateID: () => string;

  /**
   * Whether to filter duplicates when pasting content.
   * @default true
   */
  filterDuplicates: boolean;
}

export const UniqueID = Extension.create<UniqueIDOptions>({
  name: 'uniqueID',

  addOptions() {
    return {
      types: [
        'paragraph',
        'heading',
        'blockquote',
        'codeBlock',
        'bulletList',
        'orderedList',
        'taskList',
        'listItem',
        'taskItem',
        'image',
        'horizontalRule',
      ],
      attributeName: 'id',
      generateID: generateUUID,
      filterDuplicates: true,
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          [this.options.attributeName]: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute(this.options.attributeName),
            renderHTML: (attributes: Record<string, unknown>) => {
              const id = attributes[this.options.attributeName] as string | null;
              if (!id) return null;
              return { [this.options.attributeName]: id };
            },
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    const { types, attributeName, generateID, filterDuplicates } = this.options;
    const editor = this.editor as Editor | null;

    const transformPastedSlice = (slice: Slice): Slice => {
      const existingIDs = new Set<string>();

      // Collect existing IDs in document
      editor?.state.doc.descendants((node: PMNode) => {
        const id = node.attrs[attributeName] as string | undefined;
        if (id) existingIDs.add(id);
      });

      // Transform pasted content
      const transformNode = (node: PMNode): PMNode => {
        if (!types.includes(node.type.name)) {
          return node.copy(transformFragment(node.content));
        }

        const existingID = node.attrs[attributeName] as string | undefined;
        if (existingID && existingIDs.has(existingID)) {
          // Regenerate ID for duplicate
          return node.type.create(
            { ...node.attrs, [attributeName]: generateID() },
            transformFragment(node.content),
            node.marks
          );
        }

        // Track new ID
        if (existingID) existingIDs.add(existingID);
        return node.copy(transformFragment(node.content));
      };

      const transformFragment = (fragment: Fragment): Fragment => {
        const nodes: PMNode[] = [];
        fragment.forEach((node) => {
          nodes.push(transformNode(node));
        });
        return Fragment.from(nodes);
      };

      return new Slice(
        transformFragment(slice.content),
        slice.openStart,
        slice.openEnd
      );
    };

    return [
      new Plugin({
        key: uniqueIDPluginKey,

        // Ensure new nodes get IDs
        appendTransaction(transactions, _oldState, newState) {
          const docChanged = transactions.some((tr) => tr.docChanged);
          if (!docChanged) return null;

          const tr = newState.tr;
          let modified = false;

          newState.doc.descendants((node, pos) => {
            if (!types.includes(node.type.name)) return;

            const existingID = node.attrs[attributeName];
            if (!existingID) {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                [attributeName]: generateID(),
              });
              modified = true;
            }
          });

          return modified ? tr : null;
        },

        // Handle paste - filter duplicates
        props: filterDuplicates
          ? {
              transformPasted: transformPastedSlice,
            }
          : {},
      }),
    ];
  },
});
