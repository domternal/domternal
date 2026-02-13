/**
 * DetailsContent Node
 *
 * Wrapper for the collapsible content inside a <details> accordion.
 * Renders as <div data-details-content> since HTML <details> has no
 * native wrapper for non-summary content.
 */

import { Node } from '@domternal/core';

export interface DetailsContentOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const DetailsContent = Node.create<DetailsContentOptions>({
  name: 'detailsContent',
  content: 'block+',
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-details-content]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      { ...this.options.HTMLAttributes, ...HTMLAttributes, 'data-details-content': '' },
      0,
    ];
  },
});
