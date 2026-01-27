/**
 * Integration Tests for All Nodes
 *
 * Tests that verify all nodes work together correctly.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '../Editor.js';
import type { JSONContent } from '../types/Content.js';
import { Document } from './Document.js';
import { Text } from './Text.js';
import { Paragraph } from './Paragraph.js';
import { Heading } from './Heading.js';
import { Blockquote } from './Blockquote.js';
import { CodeBlock } from './CodeBlock.js';
import { BulletList } from './BulletList.js';
import { OrderedList } from './OrderedList.js';
import { ListItem } from './ListItem.js';
import { HorizontalRule } from './HorizontalRule.js';
import { HardBreak } from './HardBreak.js';
import { Image } from './Image.js';

const allNodes = [
  Document,
  Text,
  Paragraph,
  Heading,
  Blockquote,
  CodeBlock,
  BulletList,
  OrderedList,
  ListItem,
  HorizontalRule,
  HardBreak,
  Image,
];

describe('Node Integration', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  describe('Full Document', () => {
    it('creates document with all node types', () => {
      editor = new Editor({
        extensions: allNodes,
        content: `
          <h1>Title</h1>
          <p>Paragraph with <br>hard break</p>
          <blockquote><p>Quote</p></blockquote>
          <pre><code class="language-js">const x = 1;</code></pre>
          <ul><li><p>Bullet item</p></li></ul>
          <ol><li><p>Numbered item</p></li></ol>
          <hr>
          <img src="https://example.com/img.png" alt="Image">
        `,
      });

      const doc = editor.state.doc;

      // Verify all node types are present
      const nodeTypes = new Set<string>();
      doc.descendants((node) => {
        nodeTypes.add(node.type.name);
        return true;
      });

      expect(nodeTypes.has('heading')).toBe(true);
      expect(nodeTypes.has('paragraph')).toBe(true);
      expect(nodeTypes.has('blockquote')).toBe(true);
      expect(nodeTypes.has('codeBlock')).toBe(true);
      expect(nodeTypes.has('bulletList')).toBe(true);
      expect(nodeTypes.has('orderedList')).toBe(true);
      expect(nodeTypes.has('listItem')).toBe(true);
      expect(nodeTypes.has('horizontalRule')).toBe(true);
      expect(nodeTypes.has('hardBreak')).toBe(true);
      expect(nodeTypes.has('image')).toBe(true);
    });

    it('preserves content through JSON roundtrip', () => {
      const originalContent = `
        <h2>Heading</h2>
        <p>Some text</p>
        <blockquote><p>A quote</p></blockquote>
      `;

      editor = new Editor({
        extensions: allNodes,
        content: originalContent,
      });

      const json = editor.getJSON() as unknown as JSONContent;

      // Create new editor from JSON
      const editor2 = new Editor({
        extensions: allNodes,
        content: json,
      });

      expect(editor2.getJSON()).toEqual(json);
      editor2.destroy();
    });

    it('preserves content through HTML roundtrip', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<h1>Test</h1><p>Content</p>',
      });

      const html = editor.getHTML();

      const editor2 = new Editor({
        extensions: allNodes,
        content: html,
      });

      expect(editor2.getHTML()).toBe(html);
      editor2.destroy();
    });
  });

  describe('Nested Structures', () => {
    it('handles blockquote containing list', () => {
      editor = new Editor({
        extensions: allNodes,
        content: `
          <blockquote>
            <ul>
              <li><p>Item in quote</p></li>
            </ul>
          </blockquote>
        `,
      });

      const doc = editor.state.doc;
      const blockquote = doc.child(0);

      expect(blockquote.type.name).toBe('blockquote');
      expect(blockquote.child(0).type.name).toBe('bulletList');
    });

    it('handles nested lists', () => {
      editor = new Editor({
        extensions: allNodes,
        content: `
          <ul>
            <li>
              <p>Parent</p>
              <ul>
                <li><p>Child</p></li>
              </ul>
            </li>
          </ul>
        `,
      });

      const doc = editor.state.doc;
      const outerList = doc.child(0);

      expect(outerList.type.name).toBe('bulletList');

      const listItem = outerList.child(0);
      expect(listItem.type.name).toBe('listItem');
      expect(listItem.childCount).toBe(2);
      expect(listItem.child(0).type.name).toBe('paragraph');
      expect(listItem.child(1).type.name).toBe('bulletList');
    });

    it('handles list inside blockquote inside list', () => {
      editor = new Editor({
        extensions: allNodes,
        content: `
          <ul>
            <li>
              <p>Outer</p>
              <blockquote>
                <ol>
                  <li><p>Inner numbered</p></li>
                </ol>
              </blockquote>
            </li>
          </ul>
        `,
      });

      const doc = editor.state.doc;
      expect(doc.child(0).type.name).toBe('bulletList');

      const listItem = doc.child(0).child(0);
      expect(listItem.child(1).type.name).toBe('blockquote');
      expect(listItem.child(1).child(0).type.name).toBe('orderedList');
    });
  });

  describe('Multiple Block Types', () => {
    it('handles alternating block types', () => {
      editor = new Editor({
        extensions: allNodes,
        content: `
          <h1>Title</h1>
          <p>Intro</p>
          <hr>
          <h2>Section</h2>
          <pre><code>code</code></pre>
          <p>End</p>
        `,
      });

      const doc = editor.state.doc;

      expect(doc.child(0).type.name).toBe('heading');
      expect(doc.child(1).type.name).toBe('paragraph');
      expect(doc.child(2).type.name).toBe('horizontalRule');
      expect(doc.child(3).type.name).toBe('heading');
      expect(doc.child(4).type.name).toBe('codeBlock');
      expect(doc.child(5).type.name).toBe('paragraph');
    });

    it('handles images between paragraphs', () => {
      editor = new Editor({
        extensions: allNodes,
        content: `
          <p>Before</p>
          <img src="https://example.com/1.png" alt="First">
          <p>Between</p>
          <img src="https://example.com/2.png" alt="Second">
          <p>After</p>
        `,
      });

      const doc = editor.state.doc;

      expect(doc.child(0).type.name).toBe('paragraph');
      expect(doc.child(1).type.name).toBe('image');
      expect(doc.child(2).type.name).toBe('paragraph');
      expect(doc.child(3).type.name).toBe('image');
      expect(doc.child(4).type.name).toBe('paragraph');
    });
  });

  describe('Inline Content', () => {
    it('handles hard breaks in paragraph', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<p>Line one<br>Line two<br>Line three</p>',
      });

      const paragraph = editor.state.doc.child(0);
      let breakCount = 0;

      paragraph.forEach((node) => {
        if (node.type.name === 'hardBreak') {
          breakCount++;
        }
      });

      expect(breakCount).toBe(2);
    });

    it('handles hard breaks in list items', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<ul><li><p>First<br>Second</p></li></ul>',
      });

      const list = editor.state.doc.child(0);
      const listItem = list.child(0);
      const paragraph = listItem.child(0);

      let hasBreak = false;
      paragraph.forEach((node) => {
        if (node.type.name === 'hardBreak') {
          hasBreak = true;
        }
      });

      expect(hasBreak).toBe(true);
    });
  });

  describe('Heading Levels', () => {
    it('parses all heading levels', () => {
      editor = new Editor({
        extensions: allNodes,
        content: `
          <h1>H1</h1>
          <h2>H2</h2>
          <h3>H3</h3>
          <h4>H4</h4>
          <h5>H5</h5>
          <h6>H6</h6>
        `,
      });

      const doc = editor.state.doc;

      for (let i = 0; i < 6; i++) {
        const heading = doc.child(i);
        expect(heading.type.name).toBe('heading');
        expect(heading.attrs['level']).toBe(i + 1);
      }
    });
  });

  describe('Code Block', () => {
    it('preserves language attribute', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<pre><code class="language-typescript">const x: number = 1;</code></pre>',
      });

      const codeBlock = editor.state.doc.child(0);
      expect(codeBlock.type.name).toBe('codeBlock');
      expect(codeBlock.attrs['language']).toBe('typescript');
    });

    it('preserves whitespace in code', () => {
      const code = '  function test() {\n    return true;\n  }';
      editor = new Editor({
        extensions: allNodes,
        content: `<pre><code>${code}</code></pre>`,
      });

      const codeBlock = editor.state.doc.child(0);
      expect(codeBlock.textContent).toBe(code);
    });
  });

  describe('Ordered List', () => {
    it('preserves start attribute', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<ol start="5"><li><p>Fifth item</p></li></ol>',
      });

      const list = editor.state.doc.child(0);
      expect(list.type.name).toBe('orderedList');
      expect(list.attrs['start']).toBe(5);
    });
  });

  describe('Image Attributes', () => {
    it('preserves all image attributes', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<img src="https://example.com/img.png" alt="Alt text" title="Title" width="200" height="100">',
      });

      const image = editor.state.doc.child(0);
      expect(image.type.name).toBe('image');
      expect(image.attrs['src']).toBe('https://example.com/img.png');
      expect(image.attrs['alt']).toBe('Alt text');
      expect(image.attrs['title']).toBe('Title');
      expect(image.attrs['width']).toBe('200');
      expect(image.attrs['height']).toBe('100');
    });
  });

  describe('Empty Document', () => {
    it('creates valid document with empty paragraph', () => {
      editor = new Editor({
        extensions: allNodes,
        content: '<p></p>',
      });

      const doc = editor.state.doc;
      expect(doc.childCount).toBe(1);
      expect(doc.child(0).type.name).toBe('paragraph');
    });
  });

  describe('getText', () => {
    it('extracts text from complex document', () => {
      editor = new Editor({
        extensions: allNodes,
        content: `
          <h1>Title</h1>
          <p>Paragraph</p>
          <ul><li><p>List item</p></li></ul>
        `,
      });

      const text = editor.getText();
      expect(text).toContain('Title');
      expect(text).toContain('Paragraph');
      expect(text).toContain('List item');
    });
  });
});
