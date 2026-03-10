import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Heading } from '../nodes/Heading.js';
import { TextStyle } from '../marks/TextStyle.js';
import { FontSize } from './FontSize.js';
import { CodeBlock } from '../nodes/CodeBlock.js';
import { Code } from '../marks/Code.js';
import { AllSelection, TextSelection } from 'prosemirror-state';

describe('isActive skips mark-incompatible text', () => {
  let editor: Editor;

  afterEach(() => {
    editor?.destroy();
  });

  it('returns true when all applicable text has mark (code block text skipped)', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Heading, TextStyle, FontSize, CodeBlock],
      content: '<p>Hello</p><pre><code>code here</code></pre><p>World</p>',
    });

    const tr = editor.state.tr.setSelection(new AllSelection(editor.state.doc));
    editor.view.dispatch(tr);
    editor.commands.setFontSize('18px');

    expect(editor.isActive('textStyle', { fontSize: '18px' })).toBe(true);
  });

  it('returns true when all applicable text has mark (inline code text skipped)', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, TextStyle, FontSize, Code],
      content: '<p>Hello <code>inline code</code> World</p>',
    });

    const tr = editor.state.tr.setSelection(new AllSelection(editor.state.doc));
    editor.view.dispatch(tr);
    editor.commands.setFontSize('18px');

    // inline code has the `code` mark which excludes textStyle
    expect(editor.isActive('textStyle', { fontSize: '18px' })).toBe(true);
  });

  it('returns false when not all applicable text has the mark', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Heading, TextStyle, FontSize, CodeBlock],
      content: '<p>Hello</p><p>World</p>',
    });

    // Apply font to just first paragraph
    const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 6));
    editor.view.dispatch(tr);
    editor.commands.setFontSize('18px');

    // Now select all
    const tr2 = editor.state.tr.setSelection(new AllSelection(editor.state.doc));
    editor.view.dispatch(tr2);

    expect(editor.isActive('textStyle', { fontSize: '18px' })).toBe(false);
  });

  it('returns false when no applicable text exists (only code block)', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, TextStyle, FontSize, CodeBlock],
      content: '<pre><code>only code</code></pre>',
    });

    const tr = editor.state.tr.setSelection(new AllSelection(editor.state.doc));
    editor.view.dispatch(tr);

    // No applicable text — should return false
    expect(editor.isActive('textStyle', { fontSize: '18px' })).toBe(false);
  });
});
