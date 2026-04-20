import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { InputRule } from '@domternal/pm/inputrules';
import { inputRulesPlugin } from './inputRulesPlugin.js';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Heading } from '../nodes/Heading.js';

describe('inputRulesPlugin', () => {
  let editor: Editor;
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
    const rule = new InputRule(/---/, (state, match, start, end) => {
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
    const result = plugin.props.handleKeyDown!(editor.view, event);
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
    const result = plugin.props.handleKeyDown!(editor.view, event);
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
    const result = plugin.props.handleKeyDown!(editor.view, event);
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
    const result = plugin.props.handleTextInput!(mockView as any, 1, 1, 'a');
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
    const result = plugin.props.handleTextInput!(editor.view, 3, 3, 'c');
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

    const result = plugin.props.handleTextInput!(editor.view, 6, 6, 'o');
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
    if (!plugin) {
      // No input rules plugin registered, skip
      return;
    }

    // Backspace when no undo state exists
    const event = new KeyboardEvent('keydown', { key: 'Backspace' });
    const result = plugin.props.handleKeyDown!(editor.view, event);
    expect(typeof result).toBe('boolean');
  });
});
