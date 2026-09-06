/**
 * Markdown paste: when the clipboard carries plain text that looks like
 * Markdown, including syntax-highlighted source HTML, parse it into rich content.
 * Plain prose, bare URLs (linkPastePlugin territory), and code block targets pass through.
 */
import { Slice } from '@domternal/pm/model';
import { Plugin, PluginKey } from '@domternal/pm/state';
import type { MarkdownParser } from './parser/parser.js';

export const markdownPastePluginKey = new PluginKey('markdownPaste');

// Bounded quantifiers: unbounded `+` goes quadratic on pathological pastes
// like thousands of `[` (CodeQL); 999 covers any real span or row.
const BLOCK_SYNTAX =
  /^(#{1,6} |> |[-*+] |\d+\. |```|\$\$|\[( |x|X)\] |\|.{1,999}\||(---|\*\*\*|___)\s*$)/m;
const INLINE_SYNTAX =
  /(\*\*[^*\n]{1,999}\*\*|__[^_\n]{1,999}__|\[[^\]\n]{1,999}\]\([^)\n]{1,999}\)|`[^`\n]{1,999}`|~~[^~\n]{1,999}~~|!\[[^\]\n]{0,999}\]\([^)\n]{1,999}\))/;

export function looksLikeMarkdown(text: string): boolean {
  return BLOCK_SYNTAX.test(text) || INLINE_SYNTAX.test(text);
}

/** Accept source formatting only when it represents the same literal text. */
function isMarkdownSourceHTML(html: string, text: string, ownerDocument: Document): boolean {
  const template = ownerDocument.createElement('template');
  template.innerHTML = html;
  const elements = template.content.querySelectorAll('*');
  const preservesSpaces = (value: string): boolean =>
    value === 'pre' || value === 'pre-wrap' || value === 'break-spaces';
  let preservesWhitespace = false;

  for (const element of Array.from(elements)) {
    // Editor slices and semantic content must keep their original structure.
    if (element.hasAttribute('data-pm-slice') || element.hasAttribute('data-type')) return false;
    const tag = element.tagName;
    if (tag === 'META' && element.hasAttribute('charset') && element.attributes.length === 1) {
      continue;
    }
    if (!['PRE', 'DIV', 'SPAN', 'BR'].includes(tag)) return false;
    if (tag === 'PRE' || preservesSpaces((element as HTMLElement).style.whiteSpace)) {
      preservesWhitespace = true;
    }
  }
  if (!preservesWhitespace) return false;

  const chunks: string[] = [];
  const output = { length: 0, endsWithNewline: false };
  const append = (value: string): void => {
    if (value === '') return;
    chunks.push(value);
    output.length += value.length;
    output.endsWithNewline = value.endsWith('\n');
  };
  interface Frame {
    node: Node;
    sourceWhitespace?: boolean;
    blockStart?: number;
  }
  const stack: Frame[] = [{ node: template.content }];

  // An explicit stack also handles deeply nested source spans without recursion.
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) break;
    if (entry.blockStart !== undefined) {
      if (output.length === entry.blockStart || !output.endsWithNewline) append('\n');
      continue;
    }
    const { node } = entry;
    if (node.nodeType === 3) {
      const value = node.nodeValue ?? '';
      if (entry.sourceWhitespace !== true && value.trim() !== '') return false;
      append(value);
      continue;
    }
    const whitespace = node.nodeType === 1 ? (node as HTMLElement).style.whiteSpace : '';
    const sourceWhitespace =
      whitespace === ''
        ? node.nodeName === 'PRE' || entry.sourceWhitespace === true
        : preservesSpaces(whitespace);
    if (node.nodeName === 'BR') {
      append('\n');
      continue;
    }
    const isBlock = node.nodeName === 'DIV' || node.nodeName === 'PRE';
    if (isBlock) {
      if (output.length > 0 && !output.endsWithNewline) append('\n');
      stack.push({ node, blockStart: output.length });
    }
    for (let child = node.lastChild; child !== null; child = child.previousSibling) {
      stack.push({ node: child, sourceWhitespace });
    }
  }

  const normalize = (value: string): string =>
    value.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
  let rendered = normalize(chunks.join(''));
  let source = normalize(text);
  // A block wrapper may add one final line break, or a clipboard flavor may omit it.
  const trailingLines = (value: string): number => {
    let offset = value.length;
    while (offset > 0 && value[offset - 1] === '\n') offset--;
    return value.length - offset;
  };
  const finalLineDifference = trailingLines(rendered) - trailingLines(source);
  if (finalLineDifference === 1) rendered = rendered.slice(0, -1);
  else if (finalLineDifference === -1) source = source.slice(0, -1);
  if (rendered === source) return true;
  if (!source.includes('\t')) return false;

  // Source editors expand tabs for HTML display. Only those whitespace runs
  // may differ; the parser still receives the original text and its indentation.
  let renderedOffset = 0;
  let sourceOffset = 0;
  while (sourceOffset < source.length) {
    const character = source[sourceOffset];
    if (character === ' ' || character === '\t') {
      let spaces = 0;
      let tabs = 0;
      while (source[sourceOffset] === ' ' || source[sourceOffset] === '\t') {
        if (source[sourceOffset] === '\t') tabs++;
        else spaces++;
        sourceOffset++;
      }
      const renderedStart = renderedOffset;
      while (rendered[renderedOffset] === ' ') renderedOffset++;
      const renderedSpaces = renderedOffset - renderedStart;
      if (tabs > 0 ? renderedSpaces < spaces + tabs : renderedSpaces !== spaces) return false;
    } else {
      if (rendered[renderedOffset] !== character) return false;
      renderedOffset++;
      sourceOffset++;
    }
  }
  return renderedOffset === rendered.length;
}

export function markdownPastePlugin(getParser: () => MarkdownParser): Plugin {
  return new Plugin({
    key: markdownPastePluginKey,
    props: {
      handlePaste(view, event) {
        const clipboard = event.clipboardData;
        if (clipboard === null) return false;
        const text = clipboard.getData('text/plain');
        if (text === '' || !looksLikeMarkdown(text)) return false;
        // Inside code blocks, pasted text stays literal.
        if (view.state.selection.$from.parent.type.spec.code === true) return false;

        let doc;
        try {
          const html = clipboard.getData('text/html');
          if (html !== '' && !isMarkdownSourceHTML(html, text, view.dom.ownerDocument))
            return false;
          doc = getParser().parse(text);
        } catch {
          // A parser failure must fall back to the default plain-text paste,
          // never escape the paste event handler.
          return false;
        }
        const first = doc.content.firstChild;
        const slice =
          doc.content.childCount === 1 && first !== null && first.type.name === 'paragraph'
            ? new Slice(first.content, 0, 0)
            : new Slice(doc.content, 0, 0);
        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
        return true;
      },
    },
  });
}
