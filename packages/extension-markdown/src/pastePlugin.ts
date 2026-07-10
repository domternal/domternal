/**
 * Markdown paste: when the clipboard carries plain text that looks like
 * Markdown (and no HTML flavor), parse it into rich content. Plain prose,
 * bare URLs (linkPastePlugin territory), and code block targets pass through.
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

export function markdownPastePlugin(getParser: () => MarkdownParser): Plugin {
  return new Plugin({
    key: markdownPastePluginKey,
    props: {
      handlePaste(view, event) {
        const clipboard = event.clipboardData;
        if (clipboard === null) return false;
        // An HTML flavor means a rich source; ProseMirror's own paste
        // handling preserves more fidelity than a Markdown reparse.
        if (clipboard.getData('text/html') !== '') return false;
        const text = clipboard.getData('text/plain');
        if (text === '' || !looksLikeMarkdown(text)) return false;
        // Inside code blocks, pasted text stays literal.
        if (view.state.selection.$from.parent.type.spec.code === true) return false;

        let doc;
        try {
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
