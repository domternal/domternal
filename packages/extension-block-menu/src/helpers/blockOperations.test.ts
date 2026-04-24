import { describe, it, expect } from 'vitest';
import {
  Document,
  Text,
  Paragraph,
  Heading,
  Blockquote,
  CodeBlock,
  Editor,
} from '@domternal/core';
import {
  deleteBlock,
  duplicateBlock,
  turnIntoBlock,
} from './blockOperations.js';
import { findTopLevelBlock } from './findTopLevelBlock.js';

const extensions = [Document, Text, Paragraph, Heading, Blockquote, CodeBlock];

function makeEditor(html: string): Editor {
  return new Editor({ extensions, content: html });
}

describe('blockOperations', () => {
  describe('deleteBlock', () => {
    it('removes the targeted block from the document', () => {
      const editor = makeEditor('<p>First</p><p>Second</p><p>Third</p>');
      const second = findTopLevelBlock(editor.state.doc, 9);
      expect(second?.node.textContent).toBe('Second');
      const tr = editor.state.tr;
      deleteBlock(tr, second?.pos ?? 0);
      editor.view.dispatch(tr);
      const texts: string[] = [];
      editor.state.doc.forEach((n) => { texts.push(n.textContent); });
      expect(texts).toEqual(['First', 'Third']);
      editor.destroy();
    });

    it('is a no-op when pos has no node', () => {
      const editor = makeEditor('<p>A</p>');
      const tr = editor.state.tr;
      deleteBlock(tr, 999);
      expect(tr.steps.length).toBe(0);
      editor.destroy();
    });

    it('returns the same transaction (chainable)', () => {
      const editor = makeEditor('<p>A</p>');
      const tr = editor.state.tr;
      const result = deleteBlock(tr, 0);
      expect(result).toBe(tr);
      editor.destroy();
    });
  });

  describe('duplicateBlock', () => {
    it('inserts an identical copy immediately after the original', () => {
      const editor = makeEditor('<p>Hello</p>');
      const first = findTopLevelBlock(editor.state.doc, 1);
      const tr = editor.state.tr;
      duplicateBlock(tr, first?.pos ?? 0);
      editor.view.dispatch(tr);
      const texts: string[] = [];
      editor.state.doc.forEach((n) => { texts.push(n.textContent); });
      expect(texts).toEqual(['Hello', 'Hello']);
      editor.destroy();
    });

    it('preserves node type and attributes of a heading', () => {
      const editor = makeEditor('<h3>Intro</h3>');
      const heading = findTopLevelBlock(editor.state.doc, 1);
      const tr = editor.state.tr;
      duplicateBlock(tr, heading?.pos ?? 0);
      editor.view.dispatch(tr);
      const children: Array<{ name: string; level: number }> = [];
      editor.state.doc.forEach((n) => {
        children.push({
          name: n.type.name,
          level: (n.attrs['level'] as number) ?? 0,
        });
      });
      expect(children).toEqual([
        { name: 'heading', level: 3 },
        { name: 'heading', level: 3 },
      ]);
      editor.destroy();
    });

    it('is a no-op when pos has no node', () => {
      const editor = makeEditor('<p>A</p>');
      const tr = editor.state.tr;
      duplicateBlock(tr, 999);
      expect(tr.steps.length).toBe(0);
      editor.destroy();
    });
  });

  describe('turnIntoBlock', () => {
    it('converts a paragraph into a heading level 2 preserving inline content', () => {
      const editor = makeEditor('<p>Hello world</p>');
      const first = findTopLevelBlock(editor.state.doc, 1);
      const headingType = editor.state.schema.nodes['heading'];
      expect(headingType).toBeDefined();
      const tr = editor.state.tr;
      turnIntoBlock(tr, first?.pos ?? 0, headingType!, { level: 2 });
      editor.view.dispatch(tr);
      const firstChild = editor.state.doc.firstChild;
      expect(firstChild?.type.name).toBe('heading');
      expect(firstChild?.attrs['level']).toBe(2);
      expect(firstChild?.textContent).toBe('Hello world');
      editor.destroy();
    });

    it('converts a heading back to paragraph', () => {
      const editor = makeEditor('<h2>Title</h2>');
      const heading = findTopLevelBlock(editor.state.doc, 1);
      const paragraphType = editor.state.schema.nodes['paragraph'];
      expect(paragraphType).toBeDefined();
      const tr = editor.state.tr;
      turnIntoBlock(tr, heading?.pos ?? 0, paragraphType!);
      editor.view.dispatch(tr);
      const firstChild = editor.state.doc.firstChild;
      expect(firstChild?.type.name).toBe('paragraph');
      expect(firstChild?.textContent).toBe('Title');
      editor.destroy();
    });

    it('converts a paragraph into a code block', () => {
      const editor = makeEditor('<p>let x = 1</p>');
      const first = findTopLevelBlock(editor.state.doc, 1);
      const codeType = editor.state.schema.nodes['codeBlock'];
      expect(codeType).toBeDefined();
      const tr = editor.state.tr;
      turnIntoBlock(tr, first?.pos ?? 0, codeType!);
      editor.view.dispatch(tr);
      const firstChild = editor.state.doc.firstChild;
      expect(firstChild?.type.name).toBe('codeBlock');
      expect(firstChild?.textContent).toBe('let x = 1');
      editor.destroy();
    });

    it('is a no-op when target type is not a textblock (e.g. blockquote wrapper)', () => {
      const editor = makeEditor('<p>Hi</p>');
      const first = findTopLevelBlock(editor.state.doc, 1);
      const blockquoteType = editor.state.schema.nodes['blockquote'];
      expect(blockquoteType).toBeDefined();
      const tr = editor.state.tr;
      turnIntoBlock(tr, first?.pos ?? 0, blockquoteType!);
      // blockquote is not a textblock → helper bails without touching tr
      expect(tr.steps.length).toBe(0);
      editor.destroy();
    });

    it('is a no-op when pos has no node', () => {
      const editor = makeEditor('<p>A</p>');
      const paragraphType = editor.state.schema.nodes['paragraph'];
      const tr = editor.state.tr;
      turnIntoBlock(tr, 999, paragraphType!);
      expect(tr.steps.length).toBe(0);
      editor.destroy();
    });
  });
});
