import { defaultTreeAdapter, html as parse5HTML, parseFragment } from 'parse5';
import type { DefaultTreeAdapterTypes as P5, TreeAdapter, DefaultTreeAdapterMap } from 'parse5';
import { fromParse5 } from 'hast-util-from-parse5';
import type { Element, Nodes, Root } from 'hast';
import type { PasteHTMLLimits } from './types.js';

export class StructureLimitError extends Error {}

/** Each parsed image's attributes as the HTML parser read them, before HAST reads `1e3` as the number 1000. */
export const imageSourceAttributes = new WeakMap<Element, ReadonlyMap<string, string>>();

/**
 * Reject hostile nesting before the recursive HAST conversion or sanitizer runs. A `table` context
 * parses the HTML as a table's content, as a browser parses bare rows or cells inside a table.
 */
export function parseBoundedHTML(html: string, limits: PasteHTMLLimits, context?: 'table'): Root {
  let allocations = 0;
  const allocate = (): void => {
    if (++allocations > limits.maxNodes) throw new StructureLimitError();
  };
  const checkParent = (parent: P5.ParentNode): void => {
    let depth = 1;
    let node: P5.ParentNode | null = parent;
    while (node !== null && 'parentNode' in node) {
      if (++depth > limits.maxDepth) throw new StructureLimitError();
      node = node.parentNode;
    }
  };
  const adapter: TreeAdapter<DefaultTreeAdapterMap> = {
    ...defaultTreeAdapter,
    createElement(...args) { allocate(); return defaultTreeAdapter.createElement(...args); },
    createCommentNode(...args) { allocate(); return defaultTreeAdapter.createCommentNode(...args); },
    insertText(parent, text) { allocate(); checkParent(parent); defaultTreeAdapter.insertText(parent, text); },
    insertTextBefore(parent, text, reference) {
      allocate(); checkParent(parent); defaultTreeAdapter.insertTextBefore(parent, text, reference);
    },
    appendChild(parent, child) { checkParent(parent); defaultTreeAdapter.appendChild(parent, child); },
    insertBefore(parent, child, reference) {
      checkParent(parent); defaultTreeAdapter.insertBefore(parent, child, reference);
    },
  };
  const options = { treeAdapter: adapter, sourceCodeLocationInfo: true };
  const tree = context === undefined ? parseFragment(html, options)
    : parseFragment(adapter.createElement(context, parse5HTML.NS.HTML, []), html, options);
  const queue: { node: P5.Node; depth: number }[] = [{ node: tree, depth: 0 }];
  while (queue.length > 0) {
    const entry = queue.pop();
    if (entry === undefined) break;
    if (entry.depth > limits.maxDepth) throw new StructureLimitError();
    if ('childNodes' in entry.node) {
      for (const child of entry.node.childNodes) queue.push({ node: child, depth: entry.depth + 1 });
    }
    if ('content' in entry.node) queue.push({ node: entry.node.content, depth: entry.depth + 1 });
  }
  const converted = fromParse5(tree);
  if (converted.type !== 'root') throw new Error('Expected an HTML fragment');
  // fromParse5 only attaches positions with a VFile. Copy the parser's locations
  // directly so this entry does not need a filesystem-oriented file abstraction.
  const positions: { source: P5.Node; target: Nodes }[] = [{ source: tree, target: converted }];
  while (positions.length > 0) {
    const pair = positions.pop();
    if (pair === undefined) break;
    const location = pair.source.sourceCodeLocation;
    if (location !== undefined && location !== null) {
      pair.target.position = {
        start: { line: location.startLine, column: location.startCol, offset: location.startOffset },
        end: { line: location.endLine, column: location.endCol, offset: location.endOffset },
      };
    }
    if (pair.target.type === 'element' && pair.target.tagName === 'img' && 'attrs' in pair.source) {
      imageSourceAttributes.set(pair.target, new Map(pair.source.attrs.map(({ name, value }) => [name, value])));
    }
    if ('childNodes' in pair.source && 'children' in pair.target) {
      for (let index = 0; index < pair.source.childNodes.length; index++) {
        const source = pair.source.childNodes[index];
        const target = pair.target.children[index];
        if (source !== undefined && target !== undefined) positions.push({ source, target });
      }
    }
  }
  return converted;
}
