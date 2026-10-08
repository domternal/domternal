/**
 * markdown-it rules for LaTeX math: `$...$` and `` $`...`$ `` inline, and
 * `$$` blocks (a `math` code fence is mapped by the parser). Only registered
 * when the schema actually has the math nodes.
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

/**
 * `` $`...`$ ``: inline math in the code span form GitHub and GitLab read,
 * which the serializer writes when the LaTeX holds something that could end
 * `$...$` early. The closing backtick run has the opening run's length and
 * is followed by `$`; line breaks read as spaces, and one space is dropped at
 * each end when both ends have one, as in a code span.
 */
const mathInlineCodeRule: RuleInline = (state, silent) => {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x24 /* $ */ || state.src.charCodeAt(start + 1) !== 0x60 /* ` */) return false;
  let open = start + 1;
  while (open < state.posMax && state.src.charCodeAt(open) === 0x60) open += 1;
  const length = open - start - 1;
  let pos = open;
  while (pos < state.posMax) {
    if (state.src.charCodeAt(pos) !== 0x60) {
      pos += 1;
      continue;
    }
    let run = pos;
    while (run < state.posMax && state.src.charCodeAt(run) === 0x60) run += 1;
    if (run - pos === length && run < state.posMax && state.src.charCodeAt(run) === 0x24) {
      if (!silent) {
        let content = state.src.slice(open, pos).replace(/\n/g, ' ');
        if (/^ [\s\S]* $/.test(content) && content.trim() !== '') content = content.slice(1, -1);
        const token = state.push('math_inline', '', 0);
        token.content = content;
      }
      state.pos = run + 1;
      return true;
    }
    pos = run;
  }
  return false;
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
  md.inline.ruler.after('escape', 'math_inline_code', mathInlineCodeRule);
  md.inline.ruler.after('math_inline_code', 'math_inline', mathInlineRule);
}

export function addMathBlockRule(md: MarkdownIt): void {
  // The alt list lets $$ interrupt a paragraph, the same way fences do.
  md.block.ruler.after('fence', 'math_block', mathBlockRule, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
}
