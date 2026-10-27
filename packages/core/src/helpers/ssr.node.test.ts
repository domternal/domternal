// @vitest-environment node
/**
 * generateHTML and generateJSON in Node.js without a document option: they
 * load the installed linkedom peer themselves, in an ES module as well.
 */
import { describe, it, expect } from 'vitest';
import { generateHTML, generateJSON } from './ssr.js';
import { StarterKit } from '../extensions/StarterKit.js';
import type { JSONContent } from '../types/index.js';

const content: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world', marks: [{ type: 'bold' }] }] }],
};

describe('SSR helpers without a document option', () => {
  it('runs outside a browser', () => {
    expect(typeof window).toBe('undefined');
  });

  it('generateHTML loads linkedom', () => {
    expect(generateHTML(content, [StarterKit])).toBe('<p>Hello <strong>world</strong></p>');
  });

  it('generateJSON loads linkedom', () => {
    expect(generateJSON('<p>Hello <strong>world</strong></p>', [StarterKit])).toEqual(content);
  });
});
