import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Document, Text, Paragraph, Editor, CodeBlock, HardBreak, StarterKit } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { Mention } from './Mention.js';
import { dismissMentionSuggestion } from './mentionSuggestionPlugin.js';
import type {
  MentionItem,
  MentionSuggestionProps,
  MentionSuggestionRenderer,
  MentionTrigger,
} from './mentionSuggestionPlugin.js';

const mockItems: MentionItem[] = [
  { id: '1', label: 'Alice' },
  { id: '2', label: 'Bob' },
  { id: '3', label: 'Charlie' },
];

function makeRenderer(): {
  renderer: MentionSuggestionRenderer;
  onStart: ReturnType<typeof vi.fn>;
  onUpdate: ReturnType<typeof vi.fn>;
  onExit: ReturnType<typeof vi.fn>;
  onKeyDown: ReturnType<typeof vi.fn>;
} {
  const onStart = vi.fn();
  const onUpdate = vi.fn();
  const onExit = vi.fn();
  const onKeyDown = vi.fn((_event: KeyboardEvent): boolean => false);
  return {
    renderer: { onStart, onUpdate, onExit, onKeyDown },
    onStart,
    onUpdate,
    onExit,
    onKeyDown,
  };
}

describe('mentionSuggestionPlugin', () => {
  let editor: Editor | undefined;
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
    host.remove();
  });

  describe('dismissMentionSuggestion', () => {
    it('exists as an exported function', () => {
      expect(typeof dismissMentionSuggestion).toBe('function');
    });

    it('dispatches dismiss meta without throwing', () => {
      const CustomMention = Mention.configure({
        suggestion: { char: '@', name: 'user', items: () => mockItems },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomMention],
        content: '<p>Hello</p>',
      });

      expect(() => { dismissMentionSuggestion(editor!.view, 'user'); }).not.toThrow();
    });
  });

  describe('invalidNodes check', () => {
    it('does not activate suggestion when cursor is in an invalidNode', async () => {
      const { renderer, onStart } = makeRenderer();
      const CustomMention = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: () => mockItems,
          invalidNodes: ['codeBlock'],
          render: () => renderer,
        },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CodeBlock, CustomMention],
        content: '<pre><code>console.log</code></pre>',
      });

      // Focus editor + type @ inside code block
      editor.commands.focus();
      editor.view.dispatch(editor.state.tr.insertText('@', 3));
      await new Promise((r) => setTimeout(r, 50));

      // Suggestion should not activate
      expect(onStart).not.toHaveBeenCalled();
    });

    it('does not activate in a custom invalid paragraph-like node', async () => {
      const { renderer, onStart } = makeRenderer();
      const CustomMention = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: () => mockItems,
          // Invalidate regular paragraph (unusual but tests the branch)
          invalidNodes: ['paragraph'],
          render: () => renderer,
        },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomMention],
        content: '<p>Hello </p>',
      });

      editor.commands.focus();
      editor.view.dispatch(editor.state.tr.insertText('@', 7));
      await new Promise((r) => setTimeout(r, 50));

      // Invalid node list blocks activation → onStart not called
      expect(onStart).not.toHaveBeenCalled();
    });
  });

  describe('keydown without render factory', () => {
    it('keydown returns false when no render factory is configured', async () => {
      // No render configured - renderer will be null in the plugin
      const CustomMention = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: () => mockItems,
          // No render prop
        },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomMention],
        content: '<p></p>',
      });

      editor.commands.focus();
      editor.view.dispatch(editor.state.tr.insertText('@', 1));
      await new Promise((r) => setTimeout(r, 50));

      // Dispatch a non-Escape keydown
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
      expect(() => editor!.view.dom.dispatchEvent(event)).not.toThrow();
      // Without renderer, keydown returns false (doesn't preventDefault)
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe('keydown handling when suggestion is active', () => {
    it('Escape dismisses active suggestion', async () => {
      const { renderer, onStart, onExit } = makeRenderer();
      const CustomMention = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: () => mockItems,
          render: () => renderer,
        },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomMention],
        content: '<p></p>',
      });

      // Type @ to activate suggestion
      editor.commands.focus();
      editor.view.dispatch(editor.state.tr.insertText('@', 1));
      await new Promise((r) => setTimeout(r, 50));
      expect(onStart).toHaveBeenCalled();

      // Dispatch Escape keydown
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      editor.view.dom.dispatchEvent(event);
      await new Promise((r) => setTimeout(r, 50));

      // Suggestion should exit
      expect(onExit).toHaveBeenCalled();
    });

    it('keydown delegates to renderer.onKeyDown and preventsDefault when handled', async () => {
      const { renderer, onStart, onKeyDown } = makeRenderer();
      onKeyDown.mockReturnValue(true);

      const CustomMention = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: () => mockItems,
          render: () => renderer,
        },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomMention],
        content: '<p></p>',
      });

      editor.commands.focus();
      editor.view.dispatch(editor.state.tr.insertText('@', 1));
      await new Promise((r) => setTimeout(r, 50));
      expect(onStart).toHaveBeenCalled();

      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
      editor.view.dom.dispatchEvent(event);

      expect(onKeyDown).toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
    });

    it('keydown returns false when renderer does not handle (falls through)', async () => {
      const { renderer, onStart, onKeyDown } = makeRenderer();
      onKeyDown.mockReturnValue(false);

      const CustomMention = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: () => mockItems,
          render: () => renderer,
        },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomMention],
        content: '<p></p>',
      });

      editor.commands.focus();
      editor.view.dispatch(editor.state.tr.insertText('@', 1));
      await new Promise((r) => setTimeout(r, 50));
      expect(onStart).toHaveBeenCalled();

      const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
      editor.view.dom.dispatchEvent(event);

      // Renderer returned false → defaultPrevented should be false
      expect(event.defaultPrevented).toBe(false);
    });

    it('keydown returns false when suggestion is not active', () => {
      const { renderer } = makeRenderer();
      const CustomMention = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: () => mockItems,
          render: () => renderer,
        },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomMention],
        content: '<p>Hello</p>',
      });

      // No @ typed, suggestion inactive
      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
      expect(() => editor!.view.dom.dispatchEvent(event)).not.toThrow();
    });
  });

  describe('decorations', () => {
    it('adds decoration on active suggestion range', async () => {
      const { renderer, onStart } = makeRenderer();
      const CustomMention = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: () => mockItems,
          render: () => renderer,
          decorationClass: 'my-mention-deco',
        },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomMention],
        content: '<p></p>',
      });

      editor.commands.focus();
      editor.view.dispatch(editor.state.tr.insertText('@', 1));
      await new Promise((r) => setTimeout(r, 50));
      expect(onStart).toHaveBeenCalled();

      // Should have inline decoration with custom class
      const decorated = host.querySelector('.my-mention-deco');
      expect(decorated).not.toBeNull();
    });
  });

  describe('async items with debounce', () => {
    it('handles async items callback', async () => {
      const { renderer, onStart } = makeRenderer();
      const CustomMention = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: async () => {
            await new Promise((r) => setTimeout(r, 10));
            return mockItems;
          },
          render: () => renderer,
          debounce: 50,
        },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomMention],
        content: '<p></p>',
      });

      editor.commands.focus();
      editor.view.dispatch(editor.state.tr.insertText('@', 1));

      // Wait for debounce + async resolve
      await new Promise((r) => setTimeout(r, 200));
      expect(onStart).toHaveBeenCalled();
    });
  });

  describe('minQueryLength', () => {
    it('does not show suggestion until query meets minQueryLength', async () => {
      const { renderer, onStart } = makeRenderer();
      const CustomMention = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: () => mockItems,
          render: () => renderer,
          minQueryLength: 2,
        },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomMention],
        content: '<p></p>',
      });

      editor.commands.focus();
      // Type just @a (query = "a", length 1 < minQueryLength 2)
      editor.view.dispatch(editor.state.tr.insertText('@a', 1));
      await new Promise((r) => setTimeout(r, 50));
      expect(onStart).not.toHaveBeenCalled();

      // Type more to reach minQueryLength
      editor.view.dispatch(editor.state.tr.insertText('b', 3));
      await new Promise((r) => setTimeout(r, 50));
      expect(onStart).toHaveBeenCalled();
    });
  });

  describe('shouldShow callback', () => {
    it('suppresses suggestion when shouldShow returns false', async () => {
      const { renderer, onStart } = makeRenderer();
      const CustomMention = Mention.configure({
        suggestion: {
          char: '@',
          name: 'user',
          items: () => mockItems,
          render: () => renderer,
          shouldShow: () => false,
        },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomMention],
        content: '<p></p>',
      });

      editor.commands.focus();
      editor.view.dispatch(editor.state.tr.insertText('@', 1));
      await new Promise((r) => setTimeout(r, 50));

      expect(onStart).not.toHaveBeenCalled();
    });
  });

  describe('query characters and trigger boundary', () => {
    type Mounted = ReturnType<typeof makeRenderer> & {
      items: Mock<(props: { query: string }) => MentionItem[]>;
    };

    // Names in many scripts. Invisible characters are escaped: the combining
    // marks U+0301 to U+0303, ZWNJ (U+200C) and ZWJ (U+200D).
    const NON_ASCII_QUERIES: [string, string][] = [
      ['a German name', 'Jürgen'],
      ['a Croatian name', 'Željko'],
      ['a Croatian name with đ', 'Đurđica'],
      ['a Spanish name', 'José'],
      ['a decomposed Spanish name', 'Jose\u0301'],
      ['a Cyrillic name', 'Иван'],
      ['a Chinese name', '李明'],
      ['a name with an astral CJK character', '𠮷田'],
      ['a Japanese name', 'やまだ'],
      ['a Korean name', '김민준'],
      ['an Arabic name', 'محمد'],
      ['a Hebrew name', 'דוד'],
      ['a Greek name', 'Νίκος'],
      ['a Devanagari name', 'राम'],
      ['a Thai name with combining marks', 'สมศักดิ์'],
      ['a decomposed Vietnamese name', 'Nguye\u0302\u0303n'],
      ['a Persian name with a ZWNJ', 'علی\u200Cرضا'],
      ['a Sinhala name with a ZWJ', 'ශ්\u200Dරී'],
    ];

    const REPLACEMENTS: [string, string, MentionItem, string[]][] = [
      ['a query after text', 'Hi @Žel', { id: '7', label: 'Željko' }, ['Hi ', '[mention Željko]', ' ']],
      ['an astral query', '@𠮷', { id: '8', label: '𠮷田' }, ['[mention 𠮷田]', ' ']],
      ['a decomposed query', '@Jose\u0301', { id: '9', label: 'José' }, ['[mention José]', ' ']],
    ];

    function mount(content = '<p></p>', options: Partial<MentionTrigger> = {}): Mounted {
      const mocks = makeRenderer();
      const items = vi.fn<(props: { query: string }) => MentionItem[]>(() => mockItems);
      editor = new Editor({
        element: host,
        extensions: [
          Document,
          Text,
          Paragraph,
          HardBreak,
          Mention.configure({
            suggestion: { char: '@', name: 'user', items, render: () => mocks.renderer, ...options },
          }),
        ],
        content,
      });
      editor.commands.focus('end');
      return { ...mocks, items };
    }

    // One character per transaction, as typing does.
    function typeText(text: string): void {
      for (const ch of text) editor!.view.dispatch(editor!.state.tr.insertText(ch));
    }

    // The props of the latest renderer call.
    function lastProps(mocks: Mounted): MentionSuggestionProps {
      const call = mocks.onUpdate.mock.lastCall ?? mocks.onStart.mock.lastCall;
      if (!call) throw new Error('The suggestion never opened');
      return call[0] as MentionSuggestionProps;
    }

    // The first paragraph as text runs and bracketed inline nodes.
    function inlineContent(): string[] {
      const parts: string[] = [];
      editor!.state.doc.firstChild?.forEach((node) => {
        if (node.isText) parts.push(node.text ?? '');
        else if (node.type.name === 'mention') parts.push(`[mention ${String(node.attrs['label'])}]`);
        else parts.push(`[${node.type.name}]`);
      });
      return parts;
    }

    function enter(init: KeyboardEventInit = {}): KeyboardEvent {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init });
      editor!.view.dom.dispatchEvent(event);
      return event;
    }

    it.each(NON_ASCII_QUERIES)('keeps the suggestion open for %s', (_name, query) => {
      const { onStart, onExit, items } = mount('<p>Hi</p>');
      typeText(` @${query}`);

      expect(onStart).toHaveBeenCalledTimes(1);
      expect(onExit).not.toHaveBeenCalled();
      expect(items).toHaveBeenLastCalledWith(expect.objectContaining({ query }));
      expect(host.querySelector('.mention-suggestion')?.textContent).toBe(`@${query}`);
    });

    it('keeps an allowSpaces query with non-ASCII letters open', () => {
      const { onExit, items } = mount('<p></p>', { allowSpaces: true });
      typeText('@Jürgen Mü');

      expect(onExit).not.toHaveBeenCalled();
      expect(items).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'Jürgen Mü' }));
    });

    it.each([
      ['punctuation', '!'],
      ['an emoji', '😀'],
    ])('closes when %s follows a non-ASCII query', (_name, suffix) => {
      const { onStart, onExit } = mount();
      typeText('@Jü');
      expect(onStart).toHaveBeenCalledTimes(1);
      expect(onExit).not.toHaveBeenCalled();

      typeText(suffix);
      expect(onExit).toHaveBeenCalledTimes(1);
    });

    it('closes when a hard break lands inside the query', () => {
      const { onStart, onExit } = mount();
      typeText('@Jo');
      editor!.commands.setHardBreak();
      expect(onExit).toHaveBeenCalledTimes(1);

      typeText('hn');
      expect(onStart).toHaveBeenCalledTimes(1);
    });

    it('opens at the start of a line created by a hard break and inserts there', () => {
      const mocks = mount('<p>Line</p>');
      editor!.commands.setHardBreak();
      typeText('@J');

      expect(mocks.onStart).toHaveBeenCalledTimes(1);
      expect(mocks.items).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'J' }));

      lastProps(mocks).command({ id: '7', label: 'Jürgen' });
      expect(inlineContent()).toEqual(['Line', '[hardBreak]', '[mention Jürgen]', ' ']);
    });

    it.each([
      ['a no-break space', '\u00A0'],
      ['a narrow no-break space', '\u202F'],
      ['an ideographic space', '\u3000'],
    ])('opens after %s', (_name, space) => {
      const { onStart, items } = mount();
      typeText(`Hi${space}@J`);

      expect(onStart).toHaveBeenCalledTimes(1);
      expect(items).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'J' }));
    });

    it('opens right after an inline mention node', () => {
      const { onStart, items } = mount('<p>Hi</p>');
      typeText(' ');
      editor!.commands.insertMention({ id: '1', label: 'Alice' });
      typeText('@B');

      expect(onStart).toHaveBeenCalledTimes(1);
      expect(items).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'B' }));
    });

    it.each([
      ['an email address', 'mail@ex'],
      ['an @ right after a non-ASCII letter', 'Željko@x'],
      ['an @ right after CJK text', '请@李明'],
      ['an @ right after a text emoji', '😀@J'],
      ['an IDN email address', '用户@例子'],
      ['the full-width ＠', '＠山田'],
    ])('does not open for %s', (_name, text) => {
      const { onStart } = mount();
      typeText(text);

      expect(onStart).not.toHaveBeenCalled();
    });

    it.each(REPLACEMENTS)('replaces the whole range of %s on selection', (_name, text, item, expected) => {
      const mocks = mount();
      typeText(text);

      lastProps(mocks).command(item);
      expect(inlineContent()).toEqual(expected);
    });

    it('opens when the caret is placed inside an existing non-ASCII handle', () => {
      const { onStart, items } = mount('<p>Hi @Željko there</p>');
      expect(onStart).not.toHaveBeenCalled();

      // Text starts at position 1, so 8 sits right after "Hi @Žel"
      editor!.view.dispatch(editor!.state.tr.setSelection(TextSelection.create(editor!.state.doc, 8)));

      expect(onStart).toHaveBeenCalledTimes(1);
      expect(items).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'Žel' }));
    });

    // Apostrophes stay out of the query while the renderer still takes Enter on
    // an empty result list: "@Ana's" plus Enter would otherwise do nothing.
    it.each([
      ['an ASCII apostrophe', "'"],
      ['a typographic apostrophe', '\u2019'],
    ])('closes at %s and leaves the next Enter to the editor', (_name, apostrophe) => {
      const { onExit, onKeyDown } = mount();
      onKeyDown.mockReturnValue(true);
      typeText(`@Ana${apostrophe}s`);
      expect(onExit).toHaveBeenCalledTimes(1);

      enter();
      expect(onKeyDown).not.toHaveBeenCalled();
    });

    it('leaves the Enter that commits an IME conversion (keyCode 229) to the browser', () => {
      const { onStart, onKeyDown } = mount();
      onKeyDown.mockReturnValue(true);
      // Romaji and pinyin compose ASCII letters, so the suggestion is open
      typeText('@ya');
      expect(onStart).toHaveBeenCalledTimes(1);

      const event = enter({ keyCode: 229 });

      expect(onKeyDown).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it('leaves keys to the IME while ProseMirror reports a composition', () => {
      const { onStart, onKeyDown } = mount();
      onKeyDown.mockReturnValue(true);
      typeText('@ya');
      expect(onStart).toHaveBeenCalledTimes(1);
      editor!.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      expect(editor!.view.composing).toBe(true);

      const event = enter();

      expect(onKeyDown).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it('does not pick an item on the Enter that commits a Safari IME conversion', () => {
      const mocks = makeRenderer();
      mocks.onKeyDown.mockReturnValue(true);
      editor = new Editor({
        element: host,
        extensions: [
          StarterKit,
          Mention.configure({
            suggestion: { char: '@', name: 'user', items: () => mockItems, render: () => mocks.renderer },
          }),
        ],
        content: '<p>Hi</p>',
      });
      editor.commands.focus('end');
      typeText(' @');

      // Safari order: compositionstart, the converted text, compositionend,
      // then keydown Enter with keyCode 229 and isComposing false.
      editor.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      typeText('山');
      editor.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '山' }));
      expect(mocks.onStart).toHaveBeenCalledTimes(1);
      expect(mocks.onExit).not.toHaveBeenCalled();
      const doc = editor.state.doc;

      const event = enter({ keyCode: 229 });

      // ProseMirror's own Safari guard then drops the Enter: no mention, no split.
      expect(mocks.onKeyDown).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
      expect(editor.state.doc.eq(doc)).toBe(true);
    });
  });
});
