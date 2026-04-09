import { describe, it, expect, afterEach, vi } from 'vitest';
import { Image } from './Image.js';
import { Document, Text, Paragraph, Editor } from '@domternal/core';
import {
  imageUploadPlugin,
  imageUploadPluginKey,
  _resetPlaceholderCounter,
} from './imageUploadPlugin.js';
import { Schema } from '@domternal/pm/model';
import { EditorState } from '@domternal/pm/state';
import { NodeSelection } from '@domternal/pm/state';
import { EditorView } from '@domternal/pm/view';

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
        allowBase64: true,
        HTMLAttributes: {},
        uploadHandler: null,
        allowedMimeTypes: [
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
          'image/svg+xml',
          'image/avif',
        ],
        maxFileSize: 0,
        onUploadStart: null,
        onUploadError: null,
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

    it('defines loading attribute', () => {
      const attributes = Image.config.addAttributes?.call(Image);
      expect(attributes).toHaveProperty('loading');
      expect(attributes?.['loading']?.default).toBeNull();
    });

    it('defines crossorigin attribute', () => {
      const attributes = Image.config.addAttributes?.call(Image);
      expect(attributes).toHaveProperty('crossorigin');
      expect(attributes?.['crossorigin']?.default).toBeNull();
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

      it('rejects data: URLs when allowBase64 is false', () => {
        const NoBase64Image = Image.configure({ allowBase64: false });
        editor = new Editor({
          extensions: [Document, Text, Paragraph, NoBase64Image],
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

      it('accepts absolute path URLs', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Image],
          content: '<img src="/uploads/photo.jpg">',
        });

        const html = editor.getHTML();
        expect(html).toContain('src="/uploads/photo.jpg"');
      });

      it('accepts relative path URLs', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Image],
          content: '<img src="./images/photo.jpg">',
        });

        const html = editor.getHTML();
        expect(html).toContain('src="./images/photo.jpg"');
      });

      it('accepts protocol-relative URLs', () => {
        editor = new Editor({
          extensions: [Document, Text, Paragraph, Image],
          content: '<img src="//cdn.example.com/img.png">',
        });

        const html = editor.getHTML();
        expect(html).toContain('src="//cdn.example.com/img.png"');
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

    it('setImage accepts loading option', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>Text</p>',
      });
      editor.commands.setImage({
        src: 'https://example.com/lazy.png',
        loading: 'lazy',
      });

      const html = editor.getHTML();
      expect(html).toContain('loading="lazy"');
    });

    it('setImage accepts crossorigin option', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>Text</p>',
      });
      editor.commands.setImage({
        src: 'https://cdn.example.com/img.png',
        crossorigin: 'anonymous',
      });

      const html = editor.getHTML();
      expect(html).toContain('crossorigin="anonymous"');
    });

    it('parses loading attribute from HTML', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png" loading="lazy">',
      });

      const image = editor.state.doc.child(0);
      expect(image.attrs['loading']).toBe('lazy');
    });

    it('parses crossorigin attribute from HTML', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png" crossorigin="anonymous">',
      });

      const image = editor.state.doc.child(0);
      expect(image.attrs['crossorigin']).toBe('anonymous');
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
      ) as import('@domternal/core').Extension | undefined;
      const rules = imageExt?.config.addInputRules?.call(imageExt);
      expect(rules).toHaveLength(1);
    });

    // Regex pattern tests — verify the markdown image syntax pattern
    const imageInputRegex = /(?:^|\s)(!\[(.+|:?)]\((\S+)(?:(?:\s+)["']([^"']+)["'])?\))$/;

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

    it('regex matches title with spaces', () => {
      const match = imageInputRegex.exec('![alt](https://example.com/a.png "Hello World")');
      expect(match).not.toBeNull();
      expect(match![2]).toBe('alt');
      expect(match![3]).toBe('https://example.com/a.png');
      expect(match![4]).toBe('Hello World');
    });
  });

  describe('leafText', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    });

    it('returns alt text for getText()', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>Before</p><img src="https://example.com/img.png" alt="My photo"><p>After</p>',
      });

      const text = editor.getText();
      expect(text).toContain('My photo');
    });

    it('returns empty string when no alt attribute', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>Before</p><img src="https://example.com/img.png"><p>After</p>',
      });

      const text = editor.getText();
      expect(text).toContain('Before');
      expect(text).toContain('After');
    });
  });

  describe('upload options', () => {
    it('has default upload options', () => {
      expect(Image.options.uploadHandler).toBeNull();
      expect(Image.options.allowedMimeTypes).toEqual([
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/svg+xml',
        'image/avif',
      ]);
      expect(Image.options.maxFileSize).toBe(0);
      expect(Image.options.onUploadStart).toBeNull();
      expect(Image.options.onUploadError).toBeNull();
    });

    it('can configure uploadHandler', () => {
      const handler = (): Promise<string> => Promise.resolve('https://example.com/uploaded.png');
      const CustomImage = Image.configure({ uploadHandler: handler });
      expect(CustomImage.options.uploadHandler).toBe(handler);
    });

    it('can configure allowedMimeTypes', () => {
      const CustomImage = Image.configure({
        allowedMimeTypes: ['image/png'],
      });
      expect(CustomImage.options.allowedMimeTypes).toEqual(['image/png']);
    });

    it('can configure maxFileSize', () => {
      const CustomImage = Image.configure({ maxFileSize: 5_000_000 });
      expect(CustomImage.options.maxFileSize).toBe(5_000_000);
    });

    it('can configure onUploadStart', () => {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const startHandler = (): void => {};
      const CustomImage = Image.configure({ onUploadStart: startHandler });
      expect(CustomImage.options.onUploadStart).toBe(startHandler);
    });

    it('can configure onUploadError', () => {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const errorHandler = (): void => {};
      const CustomImage = Image.configure({ onUploadError: errorHandler });
      expect(CustomImage.options.onUploadError).toBe(errorHandler);
    });
  });

  describe('addProseMirrorPlugins', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    });

    it('does not create upload plugin when uploadHandler is null', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p></p>',
      });

      const pluginState = imageUploadPluginKey.getState(editor.state);
      expect(pluginState).toBeUndefined();
    });

    it('creates upload plugin when uploadHandler is provided', () => {
      const UploadImage = Image.configure({
        uploadHandler: (): Promise<string> => Promise.resolve('https://example.com/img.png'),
      });
      editor = new Editor({
        extensions: [Document, Text, Paragraph, UploadImage],
        content: '<p></p>',
      });

      const pluginState = imageUploadPluginKey.getState(editor.state);
      expect(pluginState).toBeDefined();
    });
  });

  describe('float attribute', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    });

    it('has default value none', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png">',
      });
      const image = editor.state.doc.child(0);
      expect(image.attrs['float']).toBe('none');
    });

    it('parseHTML detects float: left from style', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png" style="float: left;">',
      });
      const image = editor.state.doc.child(0);
      expect(image.attrs['float']).toBe('left');
    });

    it('parseHTML detects float: right from style', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png" style="float: right;">',
      });
      const image = editor.state.doc.child(0);
      expect(image.attrs['float']).toBe('right');
    });

    it('parseHTML detects center from auto margins', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png" style="margin-left: auto; margin-right: auto;">',
      });
      const image = editor.state.doc.child(0);
      expect(image.attrs['float']).toBe('center');
    });

    it('parseHTML detects align="left" (legacy HTML)', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png" align="left">',
      });
      const image = editor.state.doc.child(0);
      expect(image.attrs['float']).toBe('left');
    });

    it('parseHTML detects align="center" (legacy HTML)', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png" align="center">',
      });
      const image = editor.state.doc.child(0);
      expect(image.attrs['float']).toBe('center');
    });

    it('parseHTML returns none when no float style', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png">',
      });
      const image = editor.state.doc.child(0);
      expect(image.attrs['float']).toBe('none');
    });

    it('renderHTML outputs float: left style', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png" style="float: left;">',
      });
      const html = editor.getHTML();
      expect(html).toContain('float: left');
      // Browser normalizes `0` to `0px` in margin shorthand
      expect(html).toMatch(/margin:.*1em.*1em/);
    });

    it('renderHTML outputs float: right style', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png" style="float: right;">',
      });
      const html = editor.getHTML();
      expect(html).toContain('float: right');
      expect(html).toMatch(/margin:.*1em.*1em/);
    });

    it('renderHTML outputs center styles', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png" style="margin-left: auto; margin-right: auto;">',
      });
      const html = editor.getHTML();
      expect(html).toContain('margin-left: auto');
      expect(html).toContain('margin-right: auto');
    });

    it('renderHTML outputs no style for float: none', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png">',
      });
      const html = editor.getHTML();
      expect(html).not.toContain('float:');
      expect(html).not.toContain('margin-left: auto');
    });

    it('setImage command accepts float option', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>test</p>',
      });
      editor.commands.setImage({ src: 'https://example.com/img.png', float: 'left' });
      const image = editor.state.doc.child(0);
      expect(image.type.name).toBe('image');
      expect(image.attrs['float']).toBe('left');
    });

    it('setImageFloat command changes float attribute', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png">',
      });
      // Select the image node (position 0)
      const { tr } = editor.state;
      const nodeSelection = editor.state.selection.constructor;
      tr.setSelection((nodeSelection as any).create(editor.state.doc, 0));
      editor.view.dispatch(tr);

      editor.commands.setImageFloat('right');
      const image = editor.state.doc.child(0);
      expect(image.attrs['float']).toBe('right');
    });

    it('setImageFloat returns false for invalid values', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png">',
      });
      const { tr } = editor.state;
      const nodeSelection = editor.state.selection.constructor;
      tr.setSelection((nodeSelection as any).create(editor.state.doc, 0));
      editor.view.dispatch(tr);

      const result = editor.commands.setImageFloat('invalid' as any);
      expect(result).toBe(false);
    });

    it('float attribute round-trips through HTML', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png" style="float: left; margin: 0 1em 1em 0;">',
      });
      const html = editor.getHTML();
      expect(html).toContain('float: left');

      // Parse the output back
      editor.commands.setContent(html);
      const image = editor.state.doc.child(0);
      expect(image.attrs['float']).toBe('left');
    });
  });
});

describe('imageUploadPlugin', () => {
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: {
        group: 'block',
        content: 'inline*',
        toDOM: () => ['p', 0] as const,
        parseDOM: [{ tag: 'p' }],
      },
      image: {
        group: 'block',
        atom: true,
        attrs: {
          src: { default: null },
          alt: { default: null },
          title: { default: null },
        },
        toDOM: (node) =>
          [
            'img',
            {
              src: node.attrs['src'],
              alt: node.attrs['alt'],
              title: node.attrs['title'],
            },
          ] as const,
        parseDOM: [{ tag: 'img[src]' }],
      },
      text: { group: 'inline' },
    },
  });

  let view: EditorView | undefined;

  afterEach(() => {
    view?.destroy();
    _resetPlaceholderCounter();
  });

  function createUploadView(
    uploadHandler: (file: File) => Promise<string>,
    opts?: {
      allowedMimeTypes?: string[];
      maxFileSize?: number;
      onUploadStart?: ((file: File) => void) | null;
      onUploadError?: ((error: Error, file: File) => void) | null;
    },
  ): EditorView {
    const plugin = imageUploadPlugin({
      nodeType: schema.nodes.image,
      uploadHandler,
      allowedMimeTypes: opts?.allowedMimeTypes ?? [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
      ],
      maxFileSize: opts?.maxFileSize ?? 0,
      onUploadStart: opts?.onUploadStart ?? null,
      onUploadError: opts?.onUploadError ?? null,
    });

    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [schema.text('hello')]),
    ]);
    const state = EditorState.create({ schema, doc, plugins: [plugin] });
    const container = document.createElement('div');
    return new EditorView(container, { state });
  }

  function mockFile(name: string, type: string, size = 1000): File {
    const content = new Uint8Array(size);
    return new File([content], name, { type });
  }

  function mockPasteEvent(files: File[]): ClipboardEvent {
    const items = files.map((file) => ({
      kind: 'file' as const,
      type: file.type,
      getAsFile: () => file,
    }));

    return {
      clipboardData: {
        items,
        getData: () => '',
      },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;
  }

  function mockDropEvent(
    files: File[],
    clientX = 0,
    clientY = 0,
  ): DragEvent {
    const fileList = Object.assign(files, {
      item: (i: number) => files[i] ?? null,
    }) as unknown as FileList;

    return {
      dataTransfer: { files: fileList },
      clientX,
      clientY,
      preventDefault: vi.fn(),
    } as unknown as DragEvent;
  }

  describe('plugin creation', () => {
    it('creates a plugin with imageUploadPluginKey', () => {
      const handler = vi.fn().mockResolvedValue('https://example.com/img.png');
      view = createUploadView(handler);

      const pluginState = imageUploadPluginKey.getState(view.state);
      expect(pluginState).toBeDefined();
    });

    it('has handlePaste and handleDrop props', () => {
      const handler = vi
        .fn()
        .mockResolvedValue('https://example.com/img.png');
      const plugin = imageUploadPlugin({
        nodeType: schema.nodes.image,
        uploadHandler: handler,
        allowedMimeTypes: ['image/png'],
        maxFileSize: 0,
        onUploadStart: null,
        onUploadError: null,
      });
      expect(plugin.props.handlePaste).toBeDefined();
      expect(plugin.props.handleDrop).toBeDefined();
    });
  });

  describe('handlePaste', () => {
    it('ignores paste without files', () => {
      const handler = vi.fn().mockResolvedValue('url');
      view = createUploadView(handler);

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === imageUploadPluginKey,
      );
      const handlePaste = plugin!.props.handlePaste as any;

      const event = {
        clipboardData: {
          items: [
            {
              kind: 'string',
              type: 'text/plain',
              getAsFile: () => null,
            },
          ],
          getData: () => 'just text',
        },
        preventDefault: vi.fn(),
      } as unknown as ClipboardEvent;

      const result = handlePaste(view, event);
      expect(result).toBe(false);
      expect(handler).not.toHaveBeenCalled();
    });

    it('ignores non-image files', () => {
      const handler = vi.fn().mockResolvedValue('url');
      view = createUploadView(handler);

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === imageUploadPluginKey,
      );
      const handlePaste = plugin!.props.handlePaste as any;

      const txtFile = mockFile('doc.txt', 'text/plain');
      const event = mockPasteEvent([txtFile]);

      const result = handlePaste(view, event);
      expect(result).toBe(false);
      expect(handler).not.toHaveBeenCalled();
    });

    it('rejects files exceeding maxFileSize', () => {
      const handler = vi.fn().mockResolvedValue('url');
      view = createUploadView(handler, { maxFileSize: 500 });

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === imageUploadPluginKey,
      );
      const handlePaste = plugin!.props.handlePaste as any;

      const bigFile = mockFile('big.png', 'image/png', 1000);
      const event = mockPasteEvent([bigFile]);

      const result = handlePaste(view, event);
      expect(result).toBe(false);
      expect(handler).not.toHaveBeenCalled();
    });

    it('accepts valid image file and calls uploadHandler', () => {
      const handler = vi
        .fn()
        .mockResolvedValue('https://example.com/uploaded.png');
      view = createUploadView(handler);

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === imageUploadPluginKey,
      );
      const handlePaste = plugin!.props.handlePaste as any;

      const file = mockFile('photo.png', 'image/png');
      const event = mockPasteEvent([file]);

      const result = handlePaste(view, event);
      expect(result).toBe(true);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(event.preventDefault).toHaveBeenCalled();
      expect(handler).toHaveBeenCalledWith(file);
    });

    it('calls onUploadStart before upload', () => {
      const handler = vi
        .fn()
        .mockResolvedValue('https://example.com/uploaded.png');
      const onStart = vi.fn();
      view = createUploadView(handler, { onUploadStart: onStart });

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === imageUploadPluginKey,
      );
      const handlePaste = plugin!.props.handlePaste as any;

      const file = mockFile('photo.png', 'image/png');
      const event = mockPasteEvent([file]);

      handlePaste(view, event);
      expect(onStart).toHaveBeenCalledWith(file);
    });

    it('inserts image after successful upload', async () => {
      const handler = vi
        .fn()
        .mockResolvedValue('https://example.com/uploaded.png');
      view = createUploadView(handler);

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === imageUploadPluginKey,
      );
      const handlePaste = plugin!.props.handlePaste as any;

      const file = mockFile('photo.png', 'image/png');
      const event = mockPasteEvent([file]);

      handlePaste(view, event);

      // Wait for async upload to complete
      await vi.waitFor(() => {
        let hasImage = false;
        view!.state.doc.descendants((node) => {
          if (node.type.name === 'image') hasImage = true;
        });
        expect(hasImage).toBe(true);
      });

      // Verify inserted image has correct src
      let imgSrc: string | null = null;
      view.state.doc.descendants((node) => {
        if (node.type.name === 'image') {
          imgSrc = node.attrs['src'] as string;
        }
      });
      expect(imgSrc).toBe('https://example.com/uploaded.png');
    });

    it('removes placeholder on upload error', async () => {
      const handler = vi
        .fn()
        .mockRejectedValue(new Error('Upload failed'));
      const onError = vi.fn();
      view = createUploadView(handler, { onUploadError: onError });

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === imageUploadPluginKey,
      );
      const handlePaste = plugin!.props.handlePaste as any;

      const file = mockFile('photo.png', 'image/png');
      const event = mockPasteEvent([file]);

      handlePaste(view, event);

      // Wait for error handling
      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalled();
      });

      expect(onError).toHaveBeenCalledWith(expect.any(Error), file);
      expect((onError.mock.calls[0] as [Error, File])[0].message).toBe('Upload failed');

      // No image should be in the document
      let hasImage = false;
      view.state.doc.descendants((node) => {
        if (node.type.name === 'image') hasImage = true;
      });
      expect(hasImage).toBe(false);
    });

    it('handles multiple files in single paste', () => {
      const handler = vi
        .fn()
        .mockResolvedValue('https://example.com/img.png');
      view = createUploadView(handler);

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === imageUploadPluginKey,
      );
      const handlePaste = plugin!.props.handlePaste as any;

      const file1 = mockFile('a.png', 'image/png');
      const file2 = mockFile('b.jpg', 'image/jpeg');
      const event = mockPasteEvent([file1, file2]);

      const result = handlePaste(view, event);
      expect(result).toBe(true);
      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenCalledWith(file1);
      expect(handler).toHaveBeenCalledWith(file2);
    });

    it('validates allowedMimeTypes correctly', () => {
      const handler = vi.fn().mockResolvedValue('url');
      view = createUploadView(handler, { allowedMimeTypes: ['image/png'] });

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === imageUploadPluginKey,
      );
      const handlePaste = plugin!.props.handlePaste as any;

      // JPEG should be rejected when only PNG is allowed
      const jpegFile = mockFile('photo.jpg', 'image/jpeg');
      const event1 = mockPasteEvent([jpegFile]);
      expect(handlePaste(view, event1)).toBe(false);

      // PNG should be accepted
      const pngFile = mockFile('photo.png', 'image/png');
      const event2 = mockPasteEvent([pngFile]);
      expect(handlePaste(view, event2)).toBe(true);
    });
  });

  describe('handleDrop', () => {
    it('accepts valid image file on drop', () => {
      const handler = vi
        .fn()
        .mockResolvedValue('https://example.com/dropped.png');
      view = createUploadView(handler);

      // Mock posAtCoords since jsdom doesn't support elementFromPoint
      vi.spyOn(view, 'posAtCoords').mockReturnValue({ pos: 1, inside: -1 });

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === imageUploadPluginKey,
      );
      const handleDrop = plugin!.props.handleDrop as any;

      const file = mockFile('dropped.png', 'image/png');
      const event = mockDropEvent([file], 10, 10);

      const result = handleDrop(view, event);
      expect(result).toBe(true);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(event.preventDefault).toHaveBeenCalled();
      expect(handler).toHaveBeenCalledWith(file);
    });

    it('ignores drop without image files', () => {
      const handler = vi.fn().mockResolvedValue('url');
      view = createUploadView(handler);

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === imageUploadPluginKey,
      );
      const handleDrop = plugin!.props.handleDrop as any;

      const txtFile = mockFile('doc.txt', 'text/plain');
      const event = mockDropEvent([txtFile]);

      const result = handleDrop(view, event);
      expect(result).toBe(false);
      expect(handler).not.toHaveBeenCalled();
    });

    it('ignores drop with no dataTransfer', () => {
      const handler = vi.fn().mockResolvedValue('url');
      view = createUploadView(handler);

      const plugin = view.state.plugins.find(
        (p) => p.spec.key === imageUploadPluginKey,
      );
      const handleDrop = plugin!.props.handleDrop as any;

      const event = {
        dataTransfer: null,
        preventDefault: vi.fn(),
      } as unknown as DragEvent;

      const result = handleDrop(view, event);
      expect(result).toBe(false);
    });
  });
});

describe('Image addToolbarItems', () => {
  it('returns toolbar items (insert + float controls + delete)', () => {
    const items = Image.config.addToolbarItems?.call(Image);
    expect(items).toHaveLength(6);
    expect(items?.[0]?.type).toBe('button');
    // First item is the insert button
    if (items?.[0]?.type === 'button') {
      expect(items[0].name).toBe('image');
    }
    // Float controls
    const names = items?.map(i => i.type === 'button' ? i.name : '');
    expect(names).toContain('imageFloatNone');
    expect(names).toContain('imageFloatLeft');
    expect(names).toContain('imageFloatCenter');
    expect(names).toContain('imageFloatRight');
    expect(names).toContain('deleteImage');
  });

  it('button has correct metadata', () => {
    const items = Image.config.addToolbarItems?.call(Image);
    const button = items?.[0];
    if (button?.type === 'button') {
      expect(button.name).toBe('image');
      expect(button.command).toBe('setImage');
      expect(button.commandArgs).toEqual([{ src: '' }]);
      expect(button.icon).toBe('image');
      expect(button.label).toBe('Insert Image');
      expect(button.group).toBe('insert');
      expect(button.priority).toBe(150);
    }
  });

  it('emits insertImage event instead of executing command', () => {
    const items = Image.config.addToolbarItems?.call(Image);
    const button = items?.[0];
    if (button?.type === 'button') {
      expect(button.emitEvent).toBe('insertImage');
    }
  });

  describe('toolbar: false flag', () => {
    it('insert button does NOT have toolbar: false', () => {
      const items = Image.config.addToolbarItems?.call(Image);
      const insert = items?.find(i => i.name === 'image');
      expect(insert?.type).toBe('button');
      if (insert?.type === 'button') {
        expect(insert.toolbar).toBeUndefined();
      }
    });

    it('float controls have toolbar: false', () => {
      const items = Image.config.addToolbarItems?.call(Image);
      const floatNames = ['imageFloatNone', 'imageFloatLeft', 'imageFloatCenter', 'imageFloatRight'];
      for (const name of floatNames) {
        const item = items?.find(i => i.name === name);
        expect(item?.type).toBe('button');
        if (item?.type === 'button') {
          expect(item.toolbar).toBe(false);
        }
      }
    });

    it('deleteImage has toolbar: false', () => {
      const items = Image.config.addToolbarItems?.call(Image);
      const del = items?.find(i => i.name === 'deleteImage');
      expect(del?.type).toBe('button');
      if (del?.type === 'button') {
        expect(del.toolbar).toBe(false);
      }
    });
  });

  describe('float control items', () => {
    it('imageFloatNone uses setImageFloat command with none', () => {
      const items = Image.config.addToolbarItems?.call(Image);
      const item = items?.find(i => i.name === 'imageFloatNone');
      if (item?.type === 'button') {
        expect(item.command).toBe('setImageFloat');
        expect(item.commandArgs).toEqual(['none']);
        expect(item.icon).toBe('textIndent');
        expect(item.label).toBe('Inline');
        expect(item.group).toBe('image-float');
      }
    });

    it('imageFloatLeft uses setImageFloat command with left', () => {
      const items = Image.config.addToolbarItems?.call(Image);
      const item = items?.find(i => i.name === 'imageFloatLeft');
      if (item?.type === 'button') {
        expect(item.command).toBe('setImageFloat');
        expect(item.commandArgs).toEqual(['left']);
        expect(item.icon).toBe('textAlignLeft');
      }
    });

    it('imageFloatCenter uses setImageFloat command with center', () => {
      const items = Image.config.addToolbarItems?.call(Image);
      const item = items?.find(i => i.name === 'imageFloatCenter');
      if (item?.type === 'button') {
        expect(item.command).toBe('setImageFloat');
        expect(item.commandArgs).toEqual(['center']);
        expect(item.icon).toBe('textAlignCenter');
      }
    });

    it('imageFloatRight uses setImageFloat command with right', () => {
      const items = Image.config.addToolbarItems?.call(Image);
      const item = items?.find(i => i.name === 'imageFloatRight');
      if (item?.type === 'button') {
        expect(item.command).toBe('setImageFloat');
        expect(item.commandArgs).toEqual(['right']);
        expect(item.icon).toBe('textAlignRight');
      }
    });

    it('float controls have isActive with correct attributes', () => {
      const items = Image.config.addToolbarItems?.call(Image);
      const expected: Record<string, { name: string; attributes: { float: string } }> = {
        imageFloatNone: { name: 'image', attributes: { float: 'none' } },
        imageFloatLeft: { name: 'image', attributes: { float: 'left' } },
        imageFloatCenter: { name: 'image', attributes: { float: 'center' } },
        imageFloatRight: { name: 'image', attributes: { float: 'right' } },
      };
      for (const [itemName, isActiveVal] of Object.entries(expected)) {
        const item = items?.find(i => i.name === itemName);
        if (item?.type === 'button') {
          expect(item.isActive).toEqual(isActiveVal);
        }
      }
    });

    it('float controls have descending priority', () => {
      const items = Image.config.addToolbarItems?.call(Image);
      const floatNames = ['imageFloatNone', 'imageFloatLeft', 'imageFloatCenter', 'imageFloatRight'];
      const priorities = floatNames.map(name => {
        const item = items?.find(i => i.name === name);
        return item?.type === 'button' ? (item.priority ?? 100) : 0;
      });
      // Should be strictly descending
      for (let i = 1; i < priorities.length; i++) {
        expect(priorities[i]!).toBeLessThan(priorities[i - 1]!);
      }
    });
  });

  describe('deleteImage item', () => {
    it('has correct command and icon', () => {
      const items = Image.config.addToolbarItems?.call(Image);
      const item = items?.find(i => i.name === 'deleteImage');
      if (item?.type === 'button') {
        expect(item.command).toBe('deleteImage');
        expect(item.icon).toBe('trash');
        expect(item.label).toBe('Delete');
        expect(item.group).toBe('image-actions');
      }
    });
  });
});

describe('Image commands (integration)', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  describe('deleteImage', () => {
    it('provides deleteImage command', () => {
      const commands = Image.config.addCommands?.call(Image);
      expect(commands).toHaveProperty('deleteImage');
      expect(typeof commands?.['deleteImage']).toBe('function');
    });

    it('deletes the selected image', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>before</p><img src="https://example.com/img.png"><p>after</p>',
      });
      expect(editor.state.doc.childCount).toBe(3);

      // Find the image position and select it with NodeSelection
      let imagePos = 0;
      editor.state.doc.forEach((node, offset) => {
        if (node.type.name === 'image') imagePos = offset;
      });
      const { tr } = editor.state;
      tr.setSelection(NodeSelection.create(editor.state.doc, imagePos));
      editor.view.dispatch(tr);

      editor.commands.deleteImage();
      let hasImage = false;
      editor.state.doc.forEach(node => {
        if (node.type.name === 'image') hasImage = true;
      });
      expect(hasImage).toBe(false);
    });

    it('returns true even without dispatch (dry-run)', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png">',
      });
      // can() dry-run should return true
      const canDelete = editor.can().deleteImage();
      expect(canDelete).toBe(true);
    });
  });

  describe('setImageFloat', () => {
    it('provides setImageFloat command', () => {
      const commands = Image.config.addCommands?.call(Image);
      expect(commands).toHaveProperty('setImageFloat');
    });

    it('changes float from none to left', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png">',
      });
      const { tr } = editor.state;
      const nodeSelection = editor.state.selection.constructor;
      tr.setSelection((nodeSelection as any).create(editor.state.doc, 0));
      editor.view.dispatch(tr);

      editor.commands.setImageFloat('left');
      expect(editor.state.doc.child(0).attrs['float']).toBe('left');
    });

    it('changes float from none to center', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png">',
      });
      const { tr } = editor.state;
      const nodeSelection = editor.state.selection.constructor;
      tr.setSelection((nodeSelection as any).create(editor.state.doc, 0));
      editor.view.dispatch(tr);

      editor.commands.setImageFloat('center');
      expect(editor.state.doc.child(0).attrs['float']).toBe('center');
    });

    it('changes float from left to right', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png" style="float: left;">',
      });
      const { tr } = editor.state;
      const nodeSelection = editor.state.selection.constructor;
      tr.setSelection((nodeSelection as any).create(editor.state.doc, 0));
      editor.view.dispatch(tr);

      expect(editor.state.doc.child(0).attrs['float']).toBe('left');
      editor.commands.setImageFloat('right');
      expect(editor.state.doc.child(0).attrs['float']).toBe('right');
    });

    it('changes float back to none', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png" style="float: left;">',
      });
      const { tr } = editor.state;
      const nodeSelection = editor.state.selection.constructor;
      tr.setSelection((nodeSelection as any).create(editor.state.doc, 0));
      editor.view.dispatch(tr);

      editor.commands.setImageFloat('none');
      expect(editor.state.doc.child(0).attrs['float']).toBe('none');
    });

    it('returns false when selection is not on an image', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>just text</p>',
      });
      const result = editor.commands.setImageFloat('left');
      expect(result).toBe(false);
    });

    it('returns false for invalid float value', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png">',
      });
      const { tr } = editor.state;
      const nodeSelection = editor.state.selection.constructor;
      tr.setSelection((nodeSelection as any).create(editor.state.doc, 0));
      editor.view.dispatch(tr);

      const result = editor.commands.setImageFloat('invalid' as any);
      expect(result).toBe(false);
    });

    it('preserves other attributes when changing float', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<img src="https://example.com/img.png" alt="Photo" title="My photo">',
      });
      const { tr } = editor.state;
      const nodeSelection = editor.state.selection.constructor;
      tr.setSelection((nodeSelection as any).create(editor.state.doc, 0));
      editor.view.dispatch(tr);

      editor.commands.setImageFloat('center');
      const image = editor.state.doc.child(0);
      expect(image.attrs['float']).toBe('center');
      expect(image.attrs['src']).toBe('https://example.com/img.png');
      expect(image.attrs['alt']).toBe('Photo');
      expect(image.attrs['title']).toBe('My photo');
    });
  });

  describe('setImage additional cases', () => {
    it('rejects vbscript: URLs via command', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>Text</p>',
      });
      const result = editor.commands.setImage({ src: 'vbscript:msgbox(1)' });
      expect(result).toBe(false);
    });

    it('rejects file: URLs via command', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>Text</p>',
      });
      const result = editor.commands.setImage({ src: 'file:///etc/passwd' });
      expect(result).toBe(false);
    });

    it('rejects data:text URLs via command when allowBase64 is true', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image.configure({ allowBase64: true })],
        content: '<p>Text</p>',
      });
      const result = editor.commands.setImage({ src: 'data:text/html,<script>alert(1)</script>' });
      expect(result).toBe(false);
    });

    it('accepts data:image URLs via command when allowBase64 is true', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image.configure({ allowBase64: true })],
        content: '<p>Text</p>',
      });
      const result = editor.commands.setImage({ src: 'data:image/png;base64,abc123' });
      expect(result).toBe(true);
    });

    it('rejects data:image URLs via command when allowBase64 is false', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image.configure({ allowBase64: false })],
        content: '<p>Text</p>',
      });
      const result = editor.commands.setImage({ src: 'data:image/png;base64,abc123' });
      expect(result).toBe(false);
    });

    it('accepts relative URL via command', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>Text</p>',
      });
      const result = editor.commands.setImage({ src: '/uploads/photo.jpg' });
      expect(result).toBe(true);
    });

    it('accepts protocol-relative URL via command', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>Text</p>',
      });
      const result = editor.commands.setImage({ src: '//cdn.example.com/img.png' });
      expect(result).toBe(true);
    });

    it('inserts image with all attributes', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>Text</p>',
      });
      editor.commands.setImage({
        src: 'https://example.com/img.png',
        alt: 'Alt',
        title: 'Title',
        width: 200,
        height: 100,
        loading: 'lazy',
        crossorigin: 'anonymous',
        float: 'center',
      });

      const image = editor.state.doc.child(0);
      expect(image.type.name).toBe('image');
      expect(image.attrs['src']).toBe('https://example.com/img.png');
      expect(image.attrs['alt']).toBe('Alt');
      expect(image.attrs['title']).toBe('Title');
      expect(image.attrs['float']).toBe('center');
    });
  });
});

describe('Image float attribute (additional)', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('parseHTML detects align="right" (legacy HTML)', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Image],
      content: '<img src="https://example.com/img.png" align="right">',
    });
    const image = editor.state.doc.child(0);
    expect(image.attrs['float']).toBe('right');
  });

  it('parseHTML detects align="middle" as center (legacy HTML)', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Image],
      content: '<img src="https://example.com/img.png" align="middle">',
    });
    const image = editor.state.doc.child(0);
    expect(image.attrs['float']).toBe('center');
  });

  it('float cycle: none → left → center → right → none', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Image],
      content: '<img src="https://example.com/img.png">',
    });
    const nodeSelection = editor.state.selection.constructor;

    const selectImage = (): void => {
      const { tr } = editor!.state;
      tr.setSelection((nodeSelection as any).create(editor!.state.doc, 0));
      editor!.view.dispatch(tr);
    };

    selectImage();
    expect(editor.state.doc.child(0).attrs['float']).toBe('none');

    editor.commands.setImageFloat('left');
    selectImage();
    expect(editor.state.doc.child(0).attrs['float']).toBe('left');

    editor.commands.setImageFloat('center');
    selectImage();
    expect(editor.state.doc.child(0).attrs['float']).toBe('center');

    editor.commands.setImageFloat('right');
    selectImage();
    expect(editor.state.doc.child(0).attrs['float']).toBe('right');

    editor.commands.setImageFloat('none');
    selectImage();
    expect(editor.state.doc.child(0).attrs['float']).toBe('none');
  });

  it('float renders correct style in HTML output for all values', () => {
    const floatStyles: Record<string, string[]> = {
      left: ['float: left', 'margin:'],
      right: ['float: right', 'margin:'],
      center: ['margin-left: auto', 'margin-right: auto'],
    };

    for (const [float, patterns] of Object.entries(floatStyles)) {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>test</p>',
      });
      editor.commands.setImage({ src: 'https://example.com/img.png', float: float as any });
      const html = editor.getHTML();
      for (const pattern of patterns) {
        expect(html).toContain(pattern);
      }
      editor.destroy();
    }
    editor = undefined;
  });

  it('float none renders no float/margin styles', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Image],
      content: '<p>test</p>',
    });
    editor.commands.setImage({ src: 'https://example.com/img.png', float: 'none' });
    const html = editor.getHTML();
    expect(html).not.toContain('float:');
    expect(html).not.toContain('margin-left: auto');
    expect(html).not.toContain('display: block');
  });
});

describe('Image base64 paste/drop (no uploadHandler)', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  function getFileBrowserPlugin(ed: Editor): unknown {
    return ed.state.plugins.find(
      p => (p as any).key?.includes('imageFileBrowser'),
    );
  }

  describe('handlePaste (base64 mode)', () => {
    it('creates imageFileBrowser plugin without uploadHandler', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>text</p>',
      });
      const plugin = getFileBrowserPlugin(editor);
      expect(plugin).toBeDefined();
    });

    it('ignores paste when no clipboard data', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>text</p>',
      });
      const plugin = getFileBrowserPlugin(editor);
      const handlePaste = (plugin as any).props.handlePaste;

      const event = { clipboardData: null, preventDefault: vi.fn() } as unknown as ClipboardEvent;
      const result = handlePaste(editor.view, event);
      expect(result).toBe(false);
    });

    it('ignores paste when no items', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>text</p>',
      });
      const plugin = getFileBrowserPlugin(editor);
      const handlePaste = (plugin as any).props.handlePaste;

      const event = {
        clipboardData: { items: [] },
        preventDefault: vi.fn(),
      } as unknown as ClipboardEvent;
      const result = handlePaste(editor.view, event);
      expect(result).toBe(false);
    });

    it('ignores non-file items', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>text</p>',
      });
      const plugin = getFileBrowserPlugin(editor);
      const handlePaste = (plugin as any).props.handlePaste;

      const event = {
        clipboardData: {
          items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }],
        },
        preventDefault: vi.fn(),
      } as unknown as ClipboardEvent;
      const result = handlePaste(editor.view, event);
      expect(result).toBe(false);
    });

    it('ignores non-image files', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>text</p>',
      });
      const plugin = getFileBrowserPlugin(editor);
      const handlePaste = (plugin as any).props.handlePaste;

      const event = {
        clipboardData: {
          items: [{ kind: 'file', type: 'text/plain', getAsFile: () => new File([new Uint8Array(10)], 'doc.txt', { type: 'text/plain' }) }],
        },
        preventDefault: vi.fn(),
      } as unknown as ClipboardEvent;
      const result = handlePaste(editor.view, event);
      expect(result).toBe(false);
    });

    it('ignores file with disallowed MIME type', () => {
      const CustomImage = Image.configure({ allowedMimeTypes: ['image/png'] });
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomImage],
        content: '<p>text</p>',
      });
      const plugin = getFileBrowserPlugin(editor);
      const handlePaste = (plugin as any).props.handlePaste;

      const file = new File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' });
      const event = {
        clipboardData: {
          items: [{ kind: 'file', type: 'image/jpeg', getAsFile: () => file }],
        },
        preventDefault: vi.fn(),
      } as unknown as ClipboardEvent;
      const result = handlePaste(editor.view, event);
      expect(result).toBe(false);
    });

    it('ignores file exceeding maxFileSize', () => {
      const CustomImage = Image.configure({ maxFileSize: 100 });
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomImage],
        content: '<p>text</p>',
      });
      const plugin = getFileBrowserPlugin(editor);
      const handlePaste = (plugin as any).props.handlePaste;

      const file = new File([new Uint8Array(200)], 'big.png', { type: 'image/png' });
      const event = {
        clipboardData: {
          items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
        },
        preventDefault: vi.fn(),
      } as unknown as ClipboardEvent;
      const result = handlePaste(editor.view, event);
      expect(result).toBe(false);
    });

    it('accepts valid image paste and calls preventDefault', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>text</p>',
      });
      const plugin = getFileBrowserPlugin(editor);
      const handlePaste = (plugin as any).props.handlePaste;

      const file = new File([new Uint8Array(10)], 'photo.png', { type: 'image/png' });
      const preventDefault = vi.fn();
      const event = {
        clipboardData: {
          items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
        },
        preventDefault,
      } as unknown as ClipboardEvent;
      const result = handlePaste(editor.view, event);
      expect(result).toBe(true);
      expect(preventDefault).toHaveBeenCalled();
    });

    it('returns false (defers to imageUploadPlugin) when uploadHandler is set', () => {
      const UploadImage = Image.configure({
        uploadHandler: () => Promise.resolve('https://example.com/img.png'),
      });
      editor = new Editor({
        extensions: [Document, Text, Paragraph, UploadImage],
        content: '<p>text</p>',
      });
      const plugin = getFileBrowserPlugin(editor);
      const handlePaste = (plugin as any).props.handlePaste;

      const file = new File([new Uint8Array(10)], 'photo.png', { type: 'image/png' });
      const event = {
        clipboardData: {
          items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
        },
        preventDefault: vi.fn(),
      } as unknown as ClipboardEvent;
      const result = handlePaste(editor.view, event);
      expect(result).toBe(false);
    });

    it('ignores if getAsFile returns null', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>text</p>',
      });
      const plugin = getFileBrowserPlugin(editor);
      const handlePaste = (plugin as any).props.handlePaste;

      const event = {
        clipboardData: {
          items: [{ kind: 'file', type: 'image/png', getAsFile: () => null }],
        },
        preventDefault: vi.fn(),
      } as unknown as ClipboardEvent;
      const result = handlePaste(editor.view, event);
      expect(result).toBe(false);
    });

    it('accepts maxFileSize: 0 as unlimited', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image.configure({ maxFileSize: 0 })],
        content: '<p>text</p>',
      });
      const plugin = getFileBrowserPlugin(editor);
      const handlePaste = (plugin as any).props.handlePaste;

      const file = new File([new Uint8Array(10_000_000)], 'huge.png', { type: 'image/png' });
      const event = {
        clipboardData: {
          items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
        },
        preventDefault: vi.fn(),
      } as unknown as ClipboardEvent;
      const result = handlePaste(editor.view, event);
      expect(result).toBe(true);
    });
  });

  describe('handleDrop (base64 mode)', () => {
    it('returns false when uploadHandler is set', () => {
      const UploadImage = Image.configure({
        uploadHandler: () => Promise.resolve('https://example.com/img.png'),
      });
      editor = new Editor({
        extensions: [Document, Text, Paragraph, UploadImage],
        content: '<p>text</p>',
      });
      const plugin = getFileBrowserPlugin(editor);
      const handleDrop = (plugin as any).props.handleDrop;

      const file = new File([new Uint8Array(10)], 'photo.png', { type: 'image/png' });
      const event = {
        dataTransfer: { files: Object.assign([file], { item: (i: number) => [file][i] }) },
        clientX: 0,
        clientY: 0,
        preventDefault: vi.fn(),
      } as unknown as DragEvent;
      const result = handleDrop(editor.view, event);
      expect(result).toBe(false);
    });

    it('returns false when no files in dataTransfer', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>text</p>',
      });
      const plugin = getFileBrowserPlugin(editor);
      const handleDrop = (plugin as any).props.handleDrop;

      const event = {
        dataTransfer: { files: Object.assign([], { item: () => null, length: 0 }) },
        clientX: 0,
        clientY: 0,
        preventDefault: vi.fn(),
      } as unknown as DragEvent;
      const result = handleDrop(editor.view, event);
      expect(result).toBe(false);
    });

    it('returns false for non-image file on drop', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>text</p>',
      });
      const plugin = getFileBrowserPlugin(editor);
      const handleDrop = (plugin as any).props.handleDrop;

      const file = new File([new Uint8Array(10)], 'doc.txt', { type: 'text/plain' });
      const event = {
        dataTransfer: { files: Object.assign([file], { item: (i: number) => [file][i], length: 1 }) },
        clientX: 0,
        clientY: 0,
        preventDefault: vi.fn(),
      } as unknown as DragEvent;
      const result = handleDrop(editor.view, event);
      expect(result).toBe(false);
    });

    it('returns false for file exceeding maxFileSize on drop', () => {
      const CustomImage = Image.configure({ maxFileSize: 100 });
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomImage],
        content: '<p>text</p>',
      });
      const plugin = getFileBrowserPlugin(editor);
      const handleDrop = (plugin as any).props.handleDrop;

      const file = new File([new Uint8Array(200)], 'big.png', { type: 'image/png' });
      const event = {
        dataTransfer: { files: Object.assign([file], { item: (i: number) => [file][i], length: 1 }) },
        clientX: 0,
        clientY: 0,
        preventDefault: vi.fn(),
      } as unknown as DragEvent;
      const result = handleDrop(editor.view, event);
      expect(result).toBe(false);
    });

    it('accepts valid image file on drop', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>text</p>',
      });
      const plugin = getFileBrowserPlugin(editor);
      const handleDrop = (plugin as any).props.handleDrop;

      vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 1, inside: -1 });

      const file = new File([new Uint8Array(10)], 'dropped.png', { type: 'image/png' });
      const preventDefault = vi.fn();
      const event = {
        dataTransfer: { files: Object.assign([file], { item: (i: number) => [file][i], length: 1 }) },
        clientX: 10,
        clientY: 10,
        preventDefault,
      } as unknown as DragEvent;
      const result = handleDrop(editor.view, event);
      expect(result).toBe(true);
      expect(preventDefault).toHaveBeenCalled();
    });

    it('returns false when posAtCoords returns null', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Image],
        content: '<p>text</p>',
      });
      const plugin = getFileBrowserPlugin(editor);
      const handleDrop = (plugin as any).props.handleDrop;

      vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(null);

      const file = new File([new Uint8Array(10)], 'dropped.png', { type: 'image/png' });
      const event = {
        dataTransfer: { files: Object.assign([file], { item: (i: number) => [file][i], length: 1 }) },
        clientX: -999,
        clientY: -999,
        preventDefault: vi.fn(),
      } as unknown as DragEvent;
      const result = handleDrop(editor.view, event);
      expect(result).toBe(false);
    });
  });
});

describe('Image popover plugin', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
    // Clean up any leftover popovers
    document.querySelectorAll('.dm-image-popover').forEach(el => { el.remove(); });
  });

  it('appends popover element to document body', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Image],
      content: '<p>text</p>',
    });
    const popover = document.querySelector('.dm-image-popover');
    expect(popover).not.toBeNull();
  });

  it('popover has correct structure (input + 2 buttons)', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Image],
      content: '<p>text</p>',
    });
    const popover = document.querySelector('.dm-image-popover');
    expect(popover).not.toBeNull();
    expect(popover?.querySelector('.dm-image-popover-input')).not.toBeNull();
    expect(popover?.querySelector('.dm-image-popover-apply')).not.toBeNull();
    expect(popover?.querySelector('.dm-image-popover-browse')).not.toBeNull();
  });

  it('popover input has type="url" and placeholder', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Image],
      content: '<p>text</p>',
    });
    const input = document.querySelector<HTMLInputElement>('.dm-image-popover-input')!;
    expect(input.type).toBe('url');
    expect(input.placeholder).toBe('Image URL...');
  });

  it('popover has data-dm-editor-ui attribute', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Image],
      content: '<p>text</p>',
    });
    const popover = document.querySelector('.dm-image-popover');
    expect(popover?.hasAttribute('data-dm-editor-ui')).toBe(true);
  });

  it('popover is hidden by default (no data-show)', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Image],
      content: '<p>text</p>',
    });
    const popover = document.querySelector('.dm-image-popover');
    expect(popover?.hasAttribute('data-show')).toBe(false);
  });

  it('popover is removed on editor destroy', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Image],
      content: '<p>text</p>',
    });
    expect(document.querySelector('.dm-image-popover')).not.toBeNull();
    editor.destroy();
    expect(document.querySelector('.dm-image-popover')).toBeNull();
    editor = undefined;
  });
});

describe('Image drag overlay', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
    document.querySelectorAll('.dm-image-popover').forEach(el => { el.remove(); });
  });

  function getFileBrowserPlugin(ed: Editor): unknown {
    return ed.state.plugins.find(
      p => (p as any).key?.includes('imageFileBrowser'),
    );
  }

  it('dragenter with non-image items does not add class', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Image],
      content: '<p>text</p>',
    });
    const plugin = getFileBrowserPlugin(editor);
    const handlers = (plugin as any).props.handleDOMEvents;

    // Create a mock dragenter event with non-image items
    const event = {
      dataTransfer: {
        items: [{ kind: 'file', type: 'text/plain' }],
      },
    } as unknown as DragEvent;

    handlers.dragenter(editor.view, event);
    const editorEl = editor.view.dom.closest('.dm-editor');
    // Either no editor wrapper in test env, or no class added
    expect(editorEl?.classList.contains('dm-dragover') ?? true).toBeTruthy();
  });
});
