/**
 * Fills in the blocks a node's content expression requires where loaded JSON
 * lacks them.
 */
import { Fragment, type Node as PMNode } from '@domternal/pm/model';

/**
 * The content `node` holds once the nodes its type requires before and after
 * it are added, or `undefined` when no such fill makes it valid.
 */
function filledContent(node: PMNode, content: Fragment): Fragment | undefined {
  const head = node.type.contentMatch.fillBefore(content);
  if (!head) return undefined;
  const filled = head.append(content);
  const tail = node.type.contentMatch.matchFragment(filled)?.fillBefore(Fragment.empty, true);
  if (!tail) return undefined;
  const complete = filled.append(tail);
  return node.type.validContent(complete) ? complete : undefined;
}

/**
 * @internal Returns `node` with the blocks its schema requires filled in, as
 * empty nodes the schema can create, where stored content lacks them: the
 * paragraph a list item must start with when it starts with a heading or a
 * nested list, or the paragraph an empty blockquote must hold. Node.fromJSON
 * does not check content, so such a node would otherwise load as a document
 * that every later step through it refuses. Nothing is removed or reordered.
 * Content no fill can make valid, and every valid node, is returned as it was.
 */
export function fillRequiredContent(node: PMNode): PMNode {
  if (node.isTextblock || node.isLeaf) return node;
  let children: PMNode[] | undefined;
  node.forEach((child, _offset, index) => {
    const next = fillRequiredContent(child);
    if (next !== child && children === undefined) {
      children = [];
      for (let before = 0; before < index; before++) children.push(node.child(before));
    }
    children?.push(next);
  });
  let content = children === undefined ? node.content : Fragment.fromArray(children);
  if (!node.type.validContent(content)) content = filledContent(node, content) ?? content;
  return content === node.content ? node : node.copy(content);
}
