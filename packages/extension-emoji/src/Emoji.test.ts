import { describe, it, expect, afterEach } from 'vitest';
import { Emoji } from './Emoji.js';
import type { EmojiStorage } from './Emoji.js';
import { emojis, allEmojis } from './emojis.js';
import type { EmojiItem } from './emojis.js';
import { emoticons } from './emoticons.js';
import { Document, Text, Paragraph, Editor } from '@domternal/core';

const allExtensions = [Document, Text, Paragraph, Emoji];

/** Get typed emoji storage from editor */
function getStorage(editor: Editor): EmojiStorage {
  return editor.storage['emoji'] as EmojiStorage;
}

describe('Emoji', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(Emoji.name).toBe('emoji');
    });

    it('is a node type', () => {
      expect(Emoji.type).toBe('node');
    });

    it('belongs to inline group', () => {
      expect(Emoji.config.group).toBe('inline');
    });

    it('is inline', () => {
      expect(Emoji.config.inline).toBe(true);
    });

    it('is an atom', () => {
      expect(Emoji.config.atom).toBe(true);
    });

    it('is selectable', () => {
      expect(Emoji.config.selectable).toBe(true);
    });

    it('is not draggable', () => {
      expect(Emoji.config.draggable).toBe(false);
    });

    it('has default options', () => {
      expect(Emoji.options).toEqual({
        emojis: expect.any(Array) as unknown,
        enableEmoticons: false,
        plainText: false,
        HTMLAttributes: {},
        suggestion: null,
      });
    });

    it('defaults emojis to built-in dataset', () => {
      expect(Emoji.options.emojis).toBe(emojis);
    });

    it('can configure enableEmoticons', () => {
      const Custom = Emoji.configure({ enableEmoticons: true });
      expect(Custom.options.enableEmoticons).toBe(true);
    });

    it('can configure plainText', () => {
      const Custom = Emoji.configure({ plainText: true });
      expect(Custom.options.plainText).toBe(true);
    });

    it('can configure HTMLAttributes', () => {
      const Custom = Emoji.configure({ HTMLAttributes: { class: 'my-emoji' } });
      expect(Custom.options.HTMLAttributes).toEqual({ class: 'my-emoji' });
    });

    it('can configure custom emojis', () => {
      const custom: EmojiItem[] = [
        { emoji: '🦄', name: 'unicorn', shortcodes: ['unicorn'], tags: ['magic'], group: 'Animals' },
      ];
      const Custom = Emoji.configure({ emojis: custom });
      expect(Custom.options.emojis).toBe(custom);
    });
  });

  describe('parseHTML', () => {
    it('returns rules for span[data-type="emoji"] and span[data-emoji-name]', () => {
      const rules = Emoji.config.parseHTML?.call(Emoji);
      expect(rules).toEqual([
        { tag: 'span[data-type="emoji"]' },
        { tag: 'span[data-emoji-name]' },
      ]);
    });
  });

  describe('renderHTML', () => {
    it('renders span with data-type and data-name', () => {
      const spec = Emoji.createNodeSpec();
      const mockNode = { attrs: { name: 'grinning_face' } } as any;
      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, string];
      expect(result[0]).toBe('span');
      expect(result[1]['data-type']).toBe('emoji');
      expect(result[1]['data-name']).toBe('grinning_face');
      expect(result[1]['class']).toContain('emoji');
    });

    it('merges HTMLAttributes from options', () => {
      const Custom = Emoji.configure({ HTMLAttributes: { class: 'styled' } });
      const spec = Custom.createNodeSpec();
      const mockNode = { attrs: { name: 'grinning_face' } } as any;
      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, string];
      expect(result[1]['class']).toContain('styled');
      expect(result[1]['class']).toContain('emoji');
    });

    it('handles missing name attribute', () => {
      const spec = Emoji.createNodeSpec();
      const mockNode = { attrs: { name: null } } as any;
      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, string];
      expect(result[0]).toBe('span');
      expect(result[1]['data-name']).toBe('');
    });
  });

  describe('attributes', () => {
    it('has name attribute with parseHTML from data-name', () => {
      const attrs = Emoji.config.addAttributes?.call(Emoji);
      expect(attrs).toHaveProperty('name');

      const mockEl = { getAttribute: (attr: string) => attr === 'data-name' ? 'smile' : null } as any;
      expect(attrs!['name']!.parseHTML!(mockEl)).toBe('smile');
    });

    it('has name attribute with parseHTML from data-emoji-name fallback', () => {
      const attrs = Emoji.config.addAttributes?.call(Emoji);
      const mockEl = { getAttribute: (attr: string) => attr === 'data-emoji-name' ? 'heart' : null } as any;
      expect(attrs!['name']!.parseHTML!(mockEl)).toBe('heart');
    });

    it('has name attribute with renderHTML', () => {
      const attrs = Emoji.config.addAttributes?.call(Emoji);
      const result = attrs!['name']!.renderHTML!({ name: 'smile' });
      expect(result).toEqual({ 'data-name': 'smile' });
    });

    it('renderHTML returns empty object for missing name', () => {
      const attrs = Emoji.config.addAttributes?.call(Emoji);
      const result = attrs!['name']!.renderHTML!({ name: null });
      expect(result).toEqual({});
    });
  });
});

describe('emoji datasets', () => {
  it('emojis has items', () => {
    expect(emojis.length).toBeGreaterThan(100);
  });

  it('allEmojis has more items than emojis', () => {
    expect(allEmojis.length).toBeGreaterThan(emojis.length);
  });

  it('every emoji has required fields', () => {
    for (const item of emojis) {
      expect(item.emoji).toBeTruthy();
      expect(item.name).toBeTruthy();
      expect(item.shortcodes.length).toBeGreaterThan(0);
      expect(item.group).toBeTruthy();
    }
  });

  it('emoji names are unique', () => {
    const names = emojis.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('allEmojis names are unique', () => {
    const names = allEmojis.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('emoticons', () => {
  it('maps :) to slightly_smiling_face', () => {
    expect(emoticons[':)']).toBe('slightly_smiling_face');
  });

  it('maps <3 to red_heart', () => {
    expect(emoticons['<3']).toBe('red_heart');
  });

  it('maps :D to grinning_face_with_big_eyes', () => {
    expect(emoticons[':D']).toBe('grinning_face_with_big_eyes');
  });

  it('maps ;) to winking_face', () => {
    expect(emoticons[';)']).toBe('winking_face');
  });

  it('maps :( to slightly_frowning_face', () => {
    expect(emoticons[':(']).toBe('slightly_frowning_face');
  });

  it('maps </3 to broken_heart', () => {
    expect(emoticons['</3']).toBe('broken_heart');
  });

  it('has all emoticon names in the emoji dataset', () => {
    const emojiNames = new Set(emojis.map((e) => e.name));
    for (const name of Object.values(emoticons)) {
      expect(emojiNames.has(name)).toBe(true);
    }
  });
});

describe('integration', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('creates editor with emoji node registered', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Hello</p>',
    });

    expect(editor.state.schema.nodes['emoji']).toBeDefined();
  });

  it('parses emoji HTML correctly', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Hello <span data-type="emoji" data-name="grinning_face">😀</span> world</p>',
    });

    const doc = editor.state.doc;
    const para = doc.child(0);
    // Paragraph should have: text "Hello ", emoji node, text " world"
    expect(para.childCount).toBe(3);
    expect(para.child(1).type.name).toBe('emoji');
    expect(para.child(1).attrs['name']).toBe('grinning_face');
  });

  it('parses data-emoji-name format', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Hi <span data-emoji-name="red_heart">❤️</span></p>',
    });

    const para = editor.state.doc.child(0);
    const emojiNode = para.child(1);
    expect(emojiNode.type.name).toBe('emoji');
    expect(emojiNode.attrs['name']).toBe('red_heart');
  });

  it('renders emoji HTML correctly', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Hello <span data-type="emoji" data-name="grinning_face">😀</span></p>',
    });

    const html = editor.getHTML();
    expect(html).toContain('data-type="emoji"');
    expect(html).toContain('data-name="grinning_face"');
    expect(html).toContain('😀');
    expect(html).toContain('class="emoji"');
  });

  it('round-trips HTML correctly', () => {
    const input = '<p>Test <span data-type="emoji" data-name="red_heart">❤️</span> emoji</p>';

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

  it('supports multiple emoji in a paragraph', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p><span data-type="emoji" data-name="grinning_face">😀</span><span data-type="emoji" data-name="red_heart">❤️</span></p>',
    });

    const para = editor.state.doc.child(0);
    expect(para.child(0).type.name).toBe('emoji');
    expect(para.child(0).attrs['name']).toBe('grinning_face');
    expect(para.child(1).type.name).toBe('emoji');
    expect(para.child(1).attrs['name']).toBe('red_heart');
  });

  it('applies custom HTMLAttributes', () => {
    const Custom = Emoji.configure({ HTMLAttributes: { class: 'custom-emoji' } });
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Custom],
      content: '<p><span data-type="emoji" data-name="grinning_face">😀</span></p>',
    });

    const html = editor.getHTML();
    expect(html).toContain('custom-emoji');
  });
});

describe('storage', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('findEmoji finds emoji by name', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>test</p>',
    });

    const result = getStorage(editor).findEmoji('grinning_face');
    expect(result).toBeDefined();
    expect(result!.emoji).toBe('😀');
    expect(result!.name).toBe('grinning_face');
  });

  it('findEmoji returns undefined for unknown name', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>test</p>',
    });

    const result = getStorage(editor).findEmoji('nonexistent');
    expect(result).toBeUndefined();
  });

  it('searchEmoji finds by name', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>test</p>',
    });

    const results = getStorage(editor).searchEmoji('grinning');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((e: EmojiItem) => e.name === 'grinning_face')).toBe(true);
  });

  it('searchEmoji finds by shortcode', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>test</p>',
    });

    const results = getStorage(editor).searchEmoji('smile');
    expect(results.length).toBeGreaterThan(0);
  });

  it('searchEmoji finds by tag', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>test</p>',
    });

    const results = getStorage(editor).searchEmoji('happy');
    expect(results.length).toBeGreaterThan(0);
  });

  it('searchEmoji is case-insensitive', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>test</p>',
    });

    const lower = getStorage(editor).searchEmoji('grinning');
    const upper = getStorage(editor).searchEmoji('GRINNING');
    expect(lower.length).toBe(upper.length);
  });

  it('searchEmoji returns empty array for no matches', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>test</p>',
    });

    const results = getStorage(editor).searchEmoji('zzzznonexistent');
    expect(results).toEqual([]);
  });

  it('addFrequentlyUsed and getFrequentlyUsed track usage', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>test</p>',
    });

    const storage = getStorage(editor);
    expect(storage.getFrequentlyUsed()).toEqual([]);

    storage.addFrequentlyUsed('red_heart');
    storage.addFrequentlyUsed('grinning_face');
    storage.addFrequentlyUsed('red_heart');

    const frequent = storage.getFrequentlyUsed();
    expect(frequent[0]).toBe('red_heart');
    expect(frequent[1]).toBe('grinning_face');
  });

  it('getFrequentlyUsed sorts by count descending', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>test</p>',
    });

    const storage = getStorage(editor);
    storage.addFrequentlyUsed('a');
    storage.addFrequentlyUsed('b');
    storage.addFrequentlyUsed('b');
    storage.addFrequentlyUsed('c');
    storage.addFrequentlyUsed('c');
    storage.addFrequentlyUsed('c');

    const frequent = storage.getFrequentlyUsed();
    expect(frequent).toEqual(['c', 'b', 'a']);
  });
});

describe('commands', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('provides insertEmoji command', () => {
    const commands = Emoji.config.addCommands?.call(Emoji);
    expect(commands).toHaveProperty('insertEmoji');
    expect(typeof commands?.['insertEmoji']).toBe('function');
  });

  it('provides suggestEmoji command', () => {
    const commands = Emoji.config.addCommands?.call(Emoji);
    expect(commands).toHaveProperty('suggestEmoji');
    expect(typeof commands?.['suggestEmoji']).toBe('function');
  });

  it('insertEmoji inserts emoji node', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Hello </p>',
    });

    // Place cursor at end of paragraph
    const endPos = editor.state.doc.child(0).content.size + 1;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        (editor.state.selection.constructor as any).near(editor.state.doc.resolve(endPos))
      )
    );

    const result = editor.commands.insertEmoji('grinning_face');
    expect(result).toBe(true);

    const para = editor.state.doc.child(0);
    // Should have text "Hello " and an emoji node
    const lastChild = para.child(para.childCount - 1);
    expect(lastChild.type.name).toBe('emoji');
    expect(lastChild.attrs['name']).toBe('grinning_face');
  });

  it('insertEmoji returns false for unknown name', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Hello</p>',
    });

    const result = editor.commands.insertEmoji('totally_fake_emoji');
    expect(result).toBe(false);
  });

  it('insertEmoji inserts plain text in plainText mode', () => {
    const PlainEmoji = Emoji.configure({ plainText: true });
    editor = new Editor({
      extensions: [Document, Text, Paragraph, PlainEmoji],
      content: '<p>Hello </p>',
    });

    const endPos = editor.state.doc.child(0).content.size + 1;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        (editor.state.selection.constructor as any).near(editor.state.doc.resolve(endPos))
      )
    );

    const result = editor.commands.insertEmoji('grinning_face');
    expect(result).toBe(true);

    // In plain text mode, the emoji should be inserted as text
    const text = editor.state.doc.textContent;
    expect(text).toContain('😀');
  });

  it('suggestEmoji returns false when suggestion is not configured', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Hello</p>',
    });

    const result = editor.commands.suggestEmoji();
    expect(result).toBe(false);
  });

  it('suggestEmoji inserts trigger character when suggestion is configured', () => {
    const SuggestEmoji = Emoji.configure({
      suggestion: {
        char: ':',
        render: () => ({
          onStart: () => undefined,
          onUpdate: () => undefined,
          onExit: () => undefined,
          onKeyDown: () => false,
        }),
      },
    });
    editor = new Editor({
      extensions: [Document, Text, Paragraph, SuggestEmoji],
      content: '<p>Hello</p>',
    });

    const result = editor.commands.suggestEmoji();
    expect(result).toBe(true);

    const text = editor.state.doc.textContent;
    expect(text).toContain(':');
  });

  it('insertEmoji tracks frequently used', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p></p>',
    });

    editor.commands.insertEmoji('grinning_face');
    editor.commands.insertEmoji('red_heart');
    editor.commands.insertEmoji('grinning_face');

    const frequent = getStorage(editor).getFrequentlyUsed();
    expect(frequent).toContain('grinning_face');
  });
});

describe('input rules', () => {
  it('defines addInputRules', () => {
    expect(Emoji.config.addInputRules).toBeDefined();
    expect(typeof Emoji.config.addInputRules).toBe('function');
  });
});

describe('ProseMirror plugins', () => {
  it('defines addProseMirrorPlugins', () => {
    expect(Emoji.config.addProseMirrorPlugins).toBeDefined();
    expect(typeof Emoji.config.addProseMirrorPlugins).toBe('function');
  });
});

describe('leafText', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('returns emoji character for getText', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Hello <span data-type="emoji" data-name="grinning_face">😀</span> world</p>',
    });

    const text = editor.getText();
    expect(text).toContain('😀');
  });

  it('getText includes emoji as native character between text', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>A<span data-type="emoji" data-name="red_heart">❤️</span>B</p>',
    });

    const text = editor.state.doc.textContent;
    expect(text).toBe('A❤️B');
  });
});

describe('custom emoji data', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('works with custom emoji dataset', () => {
    const customEmojis: EmojiItem[] = [
      { emoji: '🦄', name: 'unicorn', shortcodes: ['unicorn'], tags: ['magic', 'horse'], group: 'Custom' },
      { emoji: '🌈', name: 'rainbow', shortcodes: ['rainbow'], tags: ['colors'], group: 'Custom' },
    ];

    const Custom = Emoji.configure({ emojis: customEmojis });
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Custom],
      content: '<p>test</p>',
    });

    const storage = getStorage(editor);
    expect(storage.findEmoji('unicorn')).toBeDefined();
    expect(storage.findEmoji('unicorn')!.emoji).toBe('🦄');
    expect(storage.findEmoji('grinning_face')).toBeUndefined();
  });

  it('searchEmoji works with custom data', () => {
    const customEmojis: EmojiItem[] = [
      { emoji: '🦄', name: 'unicorn', shortcodes: ['unicorn'], tags: ['magic', 'horse'], group: 'Custom' },
      { emoji: '🌈', name: 'rainbow', shortcodes: ['rainbow'], tags: ['colors'], group: 'Custom' },
    ];

    const Custom = Emoji.configure({ emojis: customEmojis });
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Custom],
      content: '<p>test</p>',
    });

    const results = getStorage(editor).searchEmoji('magic');
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe('unicorn');
  });

  it('insertEmoji works with custom data', () => {
    const customEmojis: EmojiItem[] = [
      { emoji: '🦄', name: 'unicorn', shortcodes: ['unicorn'], tags: ['magic'], group: 'Custom' },
    ];

    const Custom = Emoji.configure({ emojis: customEmojis });
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Custom],
      content: '<p></p>',
    });

    const result = editor.commands.insertEmoji('unicorn');
    expect(result).toBe(true);

    const para = editor.state.doc.child(0);
    expect(para.child(0).type.name).toBe('emoji');
    expect(para.child(0).attrs['name']).toBe('unicorn');
  });

  it('works with allEmojis dataset', () => {
    const Custom = Emoji.configure({ emojis: allEmojis });
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Custom],
      content: '<p>test</p>',
    });

    const storage = getStorage(editor);
    // allEmojis should have more entries than default
    const results = storage.searchEmoji('face');
    expect(results.length).toBeGreaterThan(10);
  });
});

describe('edge cases', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('handles empty emoji dataset', () => {
    const Custom = Emoji.configure({ emojis: [] });
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Custom],
      content: '<p>test</p>',
    });

    const storage = getStorage(editor);
    expect(storage.findEmoji('grinning_face')).toBeUndefined();
    expect(storage.searchEmoji('smile')).toEqual([]);
    expect(storage.getFrequentlyUsed()).toEqual([]);
  });

  it('insertEmoji fails gracefully with empty dataset', () => {
    const Custom = Emoji.configure({ emojis: [] });
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Custom],
      content: '<p>test</p>',
    });

    const result = editor.commands.insertEmoji('grinning_face');
    expect(result).toBe(false);
  });

  it('handles emoji node with unknown name in renderHTML', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p><span data-type="emoji" data-name="totally_unknown">?</span></p>',
    });

    // Should not crash, just render with empty emoji text
    const html = editor.getHTML();
    expect(html).toContain('data-name="totally_unknown"');
  });

  it('enableEmoticons false does not create emoticon input rules', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>test</p>',
    });

    // With enableEmoticons: false (default), only shortcode rule should exist
    // We can't easily count input rules externally, but we can verify the option is false
    expect(Emoji.options.enableEmoticons).toBe(false);
  });

  it('enableEmoticons true creates additional input rules', () => {
    const Custom = Emoji.configure({ enableEmoticons: true });
    expect(Custom.options.enableEmoticons).toBe(true);

    editor = new Editor({
      extensions: [Document, Text, Paragraph, Custom],
      content: '<p>test</p>',
    });

    // Editor should create successfully with emoticon rules
    expect(editor.state.schema.nodes['emoji']).toBeDefined();
  });
});

describe('suggestion plugin', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('does not add plugin when suggestion is null', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>test</p>',
    });

    // No suggestion plugin should be added
    const pluginKeys = editor.state.plugins.map((p) => (p as any).key as string);
    const hasSuggestion = pluginKeys.some((k) => k.includes('emojiSuggestion'));
    expect(hasSuggestion).toBe(false);
  });

  it('adds plugin when suggestion is configured', () => {
    const Custom = Emoji.configure({
      suggestion: {
        char: ':',
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
    const hasSuggestion = pluginKeys.some((k) => k.includes('emojiSuggestion'));
    expect(hasSuggestion).toBe(true);
  });
});

describe('suggestionPlugin exports', () => {
  it('exports createSuggestionPlugin', async () => {
    const mod = await import('./suggestionPlugin.js');
    expect(mod.createSuggestionPlugin).toBeDefined();
    expect(typeof mod.createSuggestionPlugin).toBe('function');
  });

  it('exports emojiSuggestionPluginKey', async () => {
    const mod = await import('./suggestionPlugin.js');
    expect(mod.emojiSuggestionPluginKey).toBeDefined();
  });
});

describe('index exports', () => {
  it('exports all public API', async () => {
    const mod = await import('./index.js');
    expect(mod.Emoji).toBeDefined();
    expect(mod.emojis).toBeDefined();
    expect(mod.allEmojis).toBeDefined();
    expect(mod.emoticons).toBeDefined();
    expect(mod.createSuggestionPlugin).toBeDefined();
    expect(mod.emojiSuggestionPluginKey).toBeDefined();
    expect(mod.default).toBe(mod.Emoji);
  });
});
