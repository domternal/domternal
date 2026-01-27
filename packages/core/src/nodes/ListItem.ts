/**
 * ListItem Node
 *
 * Individual list item that can contain paragraphs and nested blocks.
 * Used by BulletList and OrderedList.
 */

import type { Node as NodeClass } from '../Node.js';
import { Node } from '../Node.js';

export interface ListItemOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const ListItem = Node.create<ListItemOptions>({
  name: 'listItem',
  content: 'paragraph block*',
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [{ tag: 'li' }];
  },

  renderHTML({ HTMLAttributes }) {
    const self = this as unknown as NodeClass<ListItemOptions>;
    return ['li', { ...self.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },
});
