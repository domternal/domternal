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

  it('leads the Notion-mode selection menu with ai, then link and textAlign', () => {
    editor = makeEditor();
    editor.view.dom.classList.add('dm-notion-mode');
    const text = defaultBubbleContexts(editor)['text'] ?? [];
    expect(text[0]).toBe('ai'); // "Ask AI" first
    expect(text[1]).toBe('|'); // leading separator, collapses when ai is absent
    expect(text).toContain('textAlign');
  });

  it('returns a fresh array each call (safe to mutate)', () => {
    editor = makeEditor();
    const a = defaultBubbleContexts(editor)['text'];
    const b = defaultBubbleContexts(editor)['text'];
    expect(a).not.toBe(b);
  });
});
