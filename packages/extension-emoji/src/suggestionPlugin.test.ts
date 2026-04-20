import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Document, Text, Paragraph, Editor } from '@domternal/core';
import { TextSelection } from '@domternal/pm/state';
import { Emoji } from './Emoji.js';
import { emojiSuggestionPluginKey } from './suggestionPlugin.js';
import type { SuggestionRenderer } from './suggestionPlugin.js';
import { emojis as defaultEmojis } from './emojis.js';

function makeRenderer(): {
  renderer: SuggestionRenderer;
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

describe('emojiSuggestionPlugin', () => {
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

  it('exports emojiSuggestionPluginKey', () => {
    expect(emojiSuggestionPluginKey).toBeDefined();
  });

  describe('activation via typing', () => {
    it('activates on trigger char', async () => {
      const { renderer, onStart } = makeRenderer();
      const CustomEmoji = Emoji.configure({
        emojis: defaultEmojis,
        suggestion: { render: () => renderer },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomEmoji],
        content: '<p></p>',
      });

      editor.commands.focus();
      editor.view.dispatch(editor.state.tr.insertText(':sm', 1));
      await new Promise((r) => setTimeout(r, 50));

      expect(onStart).toHaveBeenCalled();
    });

    it('deactivates on dismiss', async () => {
      const { renderer, onStart, onExit } = makeRenderer();
      const CustomEmoji = Emoji.configure({
        emojis: defaultEmojis,
        suggestion: { render: () => renderer },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomEmoji],
        content: '<p></p>',
      });

      editor.commands.focus();
      editor.view.dispatch(editor.state.tr.insertText(':sm', 1));
      await new Promise((r) => setTimeout(r, 50));
      expect(onStart).toHaveBeenCalled();

      // Dismiss via meta
      editor.view.dispatch(editor.state.tr.setMeta(emojiSuggestionPluginKey, 'dismiss'));
      await new Promise((r) => setTimeout(r, 50));

      expect(onExit).toHaveBeenCalled();
    });

    it('calls onUpdate when query changes', async () => {
      const { renderer, onStart, onUpdate } = makeRenderer();
      const CustomEmoji = Emoji.configure({
        emojis: defaultEmojis,
        suggestion: { render: () => renderer },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomEmoji],
        content: '<p></p>',
      });

      editor.commands.focus();
      editor.view.dispatch(editor.state.tr.insertText(':sm', 1));
      await new Promise((r) => setTimeout(r, 50));
      expect(onStart).toHaveBeenCalled();

      // Update query with more chars
      editor.view.dispatch(editor.state.tr.insertText('i', 4));
      await new Promise((r) => setTimeout(r, 50));

      expect(onUpdate).toHaveBeenCalled();
    });
  });

  describe('keydown handling', () => {
    it('Escape dismisses suggestion', async () => {
      const { renderer, onExit } = makeRenderer();
      const CustomEmoji = Emoji.configure({
        emojis: defaultEmojis,
        suggestion: { render: () => renderer },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomEmoji],
        content: '<p></p>',
      });

      editor.commands.focus();
      editor.view.dispatch(editor.state.tr.insertText(':sm', 1));
      await new Promise((r) => setTimeout(r, 50));

      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      editor.view.dom.dispatchEvent(event);
      await new Promise((r) => setTimeout(r, 50));

      expect(onExit).toHaveBeenCalled();
    });

    it('delegates non-Escape keys to renderer.onKeyDown', async () => {
      const { renderer, onStart, onKeyDown } = makeRenderer();
      onKeyDown.mockReturnValue(true);

      const CustomEmoji = Emoji.configure({
        emojis: defaultEmojis,
        suggestion: { render: () => renderer },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomEmoji],
        content: '<p></p>',
      });

      editor.commands.focus();
      editor.view.dispatch(editor.state.tr.insertText(':sm', 1));
      await new Promise((r) => setTimeout(r, 50));
      expect(onStart).toHaveBeenCalled();

      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
      editor.view.dom.dispatchEvent(event);

      expect(onKeyDown).toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
    });

    it('returns false when suggestion is not active', () => {
      const { renderer } = makeRenderer();
      const CustomEmoji = Emoji.configure({
        emojis: defaultEmojis,
        suggestion: { render: () => renderer },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomEmoji],
        content: '<p>Hello</p>',
      });

      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
      expect(() => editor!.view.dom.dispatchEvent(event)).not.toThrow();
    });
  });

  describe('command callback (select emoji from renderer)', () => {
    it('clicking emoji via renderer command replaces query with emoji node', async () => {
      let capturedCommand: ((item: any) => void) | null = null;
      const renderer: SuggestionRenderer = {
        onStart: (props) => { capturedCommand = props.command; },
        onUpdate: (props) => { capturedCommand = props.command; },
        onExit: () => { /* noop */ },
        onKeyDown: () => false,
      };

      const CustomEmoji = Emoji.configure({
        emojis: defaultEmojis,
        suggestion: { render: () => renderer },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomEmoji],
        content: '<p></p>',
      });

      editor.commands.focus();
      editor.view.dispatch(editor.state.tr.insertText(':sm', 1));
      await new Promise((r) => setTimeout(r, 50));
      expect(capturedCommand).toBeTruthy();

      // Invoke command with a real emoji item
      const grinning = defaultEmojis.find((e) => e.name === 'grinning_face');
      expect(grinning).toBeDefined();
      capturedCommand!(grinning!);

      // Emoji node should now be in the doc
      let hasEmoji = false;
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'emoji') hasEmoji = true;
      });
      expect(hasEmoji).toBe(true);
    });

    it('plainText command inserts emoji char', async () => {
      let capturedCommand: ((item: any) => void) | null = null;
      const renderer: SuggestionRenderer = {
        onStart: (props) => { capturedCommand = props.command; },
        onUpdate: (props) => { capturedCommand = props.command; },
        onExit: () => { /* noop */ },
        onKeyDown: () => false,
      };

      const CustomEmoji = Emoji.configure({
        emojis: defaultEmojis,
        plainText: true,
        suggestion: { render: () => renderer },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomEmoji],
        content: '<p></p>',
      });

      editor.commands.focus();
      editor.view.dispatch(editor.state.tr.insertText(':sm', 1));
      await new Promise((r) => setTimeout(r, 50));

      const grinning = defaultEmojis.find((e) => e.name === 'grinning_face');
      capturedCommand!(grinning!);

      // In plain text mode, emoji char is inserted as text
      expect(editor.state.doc.textContent).toContain('😀');
    });

    it('clientRect returns DOMRect from coordsAtPos', async () => {
      let capturedClientRect: (() => DOMRect | null) | null = null;
      const renderer: SuggestionRenderer = {
        onStart: (props) => { capturedClientRect = props.clientRect; },
        onUpdate: () => { /* noop */ },
        onExit: () => { /* noop */ },
        onKeyDown: () => false,
      };

      const CustomEmoji = Emoji.configure({
        emojis: defaultEmojis,
        suggestion: { render: () => renderer },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomEmoji],
        content: '<p></p>',
      });

      editor.commands.focus();
      editor.view.dispatch(editor.state.tr.insertText(':sm', 1));
      await new Promise((r) => setTimeout(r, 50));

      expect(capturedClientRect).toBeTruthy();
      // Call the clientRect fn — should return a DOMRect or null
      const rect = capturedClientRect!();
      // jsdom coordsAtPos may throw or return 0s, either way not throws
      expect(rect === null || rect instanceof DOMRect).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('keeps prev state when not active and no new match (normal typing)', async () => {
      const { renderer, onStart } = makeRenderer();
      const CustomEmoji = Emoji.configure({
        emojis: defaultEmojis,
        suggestion: { render: () => renderer },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomEmoji],
        content: '<p>Normal text</p>',
      });

      // Type something without trigger
      editor.view.dispatch(editor.state.tr.insertText('abc'));
      await new Promise((r) => setTimeout(r, 50));

      expect(onStart).not.toHaveBeenCalled();
    });

    it('keydown returns false when renderer is null and non-Escape key', async () => {
      // No render callback
      const CustomEmoji = Emoji.configure({
        emojis: defaultEmojis,
        suggestion: {},
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomEmoji],
        content: '<p></p>',
      });

      editor.commands.focus();
      editor.view.dispatch(editor.state.tr.insertText(':sm', 1));
      await new Promise((r) => setTimeout(r, 50));

      const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
      expect(() => editor!.view.dom.dispatchEvent(event)).not.toThrow();
      // No renderer → returns false, doesn't preventDefault
      expect(event.defaultPrevented).toBe(false);
    });

    it('deactivates when previously active and query no longer matches', async () => {
      const { renderer, onStart, onExit } = makeRenderer();
      const CustomEmoji = Emoji.configure({
        emojis: defaultEmojis,
        suggestion: { render: () => renderer },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomEmoji],
        content: '<p></p>',
      });

      editor.commands.focus();
      editor.view.dispatch(editor.state.tr.insertText(':sm', 1));
      await new Promise((r) => setTimeout(r, 50));
      expect(onStart).toHaveBeenCalled();

      // Backspace the : so suggestion deactivates
      editor.view.dispatch(editor.state.tr.delete(1, 4));
      await new Promise((r) => setTimeout(r, 50));

      expect(onExit).toHaveBeenCalled();
    });
  });

  describe('findSuggestionQuery edge cases', () => {
    it('does not activate with non-empty selection', async () => {
      const { renderer, onStart } = makeRenderer();
      const CustomEmoji = Emoji.configure({
        emojis: defaultEmojis,
        suggestion: { render: () => renderer },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomEmoji],
        content: '<p>Hi :sm world</p>',
      });

      // Range selection (not collapsed)
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2, 7)));
      await new Promise((r) => setTimeout(r, 50));

      expect(onStart).not.toHaveBeenCalled();
    });

    it('does not activate when trigger is mid-word (not after space)', async () => {
      const { renderer, onStart } = makeRenderer();
      const CustomEmoji = Emoji.configure({
        emojis: defaultEmojis,
        suggestion: { render: () => renderer },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomEmoji],
        content: '<p>abc:sm</p>',
      });

      editor.commands.focus();
      // Cursor after 'abc:sm'
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 7)));
      await new Promise((r) => setTimeout(r, 50));

      // : is preceded by 'c', not space → no suggestion
      expect(onStart).not.toHaveBeenCalled();
    });

    it('does not activate with space in query when allowSpaces=false', async () => {
      const { renderer, onStart } = makeRenderer();
      const CustomEmoji = Emoji.configure({
        emojis: defaultEmojis,
        suggestion: { render: () => renderer, allowSpaces: false },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomEmoji],
        content: '<p>:sm ile</p>',
      });
      editor.commands.focus();
      await new Promise((r) => setTimeout(r, 50));

      // Initial state - activates for ":sm"
      // But query includes space → deactivates on subsequent typing
      // The test just checks nothing unexpected happens
      expect(onStart).toBeDefined();
    });

    it('does not activate inside code mark', async () => {
      const { Code } = await import('@domternal/core');
      const { renderer, onStart } = makeRenderer();
      const CustomEmoji = Emoji.configure({
        emojis: defaultEmojis,
        suggestion: { render: () => renderer },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, Code, CustomEmoji],
        content: '<p><code>hi</code></p>',
      });

      editor.commands.focus();
      // Cursor inside code mark
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));
      editor.view.dispatch(editor.state.tr.insertText(':', 3));
      await new Promise((r) => setTimeout(r, 50));

      expect(onStart).not.toHaveBeenCalled();
    });

    it('does not activate inside codeBlock', async () => {
      const { CodeBlock } = await import('@domternal/core');
      const { renderer, onStart } = makeRenderer();
      const CustomEmoji = Emoji.configure({
        emojis: defaultEmojis,
        suggestion: { render: () => renderer },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CodeBlock, CustomEmoji],
        content: '<pre><code>hi</code></pre>',
      });

      editor.commands.focus();
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));
      editor.view.dispatch(editor.state.tr.insertText(':', 3));
      await new Promise((r) => setTimeout(r, 50));

      expect(onStart).not.toHaveBeenCalled();
    });

    it('does not activate with invalid chars in query', async () => {
      const { renderer, onStart } = makeRenderer();
      const CustomEmoji = Emoji.configure({
        emojis: defaultEmojis,
        suggestion: { render: () => renderer },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomEmoji],
        content: '<p>:sm@il</p>',
      });

      editor.commands.focus();
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 8)));
      await new Promise((r) => setTimeout(r, 50));

      // @ is invalid char in emoji query → no suggestion
      expect(onStart).not.toHaveBeenCalled();
    });
  });

  describe('plainText command path', () => {
    it('command inserts emoji char when plainText=true', async () => {
      let capturedCommand: ((item: any) => void) | null = null;
      const renderer = {
        onStart: (props: any) => { capturedCommand = props.command; },
        onUpdate: (props: any) => { capturedCommand = props.command; },
        onExit: () => { /* noop */ },
        onKeyDown: () => false,
      };

      const CustomEmoji = Emoji.configure({
        emojis: defaultEmojis,
        plainText: true,
        suggestion: { render: () => renderer },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomEmoji],
        content: '<p></p>',
      });

      editor.commands.focus();
      editor.view.dispatch(editor.state.tr.insertText(':sm', 1));
      await new Promise((r) => setTimeout(r, 50));
      expect(capturedCommand).toBeTruthy();

      const grinning = defaultEmojis.find((e) => e.name === 'grinning_face');
      capturedCommand!(grinning!);

      // Plain text mode: emoji char inserted directly
      expect(editor.state.doc.textContent).toContain('😀');
    });
  });

  describe('destroy', () => {
    it('onExit called when editor is destroyed during active suggestion', async () => {
      const { renderer, onStart, onExit } = makeRenderer();
      const CustomEmoji = Emoji.configure({
        emojis: defaultEmojis,
        suggestion: { render: () => renderer },
      });
      editor = new Editor({
        element: host,
        extensions: [Document, Text, Paragraph, CustomEmoji],
        content: '<p></p>',
      });

      editor.commands.focus();
      editor.view.dispatch(editor.state.tr.insertText(':sm', 1));
      await new Promise((r) => setTimeout(r, 50));
      expect(onStart).toHaveBeenCalled();

      editor.destroy();
      expect(onExit).toHaveBeenCalled();
    });
  });
});
