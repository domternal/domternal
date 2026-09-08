import { afterEach, describe, expect, it } from 'vitest';
import { Document, Editor, Paragraph, Text } from '@domternal/core';
import { Mention } from './Mention.js';

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); });

describe('mention HTML semantics', () => {
  it('preserves identity, label and type when attribute order changes and values need escaping', () => {
    const attrs = {
      'data-id': 'user"&<42>', 'data-label': 'A & <B> "C"',
      'data-mention-type': 'user', 'data-type': 'mention',
    };
    const input = document.createElement('span');
    for (const [key, value] of Object.entries(attrs)) input.setAttribute(key, value);
    input.textContent = '@A & <B> "C"';
    editor = new Editor({ extensions: [Document, Paragraph, Text, Mention], content: `<p>${input.outerHTML}</p>` });
    const before = editor.getJSON();
    const output = document.createElement('div');
    output.innerHTML = editor.getHTML();
    const mention = output.querySelector('span[data-type="mention"]');
    expect(mention).not.toBeNull();
    for (const [key, value] of Object.entries(attrs)) expect(mention?.getAttribute(key)).toBe(value);
    expect(output.querySelectorAll('b, script, img')).toHaveLength(0);
    expect(editor.state.doc.firstChild?.firstChild?.attrs).toMatchObject({
      id: attrs['data-id'], label: attrs['data-label'], type: 'user',
    });
    const reordered = document.createElement('span');
    for (const attr of Array.from(mention!.attributes).reverse()) reordered.setAttribute(attr.name, attr.value);
    reordered.textContent = mention!.textContent;
    editor.setContent(`<p>${reordered.outerHTML}</p>`, false);
    expect(editor.getJSON()).toEqual(before);
  });
});
