/**
 * Create a ProseMirror document from content
 *
 * Supports JSON and HTML content formats (AD-11).
 * Plain text is NOT supported - use HTML or JSON explicitly.
 */
import type { Schema} from '@domternal/pm/model';
import { Node as PMNode, DOMParser, Fragment } from '@domternal/pm/model';
import type { Content, JSONContent } from '../types/index.js';

const LIST_WRAPPER_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

/**
 * True for the content-fitter artifact: a list whose only content is one item
 * holding a single empty paragraph. When HTML mixes item types in one `<ul>`
 * (e.g. a `data-type="taskItem"` first), the parser opens a bulletList, finds
 * it cannot hold the taskItem, and closes the bulletList - filling its required
 * `listItem > paragraph` with an empty placeholder the author never wrote.
 */
function isEmptyPlaceholderList(node: PMNode): boolean {
  if (!LIST_WRAPPER_TYPES.has(node.type.name) || node.childCount !== 1) return false;
  const item = node.child(0);
  return item.childCount === 1
    && item.child(0).type.name === 'paragraph'
    && item.child(0).content.size === 0;
}

/**
 * Drops the fitter artifact above: an empty single-item placeholder list that
 * sits immediately before a DIFFERENT-type list (the list it was split from).
 * Scoped tightly to that signature so authored empty lists are left alone.
 * Recurses so the artifact is removed at whatever depth the mixed list parsed.
 */
function stripFitterArtifacts(node: PMNode): PMNode {
  if (!node.isBlock || node.isLeaf) return node;

  const children: PMNode[] = [];
  node.forEach((child) => children.push(stripFitterArtifacts(child)));

  const kept: PMNode[] = [];
  children.forEach((cur, i) => {
    const next: PMNode | undefined = children[i + 1];
    if (
      isEmptyPlaceholderList(cur)
      && next
      && LIST_WRAPPER_TYPES.has(next.type.name)
      && next.type !== cur.type
    ) {
      return; // drop the content-fitter artifact
    }
    kept.push(cur);
  });

  // Reconstruct only when filtering dropped a node or recursion replaced one.
  const unchanged = kept.length === node.childCount && kept.every((c, i) => c === node.child(i));
  return unchanged ? node : node.copy(Fragment.fromArray(kept));
}

/**
 * Options for createDocument
 */
export interface CreateDocumentOptions {
  /**
   * Parse options passed to DOMParser
   */
  parseOptions?: Parameters<DOMParser['parse']>[1];
}

/**
 * Checks if content is a JSON object (has 'type' property)
 */
function isJSONContent(content: unknown): content is JSONContent {
  return (
    typeof content === 'object' &&
    content !== null &&
    'type' in content &&
    typeof (content as JSONContent).type === 'string'
  );
}

/**
 * Checks if content is an HTML string (starts with '<')
 *
 * SECURITY NOTE: This function only checks if the string looks like HTML.
 * It does NOT sanitize content. If you're accepting user-provided content,
 * sanitize it before passing to the editor (e.g., using DOMPurify).
 */
function isHTMLContent(content: unknown): content is string {
  return typeof content === 'string' && content.trim().startsWith('<');
}

/**
 * Creates an empty document with a single empty paragraph
 */
function createEmptyDocument(schema: Schema): PMNode {
  const paragraphType = schema.nodes['paragraph'];

  if (paragraphType) {
    return schema.node('doc', null, [paragraphType.create()]);
  }

  // Fallback: create doc with whatever the first block type is
  // Try to find the first allowed node type
  for (const [name, nodeType] of Object.entries(schema.nodes)) {
    if (name !== 'doc' && name !== 'text' && nodeType.isBlock) {
      return schema.node('doc', null, [nodeType.create()]);
    }
  }

  // Last resort: empty doc (might be invalid for some schemas)
  return schema.node('doc', null, []);
}

/**
 * Parses HTML string into a ProseMirror document
 */
function parseHTMLContent(
  html: string,
  schema: Schema,
  options?: CreateDocumentOptions
): PMNode {
  // Create a temporary DOM element to parse the HTML
  const element = document.createElement('div');
  element.innerHTML = html;

  const parser = DOMParser.fromSchema(schema);
  return stripFitterArtifacts(parser.parse(element, options?.parseOptions));
}

/**
 * Creates a ProseMirror document from content
 *
 * **Security:** Content is NOT sanitized. If accepting user-provided HTML,
 * sanitize it first (e.g., using DOMPurify) to prevent XSS attacks.
 *
 * @param content - JSON content object, HTML string, or null/undefined
 * @param schema - ProseMirror schema to use
 * @param options - Optional parse options
 * @returns ProseMirror Node (document)
 *
 * @throws Error if content format is invalid (plain text without HTML tags)
 *
 * @example
 * ```ts
 * // JSON content
 * const doc = createDocument(
 *   { type: 'doc', content: [{ type: 'paragraph' }] },
 *   schema
 * );
 *
 * // HTML content
 * const doc = createDocument('<p>Hello world</p>', schema);
 *
 * // Empty document
 * const doc = createDocument(null, schema);
 * ```
 */
export function createDocument(
  content: Content | null | undefined,
  schema: Schema,
  options?: CreateDocumentOptions
): PMNode {
  // Handle null/undefined/empty string - create empty document
  if (content === null || content === undefined || content === '') {
    return createEmptyDocument(schema);
  }

  // Handle JSON content
  if (isJSONContent(content)) {
    return PMNode.fromJSON(schema, content);
  }

  // Handle HTML string
  if (isHTMLContent(content)) {
    return parseHTMLContent(content, schema, options);
  }

  // Handle plain text string (not allowed per AD-11)
  if (typeof content === 'string') {
    throw new Error(
      'Invalid content format: plain text is not supported. ' +
        'Use HTML string (e.g., "<p>Hello</p>") or JSON content object instead.'
    );
  }

  // Unknown content type
  throw new Error(
    `Invalid content format: expected JSON object with 'type' property or HTML string, ` +
      `got ${typeof content}`
  );
}
