/**
 * Clipboard HTML copied from a ProseMirror editor marks its first element with
 * `data-pm-slice`: the slice's open depths, an optional count of table
 * wrappers to descend into, and a JSON context of the wrapper nodes the copied
 * content sat in. prosemirror-view rebuilds those wrappers around the pasted
 * slice without checking that they can hold it, so a crafted context can make
 * the paste throw, which also lets the browser run its native paste. These
 * helpers keep a pasted slice within what ProseMirror itself writes.
 */
import { Slice } from '@domternal/pm/model';
import type { Node as PMNode, NodeType, Schema } from '@domternal/pm/model';

// The marker as prosemirror-view's parseFromClipboard reads it.
const SLICE_DATA = /^(\d+) (\d+)(?: -(\d+))? (.*)/;
const SLICE_ATTRIBUTE = /data-pm-slice/i;
// The marker attribute as written in a start tag: its name, then a quoted or unquoted value.
const MARKER_ATTRIBUTE = /data-pm-slice\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi;
// Each written mention of the attribute is rewritten and read back in turn, so HTML that
// mentions it more often before its marker, in text or comments, is left to the slice repair.
const MAX_MARKER_REWRITES = 8;
// ProseMirror's copy records one wrapper per ancestor of the copied content. A context
// nesting far deeper than any document can overflow the stack while it is pasted.
const MAX_CONTEXT_WRAPPERS = 512;
// prosemirror-view's readHTML strips leading meta tags and wraps a leading
// table part in the ancestors the HTML parser needs to keep it.
const LEADING_METAS = /^(\s*<meta [^>]*>)*/;
const FIRST_TAG = /<([a-z][^>\s]+)/i;
const WRAP_MAP: Readonly<Record<string, readonly string[]>> = {
  thead: ['table'],
  tbody: ['table'],
  tfoot: ['table'],
  caption: ['table'],
  colgroup: ['table'],
  col: ['table', 'colgroup'],
  tr: ['table', 'tbody'],
  td: ['table', 'tbody', 'tr'],
  th: ['table', 'tbody', 'tr'],
};

/** The element prosemirror-view parses clipboard HTML from, read the same way in a detached document. */
function readClipboardHTML(html: string): Element {
  html = html.replace(LEADING_METAS, '');
  const doc = document.implementation.createHTMLDocument('title');
  let root: Element = doc.body;
  const firstTag = FIRST_TAG.exec(html)?.[1]?.toLowerCase();
  const wrap = firstTag !== undefined && Object.hasOwn(WRAP_MAP, firstTag) ? WRAP_MAP[firstTag] : undefined;
  if (wrap) html = wrap.map(name => `<${name}>`).join('') + html + wrap.map(name => `</${name}>`).reverse().join('');
  root.innerHTML = html;
  if (wrap) for (const name of wrap) root = root.querySelector(name) ?? root;
  return root;
}

/**
 * A node type ProseMirror's copy never records as context for Domternal's
 * nodes. Text, a leaf and the top node never hold a single open child; a
 * textblock or an inline node does only around an inline node with content,
 * which no Domternal node is, so for an application node of that kind the
 * content pastes as it would without the context.
 */
function neverWrittenContext(type: NodeType, schema: Schema): boolean {
  return type.isText || type.isInline || type.isLeaf || type.isTextblock || type === schema.topNodeType;
}

/**
 * Whether a JSON context is one ProseMirror's copy could not have written.
 * The entries are judged as prosemirror-view's addContext applies them: from
 * the innermost outward, stopping at a type the schema lacks or one with
 * required attributes. A context of more than 512 wrappers counts too, as no
 * document nests that deep. A context that is not JSON is ignored by ProseMirror.
 */
export function isUnwritableSliceContext(context: string, schema: Schema): boolean {
  let entries: unknown;
  try { entries = JSON.parse(context); } catch { return false; }
  if (!Array.isArray(entries) || Math.floor(entries.length / 2) > MAX_CONTEXT_WRAPPERS) return true;
  const types = schema.nodes as Readonly<Record<string, NodeType | undefined>>;
  for (let index = entries.length - 2; index >= 0; index -= 2) {
    // Property access converts the name the same way ProseMirror's lookup does.
    const type = types[String(entries[index])];
    if (type === undefined || type.hasRequiredAttrs()) break;
    if (neverWrittenContext(type, schema)) return true;
  }
  return false;
}

/** The tree without its marker attributes, which ProseMirror's parse of the content never reads. */
function withoutMarkers(root: Element): Node {
  const copy = root.cloneNode(true) as Element;
  copy.removeAttribute('data-pm-slice');
  copy.querySelectorAll('[data-pm-slice]').forEach(marked => { marked.removeAttribute('data-pm-slice'); });
  return copy;
}

/**
 * The HTML as written with only its marker's value replaced: each written marker
 * attribute is tried in turn, and a rewrite counts only when ProseMirror would
 * read the same tree from it with that value on its first marker. Nothing is
 * serialized, so a tree the HTML parser would build differently from its own
 * serialization, such as a preformatted block that starts with a blank line,
 * keeps its content. Undefined when no rewrite reads back that way.
 */
function rewriteMarker(html: string, root: Element, value: string): string | undefined {
  const expected = withoutMarkers(root);
  let rewrites = 0;
  for (const match of html.matchAll(MARKER_ATTRIBUTE)) {
    if (++rewrites > MAX_MARKER_REWRITES) return undefined;
    const rewritten = `${html.slice(0, match.index)}data-pm-slice="${value}"${html.slice(match.index + match[0].length)}`;
    const read = readClipboardHTML(rewritten);
    if (read.querySelector('[data-pm-slice]')?.getAttribute('data-pm-slice') === value && withoutMarkers(read).isEqualNode(expected)) {
      return rewritten;
    }
  }
  return undefined;
}

/**
 * Empties a `data-pm-slice` context that ProseMirror's copy never writes, so
 * the HTML pastes as it would with an empty context. The open depths and the
 * table wrapper count stay, and the rest of the HTML stays as written. HTML
 * without such a context is returned as given, and so is HTML that cannot be
 * read, as under a Trusted Types policy that refuses it, or whose marker cannot
 * be rewritten where the parser read it; the slice repair still applies there.
 */
export function guardSliceContextHTML(html: string, schema: Schema): string {
  if (!SLICE_ATTRIBUTE.test(html)) return html;
  try {
    const root = readClipboardHTML(html);
    const marker = root.querySelector('[data-pm-slice]');
    const data = SLICE_DATA.exec(marker?.getAttribute('data-pm-slice') ?? '');
    const context = data?.[4];
    if (!marker || !data || context === undefined || !isUnwritableSliceContext(context, schema)) return html;
    // The open depths and the table wrapper count, as written, before the context.
    return rewriteMarker(html, root, `${data[0].slice(0, data[0].length - context.length)}[]`) ?? html;
  } catch {
    return html;
  }
}

/**
 * Removes the context wrappers at the top of a pasted slice that cannot hold
 * their content, down to and including the deepest one. Only a clipboard
 * context produces such a wrapper: prosemirror-view nests the slice in it
 * without checking, and replacing the selection with it would throw. The
 * slice keeps its content and both open depths drop by the removed levels.
 * Every other slice is returned as given.
 */
export function repairSliceContext(slice: Slice): Slice {
  const depth = Math.min(slice.openStart, slice.openEnd);
  let node: PMNode | null = slice.content.childCount === 1 ? slice.content.firstChild : null;
  let cut: { level: number; node: PMNode } | undefined;
  for (let level = 0; node !== null && level < depth; level++) {
    if (node.type.contentMatch.fillBefore(node.content) === null) cut = { level, node };
    if (node.childCount !== 1) break;
    node = node.firstChild;
  }
  if (cut === undefined) return slice;
  return new Slice(cut.node.content, slice.openStart - cut.level - 1, slice.openEnd - cut.level - 1);
}
