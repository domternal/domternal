/**
 * markdown-it rules for LaTeX math: `$...$` inline and `$$` blocks. Only
 * registered when the schema actually has the math nodes.
 */
import type MarkdownIt from 'markdown-it';

type RuleInline = Parameters<MarkdownIt['inline']['ruler']['after']>[2];
type RuleBlock = Parameters<MarkdownIt['block']['ruler']['after']>[2];

const mathInlineRule: RuleInline = (state, silent) => {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x24 /* $ */) return false;
  if (state.src.charCodeAt(start + 1) === 0x24) return false;

  let pos = start + 1;
  while (pos < state.posMax) {
    const code = state.src.charCodeAt(pos);
    if (code === 0x5c /* \ */) {
      // Skip escaped characters so \$ inside the formula does not terminate.
      pos += 2;
      continue;
    }
    if (code === 0x24) break;
    if (code === 0x0a /* \n */) return false;
    pos += 1;
  }
  if (pos >= state.posMax || pos === start + 1) return false;
  // Currency guards, matching the usual $-math conventions: no whitespace
  // right after the opening or before the closing dollar, and no digit
  // right after the closing one ("$5 and $10").
  if (/\s/.test(state.src.charAt(start + 1))) return false;
  if (/\s/.test(state.src.charAt(pos - 1))) return false;
  if (/\d/.test(state.src.charAt(pos + 1))) return false;

  if (!silent) {
    const token = state.push('math_inline', '', 0);
    token.content = state.src.slice(start + 1, pos);
  }
  state.pos = pos + 1;
  return true;
};

const mathBlockRule: RuleBlock = (state, startLine, endLine, silent) => {
  const start = (state.bMarks[startLine] ?? 0) + (state.tShift[startLine] ?? 0);
  const lineEnd = state.eMarks[startLine];
  const firstLine = state.src.slice(start, lineEnd);
  if (!firstLine.startsWith('$$')) return false;

  const singleLine = firstLine.length > 4 && firstLine.endsWith('$$');
  if (!singleLine && firstLine.trim() !== '$$') return false;
  if (silent) return true;

  let content: string;
  let nextLine = startLine + 1;
  if (singleLine) {
    content = firstLine.slice(2, -2).trim();
  } else {
    const lines: string[] = [];
    let closed = false;
    for (; nextLine < endLine; nextLine++) {
      const lineStart = (state.bMarks[nextLine] ?? 0) + (state.tShift[nextLine] ?? 0);
      const line = state.src.slice(lineStart, state.eMarks[nextLine]);
      if (line.trim() === '$$') {
        closed = true;
        nextLine += 1;
        break;
      }
      lines.push(line);
    }
    if (!closed) return false;
    content = lines.join('\n');
  }

  const token = state.push('math_block', '', 0);
  token.content = content;
  token.map = [startLine, singleLine ? startLine + 1 : nextLine];
  state.line = singleLine ? startLine + 1 : nextLine;
  return true;
};

export function addMathInlineRule(md: MarkdownIt): void {
  md.inline.ruler.after('escape', 'math_inline', mathInlineRule);
}

export function addMathBlockRule(md: MarkdownIt): void {
  // The alt list lets $$ interrupt a paragraph, the same way fences do.
  md.block.ruler.after('fence', 'math_block', mathBlockRule, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
}
