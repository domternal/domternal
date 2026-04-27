import { describe, it, expect } from 'vitest';
import {
  Document,
  Text,
  Paragraph,
  Heading,
  Blockquote,
  BulletList,
  ListItem,
  TaskList,
  TaskItem,
  Editor,
} from '@domternal/core';
import type { Node, ResolvedPos } from '@domternal/pm/model';
import { DEFAULT_DRAG_HANDLE_RULES } from './defaultRules.js';
import { BASE_SCORE } from './scoring.js';

// Table types are tested via fake `Node` shapes (see tableStructure
// describe) so the test stays independent of `@domternal/extension-table`.
const extensions = [
  Document, Text, Paragraph, Heading, Blockquote,
  BulletList, ListItem, TaskList, TaskItem,
];

function makeEditor(html: string): Editor {
  return new Editor({ extensions, content: html });
}

function ruleById(id: string): { evaluate: (ctx: any) => number } {
  const rule = DEFAULT_DRAG_HANDLE_RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`rule ${id} not found`);
  return rule;
}

interface TestCtx {
  node: Node;
  parent: Node | null;
  isFirst: boolean;
  isLast: boolean;
  index: number;
  depth: number;
  pos: number;
  $pos: ResolvedPos;
  view: unknown;
}

function ctxFor(editor: Editor, pos: number, depth: number): TestCtx {
  const $pos = editor.state.doc.resolve(pos);
  const node = $pos.node(depth);
  const parent = depth > 0 ? $pos.node(depth - 1) : null;
  const index = depth > 0 ? $pos.index(depth - 1) : 0;
  const siblingCount = parent ? parent.childCount : 1;
  return {
    node,
    parent,
    index,
    isFirst: index === 0,
    isLast: index === siblingCount - 1,
    depth,
    pos: $pos.before(depth),
    $pos,
    view: {} as unknown,
  };
}

describe('listItemFirstChild rule', () => {
  const rule = ruleById('listItemFirstChild');

  it('excludes the first paragraph inside a listItem', () => {
    const editor = makeEditor('<ul><li><p>Hello</p></li></ul>');
    // depth 3 = paragraph inside list item; the first (only) child.
    // Walk to find paragraph position.
    const ctx = ctxFor(editor, 4, 3);
    expect(ctx.node.type.name).toBe('paragraph');
    expect(ctx.parent?.type.name).toBe('listItem');
    expect(ctx.isFirst).toBe(true);
    expect(rule.evaluate(ctx)).toBe(BASE_SCORE);
    editor.destroy();
  });

  it('does NOT exclude a non-first paragraph', () => {
    const editor = makeEditor('<ul><li><p>One</p><p>Two</p></li></ul>');
    // Walk to the SECOND paragraph inside the list item.
    let secondParaPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.textContent === 'Two') {
        secondParaPos = pos + 1;
        return false;
      }
      return true;
    });
    const ctx = ctxFor(editor, secondParaPos, 3);
    expect(ctx.node.type.name).toBe('paragraph');
    expect(ctx.isFirst).toBe(false);
    expect(rule.evaluate(ctx)).toBe(0);
    editor.destroy();
  });

  it('does NOT exclude the first paragraph at top level', () => {
    const editor = makeEditor('<p>Top</p>');
    const ctx = ctxFor(editor, 1, 1);
    expect(ctx.node.type.name).toBe('paragraph');
    expect(ctx.parent?.type.name).toBe('doc');
    expect(rule.evaluate(ctx)).toBe(0);
    editor.destroy();
  });
});

describe('listWrapperDeprioritize rule', () => {
  const rule = ruleById('listWrapperDeprioritize');

  it('excludes <ul> when its first child is a listItem', () => {
    const editor = makeEditor('<ul><li><p>Hi</p></li></ul>');
    const ctx = ctxFor(editor, 1, 1);
    expect(ctx.node.type.name).toBe('bulletList');
    expect(rule.evaluate(ctx)).toBe(BASE_SCORE);
    editor.destroy();
  });

  it('does NOT exclude a paragraph (no listItem child)', () => {
    const editor = makeEditor('<p>Hi</p>');
    const ctx = ctxFor(editor, 1, 1);
    expect(rule.evaluate(ctx)).toBe(0);
    editor.destroy();
  });
});

describe('tableStructure rule', () => {
  const rule = ruleById('tableStructure');

  it('excludes tableRow / tableCell / tableHeader by name', () => {
    const fakeNode = { type: { name: 'tableRow' } } as unknown as Node;
    const ctx = { node: fakeNode, parent: null } as unknown as TestCtx;
    expect(rule.evaluate(ctx)).toBe(BASE_SCORE);
    (fakeNode as { type: { name: string } }).type.name = 'tableCell';
    expect(rule.evaluate(ctx)).toBe(BASE_SCORE);
    (fakeNode as { type: { name: string } }).type.name = 'tableHeader';
    expect(rule.evaluate(ctx)).toBe(BASE_SCORE);
  });

  it('excludes children of tableHeader', () => {
    const fakeNode = { type: { name: 'paragraph' }, isInline: false, isText: false } as unknown as Node;
    const fakeParent = { type: { name: 'tableHeader' } } as unknown as Node;
    const ctx = { node: fakeNode, parent: fakeParent } as unknown as TestCtx;
    expect(rule.evaluate(ctx)).toBe(BASE_SCORE);
  });

  it('lets paragraphs at top level through', () => {
    const editor = makeEditor('<p>Hi</p>');
    const ctx = ctxFor(editor, 1, 1);
    expect(rule.evaluate(ctx)).toBe(0);
    editor.destroy();
  });
});

describe('inlineContent rule', () => {
  const rule = ruleById('inlineContent');

  it('excludes inline / text nodes', () => {
    const fakeText = { type: { name: 'text' }, isText: true, isInline: true } as unknown as Node;
    const ctx = { node: fakeText } as unknown as TestCtx;
    expect(rule.evaluate(ctx)).toBe(BASE_SCORE);
  });

  it('lets block nodes through', () => {
    const fakeBlock = { type: { name: 'paragraph' }, isText: false, isInline: false } as unknown as Node;
    const ctx = { node: fakeBlock } as unknown as TestCtx;
    expect(rule.evaluate(ctx)).toBe(0);
  });
});
