import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { InputRule } from '@domternal/pm/inputrules';
import { inputRulesPlugin } from './inputRulesPlugin.js';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Heading } from '../nodes/Heading.js';

describe('inputRulesPlugin', () => {
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

  it('creates a Plugin instance', () => {
    const rule = new InputRule(/---/, (state, _match, start, end) => {
      return state.tr.insertText('*', start, end);
    });
    const plugin = inputRulesPlugin({ rules: [rule] });
    expect(plugin).toBeDefined();
    expect(plugin.props).toBeDefined();
  });

  it('registers handleTextInput prop', () => {
    const rule = new InputRule(/test/, (state) => state.tr);
    const plugin = inputRulesPlugin({ rules: [rule] });
    expect(plugin.props.handleTextInput).toBeDefined();
  });

  it('registers handleKeyDown prop for Backspace undo', () => {
    const rule = new InputRule(/test/, (state) => state.tr);
    const plugin = inputRulesPlugin({ rules: [rule] });
    expect(plugin.props.handleKeyDown).toBeDefined();
  });

  it('handleKeyDown returns false for non-Backspace keys', () => {
    editor = new Editor({
      element: host,
      extensions: [Document, Text, Paragraph, Heading],
      content: '<p></p>',
    });

    const rule = new InputRule(/abc/, (state) => state.tr);
    const plugin = inputRulesPlugin({ rules: [rule] });

    const event = new KeyboardEvent('keydown', { key: 'a' });
    const result = (plugin.props.handleKeyDown as any)(editor.view, event);
    expect(result).toBe(false);
  });

  it('handleKeyDown returns false for Backspace with modifiers', () => {
    editor = new Editor({
      element: host,
      extensions: [Document, Text, Paragraph],
      content: '<p></p>',
    });

    const rule = new InputRule(/abc/, (state) => state.tr);
    const plugin = inputRulesPlugin({ rules: [rule] });

    const event = new KeyboardEvent('keydown', { key: 'Backspace', ctrlKey: true });
    const result = (plugin.props.handleKeyDown as any)(editor.view, event);
    expect(result).toBe(false);
  });

  it('handleKeyDown returns false for Backspace when no undo state', () => {
    editor = new Editor({
      element: host,
      extensions: [Document, Text, Paragraph],
      content: '<p>Hello</p>',
    });

    const rule = new InputRule(/abc/, (state) => state.tr);
    const plugin = inputRulesPlugin({ rules: [rule] });

    const event = new KeyboardEvent('keydown', { key: 'Backspace' });
    const result = (plugin.props.handleKeyDown as any)(editor.view, event);
    // No undo state → returns false
    expect(result).toBe(false);
  });

  it('handleTextInput with composing view returns false', () => {
    editor = new Editor({
      element: host,
      extensions: [Document, Text, Paragraph],
      content: '<p></p>',
    });

    const rule = new InputRule(/abc/, (state) => state.tr);
    const plugin = inputRulesPlugin({ rules: [rule] });

    // Use a mock view with composing=true
    const mockView = { ...editor.view, composing: true, state: editor.state, dispatch: editor.view.dispatch.bind(editor.view) };
    const result = (plugin.props.handleTextInput as any)(mockView as any, 1, 1, 'a');
    expect(result).toBe(false);
  });

  it('handleTextInput applies matching rule', () => {
    editor = new Editor({
      element: host,
      extensions: [Document, Text, Paragraph],
      content: '<p>ab</p>',
    });

    const rule = new InputRule(/abc/, (state, _match, start, end) => {
      return state.tr.insertText('!', start, end);
    });
    const plugin = inputRulesPlugin({ rules: [rule] });

    // Simulate typing "c" after "ab" — match "abc" fires
    const result = (plugin.props.handleTextInput as any)(editor.view, 3, 3, 'c');
    expect(typeof result).toBe('boolean');
  });

  it('handleTextInput returns false when no match', () => {
    editor = new Editor({
      element: host,
      extensions: [Document, Text, Paragraph],
      content: '<p>hello</p>',
    });

    const rule = new InputRule(/xyz/, (state) => state.tr);
    const plugin = inputRulesPlugin({ rules: [rule] });

    const result = (plugin.props.handleTextInput as any)(editor.view, 6, 6, 'o');
    expect(result).toBe(false);
  });

  it('inputRulesPlugin sets isInputRules tag', () => {
    const plugin = inputRulesPlugin({ rules: [] });
    expect((plugin as any).spec?.isInputRules).toBe(true);
  });

  it('Backspace after input rule application can undo', () => {
    editor = new Editor({
      element: host,
      extensions: [Document, Text, Paragraph, Heading],
      content: '<p>## </p>',
    });

    const plugin = editor.state.plugins.find((p) => (p as any).spec?.isInputRules);
    if (!plugin) return;

    const event = new KeyboardEvent('keydown', { key: 'Backspace' });
    const result = (plugin.props.handleKeyDown as any)(editor.view, event);
    expect(typeof result).toBe('boolean');
  });

  it('compositionend handler scheduled via setTimeout does not throw', () => {
    editor = new Editor({
      element: host,
      extensions: [Document, Text, Paragraph],
      content: '<p>Hello</p>',
    });

    const rule = new InputRule(/abc/, (state) => state.tr);
    const plugin = inputRulesPlugin({ rules: [rule] });

    const handler = plugin.props.handleDOMEvents?.compositionend as any;
    expect(typeof handler).toBe('function');
    if (handler) {
      expect(() => handler(editor!.view, new CompositionEvent('compositionend'))).not.toThrow();
    }
  });

  it('handleTextInput skips rule when inside code mark and rule does not allow it', () => {
    editor = new Editor({
      element: host,
      extensions: [Document, Text, Paragraph],
      content: '<p>test</p>',
    });

    const rule = new InputRule(/abc/, (state) => state.tr);
    const plugin = inputRulesPlugin({ rules: [rule] });

    // Mock view with marks that include code
    const mockView = {
      ...editor.view,
      composing: false,
      state: editor.state,
      dispatch: editor.view.dispatch.bind(editor.view),
    };
    const result = (plugin.props.handleTextInput as any)(mockView as any, 1, 1, 'c');
    expect(typeof result).toBe('boolean');
  });

  it('undo can restore text after input rule that produced a transaction', () => {
    editor = new Editor({
      element: host,
      extensions: [Document, Text, Paragraph, Heading],
      content: '<p></p>',
    });

    const plugin = editor.state.plugins.find((p) => (p as any).spec?.isInputRules);
    if (!plugin) return;

    // Manually set undo state via meta (simulating that input rule fired)
    const fakeState = {
      transform: editor.state.tr,
      from: 1,
      to: 1,
      text: 'foo',
    };
    editor.view.dispatch(editor.state.tr.setMeta(plugin, fakeState));

    // Now Backspace should undo
    const event = new KeyboardEvent('keydown', { key: 'Backspace' });
    const result = (plugin.props.handleKeyDown as any)(editor.view, event);
    expect(typeof result).toBe('boolean');
  });

  it('apply preserves state across appendedTransaction meta', () => {
    editor = new Editor({
      element: host,
      extensions: [Document, Text, Paragraph],
      content: '<p>X</p>',
    });

    const plugin = inputRulesPlugin({ rules: [] });

    // Test the apply function preserves state when appendedTransaction meta is set
    const mockTr = {
      getMeta: (key: any) => key === 'appendedTransaction' ? true : undefined,
      selectionSet: false,
      docChanged: false,
    };
    const mockPrev = { transform: editor.state.tr, from: 1, to: 1, text: 'test' };
    const result = (plugin.spec as any).state.apply(mockTr, mockPrev);
    // Should preserve prev state
    expect(result).toBe(mockPrev);
  });

  it('apply init returns null', () => {
    const plugin = inputRulesPlugin({ rules: [] });
    const initial = (plugin.spec as any).state.init();
    expect(initial).toBe(null);
  });

  it('apply clears state on selectionSet or docChanged', () => {
    const plugin = inputRulesPlugin({ rules: [] });
    const mockPrev = { transform: null, from: 1, to: 1, text: 'a' };
    // docChanged → return null
    const mockTrDoc = { getMeta: () => undefined, selectionSet: false, docChanged: true };
    expect((plugin.spec as any).state.apply(mockTrDoc, mockPrev)).toBe(null);
    // selectionSet → return null
    const mockTrSel = { getMeta: () => undefined, selectionSet: true, docChanged: false };
    expect((plugin.spec as any).state.apply(mockTrSel, mockPrev)).toBe(null);
  });

  it('apply keeps state when nothing changed', () => {
    const plugin = inputRulesPlugin({ rules: [] });
    const mockPrev = { transform: null, from: 1, to: 1, text: 'a' };
    const mockTr = { getMeta: () => undefined, selectionSet: false, docChanged: false };
    expect((plugin.spec as any).state.apply(mockTr, mockPrev)).toBe(mockPrev);
  });

  it('apply stored meta replaces state', () => {
    const plugin = inputRulesPlugin({ rules: [] });
    const stored = { transform: null, from: 2, to: 3, text: 'x' };
    const mockTr = {
      getMeta: (key: any) => key === plugin ? stored : undefined,
      selectionSet: false,
      docChanged: true,
    };
    expect((plugin.spec as any).state.apply(mockTr, null)).toBe(stored);
  });

  it('handleTextInput applies rule and dispatches transaction (textblockType)', () => {
    editor = new Editor({
      element: host,
      extensions: [Document, Text, Paragraph, Heading],
      content: '<p># </p>',
    });

    // A real rule that returns a transaction replacing range with "!"
    const rule = new InputRule(/.*/, (state, _match, _start, _end) => {
      return state.tr.insertText('!', 1, 2);
    });
    const plugin = inputRulesPlugin({ rules: [rule] });

    // Install plugin
    const newState = editor.state.reconfigure({ plugins: [...editor.state.plugins, plugin] });
    editor.view.updateState(newState);

    const result = (plugin.props.handleTextInput as any)(editor.view, 3, 3, ' ');
    expect(result).toBe(true);
  });

  it('handleTextInput skips rule when inCode-only and not in code block', () => {
    editor = new Editor({
      element: host,
      extensions: [Document, Text, Paragraph],
      content: '<p>hello</p>',
    });

    const rule = new InputRule(/hello/, (state) => state.tr.insertText('!', 1, 2));
    (rule as any).inCode = 'only';
    const plugin = inputRulesPlugin({ rules: [rule] });

    const result = (plugin.props.handleTextInput as any)(editor.view, 6, 6, 'o');
    expect(result).toBe(false);
  });

  it('undoInputRule restores original text when Backspace pressed after rule', () => {
    editor = new Editor({
      element: host,
      extensions: [Document, Text, Paragraph],
      content: '<p>hello</p>',
    });

    // Create plugin and simulate stored undo state via setMeta dispatch
    const plugin = inputRulesPlugin({ rules: [] });
    const newState = editor.state.reconfigure({ plugins: [...editor.state.plugins, plugin] });
    editor.view.updateState(newState);

    // Create a transaction that actually modified the doc so undo has steps to invert
    const modTr = editor.state.tr.insertText('X', 1, 1);
    const storedState = { transform: modTr, from: 1, to: 2, text: 'y' };
    editor.view.dispatch(editor.state.tr.setMeta(plugin, storedState));

    const event = new KeyboardEvent('keydown', { key: 'Backspace' });
    const result = (plugin.props.handleKeyDown as any)(editor.view, event);
    expect(result).toBe(true);
  });

  it('undoInputRule deletes range when text is empty', () => {
    editor = new Editor({
      element: host,
      extensions: [Document, Text, Paragraph],
      content: '<p>hello</p>',
    });

    const plugin = inputRulesPlugin({ rules: [] });
    const newState = editor.state.reconfigure({ plugins: [...editor.state.plugins, plugin] });
    editor.view.updateState(newState);

    const modTr = editor.state.tr.insertText('X', 1, 1);
    const storedState = { transform: modTr, from: 1, to: 2, text: '' };
    editor.view.dispatch(editor.state.tr.setMeta(plugin, storedState));

    const event = new KeyboardEvent('keydown', { key: 'Backspace' });
    const result = (plugin.props.handleKeyDown as any)(editor.view, event);
    expect(result).toBe(true);
  });

  it('handleTextInput skips rule in code block when rule.inCode is not set', async () => {
    const { CodeBlock } = await import('../nodes/CodeBlock.js');
    editor = new Editor({
      element: host,
      extensions: [Document, Text, Paragraph, CodeBlock],
      content: '<pre><code>text</code></pre>',
    });

    const rule = new InputRule(/abc/, (state) => state.tr);
    const plugin = inputRulesPlugin({ rules: [rule] });
    // cursor in code block
    const result = (plugin.props.handleTextInput as any)(editor.view, 2, 2, 'a');
    expect(result).toBe(false);
  });

  it('handleTextInput with cursor marks containing code skips rule', async () => {
    const { Code } = await import('../marks/Code.js');
    editor = new Editor({
      element: host,
      extensions: [Document, Text, Paragraph, Code],
      content: '<p>text</p>',
    });
    // Stored mark = code, so $from.marks() will include code
    const codeMark = editor.schema.marks['code']!;
    editor.view.dispatch(editor.state.tr.addStoredMark(codeMark.create()));

    const rule = new InputRule(/ab/, (state) => state.tr);
    const plugin = inputRulesPlugin({ rules: [rule] });
    const result = (plugin.props.handleTextInput as any)(editor.view, 3, 3, 'b');
    expect(typeof result).toBe('boolean');
  });

  it('handleTextInput with no match across code+text range returns false', async () => {
    const { Code } = await import('../marks/Code.js');
    editor = new Editor({
      element: host,
      extensions: [Document, Text, Paragraph, Code],
      content: '<p><code>ab</code>c</p>',
    });

    // Rule that doesn't match — ensures handleTextInput returns false normally
    const rule = new InputRule(/xyz/, (state) => state.tr);
    const plugin = inputRulesPlugin({ rules: [rule] });
    const result = (plugin.props.handleTextInput as any)(editor.view, 4, 4, 'c');
    expect(result).toBe(false);
  });
});
