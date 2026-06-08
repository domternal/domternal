/**
 * Demo extension: Callout block node with a React NodeView.
 *
 * Mirrors the Vue Callout (apps/demo-vue/src/Callout.ts) so both wrappers
 * exercise their NodeView renderer over the same schema: a block node with a
 * `variant` attribute and editable `block+` content, rendered through
 * ReactNodeViewRenderer.
 */
import { Node } from '@domternal/core';
import type { CommandSpec } from '@domternal/core';
import { ReactNodeViewRenderer } from '@domternal/react';
import { CalloutView, type CalloutVariant } from './CalloutView.js';

declare module '@domternal/core' {
  interface RawCommands {
    insertCallout: CommandSpec<[variant?: CalloutVariant]>;
  }
}

export type { CalloutVariant } from './CalloutView.js';

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: 'info',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-variant') ?? 'info',
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-variant': String(attrs['variant'] ?? 'info') }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-type': 'callout', ...HTMLAttributes }, 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },

  addCommands() {
    return {
      insertCallout:
        (variant: CalloutVariant = 'info') =>
        ({ commands }) =>
          commands['insertContent']({
            type: 'callout',
            attrs: { variant },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Callout content - edit me' }] }],
          }),
    };
  },
});
