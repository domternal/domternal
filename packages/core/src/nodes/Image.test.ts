import { describe, it, expect, afterEach } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { Image } from './Image.js';
import { Document } from './Document.js';
import { Text } from './Text.js';
import { Paragraph } from './Paragraph.js';
import { Editor } from '../Editor.js';

describe('Image', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(Image.name).toBe('image');
    });

    it('is a node type', () => {
      expect(Image.type).toBe('node');
    });

    it('belongs to block group', () => {
      expect(Image.config.group).toBe('block');
    });

    it('is draggable', () => {
      expect(Image.config.draggable).toBe(true);
    });

    it('is an atom', () => {
      expect(Image.config.atom).toBe(true);
    });

    it('has default options', () => {
      expect(Image.options).toEqual({
        allowBase64: false,
        HTMLAttributes: {},
      });
    });

    it('can configure HTMLAttributes', () => {
      const CustomImage = Image.configure({
        HTMLAttributes: { class: 'responsive-img' },
      });
      expect(CustomImage.options.HTMLAttributes).toEqual({ class: 'responsive-img' });
    });

    it('can configure allowBase64', () => {
      const CustomImage = Image.configure({
        allowBase64: true,
      });
      expect(CustomImage.options.allowBase64).toBe(true);
    });
  });

  describe('parseHTML', () => {
    it('returns rule for img[src] tag', () => {
      const rules = Image.config.parseHTML?.call(Image);

      expect(rules).toEqual([{ tag: 'img[src]' }]);
    });
  });

  describe('renderHTML', () => {
    it('renders img element', () => {
      const spec = Image.createNodeSpec();
      const mockNode = {
        attrs: { src: 'https://example.com/img.png', alt: null, title: null, width: null, height: null },
      } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>];

      expect(result[0]).toBe('img');
    });

    it('merges HTMLAttributes from options', () => {
      const CustomImage = Image.configure({
        HTMLAttributes: { class: 'styled-img' },
      });

      const spec = CustomImage.createNodeSpec();
      const mockNode = {
        attrs: { src: 'https://example.com/img.png', alt: null, title: null, width: null, height: null },
      } as unknown as PMNode;

      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>];

      expect(result[0]).toBe('img');
      expect(result[1]['class']).toBe('styled-img');
    });
  });

  describe('addAttributes', () => {
    it('defines src attribute', () => {
      const attributes = Image.config.addAttributes?.call(Image);
      expect(attributes).toHaveProperty('src');
      expect(attributes?.['src']?.default).toBeNull();
    });

    it('defines alt attribute', () => {
      const attributes = Image.config.addAttributes?.call(Image);
      expect(attributes).toHaveProperty('alt');
      expect(attributes?.['alt']?.default).toBeNull();
    });

    it('defines title attribute', () => {
      const attributes = Image.config.addAttributes?.call(Image);
      expect(attributes).toHaveProperty('title');
      expect(attributes?.['title']?.default).toBeNull();
    });

    it('defines width attribute', () => {
      const attributes = Image.config.addAttributes?.call(Image);
      expect(attributes).toHaveProperty('width');
      expect(attributes?.['width']?.default).toBeNull();
    });

    it('defines height attribute', () => {
      const attributes = Image.config.addAttributes?.call(Image);
      expect(attributes).toHaveProperty('height');
      expect(attributes?.['height']?.default).toBeNull();
    });
  });

  describe('addCommands', () => {
    it('provides setImage command', () => {
      const commands = Image.config.addCommands?.call(Image);

      expect(commands).toHaveProperty('setImage');
      expect(typeof commands?.['setImage']).toBe('function');
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    });

    it('works with Editor using extensions', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>Text</p><img src="https://example.com/img.png" alt="Test image">',
      });

      expect(editor.getText()).toContain('Text');
    });

    it('parses image correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png" alt="Alt text">',
      });

      const doc = editor.state.doc;
      const image = doc.child(0);
      expect(image.type.name).toBe('image');
      expect(image.attrs['src']).toBe('https://example.com/img.png');
      expect(image.attrs['alt']).toBe('Alt text');
    });

    it('parses all image attributes', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png" alt="Alt" title="Title" width="100" height="50">',
      });

      const doc = editor.state.doc;
      const image = doc.child(0);
      expect(image.attrs['src']).toBe('https://example.com/img.png');
      expect(image.attrs['alt']).toBe('Alt');
      expect(image.attrs['title']).toBe('Title');
      expect(image.attrs['width']).toBe('100');
      expect(image.attrs['height']).toBe('50');
    });

    it('renders image correctly', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png" alt="Test">',
      });

      const html = editor.getHTML();
      expect(html).toContain('<img');
      expect(html).toContain('src="https://example.com/img.png"');
      expect(html).toContain('alt="Test"');
    });

    it('is a block-level element', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>Before</p><img src="https://example.com/img.png"><p>After</p>',
      });

      const doc = editor.state.doc;
      expect(doc.childCount).toBe(3);
      expect(doc.child(0).type.name).toBe('paragraph');
      expect(doc.child(1).type.name).toBe('image');
      expect(doc.child(2).type.name).toBe('paragraph');
    });

    describe('XSS protection', () => {
      it('accepts valid https URLs', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Image],
          content: '<img src="https://example.com/img.png">',
        });

        const html = editor.getHTML();
        expect(html).toContain('src="https://example.com/img.png"');
      });

      it('accepts valid http URLs', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Image],
          content: '<img src="http://example.com/img.png">',
        });

        const html = editor.getHTML();
        expect(html).toContain('src="http://example.com/img.png"');
      });

      it('rejects javascript: URLs', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Image],
          content: '<img src="javascript:alert(1)">',
        });

        const html = editor.getHTML();
        expect(html).toContain('src=""');
        expect(html).not.toContain('javascript:');
      });

      it('rejects data: URLs by default', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Image],
          content: '<img src="data:image/png;base64,abc123">',
        });

        const html = editor.getHTML();
        expect(html).toContain('src=""');
      });

      it('allows data:image URLs when allowBase64 is true', () => {
        const Base64Image = Image.configure({ allowBase64: true });

        editor = new Editor({
          extensions: [Document, Text, Paragraph, Base64Image],
          content: '<img src="data:image/png;base64,abc123">',
        });

        const html = editor.getHTML();
        expect(html).toContain('src="data:image/png;base64,abc123"');
      });
    });
  });
});
