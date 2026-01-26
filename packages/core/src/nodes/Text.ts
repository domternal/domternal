/**
 * Text Node
 *
 * Inline text content. Can hold marks (bold, italic, etc.).
 * This is the leaf node that contains actual text content.
 */

import { Node } from '../Node.js';

export const Text = Node.create({
  name: 'text',
  group: 'inline',
});
