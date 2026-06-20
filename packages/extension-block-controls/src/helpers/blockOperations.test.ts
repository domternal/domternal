import { describe, it, expect } from 'vitest';
import {
  Document,
  Text,
  Paragraph,
  Heading,
  Blockquote,
  CodeBlock,
  BlockColor,
  BulletList,
  ListItem,
  Editor,
} from '@domternal/core';
import {
  deleteBlock,
  duplicateBlock,
  turnIntoBlock,
} from './blockOperations.js';
import { findTopLevelBlock } from './findTopLevelBlock.js';

const extensions = [Document, Text, Paragraph, Heading, Blockquote, CodeBlock];
const listExtensions = [Document, Text, Paragraph, Heading, Blockquote, BulletList, ListItem];

function makeEditor(html: string): Editor {
  return new Editor({ extensions, content: html });
}

function makeListEditor(html: string): Editor {
  return new Editor({ extensions: listExtensions, content: html });
}

/** Resolves the absolute pos of the first node matching `predicate`. */
function findPos(
  editor: Editor,
  predicate: (node: { type: { name: string }; textContent: string }) => boolean,
): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (predicate(node)) { found = pos; return false; }
    return true;
  });
  if (found === -1) throw new Error('node not found');
  return found;
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

    // ── Single-child wrapper expansion ──

    it('deleting an inner LI inside a multi-item UL only removes that LI', () => {
      const editor = makeListEditor('<ul><li><p>A</p></li><li><p>B</p></li><li><p>C</p></li></ul>');
      const liA = findPos(editor, (n) => n.type.name === 'listItem' && n.textContent === 'A');
      const tr = editor.state.tr;
      deleteBlock(tr, liA);
      editor.view.dispatch(tr);
      const items = editor.state.doc.firstChild?.content;
      const texts: string[] = [];
      items?.forEach((n) => texts.push(n.textContent));
      expect(texts).toEqual(['B', 'C']);
      // Surviving UL still has all 2 items, not 3-1=2 with an empty placeholder.
      expect(editor.state.doc.firstChild?.childCount).toBe(2);
      editor.destroy();
    });

    it('deleting the ONLY LI in a UL removes the entire UL when other top-level blocks exist', () => {
      // doc = [UL[only-A], paragraph]. Without the wrapper expansion the
      // delete would either leave an empty <li> placeholder or drop the
      // whole UL via PM's content fitter - the user's reported bug.
      const editor = makeListEditor('<ul><li><p>A</p></li></ul><p>After</p>');
      const liA = findPos(editor, (n) => n.type.name === 'listItem' && n.textContent === 'A');
      const tr = editor.state.tr;
      deleteBlock(tr, liA);
      editor.view.dispatch(tr);
      // Top-level: just the paragraph "After".
      const topLevel: string[] = [];
      editor.state.doc.forEach((n) => topLevel.push(n.type.name));
      expect(topLevel).toEqual(['paragraph']);
      expect(editor.state.doc.textContent).toBe('After');
      editor.destroy();
    });

    it('deleting the ONLY LI of the ONLY top-level UL replaces with a paragraph (doc-empty fallback)', () => {
      // doc = [UL[only-A]]. Expansion covers the whole doc. Plain delete
      // would violate `block+` on the doc; we replace with a paragraph.
      const editor = makeListEditor('<ul><li><p>A</p></li></ul>');
      const liA = findPos(editor, (n) => n.type.name === 'listItem' && n.textContent === 'A');
      const tr = editor.state.tr;
      deleteBlock(tr, liA);
      editor.view.dispatch(tr);
      expect(editor.state.doc.childCount).toBe(1);
      expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
      expect(editor.state.doc.firstChild?.textContent).toBe('');
      editor.destroy();
    });

    it('deleting a deeply nested only-child collapses the entire wrapper chain', () => {
      // li(L1) > ul > li(L2) > ul > li(L3). Each outer li uses an empty
      // paragraph as the (Notion-strict) label slot so the parser keeps
      // the nested structure - bare `<li><ul>` flattens to top-level
      // sibling lists. The helper's single-meaningful-child branch walks
      // through these filler paragraphs so the entire outer-UL collapses.
      const editor = makeListEditor(
        '<ul><li><p></p>'
        + '<ul><li><p></p>'
        + '<ul><li><p>L3 deep</p></li></ul>'
        + '</li></ul>'
        + '</li></ul>'
        + '<p>Sibling</p>',
      );
      const l3 = findPos(editor, (n) => n.type.name === 'listItem' && n.textContent === 'L3 deep');
      const tr = editor.state.tr;
      deleteBlock(tr, l3);
      editor.view.dispatch(tr);
      const topLevel: string[] = [];
      editor.state.doc.forEach((n) => topLevel.push(n.type.name));
      expect(topLevel).toEqual(['paragraph']);
      expect(editor.state.doc.textContent).toBe('Sibling');
      editor.destroy();
    });

    it('does NOT expand when the source has siblings (sibling-having UL stays)', () => {
      // Outer LI has paragraph + nested UL. Nested UL has 2 LIs (siblings).
      // Deleting one inner LI must leave the parent UL intact with the
      // other LI still inside.
      const editor = makeListEditor(
        '<ul><li><p>Outer</p>'
        + '<ul><li><p>First</p></li><li><p>Second</p></li></ul>'
        + '</li></ul>',
      );
      const first = findPos(editor, (n) => n.type.name === 'listItem' && n.textContent === 'First');
      const tr = editor.state.tr;
      deleteBlock(tr, first);
      editor.view.dispatch(tr);
      // Outer LI still has paragraph + nested UL containing only "Second".
      const outerLi = editor.state.doc.firstChild?.firstChild;
      expect(outerLi?.childCount).toBe(2); // p + ul
      const innerUl = outerLi?.lastChild;
      expect(innerUl?.type.name).toBe('bulletList');
      expect(innerUl?.childCount).toBe(1);
      expect(innerUl?.firstChild?.textContent).toBe('Second');
      editor.destroy();
    });

    it('deleting a top-level paragraph still uses the empty-doc fallback when it is the only block', () => {
      // Pre-existing behaviour preserved by the new flow: doc with one
      // top-level paragraph → deletion replaces with a fresh paragraph
      // (doesn't leave an empty doc).
      const editor = makeEditor('<p>Only block</p>');
      const tr = editor.state.tr;
      deleteBlock(tr, 0);
      editor.view.dispatch(tr);
      expect(editor.state.doc.childCount).toBe(1);
      expect(editor.state.doc.firstChild?.type.name).toBe('paragraph');
      expect(editor.state.doc.firstChild?.textContent).toBe('');
      editor.destroy();
    });

    it('deleting a block between two same-type lists heals the seam into one list', () => {
      // The interrupter's removal brings two bullet lists flush together;
      // rejoinAtSeam merges them so the list is continuous (matches moveBlock).
      const editor = makeListEditor(
        '<ul><li><p>A</p></li></ul><h2>Mid</h2><ul><li><p>B</p></li></ul>',
      );
      const heading = findPos(editor, (n) => n.type.name === 'heading');
      const tr = editor.state.tr;
      deleteBlock(tr, heading);
      editor.view.dispatch(tr);

      const types: string[] = [];
      editor.state.doc.forEach((n) => types.push(n.type.name));
      expect(types).toEqual(['bulletList']);
      expect(editor.state.doc.child(0).childCount).toBe(2);
      expect(editor.state.doc.child(0).textContent).toBe('AB');
      editor.destroy();
    });

    it('does NOT merge lists of different types when the interrupter is deleted', () => {
      const editor = makeListEditor(
        '<ul><li><p>A</p></li></ul><h2>Mid</h2><blockquote><p>Q</p></blockquote><ul><li><p>B</p></li></ul>',
      );
      // Delete only the heading; the blockquote still separates the two lists.
      const heading = findPos(editor, (n) => n.type.name === 'heading');
      const tr = editor.state.tr;
      deleteBlock(tr, heading);
      editor.view.dispatch(tr);

      const types: string[] = [];
      editor.state.doc.forEach((n) => types.push(n.type.name));
      expect(types).toEqual(['bulletList', 'blockquote', 'bulletList']);
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
      const children: { name: string; level: number }[] = [];
      editor.state.doc.forEach((n) => {
        children.push({
          name: n.type.name,
          level: n.attrs['level'] as number,
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

    it('preserves global attributes (bgColor, textColor) across type change', () => {
      // With BlockColor loaded, both paragraph and heading declare bgColor
      // and textColor attributes via addGlobalAttributes. Turning a colored
      // paragraph into a heading must carry the colors over.
      const host = document.createElement('div');
      host.className = 'dm-editor';
      document.body.appendChild(host);
      const editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, Heading, BlockColor],
        content: '<p data-bg-color="yellow" data-text-color="gray">Hello</p>',
      });
      const first = findTopLevelBlock(editor.state.doc, 1);
      const headingType = editor.state.schema.nodes['heading'];
      const tr = editor.state.tr;
      turnIntoBlock(tr, first?.pos ?? 0, headingType!, { level: 1 });
      editor.view.dispatch(tr);

      const firstChild = editor.state.doc.firstChild;
      expect(firstChild?.type.name).toBe('heading');
      expect(firstChild?.attrs['level']).toBe(1);
      // Colors survive the transformation.
      expect(firstChild?.attrs['bgColor']).toBe('yellow');
      expect(firstChild?.attrs['textColor']).toBe('gray');
      editor.destroy();
      host.remove();
    });

    it('caller-supplied attrs override preserved attrs with the same key', () => {
      // If source has level=2 (from an attribute other than heading) and
      // target is heading with level=1 supplied, the override wins. This
      // uses paragraph-to-heading where paragraph has no `level` attr -
      // the test is conceptual: the merge order is preserved-first then
      // overrides.
      const host = document.createElement('div');
      host.className = 'dm-editor';
      document.body.appendChild(host);
      const editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, Heading, BlockColor],
        content: '<h2 data-bg-color="blue">Two</h2>',
      });
      const first = findTopLevelBlock(editor.state.doc, 1);
      const headingType = editor.state.schema.nodes['heading'];
      const tr = editor.state.tr;
      turnIntoBlock(tr, first?.pos ?? 0, headingType!, { level: 1 });
      editor.view.dispatch(tr);

      const firstChild = editor.state.doc.firstChild;
      expect(firstChild?.attrs['level']).toBe(1); // override
      expect(firstChild?.attrs['bgColor']).toBe('blue'); // preserved
      editor.destroy();
      host.remove();
    });
  });
});
