import { describe, it, expect } from 'vitest';
import { MathInline } from './MathInline.js';
import { Document, Text, Paragraph, Editor } from '@domternal/core';

const extensions = [Document, Text, Paragraph, MathInline];

function makeEditor(content: string): Editor {
  return new Editor({ element: document.createElement('div'), extensions, content });
}

describe('MathInline', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(MathInline.name).toBe('mathInline');
    });
    it('is a node type', () => {
      expect(MathInline.type).toBe('node');
    });
    it('belongs to the inline group', () => {
      expect(MathInline.config.group).toBe('inline');
    });
    it('is inline', () => {
      expect(MathInline.config.inline).toBe(true);
    });
    it('is an atom', () => {
      expect(MathInline.config.atom).toBe(true);
    });
  });

  describe('serialization', () => {
    it('parses data-latex from HTML into the latex attribute', () => {
      const editor = makeEditor('<p>x <span data-type="math-inline" data-latex="a^2"></span></p>');
      const json = editor.getJSON() as { content?: { content?: { type?: string; attrs?: Record<string, unknown> }[] }[] };
      const para = json.content?.[0];
      const math = para?.content?.find((n) => n.type === 'mathInline');
      expect(math?.attrs?.['latex']).toBe('a^2');
      editor.destroy();
    });

    it('round-trips latex through getHTML', () => {
      const editor = makeEditor('<p><span data-type="math-inline" data-latex="x+1"></span></p>');
      const html = editor.getHTML();
      expect(html).toContain('data-type="math-inline"');
      expect(html).toContain('data-latex="x+1"');
      editor.destroy();
    });

    it('omits data-latex when latex is empty', () => {
      const editor = makeEditor('<p><span data-type="math-inline"></span></p>');
      expect(editor.getHTML()).not.toContain('data-latex');
      editor.destroy();
    });

    it('exposes latex as $...$ via getText', () => {
      const editor = makeEditor('<p><span data-type="math-inline" data-latex="a^2"></span></p>');
      expect(editor.getText()).toContain('$a^2$');
      editor.destroy();
    });
  });
});
