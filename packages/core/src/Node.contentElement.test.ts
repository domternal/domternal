import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from './Editor.js';
import { Node } from './Node.js';
import { Document } from './nodes/Document.js';
import { Paragraph } from './nodes/Paragraph.js';
import { Text } from './nodes/Text.js';
import type { NodeParseRule } from './types/NodeConfig.js';

const editors: Editor[] = [];
afterEach(() => { for (const editor of editors.splice(0)) editor.destroy(); });

describe('Node parse rules with a contentElement', () => {
  it.each(['selector', 'callback', 'element'] as const)('forwards the standard %s content source', kind => {
    const detached = document.createElement('section');
    const paragraph = document.createElement('p');
    paragraph.textContent = 'detached';
    detached.append(paragraph);
    const contentElement: NodeParseRule['contentElement'] = kind === 'selector' ? 'section' : kind === 'element' ? detached : element => {
      const section = element.querySelector('section');
      if (!section) throw new Error('Missing fixture section');
      return section;
    };
    const Container = Node.create({ name: 'container', group: 'block', content: 'block+',
      parseHTML: () => [{ tag: 'article', contentElement }], renderHTML: () => ['article', 0] });
    const editor = new Editor({ content: '<article><header>chrome</header><section><p>body</p></section></article>',
      extensions: [Document, Paragraph, Text, Container] });
    editors.push(editor);
    expect(editor.state.doc.toString()).toBe(`doc(container(paragraph("${kind === 'element' ? 'detached' : 'body'}")))`);
  });

  it('keeps the ordinary parser when no custom content source is provided', () => {
    const Container = Node.create({ name: 'container', group: 'block', content: 'block+',
      parseHTML: () => [{ tag: 'article' }], renderHTML: () => ['article', 0] });
    const editor = new Editor({ content: '<article><p>first</p><p>second</p></article>', extensions: [Document, Paragraph, Text, Container] });
    editors.push(editor);
    expect(editor.state.doc.toString()).toBe('doc(container(paragraph("first"), paragraph("second")))');
  });
});
