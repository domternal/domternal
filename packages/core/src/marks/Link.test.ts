import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { Link } from './Link.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';

describe('Link', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(Link.name).toBe('link');
    });

    it('is a mark type', () => {
      expect(Link.type).toBe('mark');
    });

    it('has priority 1000', () => {
      expect(Link.config.priority).toBe(1000);
    });

    it('is not inclusive', () => {
      expect(Link.config.inclusive).toBe(false);
    });

    it('has default options', () => {
      expect(Link.options).toEqual({
        HTMLAttributes: {},
        protocols: ['http:', 'https:', 'mailto:', 'tel:'],
        openOnClick: true,
        addRelNoopener: true,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
      });
    });

    it('can configure protocols', () => {
      const custom = Link.configure({ protocols: ['http:', 'https:'] });
      expect(custom.options.protocols).toEqual(['http:', 'https:']);
    });

    it('can disable autolink', () => {
      const custom = Link.configure({ autolink: false });
      expect(custom.options.autolink).toBe(false);
    });
  });

  describe('addAttributes', () => {
    it('defines href, target, rel attributes', () => {
      const attrs = Link.config.addAttributes?.call(Link);
      expect(attrs).toHaveProperty('href');
      expect(attrs).toHaveProperty('target');
      expect(attrs).toHaveProperty('rel');
      expect(attrs?.['href']?.default).toBeNull();
      expect(attrs?.['target']?.default).toBeNull();
      expect(attrs?.['rel']?.default).toBeNull();
    });
  });

  describe('parseHTML', () => {
    it('returns rule for a[href]', () => {
      const rules = Link.config.parseHTML?.call(Link);
      expect(rules).toHaveLength(1);
      expect(rules?.[0]).toHaveProperty('tag', 'a[href]');
      expect(rules?.[0]).toHaveProperty('getAttrs');
    });

    it('accepts valid http href', () => {
      const rules = Link.config.parseHTML?.call(Link);
      const getAttrs = rules?.[0]?.getAttrs;
      const el = document.createElement('a');
      el.setAttribute('href', 'https://example.com');
      expect(getAttrs?.(el)).toEqual({
        href: 'https://example.com',
        target: null,
        rel: null,
      });
    });

    it('rejects javascript: URLs', () => {
      const rules = Link.config.parseHTML?.call(Link);
      const getAttrs = rules?.[0]?.getAttrs;
      const el = document.createElement('a');
      el.setAttribute('href', 'javascript:alert(1)');
      expect(getAttrs?.(el)).toBe(false);
    });

    it('rejects links without href', () => {
      const rules = Link.config.parseHTML?.call(Link);
      const getAttrs = rules?.[0]?.getAttrs;
      const el = document.createElement('a');
      expect(getAttrs?.(el)).toBe(false);
    });

    it('parses target attribute', () => {
      const rules = Link.config.parseHTML?.call(Link);
      const getAttrs = rules?.[0]?.getAttrs;
      const el = document.createElement('a');
      el.setAttribute('href', 'https://example.com');
      el.setAttribute('target', '_blank');
      const attrs = getAttrs?.(el) as Record<string, unknown>;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      expect(attrs?.['target']).toBe('_blank');
    });
  });

  describe('addCommands', () => {
    it('provides setLink, unsetLink, toggleLink', () => {
      const commands = Link.config.addCommands?.call(Link);
      expect(commands).toHaveProperty('setLink');
      expect(commands).toHaveProperty('unsetLink');
      expect(commands).toHaveProperty('toggleLink');
    });
  });

  describe('addProseMirrorPlugins', () => {
    it('returns empty array when no markType', () => {
      const plugins = Link.config.addProseMirrorPlugins?.call(Link);
      expect(plugins).toEqual([]);
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('parses <a> tags', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Link],
        content: '<p><a href="https://example.com">link</a></p>',
      });
      const textNode = editor.state.doc.child(0).child(0);
      expect(textNode.marks[0]?.type.name).toBe('link');
      expect(textNode.marks[0]?.attrs['href']).toBe('https://example.com');
    });

    it('renders to <a>', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Link],
        content: '<p><a href="https://example.com">link</a></p>',
      });
      const html = editor.getHTML();
      expect(html).toContain('<a');
      expect(html).toContain('href="https://example.com"');
    });

    it('strips invalid href from rendered output', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Link],
        content: '<p><a href="javascript:alert(1)">xss</a></p>',
      });
      // javascript: URL should be rejected at parse time
      const textNode = editor.state.doc.child(0).child(0);
      expect(textNode.marks).toHaveLength(0);
    });

    it('adds rel="noopener noreferrer" for target=_blank', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Link],
        content: '<p><a href="https://example.com" target="_blank">link</a></p>',
      });
      const html = editor.getHTML();
      expect(html).toContain('noopener noreferrer');
    });

    it('preserves mailto links', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Link],
        content: '<p><a href="mailto:test@example.com">email</a></p>',
      });
      const textNode = editor.state.doc.child(0).child(0);
      expect(textNode.marks[0]?.attrs['href']).toBe('mailto:test@example.com');
    });

    it('creates link plugins when markType available', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Link],
        content: '<p>test</p>',
      });
      // Should have linkClick, linkPaste, and autolink plugins
      const pluginKeys = editor.state.plugins.map((p) => (p.spec.key as { key?: string }).key ?? '');
      expect(pluginKeys.some((k) => k.includes('linkClick'))).toBe(true);
      expect(pluginKeys.some((k) => k.includes('linkPaste'))).toBe(true);
      expect(pluginKeys.some((k) => k.includes('autolink'))).toBe(true);
    });

    it('disables autolink when configured', () => {
      const NoAutoLink = Link.configure({ autolink: false });
      editor = new Editor({
        extensions: [Document, Text, Paragraph, NoAutoLink],
        content: '<p>test</p>',
      });
      const pluginKeys = editor.state.plugins.map((p) => (p.spec.key as { key?: string }).key ?? '');
      expect(pluginKeys.some((k) => k.includes('autolink'))).toBe(false);
    });

    it('disables click handler when configured', () => {
      const NoClick = Link.configure({ openOnClick: false });
      editor = new Editor({
        extensions: [Document, Text, Paragraph, NoClick],
        content: '<p>test</p>',
      });
      const pluginKeys = editor.state.plugins.map((p) => (p.spec.key as { key?: string }).key ?? '');
      expect(pluginKeys.some((k) => k.includes('linkClick'))).toBe(false);
    });

    it('disables paste handler when configured', () => {
      const NoPaste = Link.configure({ linkOnPaste: false });
      editor = new Editor({
        extensions: [Document, Text, Paragraph, NoPaste],
        content: '<p>test</p>',
      });
      const pluginKeys = editor.state.plugins.map((p) => (p.spec.key as { key?: string }).key ?? '');
      expect(pluginKeys.some((k) => k.includes('linkPaste'))).toBe(false);
    });

    it('setLink applies link to selection', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Link],
        content: '<p>click here</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.setLink({ href: 'https://example.com' });
      const textNode = editor.state.doc.child(0).child(0);
      expect(textNode.marks[0]?.type.name).toBe('link');
      expect(textNode.marks[0]?.attrs['href']).toBe('https://example.com');
    });

    it('setLink rejects invalid URL', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Link],
        content: '<p>click here</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      const result = editor.commands.setLink({ href: 'javascript:alert(1)' });
      expect(result).toBe(false);
    });

    it('unsetLink removes link mark', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Link],
        content: '<p><a href="https://example.com">link</a></p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 5)));
      editor.commands.unsetLink();
      const textNode = editor.state.doc.child(0).child(0);
      expect(textNode.marks).toHaveLength(0);
    });

    it('toggleLink applies link to selection with valid URL', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Link],
        content: '<p>click here</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      editor.commands.toggleLink({ href: 'https://example.com' });
      const textNode = editor.state.doc.child(0).child(0);
      expect(textNode.marks[0]?.type.name).toBe('link');
    });

    it('toggleLink rejects invalid URL', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Link],
        content: '<p>click here</p>',
      });
      const { state } = editor;
      editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
      const result = editor.commands.toggleLink({ href: 'javascript:alert(1)' });
      expect(result).toBe(false);
    });

    it('renderHTML strips invalid href but keeps other attributes', () => {
      const spec = Link.createMarkSpec();
      const mockMark = { attrs: { href: 'javascript:alert(1)', target: '_blank', rel: null } };
      const result = spec.toDOM?.(mockMark as never, true) as [string, Record<string, unknown>, number];
      expect(result[0]).toBe('a');
      expect(result[1]).not.toHaveProperty('href');
      expect(result[1]).toHaveProperty('target', '_blank');
    });

    it('parseHTML getAttrs handles string argument', () => {
      const rules = Link.config.parseHTML?.call(Link);
      const getAttrs = rules?.[0]?.getAttrs;
      expect(getAttrs?.('test')).toBe(false);
    });
  });
});
