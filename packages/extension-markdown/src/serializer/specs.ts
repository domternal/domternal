/**
 * Default Markdown mappings for the full Domternal schema (GitHub-flavored
 * output). Anything Markdown cannot express degrades to plain content plus a
 * warning instead of raw HTML: the output stays valid everywhere.
 */
import type { Mark, Node as PMNode } from '@domternal/pm/model';
import {
  backticksFor,
  MarkdownSerializerState,
  type MarkdownMarkSpec,
  type MarkdownNodeSerializer,
} from './state.js';

function attrString(node: PMNode, name: string): string | null {
  const value: unknown = node.attrs[name];
  return typeof value === 'string' && value !== '' ? value : null;
}

function attrNumber(node: PMNode, name: string): number | null {
  const value: unknown = node.attrs[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Block attrs from TextAlign/LineHeight/BlockColor that Markdown cannot carry. */
function warnLossyBlockAttrs(state: MarkdownSerializerState, node: PMNode): void {
  const textAlign = attrString(node, 'textAlign');
  if (textAlign !== null && textAlign !== 'left') {
    state.warn('lossy-attribute', 'Text alignment is not representable in Markdown', node.type.name);
  }
  if (attrString(node, 'lineHeight') !== null) {
    state.warn('lossy-attribute', 'Line height is not representable in Markdown', node.type.name);
  }
  if (
    attrString(node, 'backgroundColor') !== null ||
    attrString(node, 'backgroundColorToken') !== null
  ) {
    state.warn('lossy-attribute', 'Block background color is not representable in Markdown', node.type.name);
  }
}

function escapeLinkDestination(url: string): string {
  // Backslash included: a literal `\` must not neutralize the next escape.
  return url.replace(/[\\()"]/g, '\\$&');
}

function escapeLinkTitle(title: string): string {
  return title.replace(/[\\"]/g, '\\$&');
}

/** Autolink form is only valid for a bare, title-less URL that is its own text. */
function isPlainUrl(link: Mark, parent: PMNode, index: number): boolean {
  const href: unknown = link.attrs['href'];
  if (typeof href !== 'string' || attrTitle(link) !== null || !/^\w+:/.test(href)) return false;
  const content = parent.child(index);
  if (
    !content.isText ||
    content.text !== href ||
    content.marks[content.marks.length - 1] !== link
  ) {
    return false;
  }
  return index === parent.childCount - 1 || !link.isInSet(parent.child(index + 1).marks);
}

function attrTitle(mark: Mark): string | null {
  const title: unknown = mark.attrs['title'];
  return typeof title === 'string' && title !== '' ? title : null;
}

function leafText(node: PMNode): string | null {
  const spec = node.type.spec.leafText;
  return typeof spec === 'function' ? spec(node) : null;
}

/**
 * Flatten a table cell to single-line Markdown. Pipe tables cannot hold
 * block structure, so multi-block cells collapse to space-joined inline text.
 */
function serializeCell(state: MarkdownSerializerState, cell: PMNode): string {
  const sub = new MarkdownSerializerState(
    { nodes: state.nodes, marks: state.marks },
    { tightLists: state.tightLists }
  );
  sub.renderContent(cell);
  for (const warning of sub.warnings) state.warn(warning.code, warning.message, warning.nodeType);
  const raw = sub.finish();
  // Anything that rendered across lines (extra blocks, code fences, lists,
  // hard breaks) collapses to one line inside a pipe table.
  if (cell.childCount > 1 || raw.includes('\n')) {
    state.warn('lossy-structure', 'Table cell content flattened to one line', cell.type.name);
  }
  return (
    raw
      // Hard breaks serialize as backslash plus newline; drop the marker
      // before newlines collapse, or a literal backslash survives.
      .replace(/\\\n/g, ' ')
      .replace(/\n+/g, ' ')
      .trim()
      // Pipes inside code spans bypass esc(); unescaped they split the cell.
      .replace(/(?<!\\)\|/g, '\\|')
  );
}

function separatorFor(alignment: string | null): string {
  if (alignment === 'center') return ':---:';
  if (alignment === 'right') return '---:';
  return '---';
}

const table: MarkdownNodeSerializer = (state, node) => {
  if (node.childCount === 0) return;

  const rows: string[][] = [];
  const alignments: (string | null)[] = [];

  node.forEach((row, _rowOffset, rowIndex) => {
    const cells: string[] = [];
    row.forEach((cell, _cellOffset, cellIndex) => {
      // warn() dedupes, so flagging per cell emits a single warning each.
      if ((attrNumber(cell, 'colspan') ?? 1) > 1 || (attrNumber(cell, 'rowspan') ?? 1) > 1) {
        state.warn('lossy-structure', 'Merged table cells are not representable in Markdown', node.type.name);
      }
      if (attrString(cell, 'background') !== null) {
        state.warn('lossy-attribute', 'Table cell background is not representable in Markdown', cell.type.name);
      }
      if (attrString(cell, 'verticalAlign') !== null) {
        state.warn('lossy-attribute', 'Table cell vertical alignment is not representable in Markdown', cell.type.name);
      }
      if (rowIndex === 0) {
        alignments.push(attrString(cell, 'textAlign'));
      } else {
        // Column alignment lives in the separator row; a body cell only
        // loses its alignment when it differs from the column's.
        const align = attrString(cell, 'textAlign');
        if (align !== null && align !== (alignments[cellIndex] ?? null)) {
          state.warn('lossy-attribute', 'Cell text alignment differing from its column is not representable in Markdown', cell.type.name);
        }
      }
      cells.push(serializeCell(state, cell));
    });
    rows.push(cells);
  });

  const columnCount = Math.max(...rows.map((cells) => cells.length), alignments.length);
  const line = (cells: string[]): string => {
    const padded = Array.from({ length: columnCount }, (_v, i) => cells[i] ?? '');
    return `| ${padded.join(' | ')} |`;
  };

  const [headerRow, ...bodyRows] = rows;
  state.write(line(headerRow ?? []));
  state.ensureNewLine();
  state.write(
    `| ${Array.from({ length: columnCount }, (_v, i) => separatorFor(alignments[i] ?? null)).join(' | ')} |`
  );
  for (const cells of bodyRows) {
    state.ensureNewLine();
    state.write(line(cells));
  }
  state.closeBlock(node);
};

export const defaultNodeSerializers: Record<string, MarkdownNodeSerializer> = {
  text: (state, node) => {
    state.text(node.text ?? '');
  },

  paragraph: (state, node) => {
    warnLossyBlockAttrs(state, node);
    state.renderInline(node);
    state.closeBlock(node);
  },

  heading: (state, node) => {
    warnLossyBlockAttrs(state, node);
    const level = attrNumber(node, 'level') ?? 1;
    state.write('#'.repeat(Math.min(Math.max(level, 1), 6)) + ' ');
    state.renderInline(node, false);
    state.closeBlock(node);
  },

  blockquote: (state, node) => {
    state.wrapBlock('> ', null, node, () => {
      state.renderContent(node);
    });
  },

  codeBlock: (state, node) => {
    const runs = node.textContent.match(/`{3,}/g);
    const fence = '`'.repeat(Math.max(3, ...(runs ?? ['']).map((run) => run.length + 1)));
    // The info string ends at whitespace and must not contain backticks.
    const language = (attrString(node, 'language') ?? '').split(/\s+/)[0]?.replace(/`/g, '') ?? '';
    state.write(fence + language + '\n');
    state.text(node.textContent, false);
    state.ensureNewLine();
    state.write(fence);
    state.closeBlock(node);
  },

  horizontalRule: (state, node) => {
    state.write('---');
    state.closeBlock(node);
  },

  hardBreak: (state, node, parent, index) => {
    for (let i = index + 1; i < parent.childCount; i++) {
      if (parent.child(i).type !== node.type) {
        state.write('\\\n');
        return;
      }
    }
  },

  bulletList: (state, node) => {
    state.renderList(node, '  ', () => '- ');
  },

  orderedList: (state, node) => {
    const start = attrNumber(node, 'start') ?? 1;
    const maxWidth = String(start + node.childCount - 1).length;
    const indent = ' '.repeat(maxWidth + 2);
    state.renderList(node, indent, (index) => {
      const marker = String(start + index);
      return ' '.repeat(maxWidth - marker.length) + marker + '. ';
    });
  },

  listItem: (state, node) => {
    state.renderContent(node);
  },

  taskList: (state, node) => {
    state.renderList(node, '  ', () => '- ');
  },

  taskItem: (state, node) => {
    state.write(`[${node.attrs['checked'] === true ? 'x' : ' '}] `);
    state.renderContent(node);
  },

  image: (state, node) => {
    const src = attrString(node, 'src');
    if (src === null) {
      state.warn('unsupported-node', 'Image without src omitted', node.type.name);
      return;
    }
    // Resize writes NUMERIC width/height attrs; check presence, not strings.
    const width: unknown = node.attrs['width'];
    const height: unknown = node.attrs['height'];
    if ((width !== null && width !== undefined) || (height !== null && height !== undefined)) {
      state.warn('lossy-attribute', 'Image dimensions are not representable in Markdown', node.type.name);
    }
    const alt: unknown = node.attrs['alt'];
    const title = attrString(node, 'title');
    state.write(
      `![${state.esc(typeof alt === 'string' ? alt : '')}](${escapeLinkDestination(src)}${
        title !== null ? ` "${escapeLinkTitle(title)}"` : ''
      })`
    );
    if (!node.isInline) state.closeBlock(node);
  },

  table,
  tableRow: () => {
    // Rows are consumed by the table serializer; reaching one standalone is a no-op.
  },

  details: (state, node) => {
    state.warn('lossy-structure', 'Toggle block flattened: summary becomes a bold paragraph', node.type.name);
    state.renderContent(node);
  },

  detailsSummary: (state, node) => {
    if (node.content.size === 0) {
      state.closeBlock(node);
      return;
    }
    state.write('**');
    state.renderInline(node, false);
    state.write('**');
    state.closeBlock(node);
  },

  detailsContent: (state, node) => {
    state.renderContent(node);
  },

  emoji: (state, node) => {
    const name = attrString(node, 'name');
    const glyph = leafText(node);
    state.text(glyph !== null && glyph !== '' ? glyph : name !== null ? `:${name}:` : '');
  },

  mention: (state, node) => {
    const label = attrString(node, 'label');
    const text = leafText(node);
    state.text(text !== null && text !== '' ? text : label !== null ? `@${label}` : '');
    state.warn('lossy-structure', 'Mentions serialize as plain text', node.type.name);
  },

  mathInline: (state, node) => {
    state.write(`$${attrString(node, 'latex') ?? ''}$`);
  },

  mathBlock: (state, node) => {
    state.write('$$\n');
    state.text(attrString(node, 'latex') ?? '', false);
    state.ensureNewLine();
    state.write('$$');
    state.closeBlock(node);
  },

  tableOfContents: (state, node) => {
    state.warn('unsupported-node', 'Table of contents block omitted (generated content)', node.type.name);
  },
};

export const defaultMarkSpecs: Record<string, MarkdownMarkSpec> = {
  bold: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
  italic: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
  strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
  code: {
    open: (_state, _mark, parent, index) => backticksFor(parent.child(index), -1),
    close: (_state, _mark, parent, index) => backticksFor(parent.child(index - 1), 1),
    escape: false,
  },
  link: {
    open: (_state, mark, parent, index) => (isPlainUrl(mark, parent, index) ? '<' : '['),
    close: (_state, mark, parent, index) => {
      if (isPlainUrl(mark, parent, index - 1)) return '>';
      const href: unknown = mark.attrs['href'];
      const title = attrTitle(mark);
      return `](${escapeLinkDestination(typeof href === 'string' ? href : '')}${
        title !== null ? ` "${escapeLinkTitle(title)}"` : ''
      })`;
    },
  },
};
