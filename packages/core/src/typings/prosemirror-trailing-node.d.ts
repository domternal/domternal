/**
 * Type declarations for prosemirror-trailing-node
 *
 * The package ships with types, but typescript-eslint has trouble
 * resolving them. This declaration provides explicit types.
 */
declare module 'prosemirror-trailing-node' {
  import type { Plugin } from 'prosemirror-state';

  export interface TrailingNodePluginOptions {
    nodeName?: string;
    ignoredNodes?: string[];
  }

  export function trailingNode(options?: TrailingNodePluginOptions): Plugin;
}
