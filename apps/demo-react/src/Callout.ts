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

/** The node-view constructor type core's `addNodeView` expects, derived from
 * @domternal/core itself so it uses the same prosemirror-view types core
 * bundles (importing @domternal/pm separately resolves a duplicate copy). */
type CoreNodeViewConstructor = ReturnType<NonNullable<Parameters<typeof Node.create>[0]['addNodeView']>>;

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
    // ReactNodeViewRenderer types getPos as `() => number`, while core's
    // NodeViewConstructor expects `() => number | undefined`. The values are
    // runtime-compatible; the cast bridges that variance. (The @domternal/vue
    // VueNodeViewRenderer already widens getPos, so its addNodeView needs no
    // cast - the react package signature could be aligned the same way.)
    return ReactNodeViewRenderer(CalloutView) as unknown as CoreNodeViewConstructor;
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
