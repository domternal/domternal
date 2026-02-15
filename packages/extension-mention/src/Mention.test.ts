import { describe, it, expect, afterEach } from 'vitest';
import { Mention } from './Mention.js';
import type { MentionStorage } from './Mention.js';
import type { MentionTrigger } from './mentionSuggestionPlugin.js';
import { Document, Text, Paragraph, Editor } from '@domternal/core';
import { TextSelection } from 'prosemirror-state';

const allExtensions = [Document, Text, Paragraph, Mention];

/** Get typed mention storage from editor */
function getStorage(editor: Editor): MentionStorage {
  return editor.storage['mention'] as MentionStorage;
}

// ─── Configuration ───────────────────────────────────────────────────────────

describe('Mention', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(Mention.name).toBe('mention');
    });

    it('is a node type', () => {
      expect(Mention.type).toBe('node');
    });

    it('belongs to inline group', () => {
      expect(Mention.config.group).toBe('inline');
    });

    it('is inline', () => {
      expect(Mention.config.inline).toBe(true);
    });

    it('is an atom', () => {
      expect(Mention.config.atom).toBe(true);
    });

    it('is not selectable', () => {
      expect(Mention.config.selectable).toBe(false);
    });

    it('is not draggable', () => {
      expect(Mention.config.draggable).toBe(false);
    });

    it('has default options', () => {
      expect(Mention.options).toEqual({
        suggestion: null,
        triggers: [],
        deleteTriggerWithBackspace: false,
        renderHTML: null,
        renderText: null,
        HTMLAttributes: {},
      });
    });

    it('can configure suggestion', () => {
      const trigger: MentionTrigger = {
        char: '@',
        name: 'user',
        items: () => [],
      };
      const Custom = Mention.configure({ suggestion: trigger });
      expect(Custom.options.suggestion).toBe(trigger);
    });

    it('can configure multiple triggers', () => {
      const triggers: MentionTrigger[] = [
        { char: '@', name: 'user', items: () => [] },
        { char: '#', name: 'tag', items: () => [] },
      ];
      const Custom = Mention.configure({ triggers });
      expect(Custom.options.triggers).toBe(triggers);
      expect(Custom.options.triggers).toHaveLength(2);
    });

    it('can configure deleteTriggerWithBackspace', () => {
      const Custom = Mention.configure({ deleteTriggerWithBackspace: true });
      expect(Custom.options.deleteTriggerWithBackspace).toBe(true);
    });

    it('can configure HTMLAttributes', () => {
      const Custom = Mention.configure({ HTMLAttributes: { class: 'custom' } });
      expect(Custom.options.HTMLAttributes).toEqual({ class: 'custom' });
    });

    it('can configure custom renderHTML', () => {
      const fn = () => ['a', {}, 'test'] as const;
      const Custom = Mention.configure({ renderHTML: fn as any });
      expect(Custom.options.renderHTML).toBe(fn);
    });

    it('can configure custom renderText', () => {
      const fn = (): string => 'test';
      const Custom = Mention.configure({ renderText: fn as any });
      expect(Custom.options.renderText).toBe(fn);
    });
  });

  // ─── Attributes ──────────────────────────────────────────────────────────

  describe('attributes', () => {
    it('has id attribute with parseHTML from data-id', () => {
      const attrs = Mention.config.addAttributes?.call(Mention);
      expect(attrs).toHaveProperty('id');

      const mockEl = { getAttribute: (attr: string) => attr === 'data-id' ? '42' : null } as any;
      expect(attrs!['id']!.parseHTML!(mockEl)).toBe('42');
    });

    it('has label attribute with parseHTML from data-label', () => {
      const attrs = Mention.config.addAttributes?.call(Mention);
      expect(attrs).toHaveProperty('label');

      const mockEl = { getAttribute: (attr: string) => attr === 'data-label' ? 'Alice' : null } as any;
      expect(attrs!['label']!.parseHTML!(mockEl)).toBe('Alice');
    });

    it('has type attribute with parseHTML from data-mention-type', () => {
      const attrs = Mention.config.addAttributes?.call(Mention);
      expect(attrs).toHaveProperty('type');

      const mockEl = { getAttribute: (attr: string) => attr === 'data-mention-type' ? 'user' : null } as any;
      expect(attrs!['type']!.parseHTML!(mockEl)).toBe('user');
    });

    it('type attribute defaults to mention when not present', () => {
      const attrs = Mention.config.addAttributes?.call(Mention);
      const mockEl = { getAttribute: () => null } as any;
      expect(attrs!['type']!.parseHTML!(mockEl)).toBe('mention');
    });

    it('id renderHTML produces data-id', () => {
      const attrs = Mention.config.addAttributes?.call(Mention);
      const result = attrs!['id']!.renderHTML!({ id: '42' });
      expect(result).toEqual({ 'data-id': '42' });
    });

    it('id renderHTML returns empty object for missing id', () => {
      const attrs = Mention.config.addAttributes?.call(Mention);
      const result = attrs!['id']!.renderHTML!({ id: null });
      expect(result).toEqual({});
    });

    it('label renderHTML produces data-label', () => {
      const attrs = Mention.config.addAttributes?.call(Mention);
      const result = attrs!['label']!.renderHTML!({ label: 'Alice' });
      expect(result).toEqual({ 'data-label': 'Alice' });
    });

    it('type renderHTML produces data-mention-type', () => {
      const attrs = Mention.config.addAttributes?.call(Mention);
      const result = attrs!['type']!.renderHTML!({ type: 'user' });
      expect(result).toEqual({ 'data-mention-type': 'user' });
    });
  });

  // ─── parseHTML ─────────────────────────────────────────────────────────

  describe('parseHTML', () => {
    it('returns rules for span[data-type="mention"] and span[data-mention]', () => {
      const rules = Mention.config.parseHTML?.call(Mention);
      expect(rules).toEqual([
        { tag: 'span[data-type="mention"]' },
        { tag: 'span[data-mention]' },
      ]);
    });
  });

  // ─── renderHTML ────────────────────────────────────────────────────────

  describe('renderHTML', () => {
    it('renders span with data-type and mention class', () => {
      const spec = Mention.createNodeSpec();
      const mockNode = { attrs: { id: '1', label: 'Alice', type: 'mention' } } as any;
      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, string];
      expect(result[0]).toBe('span');
      expect(result[1]['data-type']).toBe('mention');
      expect(result[1]['class']).toContain('mention');
    });

    it('renders trigger char + label as text content', () => {
      const spec = Mention.createNodeSpec();
      const mockNode = { attrs: { id: '1', label: 'Alice', type: 'mention' } } as any;
      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, string];
      // Default trigger char is @ (no triggers configured, falls back to @)
      expect(result[2]).toBe('@Alice');
    });

    it('merges custom HTMLAttributes', () => {
      const Custom = Mention.configure({ HTMLAttributes: { class: 'styled' } });
      const spec = Custom.createNodeSpec();
      const mockNode = { attrs: { id: '1', label: 'Alice', type: 'mention' } } as any;
      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, string];
      expect(result[1]['class']).toContain('styled');
      expect(result[1]['class']).toContain('mention');
    });

    it('handles missing label', () => {
      const spec = Mention.createNodeSpec();
      const mockNode = { attrs: { id: '1', label: null, type: 'mention' } } as any;
      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, string];
      expect(result[2]).toBe('@');
    });
  });

  // ─── leafText ──────────────────────────────────────────────────────────

  describe('leafText', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('returns trigger char + label for getText', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello <span data-type="mention" data-id="1" data-label="Alice" data-mention-type="mention">@Alice</span> world</p>',
      });

      const text = editor.state.doc.textContent;
      expect(text).toContain('@Alice');
    });

    it('getText includes mention between text', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>A<span data-type="mention" data-id="1" data-label="Bob" data-mention-type="mention">@Bob</span>B</p>',
      });

      const text = editor.state.doc.textContent;
      expect(text).toBe('A@BobB');
    });
  });

  // ─── Integration ──────────────────────────────────────────────────────

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('creates editor with mention node registered', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });

      expect(editor.state.schema.nodes['mention']).toBeDefined();
    });

    it('parses mention HTML correctly', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello <span data-type="mention" data-id="42" data-label="Alice" data-mention-type="user">@Alice</span> world</p>',
      });

      const para = editor.state.doc.child(0);
      expect(para.childCount).toBe(3);
      expect(para.child(1).type.name).toBe('mention');
      expect(para.child(1).attrs['id']).toBe('42');
      expect(para.child(1).attrs['label']).toBe('Alice');
      expect(para.child(1).attrs['type']).toBe('user');
    });

    it('parses legacy data-mention format', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hi <span data-mention data-id="7" data-label="Bob" data-mention-type="mention">@Bob</span></p>',
      });

      const para = editor.state.doc.child(0);
      const mentionNode = para.child(1);
      expect(mentionNode.type.name).toBe('mention');
      expect(mentionNode.attrs['id']).toBe('7');
      expect(mentionNode.attrs['label']).toBe('Bob');
    });

    it('renders mention HTML correctly', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello <span data-type="mention" data-id="1" data-label="Alice" data-mention-type="user">@Alice</span></p>',
      });

      const html = editor.getHTML();
      expect(html).toContain('data-type="mention"');
      expect(html).toContain('data-id="1"');
      expect(html).toContain('data-label="Alice"');
      expect(html).toContain('data-mention-type="user"');
      expect(html).toContain('class="mention"');
    });

    it('round-trips HTML correctly', () => {
      const input = '<p>Test <span data-type="mention" data-id="1" data-label="Alice" data-mention-type="mention">@Alice</span> end</p>';

      editor = new Editor({
        extensions: allExtensions,
        content: input,
      });

      const html1 = editor.getHTML();
      editor.destroy();

      editor = new Editor({
        extensions: allExtensions,
        content: html1,
      });

      const html2 = editor.getHTML();
      expect(html1).toBe(html2);
    });

    it('supports multiple mentions in a paragraph', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p><span data-type="mention" data-id="1" data-label="Alice" data-mention-type="mention">@Alice</span> and <span data-type="mention" data-id="2" data-label="Bob" data-mention-type="mention">@Bob</span></p>',
      });

      const para = editor.state.doc.child(0);
      expect(para.childCount).toBe(3);
      expect(para.child(0).type.name).toBe('mention');
      expect(para.child(0).attrs['label']).toBe('Alice');
      expect(para.child(2).type.name).toBe('mention');
      expect(para.child(2).attrs['label']).toBe('Bob');
    });

    it('applies custom HTMLAttributes', () => {
      const Custom = Mention.configure({ HTMLAttributes: { class: 'custom-mention' } });
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p><span data-type="mention" data-id="1" data-label="Alice" data-mention-type="mention">@Alice</span></p>',
      });

      const html = editor.getHTML();
      expect(html).toContain('custom-mention');
    });
  });

  // ─── Commands ──────────────────────────────────────────────────────────

  describe('commands', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('provides insertMention command', () => {
      const commands = Mention.config.addCommands?.call(Mention);
      expect(commands).toHaveProperty('insertMention');
      expect(typeof commands?.['insertMention']).toBe('function');
    });

    it('provides deleteMention command', () => {
      const commands = Mention.config.addCommands?.call(Mention);
      expect(commands).toHaveProperty('deleteMention');
      expect(typeof commands?.['deleteMention']).toBe('function');
    });

    it('insertMention inserts mention node', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello </p>',
      });

      const endPos = editor.state.doc.child(0).content.size + 1;
      editor.view.dispatch(
        editor.state.tr.setSelection(
          (editor.state.selection.constructor as any).near(editor.state.doc.resolve(endPos))
        )
      );

      const result = editor.commands.insertMention({ id: '42', label: 'Alice' });
      expect(result).toBe(true);

      const para = editor.state.doc.child(0);
      const lastChild = para.child(para.childCount - 1);
      expect(lastChild.type.name).toBe('mention');
      expect(lastChild.attrs['id']).toBe('42');
      expect(lastChild.attrs['label']).toBe('Alice');
    });

    it('insertMention sets type attribute', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p></p>',
      });

      editor.commands.insertMention({ id: '1', label: 'feature', type: 'tag' });

      const para = editor.state.doc.child(0);
      expect(para.child(0).attrs['type']).toBe('tag');
    });

    it('insertMention defaults type to mention', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p></p>',
      });

      editor.commands.insertMention({ id: '1', label: 'Alice' });

      const para = editor.state.doc.child(0);
      expect(para.child(0).attrs['type']).toBe('mention');
    });

    it('insertMention returns false for missing id', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>test</p>',
      });

      const result = editor.commands.insertMention({ id: '', label: 'Alice' });
      expect(result).toBe(false);
    });

    it('insertMention returns false for missing label', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>test</p>',
      });

      const result = editor.commands.insertMention({ id: '1', label: '' });
      expect(result).toBe(false);
    });

    it('deleteMention deletes mention at cursor (nodeBefore)', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hi <span data-type="mention" data-id="1" data-label="Alice" data-mention-type="mention">@Alice</span> end</p>',
      });

      // Place cursor right after mention
      // pos 1 = paragraph start, "Hi " = 3 chars, mention atom = nodeSize 1
      const posAfterMention = 1 + 3 + 1; // paragraph open + text + mention
      editor.view.dispatch(
        editor.state.tr.setSelection(
          (editor.state.selection.constructor as any).near(editor.state.doc.resolve(posAfterMention))
        )
      );

      const result = editor.commands.deleteMention();
      expect(result).toBe(true);

      // Mention should be gone
      const text = editor.state.doc.textContent;
      expect(text).not.toContain('Alice');
    });

    it('deleteMention by id finds and removes mention', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello <span data-type="mention" data-id="42" data-label="Alice" data-mention-type="mention">@Alice</span> world</p>',
      });

      const result = editor.commands.deleteMention('42');
      expect(result).toBe(true);

      const text = editor.state.doc.textContent;
      expect(text).not.toContain('Alice');
      expect(text).toContain('Hello');
      expect(text).toContain('world');
    });

    it('deleteMention by id returns false when not found', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello world</p>',
      });

      const result = editor.commands.deleteMention('nonexistent');
      expect(result).toBe(false);
    });

    it('deleteMention without id returns false when no mention at cursor', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello world</p>',
      });

      const result = editor.commands.deleteMention();
      expect(result).toBe(false);
    });

    it('can() check works for insertMention', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p></p>',
      });

      const canInsert = editor.can().insertMention({ id: '1', label: 'Alice' });
      expect(canInsert).toBe(true);
    });

    it('can() check works for deleteMention', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello world</p>',
      });

      // No mention at cursor
      const canDelete = editor.can().deleteMention();
      expect(canDelete).toBe(false);
    });

    it('insertMention can be chained', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p></p>',
      });

      const result = editor.chain()
        .insertMention({ id: '1', label: 'Alice' })
        .insertMention({ id: '2', label: 'Bob' })
        .run();

      expect(result).toBe(true);
    });
  });

  // ─── Keyboard Shortcuts ────────────────────────────────────────────────

  describe('keyboard shortcuts', () => {
    it('defines Backspace shortcut', () => {
      const shortcuts = Mention.config.addKeyboardShortcuts?.call(Mention);
      expect(shortcuts).toHaveProperty('Backspace');
    });
  });

  // ─── Storage ───────────────────────────────────────────────────────────

  describe('storage', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('findMentions returns mentions from document', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello <span data-type="mention" data-id="1" data-label="Alice" data-mention-type="user">@Alice</span> and <span data-type="mention" data-id="2" data-label="Bob" data-mention-type="user">@Bob</span></p>',
      });

      const mentions = getStorage(editor).findMentions();
      expect(mentions).toHaveLength(2);
      expect(mentions[0]!.id).toBe('1');
      expect(mentions[0]!.label).toBe('Alice');
      expect(mentions[0]!.type).toBe('user');
      expect(mentions[1]!.id).toBe('2');
      expect(mentions[1]!.label).toBe('Bob');
    });

    it('findMentions returns empty array for no mentions', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello world</p>',
      });

      const mentions = getStorage(editor).findMentions();
      expect(mentions).toEqual([]);
    });

    it('findMentions includes position', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p><span data-type="mention" data-id="1" data-label="Alice" data-mention-type="mention">@Alice</span></p>',
      });

      const mentions = getStorage(editor).findMentions();
      expect(mentions).toHaveLength(1);
      expect(mentions[0]!.pos).toBeGreaterThanOrEqual(0);
    });

    it('findMentions updates after insertMention', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello</p>',
      });

      expect(getStorage(editor).findMentions()).toHaveLength(0);

      editor.commands.insertMention({ id: '1', label: 'Alice' });
      expect(getStorage(editor).findMentions()).toHaveLength(1);
    });
  });

  // ─── Multi-trigger ─────────────────────────────────────────────────────

  describe('multi-trigger', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('creates separate plugins for each trigger', () => {
      const Custom = Mention.configure({
        triggers: [
          { char: '@', name: 'user', items: () => [], render: () => ({ onStart: () => undefined, onUpdate: () => undefined, onExit: () => undefined, onKeyDown: () => false }) },
          { char: '#', name: 'tag', items: () => [], render: () => ({ onStart: () => undefined, onUpdate: () => undefined, onExit: () => undefined, onKeyDown: () => false }) },
        ],
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p>test</p>',
      });

      const pluginKeys = editor.state.plugins.map((p) => (p as any).key as string);
      const userPlugin = pluginKeys.some((k) => k.includes('mentionSuggestion_user'));
      const tagPlugin = pluginKeys.some((k) => k.includes('mentionSuggestion_tag'));
      expect(userPlugin).toBe(true);
      expect(tagPlugin).toBe(true);
    });

    it('single suggestion creates one plugin', () => {
      const Custom = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: () => [],
          render: () => ({ onStart: () => undefined, onUpdate: () => undefined, onExit: () => undefined, onKeyDown: () => false }),
        },
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p>test</p>',
      });

      const pluginKeys = editor.state.plugins.map((p) => (p as any).key as string);
      const userPlugin = pluginKeys.some((k) => k.includes('mentionSuggestion_user'));
      expect(userPlugin).toBe(true);
    });

    it('triggers take precedence over suggestion', () => {
      const Custom = Mention.configure({
        suggestion: { char: '@', name: 'ignored', items: () => [] },
        triggers: [
          { char: '#', name: 'tag', items: () => [], render: () => ({ onStart: () => undefined, onUpdate: () => undefined, onExit: () => undefined, onKeyDown: () => false }) },
        ],
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p>test</p>',
      });

      const pluginKeys = editor.state.plugins.map((p) => (p as any).key as string);
      const tagPlugin = pluginKeys.some((k) => k.includes('mentionSuggestion_tag'));
      const ignoredPlugin = pluginKeys.some((k) => k.includes('mentionSuggestion_ignored'));
      expect(tagPlugin).toBe(true);
      expect(ignoredPlugin).toBe(false);
    });

    it('no suggestion or triggers means no plugins', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>test</p>',
      });

      const pluginKeys = editor.state.plugins.map((p) => (p as any).key as string);
      const hasMentionPlugin = pluginKeys.some((k) => k.includes('mentionSuggestion'));
      expect(hasMentionPlugin).toBe(false);
    });
  });

  // ─── Custom Rendering ──────────────────────────────────────────────────

  describe('custom rendering', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('custom renderHTML produces custom element', () => {
      const Custom = Mention.configure({
        renderHTML: ({ node, HTMLAttributes }) => [
          'a',
          { ...HTMLAttributes, href: `/profile/${String(node.attrs['id'])}`, class: 'mention-link' },
          `@${String(node.attrs['label'])}`,
        ],
      });

      const spec = Custom.createNodeSpec();
      const mockNode = { attrs: { id: '42', label: 'Alice', type: 'user' } } as any;
      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, string];
      expect(result[0]).toBe('a');
      expect(result[1]['href']).toBe('/profile/42');
      expect(result[1]['class']).toBe('mention-link');
      expect(result[2]).toBe('@Alice');
    });

    it('custom renderText changes leafText', () => {
      const Custom = Mention.configure({
        renderText: ({ node }) => `[${String(node.attrs['label'])}]`,
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p><span data-type="mention" data-id="1" data-label="Alice" data-mention-type="mention">@Alice</span></p>',
      });

      const text = editor.state.doc.textContent;
      expect(text).toBe('[Alice]');
    });
  });

  // ─── Suggestion Plugin ─────────────────────────────────────────────────

  describe('suggestion plugin', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('does not add plugin when no suggestion or triggers', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>test</p>',
      });

      const pluginKeys = editor.state.plugins.map((p) => (p as any).key as string);
      const hasSuggestion = pluginKeys.some((k) => k.includes('mentionSuggestion'));
      expect(hasSuggestion).toBe(false);
    });

    it('adds plugin when suggestion is configured', () => {
      const Custom = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: () => [],
          render: () => ({
            onStart: () => undefined,
            onUpdate: () => undefined,
            onExit: () => undefined,
            onKeyDown: () => false,
          }),
        },
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p>test</p>',
      });

      const pluginKeys = editor.state.plugins.map((p) => (p as any).key as string);
      const hasSuggestion = pluginKeys.some((k) => k.includes('mentionSuggestion'));
      expect(hasSuggestion).toBe(true);
    });
  });

  // ─── Edge Cases ────────────────────────────────────────────────────────

  describe('edge cases', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('handles mention at document start', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p><span data-type="mention" data-id="1" data-label="Alice" data-mention-type="mention">@Alice</span> hello</p>',
      });

      const para = editor.state.doc.child(0);
      expect(para.child(0).type.name).toBe('mention');
      expect(para.child(0).attrs['label']).toBe('Alice');
    });

    it('handles adjacent mentions', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p><span data-type="mention" data-id="1" data-label="Alice" data-mention-type="mention">@Alice</span><span data-type="mention" data-id="2" data-label="Bob" data-mention-type="mention">@Bob</span></p>',
      });

      const para = editor.state.doc.child(0);
      expect(para.childCount).toBe(2);
      expect(para.child(0).attrs['label']).toBe('Alice');
      expect(para.child(1).attrs['label']).toBe('Bob');
    });

    it('mention survives in different block types', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Para with <span data-type="mention" data-id="1" data-label="Alice" data-mention-type="mention">@Alice</span></p>',
      });

      const mentions = getStorage(editor).findMentions();
      expect(mentions).toHaveLength(1);
    });

    it('handles mention with empty label', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p><span data-type="mention" data-id="1" data-label="" data-mention-type="mention">@</span></p>',
      });

      const para = editor.state.doc.child(0);
      expect(para.child(0).type.name).toBe('mention');
      expect(para.child(0).attrs['label']).toBe('');
    });

    it('insertMention multiple times works', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p></p>',
      });

      editor.commands.insertMention({ id: '1', label: 'Alice' });
      editor.commands.insertMention({ id: '2', label: 'Bob' });
      editor.commands.insertMention({ id: '3', label: 'Charlie' });

      const mentions = getStorage(editor).findMentions();
      expect(mentions).toHaveLength(3);
    });

    it('deleteMention by id only deletes first match', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p><span data-type="mention" data-id="1" data-label="Alice" data-mention-type="mention">@Alice</span> and <span data-type="mention" data-id="1" data-label="Alice" data-mention-type="mention">@Alice</span></p>',
      });

      editor.commands.deleteMention('1');

      // Only one should be deleted
      const mentions = getStorage(editor).findMentions();
      expect(mentions).toHaveLength(1);
    });
  });

  // ─── Exports ───────────────────────────────────────────────────────────

  describe('index exports', () => {
    it('exports all public API', async () => {
      const mod = await import('./index.js');
      expect(mod.Mention).toBeDefined();
      expect(mod.createMentionSuggestionPlugin).toBeDefined();
      expect(mod.dismissMentionSuggestion).toBeDefined();
      expect(mod.default).toBe(mod.Mention);
    });
  });

  // ─── Suggestion Plugin Exports ─────────────────────────────────────────

  describe('mentionSuggestionPlugin exports', () => {
    it('exports createMentionSuggestionPlugin', async () => {
      const mod = await import('./mentionSuggestionPlugin.js');
      expect(mod.createMentionSuggestionPlugin).toBeDefined();
      expect(typeof mod.createMentionSuggestionPlugin).toBe('function');
    });

    it('exports dismissMentionSuggestion', async () => {
      const mod = await import('./mentionSuggestionPlugin.js');
      expect(mod.dismissMentionSuggestion).toBeDefined();
      expect(typeof mod.dismissMentionSuggestion).toBe('function');
    });
  });

  // ─── Suggestion Plugin Behavior ─────────────────────────────────────────

  describe('suggestion plugin behavior', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('activates suggestion when trigger char is typed', () => {
      let startCalled = false;
      const Custom = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: () => [{ id: '1', label: 'Alice' }],
          render: () => ({
            onStart: () => { startCalled = true; },
            onUpdate: () => undefined,
            onExit: () => undefined,
            onKeyDown: () => false,
          }),
        },
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p></p>',
      });

      // Type '@'
      editor.view.dispatch(
        editor.state.tr.insertText('@')
      );

      expect(startCalled).toBe(true);
    });

    it('updates suggestion with query text', () => {
      let lastQuery = '';
      const Custom = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: ({ query }) => {
            lastQuery = query;
            return [{ id: '1', label: 'Alice' }];
          },
          render: () => ({
            onStart: () => undefined,
            onUpdate: () => undefined,
            onExit: () => undefined,
            onKeyDown: () => false,
          }),
        },
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p></p>',
      });

      // Type '@ali'
      editor.view.dispatch(editor.state.tr.insertText('@ali'));

      expect(lastQuery).toBe('ali');
    });

    it('deactivates suggestion when trigger is removed', () => {
      let exitCalled = false;
      const Custom = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: () => [{ id: '1', label: 'Alice' }],
          render: () => ({
            onStart: () => undefined,
            onUpdate: () => undefined,
            onExit: () => { exitCalled = true; },
            onKeyDown: () => false,
          }),
        },
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p></p>',
      });

      // Type '@a' to activate
      editor.view.dispatch(editor.state.tr.insertText('@a'));

      // Delete back to remove the trigger
      const { tr } = editor.state;
      tr.delete(1, editor.state.doc.child(0).content.size + 1);
      editor.view.dispatch(tr);

      expect(exitCalled).toBe(true);
    });

    it('does not activate for trigger preceded by non-space', () => {
      let startCalled = false;
      const Custom = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: () => [{ id: '1', label: 'Alice' }],
          render: () => ({
            onStart: () => { startCalled = true; },
            onUpdate: () => undefined,
            onExit: () => undefined,
            onKeyDown: () => false,
          }),
        },
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p></p>',
      });

      // Type 'abc@' — trigger not preceded by space
      editor.view.dispatch(editor.state.tr.insertText('abc@'));

      expect(startCalled).toBe(false);
    });

    it('activates when trigger follows a space', () => {
      let startCalled = false;
      const Custom = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: () => [{ id: '1', label: 'Alice' }],
          render: () => ({
            onStart: () => { startCalled = true; },
            onUpdate: () => undefined,
            onExit: () => undefined,
            onKeyDown: () => false,
          }),
        },
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p></p>',
      });

      // Type 'hello @'
      editor.view.dispatch(editor.state.tr.insertText('hello @'));

      expect(startCalled).toBe(true);
    });

    it('does not activate for query with special characters', () => {
      let startCalled = false;
      const Custom = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: () => [{ id: '1', label: 'Alice' }],
          render: () => ({
            onStart: () => { startCalled = true; },
            onUpdate: () => undefined,
            onExit: () => undefined,
            onKeyDown: () => false,
          }),
        },
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p></p>',
      });

      // Type '@a!b' — '!' is not in valid chars
      editor.view.dispatch(editor.state.tr.insertText('@a!b'));

      expect(startCalled).toBe(false);
    });

    it('handles custom trigger character', () => {
      let startCalled = false;
      const Custom = Mention.configure({
        suggestion: {
          char: '#',
          name: 'tag',
          items: () => [{ id: '1', label: 'feature' }],
          render: () => ({
            onStart: () => { startCalled = true; },
            onUpdate: () => undefined,
            onExit: () => undefined,
            onKeyDown: () => false,
          }),
        },
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p></p>',
      });

      // Type '#'
      editor.view.dispatch(editor.state.tr.insertText('#'));

      expect(startCalled).toBe(true);
    });

    it('respects minQueryLength', () => {
      let startCalled = false;
      const Custom = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          minQueryLength: 2,
          items: () => [{ id: '1', label: 'Alice' }],
          render: () => ({
            onStart: () => { startCalled = true; },
            onUpdate: () => undefined,
            onExit: () => undefined,
            onKeyDown: () => false,
          }),
        },
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p></p>',
      });

      // Type '@a' — only 1 char query, minQueryLength is 2
      editor.view.dispatch(editor.state.tr.insertText('@a'));
      expect(startCalled).toBe(false);

      // Type one more char to reach minQueryLength
      editor.view.dispatch(editor.state.tr.insertText('l'));
      expect(startCalled).toBe(true);
    });

    it('command inserts mention and replaces trigger text', () => {
      let commandFn: ((item: { id: string; label: string }) => void) | null = null;
      const Custom = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: () => [{ id: '1', label: 'Alice' }],
          render: () => ({
            onStart: (props) => { commandFn = props.command; },
            onUpdate: (props) => { commandFn = props.command; },
            onExit: () => undefined,
            onKeyDown: () => false,
          }),
        },
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p></p>',
      });

      // Type '@ali'
      editor.view.dispatch(editor.state.tr.insertText('@ali'));

      // Select an item via the command
      expect(commandFn).not.toBeNull();
      commandFn!({ id: '1', label: 'Alice' });

      // Document should now have a mention node
      const para = editor.state.doc.child(0);
      let hasMention = false;
      para.forEach((node) => {
        if (node.type.name === 'mention') {
          hasMention = true;
          expect(node.attrs['id']).toBe('1');
          expect(node.attrs['label']).toBe('Alice');
        }
      });
      expect(hasMention).toBe(true);
    });

    it('command appends space after mention by default', () => {
      let commandFn: ((item: { id: string; label: string }) => void) | null = null;
      const Custom = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: () => [{ id: '1', label: 'Alice' }],
          render: () => ({
            onStart: (props) => { commandFn = props.command; },
            onUpdate: (props) => { commandFn = props.command; },
            onExit: () => undefined,
            onKeyDown: () => false,
          }),
        },
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p></p>',
      });

      editor.view.dispatch(editor.state.tr.insertText('@ali'));
      commandFn!({ id: '1', label: 'Alice' });

      // Text content should end with a space after the mention
      const textContent = editor.state.doc.textContent;
      expect(textContent).toContain('@Alice ');
    });

    it('command respects custom appendText', () => {
      let commandFn: ((item: { id: string; label: string }) => void) | null = null;
      const Custom = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          appendText: '',
          items: () => [{ id: '1', label: 'Alice' }],
          render: () => ({
            onStart: (props) => { commandFn = props.command; },
            onUpdate: (props) => { commandFn = props.command; },
            onExit: () => undefined,
            onKeyDown: () => false,
          }),
        },
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p></p>',
      });

      editor.view.dispatch(editor.state.tr.insertText('@ali'));
      commandFn!({ id: '1', label: 'Alice' });

      // With empty appendText, no trailing space
      const textContent = editor.state.doc.textContent;
      expect(textContent).toBe('@Alice');
    });

    it('provides clientRect callback in props', () => {
      let clientRectFn: (() => DOMRect | null) | null = null;
      const Custom = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: () => [{ id: '1', label: 'Alice' }],
          render: () => ({
            onStart: (props) => { clientRectFn = props.clientRect; },
            onUpdate: () => undefined,
            onExit: () => undefined,
            onKeyDown: () => false,
          }),
        },
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p></p>',
      });

      editor.view.dispatch(editor.state.tr.insertText('@'));

      expect(clientRectFn).not.toBeNull();
      // In jsdom, coordsAtPos is not available, so it should return null
      const rect = clientRectFn!();
      expect(rect === null || rect instanceof DOMRect).toBe(true);
    });

    it('dismisses via Escape key', () => {
      let exitCalled = false;
      const Custom = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: () => [{ id: '1', label: 'Alice' }],
          render: () => ({
            onStart: () => undefined,
            onUpdate: () => undefined,
            onExit: () => { exitCalled = true; },
            onKeyDown: () => false,
          }),
        },
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p></p>',
      });

      // Activate suggestion
      editor.view.dispatch(editor.state.tr.insertText('@'));

      // Dispatch Escape — set dismiss meta
      const pluginKeys = editor.state.plugins.map((p) => p);
      const mentionPlugin = pluginKeys.find((p) => (p as any).key.includes('mentionSuggestion'));
      if (mentionPlugin) {
        const { tr } = editor.state;
        tr.setMeta(mentionPlugin, 'dismiss');
        editor.view.dispatch(tr);
      }

      expect(exitCalled).toBe(true);
    });

    it('multiple triggers create independent plugins', () => {
      const startCalls: string[] = [];
      const Custom = Mention.configure({
        triggers: [
          {
            char: '@',
            name: 'user',
            items: () => [{ id: '1', label: 'Alice' }],
            render: () => ({
              onStart: () => { startCalls.push('user'); },
              onUpdate: () => undefined,
              onExit: () => undefined,
              onKeyDown: () => false,
            }),
          },
          {
            char: '#',
            name: 'tag',
            items: () => [{ id: '1', label: 'feature' }],
            render: () => ({
              onStart: () => { startCalls.push('tag'); },
              onUpdate: () => undefined,
              onExit: () => undefined,
              onKeyDown: () => false,
            }),
          },
        ],
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p></p>',
      });

      // Type '@' — should trigger 'user' plugin
      editor.view.dispatch(editor.state.tr.insertText('@'));
      expect(startCalls).toContain('user');
    });

    it('sets correct type on mention from trigger name', () => {
      let commandFn: ((item: { id: string; label: string }) => void) | null = null;
      const Custom = Mention.configure({
        suggestion: {
          char: '#',
          name: 'tag',
          items: () => [{ id: '1', label: 'feature' }],
          render: () => ({
            onStart: (props) => { commandFn = props.command; },
            onUpdate: (props) => { commandFn = props.command; },
            onExit: () => undefined,
            onKeyDown: () => false,
          }),
        },
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p></p>',
      });

      editor.view.dispatch(editor.state.tr.insertText('#feat'));
      commandFn!({ id: '1', label: 'feature' });

      const para = editor.state.doc.child(0);
      let mentionType = '';
      para.forEach((node) => {
        if (node.type.name === 'mention') {
          mentionType = node.attrs['type'] as string;
        }
      });
      expect(mentionType).toBe('tag');
    });
  });

  // ─── Trigger Char Map ─────────────────────────────────────────────────────

  describe('trigger char map', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('builds trigger char map from single suggestion', () => {
      const Custom = Mention.configure({
        suggestion: { char: '@', name: 'user', items: () => [] },
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p></p>',
      });

      const storage = getStorage(editor);
      expect(storage._triggerCharMap.get('user')).toBe('@');
    });

    it('builds trigger char map from multiple triggers', () => {
      const Custom = Mention.configure({
        triggers: [
          { char: '@', name: 'user', items: () => [] },
          { char: '#', name: 'tag', items: () => [] },
          { char: '/', name: 'command', items: () => [] },
        ],
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p></p>',
      });

      const storage = getStorage(editor);
      expect(storage._triggerCharMap.get('user')).toBe('@');
      expect(storage._triggerCharMap.get('tag')).toBe('#');
      expect(storage._triggerCharMap.get('command')).toBe('/');
    });

    it('empty map when no triggers configured', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p></p>',
      });

      const storage = getStorage(editor);
      expect(storage._triggerCharMap.size).toBe(0);
    });

    it('leafText resolves correct char per trigger type', () => {
      const Custom = Mention.configure({
        triggers: [
          { char: '@', name: 'user', items: () => [] },
          { char: '#', name: 'tag', items: () => [] },
        ],
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: `<p><span data-type="mention" data-id="1" data-label="Alice" data-mention-type="user">@Alice</span> and <span data-type="mention" data-id="2" data-label="feature" data-mention-type="tag">#feature</span></p>`,
      });

      const text = editor.state.doc.textContent;
      expect(text).toContain('@Alice');
      expect(text).toContain('#feature');
    });
  });

  // ─── Backspace Behavior ─────────────────────────────────────────────────

  describe('backspace behavior', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('Backspace no-op when cursor not near mention', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello world</p>',
      });

      // Simulate Backspace via keyboard shortcuts
      const context = Object.create(Mention, {
        editor: { value: editor },
        options: { value: Mention.options },
        storage: { value: getStorage(editor) },
      });
      const shortcuts = Mention.config.addKeyboardShortcuts?.call(context);

      if (shortcuts?.['Backspace']) {
        const result = (shortcuts['Backspace'] as () => boolean)();
        expect(result).toBe(false);
      }
    });

    it('Backspace returns false for non-empty selection', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello <span data-type="mention" data-id="1" data-label="Alice" data-mention-type="mention">@Alice</span> world</p>',
      });

      // Create non-empty selection
      const { tr } = editor.state;
      tr.setSelection(TextSelection.create(editor.state.doc, 1, 4));
      editor.view.dispatch(tr);

      const context = Object.create(Mention, {
        editor: { value: editor },
        options: { value: Mention.options },
        storage: { value: getStorage(editor) },
      });
      const shortcuts = Mention.config.addKeyboardShortcuts?.call(context);

      if (shortcuts?.['Backspace']) {
        const result = (shortcuts['Backspace'] as () => boolean)();
        expect(result).toBe(false);
      }
    });
  });

  // ─── Command Edge Cases ─────────────────────────────────────────────────

  describe('command edge cases', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('deleteMention returns false for non-empty selection', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello <span data-type="mention" data-id="1" data-label="Alice" data-mention-type="mention">@Alice</span> world</p>',
      });

      // Create non-empty selection
      const { tr } = editor.state;
      tr.setSelection(TextSelection.create(editor.state.doc, 1, 4));
      editor.view.dispatch(tr);

      const result = editor.commands.deleteMention();
      expect(result).toBe(false);
    });

    it('deleteMention without id returns false when nodeBefore is text', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello world</p>',
      });

      // Place cursor after "Hello"
      const { tr } = editor.state;
      tr.setSelection(TextSelection.create(editor.state.doc, 6));
      editor.view.dispatch(tr);

      const result = editor.commands.deleteMention();
      expect(result).toBe(false);
    });

    it('insertMention replaces selected text', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p>Hello world</p>',
      });

      // Select "world"
      const { tr } = editor.state;
      tr.setSelection(TextSelection.create(editor.state.doc, 7, 12));
      editor.view.dispatch(tr);

      const result = editor.commands.insertMention({ id: '1', label: 'Alice' });
      expect(result).toBe(true);

      const text = editor.state.doc.textContent;
      expect(text).toContain('Hello');
      expect(text).toContain('@Alice');
      expect(text).not.toContain('world');
    });

    it('deleteMention by id works with multiple different mentions', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p><span data-type="mention" data-id="1" data-label="Alice" data-mention-type="mention">@Alice</span> <span data-type="mention" data-id="2" data-label="Bob" data-mention-type="mention">@Bob</span> <span data-type="mention" data-id="3" data-label="Charlie" data-mention-type="mention">@Charlie</span></p>',
      });

      // Delete Bob (id=2)
      editor.commands.deleteMention('2');

      const mentions = getStorage(editor).findMentions();
      expect(mentions).toHaveLength(2);
      expect(mentions.map(m => m.label)).toContain('Alice');
      expect(mentions.map(m => m.label)).not.toContain('Bob');
      expect(mentions.map(m => m.label)).toContain('Charlie');
    });

    it('chain deleteMention by id with other commands', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p><span data-type="mention" data-id="1" data-label="Alice" data-mention-type="mention">@Alice</span></p>',
      });

      const result = editor.chain()
        .deleteMention('1')
        .run();

      expect(result).toBe(true);
      expect(getStorage(editor).findMentions()).toHaveLength(0);
    });

    it('can() for deleteMention with id returns true when mention exists', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p><span data-type="mention" data-id="42" data-label="Alice" data-mention-type="mention">@Alice</span></p>',
      });

      const canDelete = editor.can().deleteMention('42');
      expect(canDelete).toBe(true);
    });

    it('can() for deleteMention with nonexistent id returns false', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p><span data-type="mention" data-id="42" data-label="Alice" data-mention-type="mention">@Alice</span></p>',
      });

      const canDelete = editor.can().deleteMention('999');
      expect(canDelete).toBe(false);
    });
  });

  // ─── renderHTML Integration ─────────────────────────────────────────────

  describe('renderHTML integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('custom renderHTML as link element renders in editor', () => {
      const Custom = Mention.configure({
        renderHTML: ({ node, HTMLAttributes }) => [
          'a',
          {
            ...HTMLAttributes,
            href: `/user/${String(node.attrs['id'])}`,
            'data-type': 'mention',
          },
          `@${String(node.attrs['label'])}`,
        ],
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p></p>',
      });

      // Insert a mention programmatically
      editor.commands.insertMention({ id: '1', label: 'Alice', type: 'user' });

      const html = editor.getHTML();
      expect(html).toContain('<a');
      expect(html).toContain('href="/user/1"');
    });

    it('renderHTML receives merged HTMLAttributes', () => {
      let receivedAttrs: Record<string, unknown> = {};
      const Custom = Mention.configure({
        HTMLAttributes: { 'data-custom': 'yes' },
        renderHTML: ({ HTMLAttributes }) => {
          receivedAttrs = HTMLAttributes;
          return ['span', HTMLAttributes, 'test'];
        },
      });

      const spec = Custom.createNodeSpec();
      const mockNode = { attrs: { id: '1', label: 'Alice', type: 'mention' } } as any;
      spec.toDOM?.(mockNode);

      expect(receivedAttrs['data-id']).toBe('1');
      expect(receivedAttrs['data-label']).toBe('Alice');
    });

    it('default renderHTML includes all HTML attributes', () => {
      const Custom = Mention.configure({
        HTMLAttributes: { 'data-extra': 'value', role: 'button' },
      });

      const spec = Custom.createNodeSpec();
      const mockNode = { attrs: { id: '1', label: 'Alice', type: 'mention' } } as any;
      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, string];
      expect(result[1]['data-extra']).toBe('value');
      expect(result[1]['role']).toBe('button');
    });
  });

  // ─── Schema Properties ──────────────────────────────────────────────────

  describe('schema properties', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('mention nodeType has correct properties', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p></p>',
      });

      const mentionType = editor.state.schema.nodes['mention'];
      expect(mentionType).toBeDefined();
      expect(mentionType!.isInline).toBe(true);
      expect(mentionType!.isAtom).toBe(true);
    });

    it('mention node has correct attribute defaults', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p></p>',
      });

      const mentionType = editor.state.schema.nodes['mention']!;
      // Create node with minimal attrs
      const node = mentionType.create({ id: 'test', label: 'Test' });
      expect(node.attrs['type']).toBe('mention');
    });

    it('mention appears in inline group', () => {
      editor = new Editor({
        extensions: allExtensions,
        content: '<p></p>',
      });

      // Paragraph allows inline content — mention should be valid
      const mentionType = editor.state.schema.nodes['mention']!;
      const node = mentionType.create({ id: '1', label: 'Test' });
      expect(node.type.isInline).toBe(true);
    });

    it('creates nodeSpec with leafText', () => {
      const spec = Mention.createNodeSpec();
      expect(spec.leafText).toBeDefined();
      expect(typeof spec.leafText).toBe('function');
    });
  });

  // ─── Async Items ──────────────────────────────────────────────────────────

  describe('async items', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('handles async items function', () => {
      let itemsFnCalled = false;

      const Custom = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: () => {
            itemsFnCalled = true;
            return Promise.resolve([{ id: '1', label: 'Alice' }]);
          },
          render: () => ({
            onStart: () => undefined,
            onUpdate: () => undefined,
            onExit: () => undefined,
            onKeyDown: () => false,
          }),
        },
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p></p>',
      });

      editor.view.dispatch(editor.state.tr.insertText('@ali'));

      // Items function should have been called
      expect(itemsFnCalled).toBe(true);
    });
  });

  // ─── Decoration ─────────────────────────────────────────────────────────

  describe('decorations', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('applies decoration when suggestion is active', () => {
      const Custom = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: () => [{ id: '1', label: 'Alice' }],
          render: () => ({
            onStart: () => undefined,
            onUpdate: () => undefined,
            onExit: () => undefined,
            onKeyDown: () => false,
          }),
        },
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p></p>',
      });

      editor.view.dispatch(editor.state.tr.insertText('@ali'));

      // Check that the mention-suggestion plugin is active
      const plugins = editor.state.plugins;
      const mentionPlugin = plugins.find((p) => (p as any).key.includes('mentionSuggestion'));
      expect(mentionPlugin).toBeDefined();

      if (mentionPlugin) {
        const pluginState = (mentionPlugin as any).getState(editor.state);
        expect(pluginState?.active).toBe(true);
        expect(pluginState?.query).toBe('ali');
      }
    });

    it('no decoration when suggestion is inactive', () => {
      const Custom = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: () => [{ id: '1', label: 'Alice' }],
          render: () => ({
            onStart: () => undefined,
            onUpdate: () => undefined,
            onExit: () => undefined,
            onKeyDown: () => false,
          }),
        },
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Custom],
        content: '<p>hello world</p>',
      });

      const plugins = editor.state.plugins;
      const mentionPlugin = plugins.find((p) => (p as any).key.includes('mentionSuggestion'));
      expect(mentionPlugin).toBeDefined();

      if (mentionPlugin) {
        const pluginState = (mentionPlugin as any).getState(editor.state);
        expect(pluginState?.active).toBe(false);
      }
    });
  });
});
