import { describe, it, expect, afterEach } from 'vitest';
import { StarterKit } from './StarterKit.js';
import { Editor } from '../Editor.js';

describe('StarterKit', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(StarterKit.name).toBe('starterKit');
    });

    it('is an extension type', () => {
      expect(StarterKit.type).toBe('extension');
    });

    it('has empty default options', () => {
      const opts = StarterKit.config.addOptions?.call(StarterKit);
      expect(opts).toEqual({});
    });
  });

  describe('addExtensions', () => {
    it('returns all default extensions', () => {
      const extensions = StarterKit.config.addExtensions?.call(StarterKit);
      expect(extensions).toBeDefined();
      expect(extensions!.length).toBeGreaterThan(20);
    });

    it('includes all node types', () => {
      const extensions = StarterKit.config.addExtensions?.call(StarterKit);
      const names = extensions!.map((e) => e.name);
      expect(names).toContain('doc');
      expect(names).toContain('text');
      expect(names).toContain('paragraph');
      expect(names).toContain('heading');
      expect(names).toContain('blockquote');
      expect(names).toContain('codeBlock');
      expect(names).toContain('bulletList');
      expect(names).toContain('orderedList');
      expect(names).toContain('listItem');
      expect(names).toContain('horizontalRule');
      expect(names).toContain('hardBreak');
      expect(names).toContain('taskList');
      expect(names).toContain('taskItem');
    });

    it('includes all mark types', () => {
      const extensions = StarterKit.config.addExtensions?.call(StarterKit);
      const names = extensions!.map((e) => e.name);
      expect(names).toContain('bold');
      expect(names).toContain('italic');
      expect(names).toContain('underline');
      expect(names).toContain('strike');
      expect(names).toContain('code');
      expect(names).toContain('link');
    });

    it('includes functionality extensions', () => {
      const extensions = StarterKit.config.addExtensions?.call(StarterKit);
      const names = extensions!.map((e) => e.name);
      expect(names).toContain('baseKeymap');
      expect(names).toContain('history');
      expect(names).toContain('dropcursor');
      expect(names).toContain('gapcursor');
      expect(names).toContain('trailingNode');
      expect(names).toContain('listKeymap');
    });

    it('can disable individual extensions', () => {
      const custom = StarterKit.configure({
        bold: false,
        history: false,
      });
      const extensions = custom.config.addExtensions?.call(custom);
      const names = extensions!.map((e) => e.name);
      expect(names).not.toContain('bold');
      expect(names).not.toContain('history');
      // Other extensions should still be present
      expect(names).toContain('italic');
      expect(names).toContain('paragraph');
    });

    it('can configure individual extensions', () => {
      const custom = StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      });
      const extensions = custom.config.addExtensions?.call(custom);
      const heading = extensions!.find((e) => e.name === 'heading');
      expect(heading).toBeDefined();
      expect(heading?.options?.levels).toEqual([1, 2, 3]);
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('creates a working editor with all extensions', () => {
      editor = new Editor({
        extensions: [StarterKit],
        content: '<p>Hello world</p>',
      });
      expect(editor.getText()).toContain('Hello world');
    });

    it('supports headings', () => {
      editor = new Editor({
        extensions: [StarterKit],
        content: '<h1>Title</h1><p>Content</p>',
      });
      expect(editor.state.doc.child(0).type.name).toBe('heading');
    });

    it('supports marks', () => {
      editor = new Editor({
        extensions: [StarterKit],
        content: '<p><strong>bold</strong> and <em>italic</em></p>',
      });
      const p = editor.state.doc.child(0);
      expect(p.child(0).marks[0]?.type.name).toBe('bold');
    });

    it('supports lists', () => {
      editor = new Editor({
        extensions: [StarterKit],
        content: '<ul><li>item</li></ul>',
      });
      expect(editor.state.doc.child(0).type.name).toBe('bulletList');
    });

    it('works with disabled extensions', () => {
      editor = new Editor({
        extensions: [StarterKit.configure({ bold: false, italic: false })],
        content: '<p><strong>not bold</strong></p>',
      });
      // Bold should be stripped since it's disabled
      const p = editor.state.doc.child(0);
      expect(p.child(0).marks).toHaveLength(0);
    });
  });
});
