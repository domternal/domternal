import { afterEach, describe, expect, it } from 'vitest';
import { Document, Editor, Paragraph, Text } from '@domternal/core';
import { MathInline } from './MathInline.js';
import { MathBlock } from './MathBlock.js';

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); });

describe('math HTML semantics', () => {
  it.each([
    { extension: MathInline, tag: 'span', type: 'math-inline', inline: true },
    { extension: MathBlock, tag: 'div', type: 'math-block', inline: false },
  ])('round-trips $type with reordered attributes and escaped LaTeX', ({ extension, tag, type, inline }) => {
    const latex = '\\frac{a&b}{<c>} "quoted"';
    const input = document.createElement(tag);
    input.setAttribute('data-latex', latex);
    input.setAttribute('data-type', type);
    editor = new Editor({
      extensions: [Document, Paragraph, Text, extension],
      content: inline ? `<p>${input.outerHTML}</p>` : input.outerHTML,
    });
    const before = editor.getJSON();
    const output = document.createElement('div');
    output.innerHTML = editor.getHTML();
    const math = output.querySelector(`[data-type="${type}"]`);
    expect(math?.tagName.toLowerCase()).toBe(tag);
    expect(math?.getAttribute('data-latex')).toBe(latex);
    expect(output.querySelectorAll('c, script, img')).toHaveLength(0);
    const reordered = document.createElement(tag);
    for (const attr of Array.from(math!.attributes).reverse()) reordered.setAttribute(attr.name, attr.value);
    editor.setContent(inline ? `<p>${reordered.outerHTML}</p>` : reordered.outerHTML, false);
    expect(editor.getJSON()).toEqual(before);
  });
});
