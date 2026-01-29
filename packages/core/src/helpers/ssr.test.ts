/**
 * Tests for SSR helpers
 *
 * Tests generateHTML, generateJSON, and generateText functions.
 * Note: Mark tests are limited because marks require editor context for options.
 */
import { describe, it, expect } from 'vitest';
import { generateHTML, generateJSON, generateText } from './ssr.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Heading } from '../nodes/Heading.js';
import type { JSONContent } from '../types/index.js';

// Basic extensions for testing (nodes only - marks need editor context)
const basicExtensions = [Document, Text, Paragraph];
const extendedExtensions = [Document, Text, Paragraph, Heading];

describe('generateHTML', () => {
  it('converts simple JSON to HTML', () => {
    const json: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello world' }],
        },
      ],
    };

    const html = generateHTML(json, basicExtensions);

    expect(html).toBe('<p>Hello world</p>');
  });

  it('converts multiple paragraphs', () => {
    const json: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'First' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Second' }],
        },
      ],
    };

    const html = generateHTML(json, basicExtensions);

    expect(html).toBe('<p>First</p><p>Second</p>');
  });

  it('converts headings', () => {
    const json: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Title' }],
        },
      ],
    };

    const html = generateHTML(json, extendedExtensions);

    expect(html).toBe('<h1>Title</h1>');
  });

  it('handles empty document', () => {
    const json: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    };

    const html = generateHTML(json, basicExtensions);

    expect(html).toBe('<p></p>');
  });
});

describe('generateJSON', () => {
  it('converts simple HTML to JSON', () => {
    const html = '<p>Hello world</p>';

    const json = generateJSON(html, basicExtensions);

    expect(json.type).toBe('doc');
    expect(json.content).toHaveLength(1);
    expect(json.content?.[0]?.type).toBe('paragraph');
    expect(json.content?.[0]?.content?.[0]?.text).toBe('Hello world');
  });

  it('converts multiple paragraphs', () => {
    const html = '<p>First</p><p>Second</p>';

    const json = generateJSON(html, basicExtensions);

    expect(json.content).toHaveLength(2);
    expect(json.content?.[0]?.content?.[0]?.text).toBe('First');
    expect(json.content?.[1]?.content?.[0]?.text).toBe('Second');
  });

  it('converts headings', () => {
    const html = '<h1>Title</h1>';

    const json = generateJSON(html, extendedExtensions);

    expect(json.content?.[0]?.type).toBe('heading');
    expect(json.content?.[0]?.attrs?.['level']).toBe(1);
  });
});

describe('generateText', () => {
  it('extracts text from JSON', () => {
    const json: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello world' }],
        },
      ],
    };

    const text = generateText(json, basicExtensions);

    expect(text).toBe('Hello world');
  });

  it('joins paragraphs with default separator', () => {
    const json: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'First' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Second' }],
        },
      ],
    };

    const text = generateText(json, basicExtensions);

    expect(text).toBe('First\n\nSecond');
  });

  it('uses custom block separator', () => {
    const json: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'First' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Second' }],
        },
      ],
    };

    const text = generateText(json, basicExtensions, { blockSeparator: ' | ' });

    expect(text).toBe('First | Second');
  });

  it('handles empty paragraphs', () => {
    const json: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    };

    const text = generateText(json, basicExtensions);

    expect(text).toBe('');
  });
});

describe('round-trip conversion', () => {
  it('JSON -> HTML -> JSON preserves content', () => {
    const originalJson: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello world' }],
        },
      ],
    };

    const html = generateHTML(originalJson, basicExtensions);
    const resultJson = generateJSON(html, basicExtensions);

    expect(resultJson.content?.[0]?.content?.[0]?.text).toBe('Hello world');
  });

  it('HTML -> JSON -> HTML preserves structure', () => {
    const originalHtml = '<p>Test content</p>';

    const json = generateJSON(originalHtml, basicExtensions);
    const resultHtml = generateHTML(json, basicExtensions);

    expect(resultHtml).toBe(originalHtml);
  });
});
