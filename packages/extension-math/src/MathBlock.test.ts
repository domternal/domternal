import { describe, it, expect } from 'vitest';
import { MathBlock } from './MathBlock.js';
import { Document, Text, Paragraph, Editor } from '@domternal/core';

const extensions = [Document, Text, Paragraph, MathBlock];

function makeEditor(content: string): Editor {
  return new Editor({ element: document.createElement('div'), extensions, content });
}

describe('MathBlock', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(MathBlock.name).toBe('mathBlock');
    });
    it('is a node type', () => {
      expect(MathBlock.type).toBe('node');
    });
    it('belongs to the block group', () => {
      expect(MathBlock.config.group).toBe('block');
    });
    it('is an atom', () => {
      expect(MathBlock.config.atom).toBe(true);
    });
    it('is not inline', () => {
      expect(MathBlock.config.inline).toBeFalsy();
    });
  });

  describe('serialization', () => {
    it('parses data-latex from HTML into the latex attribute', () => {
      const editor = makeEditor('<div data-type="math-block" data-latex="x^2"></div>');
      const json = editor.getJSON() as { content?: { type?: string; attrs?: Record<string, unknown> }[] };
      const math = json.content?.find((n) => n.type === 'mathBlock');
      expect(math?.attrs?.['latex']).toBe('x^2');
      editor.destroy();
    });

    it('round-trips latex through getHTML', () => {
      const editor = makeEditor('<div data-type="math-block" data-latex="x^2"></div>');
      const html = editor.getHTML();
      expect(html).toContain('data-type="math-block"');
      expect(html).toContain('data-latex="x^2"');
      editor.destroy();
    });

    it('exposes latex as $$...$$ via getText', () => {
      const editor = makeEditor('<div data-type="math-block" data-latex="x^2"></div>');
      expect(editor.getText()).toContain('$$x^2$$');
      editor.destroy();
    });
  });
});
