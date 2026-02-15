import { describe, it, expect, afterEach } from 'vitest';
import { Image } from './Image.js';
import { Document, Text, Paragraph, Editor } from '@domternal/core';

describe('Image', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(Image.name).toBe('image');
    });

    it('is a node type', () => {
      expect(Image.type).toBe('node');
    });

    it('belongs to block group by default', () => {
      expect(typeof Image.config.group).toBe('function');
      const group = (Image.config.group as (...args: unknown[]) => unknown).call(Image);
      expect(group).toBe('block');
    });

    it('is draggable', () => {
      expect(Image.config.draggable).toBe(true);
    });

    it('is an atom', () => {
      expect(Image.config.atom).toBe(true);
    });

    it('has default options', () => {
      expect(Image.options).toEqual({
        inline: false,
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
      } as any;

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
      } as any;

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

    it('setImage inserts image with valid URL', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>Text</p>',
      });
      editor.commands.setImage({ src: 'https://example.com/img.png' });
      let hasImage = false;
      editor.state.doc.forEach((node) => {
        if (node.type.name === 'image') hasImage = true;
      });
      expect(hasImage).toBe(true);
    });

    it('setImage rejects javascript: URL', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>Text</p>',
      });
      const result = editor.commands.setImage({ src: 'javascript:alert(1)' });
      expect(result).toBe(false);
    });

    it('renderHTML returns empty src for invalid URL (defense in depth)', () => {
      const spec = Image.createNodeSpec();
      const mockNode = {
        attrs: { src: 'javascript:alert(1)', alt: null, title: null, width: null, height: null },
      } as any;
      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>];
      expect(result[0]).toBe('img');
      expect(result[1]['src']).toBe('');
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
        expect(html).not.toContain('javascript:');
        expect(html).not.toContain('src="javascript');
      });

      it('rejects data: URLs by default', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Image],
          content: '<img src="data:image/png;base64,abc123">',
        });

        const html = editor.getHTML();
        expect(html).not.toContain('data:image');
        expect(html).not.toContain('src="data:');
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

      it('rejects data:text URLs even when allowBase64 is true', () => {
        const Base64Image = Image.configure({ allowBase64: true });

        editor = new Editor({
          extensions: [Document, Text, Paragraph, Base64Image],
          content: '<img src="data:text/html,<script>alert(1)</script>">',
        });

        const html = editor.getHTML();
        expect(html).not.toContain('data:text/html');
      });

      it('rejects vbscript: URLs', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Image],
          content: '<img src="vbscript:msgbox(1)">',
        });

        const html = editor.getHTML();
        expect(html).not.toContain('vbscript:');
      });

      it('rejects file:// URLs', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Image],
          content: '<img src="file:///etc/passwd">',
        });

        const html = editor.getHTML();
        expect(html).not.toContain('file://');
      });

      it('handles case-insensitive URL schemes', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Image],
          content: '<img src="HTTPS://example.com/img.png">',
        });

        const html = editor.getHTML();
        expect(html).toContain('src="HTTPS://example.com/img.png"');
      });

      it('rejects case-insensitive javascript URLs', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Image],
          content: '<img src="JaVaScRiPt:alert(1)">',
        });

        const html = editor.getHTML();
        expect(html).not.toContain('JaVaScRiPt');
      });
    });
  });

  describe('SetImageOptions typed interface', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    });

    it('setImage accepts typed options with src, alt, title', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>Text</p>',
      });
      const result = editor.commands.setImage({
        src: 'https://example.com/typed.png',
        alt: 'Typed alt',
        title: 'Typed title',
      });
      expect(result).toBe(true);

      const html = editor.getHTML();
      expect(html).toContain('src="https://example.com/typed.png"');
      expect(html).toContain('alt="Typed alt"');
      expect(html).toContain('title="Typed title"');
    });

    it('setImage accepts width and height options', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>Text</p>',
      });
      editor.commands.setImage({
        src: 'https://example.com/sized.png',
        width: '200',
        height: '100',
      });

      const html = editor.getHTML();
      expect(html).toContain('width="200"');
      expect(html).toContain('height="100"');
    });
  });

  describe('inline mode', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    });

    it('inline: true changes group to inline', () => {
      const InlineImage = Image.configure({ inline: true });
      const group = (InlineImage.config.group as (...args: unknown[]) => unknown).call(InlineImage);
      expect(group).toBe('inline');
    });

    it('inline: true sets inline to true', () => {
      const InlineImage = Image.configure({ inline: true });
      const inline = (InlineImage.config.inline as (...args: unknown[]) => unknown).call(InlineImage);
      expect(inline).toBe(true);
    });

    it('inline: false (default) keeps block group', () => {
      const group = (Image.config.group as (...args: unknown[]) => unknown).call(Image);
      expect(group).toBe('block');
    });

    it('inline image can exist inside paragraph', () => {
      const InlineImage = Image.configure({ inline: true });
      editor = new Editor({
        extensions: [Document, Text, Paragraph, InlineImage],
        content: '<p>Before <img src="https://example.com/inline.png"> after</p>',
      });

      const doc = editor.state.doc;
      // Should be a single paragraph containing text + inline image + text
      expect(doc.childCount).toBe(1);
      expect(doc.child(0).type.name).toBe('paragraph');

      let hasImage = false;
      doc.child(0).forEach((node) => {
        if (node.type.name === 'image') hasImage = true;
      });
      expect(hasImage).toBe(true);
    });

    it('block image (default) is a separate block', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>Before</p><img src="https://example.com/block.png"><p>After</p>',
      });

      const doc = editor.state.doc;
      expect(doc.childCount).toBe(3);
      expect(doc.child(1).type.name).toBe('image');
    });
  });

  describe('input rules', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    });

    it('provides addInputRules', () => {
      expect(typeof Image.config.addInputRules).toBe('function');
    });

    it('returns one input rule when editor is initialized', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p></p>',
      });

      const imageExt = editor.extensionManager.extensions.find(
        (e) => e.name === 'image'
      );
      const rules = imageExt?.config.addInputRules?.call(imageExt);
      expect(rules).toHaveLength(1);
    });

    // Regex pattern tests — verify the markdown image syntax pattern
    const imageInputRegex = /(?:^|\s)(!\[(.+|:?)]\((\S+)(?:(?:\s+)["'](\S+)["'])?\))$/;

    it('regex matches ![alt](src)', () => {
      const match = imageInputRegex.exec('![My alt](https://example.com/input.png)');
      expect(match).not.toBeNull();
      expect(match![2]).toBe('My alt');
      expect(match![3]).toBe('https://example.com/input.png');
      expect(match![4]).toBeUndefined();
    });

    it('regex matches ![alt](src "title")', () => {
      const match = imageInputRegex.exec('![Photo](https://example.com/photo.jpg "My-title")');
      expect(match).not.toBeNull();
      expect(match![2]).toBe('Photo');
      expect(match![3]).toBe('https://example.com/photo.jpg');
      expect(match![4]).toBe('My-title');
    });

    it('regex matches after whitespace', () => {
      const match = imageInputRegex.exec('some text ![img](https://example.com/a.png)');
      expect(match).not.toBeNull();
      expect(match![3]).toBe('https://example.com/a.png');
    });

    it('regex does not match without !', () => {
      const match = imageInputRegex.exec('[alt](https://example.com/a.png)');
      // Without !, this is a link syntax, not image
      expect(match).toBeNull();
    });

    it('regex does not match without src', () => {
      const match = imageInputRegex.exec('![alt]()');
      // \S+ requires at least one non-whitespace char in src
      expect(match).toBeNull();
    });

    it('regex matches with single-quoted title', () => {
      const match = imageInputRegex.exec("![alt](https://example.com/a.png 'title')");
      expect(match).not.toBeNull();
      expect(match![4]).toBe('title');
    });
  });
});
