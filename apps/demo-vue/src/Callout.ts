/**
 * Demo extension: Callout block node with a Vue NodeView.
 *
 * Schema:
 * - attrs: variant ('info' | 'warning' | 'success' | 'danger')
 * - content: block+ (editable content inside)
 * - group: block
 *
 * Renders via VueNodeViewRenderer so we exercise the full Vue NodeView path:
 * reactive props, updateAttributes, deleteNode, NodeViewContent for editable
 * content, appContext forwarding for provide/inject.
 */
import { Node } from '@domternal/core';
import type { CommandSpec } from '@domternal/core';
import { VueNodeViewRenderer } from '@domternal/vue';
import CalloutView from './CalloutView.vue';

declare module '@domternal/core' {
  interface RawCommands {
    insertCallout: CommandSpec<[variant?: CalloutVariant]>;
  }
}

export type CalloutVariant = 'info' | 'warning' | 'success' | 'danger';

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
    return VueNodeViewRenderer(CalloutView);
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
