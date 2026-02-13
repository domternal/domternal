/**
 * DetailsSummary Node
 *
 * The clickable summary/header part of a <details> accordion.
 * Contains inline content only (text, marks).
 */

import { Node } from '@domternal/core';

export interface DetailsSummaryOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const DetailsSummary = Node.create<DetailsSummaryOptions>({
  name: 'detailsSummary',
  content: 'inline*',
  defining: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  parseHTML() {
    return [{ tag: 'summary' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['summary', { ...this.options.HTMLAttributes, ...HTMLAttributes }, 0];
  },
});
