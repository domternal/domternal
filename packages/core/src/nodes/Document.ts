/**
 * Document Node
 *
 * The root node of every ProseMirror document.
 * Must have at least one block child.
 */

import { Node } from '../Node.js';

export const Document = Node.create({
  name: 'doc',
  topNode: true,
  content: 'block+',
});
