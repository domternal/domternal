import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Document, Text, Paragraph, Editor, CodeBlock } from '@domternal/core';
import { Mention } from './Mention.js';
import { dismissMentionSuggestion } from './mentionSuggestionPlugin.js';
import type { MentionItem, MentionSuggestionRenderer } from './mentionSuggestionPlugin.js';

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
});
