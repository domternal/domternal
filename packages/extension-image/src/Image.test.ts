import { describe, it, expect, afterEach, vi } from 'vitest';
import { Image } from './Image.js';
import { Document, Text, Paragraph, Editor } from '@domternal/core';
import {
  imageUploadPlugin,
  imageUploadPluginKey,
  _resetPlaceholderCounter,
} from './imageUploadPlugin.js';
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

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
      );
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
