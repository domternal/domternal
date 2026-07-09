/**
 * Markdown serializer state machine. Same output semantics as
 * prosemirror-markdown's serializer (delimiter stacking, tight lists, mark
 * mixing, enclosing-whitespace expelling) but built on `@domternal/pm` so the
 * package never pulls in a second prosemirror-model instance.
 */
import type { Mark, Node as PMNode } from '@domternal/pm/model';
import type { MarkdownWarning, MarkdownWarningCode } from '../types.js';

export type MarkdownNodeSerializer = (
  state: MarkdownSerializerState,
  node: PMNode,
  parent: PMNode,
  index: number
) => void;

type MarkDelimiter =
  | string
  | ((state: MarkdownSerializerState, mark: Mark, parent: PMNode, index: number) => string);

export interface MarkdownMarkSpec {
  open: MarkDelimiter;
  close: MarkDelimiter;
  /** Marks that can be reordered against other mixable marks to minimize delimiters. */
  mixable?: boolean;
  /** Move leading/trailing whitespace outside the delimiters (`**a ** b` is invalid emphasis). */
  expelEnclosingWhitespace?: boolean;
  /** Set false when the mark content is raw (inline code). */
  escape?: boolean;
}

export interface MarkdownSerializerSpecs {
  nodes: Record<string, MarkdownNodeSerializer>;
  marks: Record<string, MarkdownMarkSpec>;
}

export interface MarkdownSerializerOptions {
  /**
   * Render lists without blank lines between items.
   * @default true
   */
  tightLists?: boolean;
}

const BACKTICKS = /`+/g;

/** Longest backtick run inside inline code decides the fence length around it. */
export function backticksFor(node: PMNode, side: -1 | 1): string {
  let len = 0;
  const text = node.isText ? (node.text ?? '') : '';
  for (const match of text.matchAll(BACKTICKS)) {
    len = Math.max(len, match[0].length);
  }
  const result = len > 0 ? '`'.repeat(len + 1) : '`';
  if (side === -1) return result + (text.startsWith('`') ? ' ' : '');
  return (text.endsWith('`') ? ' ' : '') + result;
}

export class MarkdownSerializerState {
  readonly nodes: Record<string, MarkdownNodeSerializer>;
  readonly marks: Record<string, MarkdownMarkSpec>;
  readonly warnings: MarkdownWarning[] = [];
  readonly tightLists: boolean;

  private delim = '';
  private out = '';
  private closed: PMNode | null = null;
  private inTightList = false;
  // True until the first content of a textblock is written; drives
  // start-of-line escaping (a list item's first line starts after `- `,
  // which the output buffer alone cannot reveal).
  private atBlockStart = false;

  constructor(specs: MarkdownSerializerSpecs, options: MarkdownSerializerOptions = {}) {
    this.nodes = specs.nodes;
    this.marks = specs.marks;
    this.tightLists = options.tightLists ?? true;
  }

  warn(code: MarkdownWarningCode, message: string, nodeType?: string): void {
    const duplicate = this.warnings.some(
      (w) => w.code === code && w.message === message && w.nodeType === nodeType
    );
    if (duplicate) return;
    this.warnings.push(nodeType === undefined ? { code, message } : { code, message, nodeType });
  }

  private flushClose(size = 2): void {
    if (this.closed === null) return;
    if (!this.atBlank()) this.out += '\n';
    if (size > 1) {
      let delimMin = this.delim;
      const trim = /\s+$/.exec(delimMin);
      if (trim) delimMin = delimMin.slice(0, delimMin.length - trim[0].length);
      for (let i = 1; i < size; i++) this.out += delimMin + '\n';
    }
    this.closed = null;
  }

  /**
   * Render a block wrapped in a line prefix: `firstDelim` on its first line,
   * `delim` on every following line (blockquote `> `, list item indent).
   */
  wrapBlock(delim: string, firstDelim: string | null, node: PMNode, f: () => void): void {
    const old = this.delim;
    this.write(firstDelim ?? delim);
    this.delim += delim;
    f();
    this.delim = old;
    this.closeBlock(node);
  }

  atBlank(): boolean {
    return /(^|\n)$/.test(this.out);
  }

  ensureNewLine(): void {
    if (!this.atBlank()) this.out += '\n';
  }

  write(content?: string): void {
    this.flushClose();
    if (this.delim !== '' && this.atBlank()) this.out += this.delim;
    if (content !== undefined) this.out += content;
  }

  /** Close the block: the next write emits the separating blank line. */
  closeBlock(node: PMNode): void {
    this.closed = node;
  }

  text(text: string, escape = true): void {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      this.write();
      const line = lines[i] ?? '';
      // A `!` before a link open delimiter would turn the link into an image.
      if (!escape && line.startsWith('[') && /(^|[^\\])!$/.test(this.out)) {
        this.out = this.out.slice(0, this.out.length - 1) + '\\!';
      }
      this.out += escape ? this.esc(line, this.atBlockStart) : line;
      if (i !== lines.length - 1) this.out += '\n';
    }
  }

  render(node: PMNode, parent: PMNode, index: number): void {
    const serializer = this.nodes[node.type.name];
    if (serializer === undefined) {
      this.warn(
        'unsupported-node',
        node.type.isLeaf
          ? `Node type "${node.type.name}" has no Markdown mapping; node omitted`
          : `Node type "${node.type.name}" has no Markdown mapping; content flattened`,
        node.type.name
      );
      if (!node.type.isLeaf) {
        if (node.type.inlineContent) {
          this.renderInline(node);
        } else {
          this.renderContent(node);
        }
      }
      if (node.isBlock) this.closeBlock(node);
      return;
    }
    serializer(this, node, parent, index);
  }

  renderContent(parent: PMNode): void {
    parent.forEach((node, _offset, index) => {
      this.render(node, parent, index);
    });
  }

  renderInline(parent: PMNode, fromBlockStart = true): void {
    this.atBlockStart = fromBlockStart;
    const active: Mark[] = [];
    let trailing = '';

    const progress = (node: PMNode | null, index: number): void => {
      let marks: readonly Mark[] = node ? node.marks : [];

      // Unknown marks: drop with a warning instead of crashing mid-document.
      marks = marks.filter((mark) => {
        if (this.marks[mark.type.name] !== undefined) return true;
        this.warn(
          'unsupported-mark',
          `Mark type "${mark.type.name}" has no Markdown mapping; formatting dropped`,
          mark.type.name
        );
        return false;
      });

      // A mark ending exactly at a hard break would close right after the
      // trailing backslash, where the delimiter cannot close. Keep only
      // marks that continue past the break.
      if (node !== null && node.type.name === 'hardBreak') {
        marks = marks.filter((mark) => {
          if (index + 1 === parent.childCount) return false;
          const next = parent.child(index + 1);
          return mark.isInSet(next.marks) && (!next.isText || /\S/.test(next.text ?? ''));
        });
      }

      let leading = trailing;
      trailing = '';

      // Expel enclosing whitespace outside mark delimiters.
      if (
        node?.isText === true &&
        marks.some((mark) => {
          const spec = this.marks[mark.type.name];
          return spec?.expelEnclosingWhitespace === true;
        })
      ) {
        const text = node.text ?? '';
        const match = /^(\s*)(.*?)(\s*)$/s.exec(text);
        if (match) {
          const [, lead = '', inner = '', trail = ''] = match;
          if (lead !== '' || trail !== '') {
            leading += lead;
            trailing = trail;
            if (inner === '') {
              // Whitespace-only node: keep the active marks open across it
              // instead of closing and reopening the delimiters.
              marks = active.slice();
              node = null;
            } else {
              node = (node as PMNode & { withText: (t: string) => PMNode }).withText(inner);
            }
          }
        }
      }

      const inner = marks.length > 0 ? marks[marks.length - 1] : undefined;
      const noEsc = inner !== undefined && this.marks[inner.type.name]?.escape === false;
      const len = marks.length - (noEsc ? 1 : 0);

      // Try to reorder mixable marks so shared marks stay adjacent and reuse
      // one delimiter pair.
      outer: for (let i = 0; i < len; i++) {
        const mark = marks[i];
        if (mark === undefined) break;
        if (this.marks[mark.type.name]?.mixable !== true) break;
        for (let j = 0; j < active.length; j++) {
          const other = active[j];
          if (other === undefined) break;
          if (this.marks[other.type.name]?.mixable !== true) break;
          if (mark.eq(other)) {
            if (i > j) {
              marks = [
                ...marks.slice(0, j),
                mark,
                ...marks.slice(j, i),
                ...marks.slice(i + 1, len),
              ];
            } else if (j > i) {
              marks = [
                ...marks.slice(0, i),
                ...marks.slice(i + 1, j),
                mark,
                ...marks.slice(j, len),
              ];
            }
            continue outer;
          }
        }
      }

      // Close marks that are no longer active.
      let keep = 0;
      while (keep < Math.min(active.length, len)) {
        const activeMark = active[keep];
        const nextMark = marks[keep];
        if (activeMark === undefined || nextMark === undefined) break;
        if (!activeMark.eq(nextMark)) break;
        keep += 1;
      }
      while (keep < active.length) {
        const mark = active.pop();
        if (mark === undefined) break;
        this.text(this.markString(mark, false, parent, index), false);
      }

      // Emit expelled leading whitespace between close and open.
      if (leading !== '') this.text(leading);

      // Open marks that became active.
      if (node !== null) {
        while (active.length < len) {
          const mark = marks[active.length];
          if (mark === undefined) break;
          active.push(mark);
          this.text(this.markString(mark, true, parent, index), false);
          this.atBlockStart = false;
        }

        if (inner !== undefined && noEsc && node.isText) {
          this.text(
            this.markString(inner, true, parent, index) +
              (node.text ?? '') +
              this.markString(inner, false, parent, index + 1),
            false
          );
        } else {
          this.render(node, parent, index);
        }
        this.atBlockStart = false;
      }
    };

    parent.forEach((node, _offset, index) => {
      progress(node, index);
    });
    progress(null, parent.childCount);
    this.atBlockStart = false;
  }

  renderList(node: PMNode, delim: string, firstDelim: (index: number) => string): void {
    if (this.closed !== null && this.closed.type === node.type) {
      this.flushClose(3);
    } else if (this.inTightList) {
      this.flushClose(1);
    }

    const isTight = this.tightLists;
    const prevTight = this.inTightList;
    this.inTightList = isTight;
    node.forEach((child, _offset, index) => {
      if (index > 0 && isTight) this.flushClose(1);
      this.wrapBlock(delim, firstDelim(index), node, () => {
        this.render(child, node, index);
      });
    });
    this.inTightList = prevTight;
  }

  /**
   * Escape Markdown syntax in plain text. Beyond the CommonMark set this
   * also escapes `|` (table cells), `$` (this package's own math rules), and
   * `<` plus entity-like `&` (raw-HTML/autolink/entity ambiguity on external
   * renderers): all render as the literal character everywhere.
   */
  esc(str: string, startOfLine = false): string {
    let escaped = str.replace(/[`*\\~[\]_<$]/g, (m, i: number) =>
      m === '_' && i > 0 && i + 1 < str.length && /\w/.test(str[i - 1] ?? '') && /\w/.test(str[i + 1] ?? '')
        ? m
        : '\\' + m
    );
    if (startOfLine) {
      escaped = escaped
        .replace(/^([-*>]|\+ )/, '\\$&')
        .replace(/^(\s*)(#{1,6})(\s|$)/, '$1\\$2$3')
        .replace(/^(\s*\d+)\.(\s|$)/, '$1\\.$2');
    }
    return escaped.replace(/\|/g, '\\|').replace(/&(?=[a-z#])/gi, '\\&');
  }

  markString(mark: Mark, open: boolean, parent: PMNode, index: number): string {
    const spec = this.marks[mark.type.name];
    if (spec === undefined) return '';
    const value = open ? spec.open : spec.close;
    return typeof value === 'string' ? value : value(this, mark, parent, index);
  }

  /** The accumulated output; call once after rendering the document. */
  finish(): string {
    return this.out;
  }
}
