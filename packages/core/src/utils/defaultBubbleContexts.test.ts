import { describe, it, expect, afterEach } from 'vitest';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';
import { defaultBubbleContexts } from './defaultBubbleContexts.js';

describe('defaultBubbleContexts', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
  });

  function makeEditor(): Editor {
    return new Editor({ extensions: [Document, Text, Paragraph], content: '<p>hi</p>' });
  }

  it('returns the minimal formatting set outside Notion mode', () => {
    editor = makeEditor();
    expect(defaultBubbleContexts(editor)['text']).toEqual([
      'bold',
      'italic',
      'underline',
      'strike',
      'code',
      'mathInline',
      '|',
      'link',
    ]);
  });

  it('orders the Notion-mode selection menu the way Notion does', () => {
    editor = makeEditor();
    editor.view.dom.classList.add('dm-notion-mode');
    expect(defaultBubbleContexts(editor)['text']).toEqual([
      'ai',
      '|',
      'heading',
      '|',
      'link',
      'comment',
      '|',
      'bold',
      'italic',
      'underline',
      'strike',
      'code',
      'mathInline',
    ]);
  });

  it('no longer names textAlign, which StarterKit does not ship', () => {
    // It resolved to nothing in a default install and left its separator
    // hanging off the end of the menu; Notion keeps alignment in the block
    // menu rather than the selection menu anyway.
    editor = makeEditor();
    editor.view.dom.classList.add('dm-notion-mode');
    expect(defaultBubbleContexts(editor)['text']).not.toContain('textAlign');
  });

  it('the preset option declares Notion mode without any class', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph],
      content: '<p>hi</p>',
      preset: 'notion',
    });
    const text = defaultBubbleContexts(editor)['text'] ?? [];
    expect(text[0]).toBe('ai');
    expect(text).toContain('heading');
  });

  it('returns a fresh array each call (safe to mutate)', () => {
    editor = makeEditor();
    const a = defaultBubbleContexts(editor)['text'];
    const b = defaultBubbleContexts(editor)['text'];
    expect(a).not.toBe(b);
  });
});
