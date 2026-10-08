import type { Nodes, Root } from 'hast';
import { StructureLimitError } from './parse.js';

/** Generated formatting and list wrappers must fit the same bounded output tree. */
export function assertOutputTreeBounds(root: Root, maxNodes: number, maxDepth: number): void {
  const pending: { node: Nodes; depth: number }[] = [{ node: root, depth: 0 }];
  let count = 0;
  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined) break;
    if (++count > maxNodes || entry.depth > maxDepth) throw new StructureLimitError();
    if ('children' in entry.node) {
      for (const node of entry.node.children) pending.push({ node, depth: entry.depth + 1 });
    }
  }
}
