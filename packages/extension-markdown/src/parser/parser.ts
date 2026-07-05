/**
 * Markdown to ProseMirror parser. markdown-it produces the token stream; the
 * handler set is derived from what the schema actually contains, so Markdown
 * features without a schema counterpart degrade to plain text instead of
 * failing (tables without the table extension, strikethrough without the
 * strike mark, and so on).
 */
import MarkdownIt from 'markdown-it';
import { Fragment } from '@domternal/pm/model';
import type { Node as PMNode, NodeType, Schema } from '@domternal/pm/model';
import { addMathRules } from './mathRules.js';
import { MarkdownParseState } from './state.js';

type Token = ReturnType<MarkdownIt['parse']>[number];
type TokenHandler = (state: MarkdownParseState, token: Token) => void;

export interface MarkdownParser {
  /** Parse a Markdown string into a document node of the schema. */
  parse(markdown: string): PMNode;
}

function attrFrom(token: Token, name: string): string | null {
  const value = token.attrGet(name);
  return value === null || value === '' ? null : value;
}

function cellAlign(token: Token): Record<string, string> | null {
  const style = token.attrGet('style');
  if (style === null) return null;
  const match = /text-align:\s*(left|center|right)/.exec(style);
  const align = match?.[1];
  return align === undefined ? null : { textAlign: align };
}

function altText(token: Token): string {
  return (token.children ?? [])
    .filter((child) => child.type === 'text' || child.type === 'text_special')
    .map((child) => child.content)
    .join('');
}

const TASK_PREFIX = /^\[( |x|X)\] /;

/**
 * GFM task lists arrive as bullet lists whose items start with a checkbox
 * marker. A bullet list converts only when EVERY item carries the marker:
 * the schema does not allow mixing task and plain items in one list.
 */
function transformTaskLists(doc: PMNode, schema: Schema): PMNode {
  const taskList = schema.nodes['taskList'];
  const taskItem = schema.nodes['taskItem'];
  const bulletList = schema.nodes['bulletList'];
  const listItem = schema.nodes['listItem'];
  if (
    taskList === undefined ||
    taskItem === undefined ||
    bulletList === undefined ||
    listItem === undefined
  ) {
    return doc;
  }

  const itemMarker = (item: PMNode): string | null => {
    if (item.type !== listItem) return null;
    const paragraph = item.firstChild;
    if (paragraph?.isTextblock !== true) return null;
    const first = paragraph.firstChild;
    if (first?.isText !== true) return null;
    const match = TASK_PREFIX.exec(first.text ?? '');
    return match === null ? null : (match[1] ?? ' ');
  };

  const convertItem = (item: PMNode): PMNode => {
    const marker = itemMarker(item);
    const children: PMNode[] = [];
    item.forEach((child, _offset, index) => {
      if (index === 0 && child.isTextblock) {
        const inline: PMNode[] = [];
        child.forEach((inlineChild, _o, inlineIndex) => {
          if (inlineIndex === 0 && inlineChild.isText) {
            const stripped = (inlineChild.text ?? '').replace(TASK_PREFIX, '');
            if (stripped !== '') {
              inline.push(
                (inlineChild as PMNode & { withText: (text: string) => PMNode }).withText(stripped)
              );
            }
            return;
          }
          inline.push(inlineChild);
        });
        children.push(child.copy(Fragment.from(inline)));
        return;
      }
      children.push(child);
    });
    return taskItem.create({ checked: marker === 'x' || marker === 'X' }, children);
  };

  const map = (node: PMNode): PMNode => {
    if (node.isLeaf) return node;
    const mapped: PMNode[] = [];
    node.forEach((child) => {
      mapped.push(map(child));
    });
    const rebuilt = node.copy(Fragment.from(mapped));
    if (rebuilt.type !== bulletList || rebuilt.childCount === 0) return rebuilt;
    const items: PMNode[] = [];
    rebuilt.forEach((item) => {
      items.push(item);
    });
    if (!items.every((item) => itemMarker(item) !== null)) return rebuilt;
    return taskList.create(null, items.map(convertItem));
  };

  return map(doc);
}

function buildMarkdownIt(schema: Schema): MarkdownIt {
  const md = new MarkdownIt('default', { html: false, linkify: true });
  if (schema.nodes['table'] === undefined) md.disable('table');
  if (schema.nodes['image'] === undefined) md.disable('image');
  if (schema.marks['strike'] === undefined) md.disable('strikethrough');
  if (schema.marks['link'] === undefined) {
    md.disable(['link', 'linkify', 'autolink']);
    md.set({ linkify: false });
  }
  if (schema.nodes['mathInline'] !== undefined || schema.nodes['mathBlock'] !== undefined) {
    addMathRules(md);
  }
  return md;
}

export function createMarkdownParser(schema: Schema): MarkdownParser {
  const md = buildMarkdownIt(schema);
  const handlers: Record<string, TokenHandler> = {};

  const handleTokens = (state: MarkdownParseState, tokens: Token[]): void => {
    for (const token of tokens) {
      const handler = handlers[token.type];
      if (handler === undefined) {
        throw new Error(`No markdown token handler for "${token.type}"`);
      }
      handler(state, token);
    }
  };

  const node = (name: string): NodeType | undefined => schema.nodes[name];

  const block = (
    tokenName: string,
    nodeName: string,
    getAttrs?: (token: Token) => Record<string, unknown> | null,
    fallback?: 'paragraph'
  ): void => {
    const type = node(nodeName);
    if (type === undefined) {
      // Wrapper missing from the schema: content flows into the parent,
      // textblocks fall back to plain paragraphs.
      const fallbackType = fallback === 'paragraph' ? node('paragraph') : undefined;
      handlers[`${tokenName}_open`] = (state) => {
        if (fallbackType !== undefined) state.openNode(fallbackType);
      };
      handlers[`${tokenName}_close`] = (state) => {
        if (fallbackType !== undefined) state.closeNode();
      };
      return;
    }
    handlers[`${tokenName}_open`] = (state, token) => {
      state.openNode(type, getAttrs?.(token) ?? null);
    };
    handlers[`${tokenName}_close`] = (state) => {
      state.closeNode();
    };
  };

  const inlineMark = (tokenName: string, markName: string): void => {
    const type = schema.marks[markName];
    if (type === undefined) {
      // Mark missing from the schema: keep the text, drop the formatting.
      ignore(`${tokenName}_open`, `${tokenName}_close`);
      return;
    }
    handlers[`${tokenName}_open`] = (state, token) => {
      state.openMark(
        type.create(
          tokenName === 'link'
            ? { href: attrFrom(token, 'href'), title: attrFrom(token, 'title') }
            : null
        )
      );
    };
    handlers[`${tokenName}_close`] = (state) => {
      state.closeMark(type);
    };
  };

  const cell = (tokenName: string, nodeName: string): void => {
    const cellType = node(nodeName);
    const paragraphType = node('paragraph');
    if (cellType === undefined || paragraphType === undefined) return;
    handlers[`${tokenName}_open`] = (state, token) => {
      state.openNode(cellType, cellAlign(token));
      state.openNode(paragraphType);
    };
    handlers[`${tokenName}_close`] = (state) => {
      state.closeNode();
      state.closeNode();
    };
  };

  const ignore = (...tokenNames: string[]): void => {
    for (const name of tokenNames) {
      handlers[name] = () => {
        // Structural token with no ProseMirror counterpart.
      };
    }
  };

  block('paragraph', 'paragraph');
  block('heading', 'heading', (token) => ({ level: Number(token.tag.slice(1)) || 1 }), 'paragraph');
  block('blockquote', 'blockquote');
  block('bullet_list', 'bulletList');
  block('ordered_list', 'orderedList', (token) => {
    const start = Number(token.attrGet('start') ?? '1');
    return { start: Number.isFinite(start) && start >= 1 ? start : 1 };
  });
  block('list_item', 'listItem');
  block('table', 'table');
  block('tr', 'tableRow');
  cell('th', 'tableHeader');
  cell('td', 'tableCell');
  ignore('thead_open', 'thead_close', 'tbody_open', 'tbody_close');

  handlers['inline'] = (state, token) => {
    handleTokens(state, token.children ?? []);
  };
  handlers['text'] = (state, token) => {
    state.addText(token.content);
  };
  handlers['text_special'] = (state, token) => {
    state.addText(token.content);
  };
  handlers['softbreak'] = (state) => {
    state.addText(' ');
  };

  const hardBreakType = node('hardBreak');
  handlers['hardbreak'] = (state) => {
    if (hardBreakType !== undefined) {
      state.addNode(hardBreakType, null);
    } else {
      state.addText(' ');
    }
  };

  const codeBlockType = node('codeBlock') ?? node('paragraph');
  if (codeBlockType !== undefined) {
    const addCodeBlock = (state: MarkdownParseState, content: string, language: string | null): void => {
      const text = content.replace(/\n$/, '');
      const attrs = codeBlockType.name === 'codeBlock' ? { language } : null;
      state.addNode(codeBlockType, attrs, text === '' ? [] : [schema.text(text)]);
    };
    handlers['fence'] = (state, token) => {
      const language = token.info.trim().split(/\s+/)[0] ?? '';
      addCodeBlock(state, token.content, language === '' ? null : language);
    };
    handlers['code_block'] = (state, token) => {
      addCodeBlock(state, token.content, null);
    };
  }

  const horizontalRuleType = node('horizontalRule');
  handlers['hr'] = (state) => {
    if (horizontalRuleType !== undefined) state.addNode(horizontalRuleType, null);
  };

  const codeMarkType = schema.marks['code'];
  handlers['code_inline'] = (state, token) => {
    if (codeMarkType === undefined) {
      state.addText(token.content);
      return;
    }
    const mark = codeMarkType.create(null);
    state.openMark(mark);
    state.addText(token.content);
    state.closeMark(codeMarkType);
  };

  inlineMark('strong', 'bold');
  inlineMark('em', 'italic');
  inlineMark('s', 'strike');
  inlineMark('link', 'link');

  const imageType = node('image');
  if (imageType !== undefined) {
    handlers['image'] = (state, token) => {
      const src = attrFrom(token, 'src');
      if (src === null) return;
      const alt = altText(token);
      const attrs = { src, alt: alt === '' ? null : alt, title: attrFrom(token, 'title') };
      if (imageType.isInline) {
        state.addNode(imageType, attrs);
        return;
      }
      const image = imageType.createAndFill(attrs);
      if (image === null) return;
      if (state.topType().name === 'paragraph') {
        state.splitAround(image);
      } else {
        state.addText(alt);
      }
    };
  }

  const mathInlineType = node('mathInline');
  if (mathInlineType !== undefined) {
    handlers['math_inline'] = (state, token) => {
      state.addNode(mathInlineType, { latex: token.content });
    };
  }
  const mathBlockType = node('mathBlock');
  if (mathBlockType !== undefined) {
    handlers['math_block'] = (state, token) => {
      state.addNode(mathBlockType, { latex: token.content });
    };
  }

  return {
    parse(markdown: string): PMNode {
      const state = new MarkdownParseState(schema);
      handleTokens(state, md.parse(markdown, {}));
      return transformTaskLists(state.finish(), schema);
    },
  };
}

/** One-shot convenience wrapper around {@link createMarkdownParser}. */
export function parseMarkdown(markdown: string, schema: Schema): PMNode {
  return createMarkdownParser(schema).parse(markdown);
}
