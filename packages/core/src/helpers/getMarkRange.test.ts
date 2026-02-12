import { describe, it, expect, afterEach } from 'vitest';
import { getMarkRange } from './getMarkRange.js';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Link } from '../marks/Link.js';
import { Bold } from '../marks/Bold.js';

describe('getMarkRange', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
  });

  it('returns the full range of a link mark around cursor', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Link],
      content: '<p><a href="https://example.com">hello world</a></p>',
    });

    // Cursor in middle of "hello world" (pos 6)
    const $pos = editor.state.doc.resolve(6);
    const linkType = editor.state.schema.marks['link']!;
    const range = getMarkRange($pos, linkType);

    expect(range).toBeDefined();
    // "hello world" starts at pos 1, ends at pos 12
    expect(range!.from).toBe(1);
    expect(range!.to).toBe(12);
  });

  it('returns undefined when mark is not present at position', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Link],
      content: '<p>plain text</p>',
    });

    const $pos = editor.state.doc.resolve(3);
    const linkType = editor.state.schema.marks['link']!;
    const range = getMarkRange($pos, linkType);

    expect(range).toBeUndefined();
  });

  it('returns correct range when link is part of larger text', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Link],
      content: '<p>before <a href="https://example.com">link</a> after</p>',
    });

    // Cursor inside "link" text
    const $pos = editor.state.doc.resolve(9);
    const linkType = editor.state.schema.marks['link']!;
    const range = getMarkRange($pos, linkType);

    expect(range).toBeDefined();
    // "before " = 7 chars, so "link" starts at pos 8, ends at pos 12
    expect(range!.from).toBe(8);
    expect(range!.to).toBe(12);
  });

  it('returns range at the start boundary of a mark', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Link],
      content: '<p>before <a href="https://example.com">link</a> after</p>',
    });

    // Cursor at the start of the link
    const $pos = editor.state.doc.resolve(8);
    const linkType = editor.state.schema.marks['link']!;
    const range = getMarkRange($pos, linkType);

    expect(range).toBeDefined();
    expect(range!.from).toBe(8);
    expect(range!.to).toBe(12);
  });

  it('does not find a different mark type', () => {
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Link, Bold],
      content: '<p><strong>bold text</strong></p>',
    });

    const $pos = editor.state.doc.resolve(3);
    const linkType = editor.state.schema.marks['link']!;
    const range = getMarkRange($pos, linkType);

    expect(range).toBeUndefined();
  });
});
