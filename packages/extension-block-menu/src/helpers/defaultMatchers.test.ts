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
import { DEFAULT_BLOCK_MATCHERS } from './defaultMatchers.js';
import type { BlockCandidate, BlockMatcher, MatchVerdict } from './blockMatcher.js';

// Table types are tested via fake `Node` shapes (see tableInternals
// describe) so the test stays independent of `@domternal/extension-table`.
const extensions = [
  Document, Text, Paragraph, Heading, Blockquote,
  BulletList, ListItem, TaskList, TaskItem,
];

function makeEditor(html: string): Editor {
  return new Editor({ extensions, content: html });
}

function matcherByName(name: string): BlockMatcher {
  const m = DEFAULT_BLOCK_MATCHERS.find((x) => x.name === name);
  if (!m) throw new Error(`matcher ${name} not found`);
  return m;
}

function candidateFor(editor: Editor, pos: number, treeDepth: number): BlockCandidate {
  const $pos = editor.state.doc.resolve(pos);
  const block = $pos.node(treeDepth);
  const container = treeDepth > 0 ? $pos.node(treeDepth - 1) : null;
  const positionInContainer = treeDepth > 0 ? $pos.index(treeDepth - 1) : 0;
  const containerSize = container?.childCount ?? 1;
  return {
    block,
    documentPos: $pos.before(treeDepth),
    treeDepth,
    container,
    positionInContainer,
    isFirstChild: positionInContainer === 0,
    isLastChild: positionInContainer === containerSize - 1,
    resolvedPos: $pos,
    editorView: {} as unknown as never,
  };
}

function fakeCandidate(overrides: Partial<BlockCandidate>): BlockCandidate {
  const fakeNode = { type: { name: 'paragraph' }, isInline: false, isText: false } as unknown as Node;
  return {
    block: fakeNode,
    documentPos: 0,
    treeDepth: 1,
    container: null,
    positionInContainer: 0,
    isFirstChild: true,
    isLastChild: true,
    resolvedPos: { depth: 0 } as unknown as ResolvedPos,
    editorView: {} as unknown as never,
    ...overrides,
  };
}

describe('firstChildOfListItem matcher', () => {
  const matcher = matcherByName('firstChildOfListItem');

  it('rejects the first paragraph inside a listItem', () => {
    const editor = makeEditor('<ul><li><p>Hello</p></li></ul>');
    const c = candidateFor(editor, 4, 3);
    expect(c.block.type.name).toBe('paragraph');
    expect(c.container?.type.name).toBe('listItem');
    expect(c.isFirstChild).toBe(true);
    expect(matcher.test(c)).toBe<MatchVerdict>('reject');
    editor.destroy();
  });

  it('allows a non-first paragraph inside a listItem', () => {
    const editor = makeEditor('<ul><li><p>One</p><p>Two</p></li></ul>');
    let secondParaPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.textContent === 'Two') {
        secondParaPos = pos + 1;
        return false;
      }
      return true;
    });
    const c = candidateFor(editor, secondParaPos, 3);
    expect(c.isFirstChild).toBe(false);
    expect(matcher.test(c)).toBe<MatchVerdict>('allow');
    editor.destroy();
  });

  it('allows a first paragraph whose container is not a list item', () => {
    const editor = makeEditor('<p>Top</p>');
    const c = candidateFor(editor, 1, 1);
    expect(c.container?.type.name).toBe('doc');
    expect(matcher.test(c)).toBe<MatchVerdict>('allow');
    editor.destroy();
  });
});

describe('listContainerSkip matcher', () => {
  const matcher = matcherByName('listContainerSkip');

  it('rejects <ul> when its first child is a listItem', () => {
    const editor = makeEditor('<ul><li><p>Hi</p></li></ul>');
    const c = candidateFor(editor, 1, 1);
    expect(c.block.type.name).toBe('bulletList');
    expect(matcher.test(c)).toBe<MatchVerdict>('reject');
    editor.destroy();
  });

  it('allows a paragraph (no list-item child)', () => {
    const editor = makeEditor('<p>Hi</p>');
    const c = candidateFor(editor, 1, 1);
    expect(matcher.test(c)).toBe<MatchVerdict>('allow');
    editor.destroy();
  });
});

describe('tableInternals matcher', () => {
  const matcher = matcherByName('tableInternals');

  it('rejects tableRow / tableCell / tableHeader by name', () => {
    for (const typeName of ['tableRow', 'tableCell', 'tableHeader']) {
      const block = { type: { name: typeName } } as unknown as Node;
      expect(matcher.test(fakeCandidate({ block }))).toBe<MatchVerdict>('reject');
    }
  });

  it('rejects descendants whose container is a tableHeader', () => {
    const block = { type: { name: 'paragraph' }, isInline: false, isText: false } as unknown as Node;
    const container = { type: { name: 'tableHeader' } } as unknown as Node;
    expect(matcher.test(fakeCandidate({ block, container }))).toBe<MatchVerdict>('reject');
  });

  it('allows ordinary block nodes', () => {
    const editor = makeEditor('<p>Hi</p>');
    expect(matcher.test(candidateFor(editor, 1, 1))).toBe<MatchVerdict>('allow');
    editor.destroy();
  });
});

describe('inlineNodes matcher', () => {
  const matcher = matcherByName('inlineNodes');

  it('rejects inline / text nodes', () => {
    const block = { type: { name: 'text' }, isText: true, isInline: true } as unknown as Node;
    expect(matcher.test(fakeCandidate({ block }))).toBe<MatchVerdict>('reject');
  });

  it('allows block nodes', () => {
    const block = { type: { name: 'paragraph' }, isText: false, isInline: false } as unknown as Node;
    expect(matcher.test(fakeCandidate({ block }))).toBe<MatchVerdict>('allow');
  });
});
