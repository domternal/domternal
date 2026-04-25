/**
 * Tests for BlockColor extension.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { BlockColor, DEFAULT_BLOCK_COLORS, DEFAULT_BLOCK_COLOR_TYPES } from './BlockColor.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Heading } from '../nodes/Heading.js';
import { Blockquote } from '../nodes/Blockquote.js';
import { BulletList } from '../nodes/BulletList.js';
import { ListItem } from '../nodes/ListItem.js';
import { Editor } from '../Editor.js';

const extensions = [Document, Text, Paragraph, Heading, Blockquote, BulletList, ListItem, BlockColor];

let editor: Editor | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  host?.remove();
  host = undefined;
});

function makeEditor(html = '<p>Hello</p>'): Editor {
  host = document.createElement('div');
  host.className = 'dm-editor';
  document.body.appendChild(host);
  editor = new Editor({ element: host, extensions, content: html });
  return editor;
}

describe('BlockColor configuration', () => {
  it('has the correct name', () => {
    expect(BlockColor.name).toBe('blockColor');
  });

  it('has sensible default types (excludes codeBlock/details)', () => {
    expect(BlockColor.options.types).toEqual(DEFAULT_BLOCK_COLOR_TYPES);
    expect(BlockColor.options.types).toContain('paragraph');
    expect(BlockColor.options.types).toContain('heading');
    expect(BlockColor.options.types).toContain('listItem');
    expect(BlockColor.options.types).not.toContain('codeBlock');
  });

  it('ships the full 9-color palette for bg and text', () => {
    expect(BlockColor.options.bgColors).toEqual(DEFAULT_BLOCK_COLORS);
    expect(BlockColor.options.textColors).toEqual(DEFAULT_BLOCK_COLORS);
    // Explicit names so palette changes are caught by tests.
    const names = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];
    for (const name of names) {
      expect(BlockColor.options.bgColors).toContain(name);
    }
  });

  it('can override types', () => {
    const configured = BlockColor.configure({ types: ['paragraph'] });
    expect(configured.options.types).toEqual(['paragraph']);
  });

  it('can override palettes', () => {
    const configured = BlockColor.configure({
      bgColors: ['yellow', 'blue'],
      textColors: ['red'],
    });
    expect(configured.options.bgColors).toEqual(['yellow', 'blue']);
    expect(configured.options.textColors).toEqual(['red']);
  });
});

describe('BlockColor schema integration', () => {
  it('injects bgColor and textColor attributes on paragraph', () => {
    const ed = makeEditor('<p>Hello</p>');
    const paragraph = ed.state.doc.firstChild;
    expect(paragraph?.type.name).toBe('paragraph');
    expect('bgColor' in (paragraph?.attrs ?? {})).toBe(true);
    expect('textColor' in (paragraph?.attrs ?? {})).toBe(true);
    expect(paragraph?.attrs['bgColor']).toBe(null);
    expect(paragraph?.attrs['textColor']).toBe(null);
  });

  it('parses data-bg-color and data-text-color from HTML', () => {
    const ed = makeEditor('<p data-bg-color="yellow" data-text-color="gray">Hi</p>');
    const p = ed.state.doc.firstChild;
    expect(p?.attrs['bgColor']).toBe('yellow');
    expect(p?.attrs['textColor']).toBe('gray');
  });

  it('does not inject attributes on unconfigured types', () => {
    // Reconfigure so only paragraph gets the attrs.
    const onlyParagraph = BlockColor.configure({ types: ['paragraph'] });
    host = document.createElement('div');
    host.className = 'dm-editor';
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: [Document, Text, Paragraph, Heading, onlyParagraph],
      content: '<h1>Heading</h1><p>Para</p>',
    });
    const h1 = editor.state.doc.child(0);
    const p = editor.state.doc.child(1);
    expect(h1.type.name).toBe('heading');
    expect('bgColor' in h1.attrs).toBe(false);
    expect('bgColor' in p.attrs).toBe(true);
  });
});

describe('BlockColor commands', () => {
  it('setBlockBgColor sets the attribute on the containing block', () => {
    const ed = makeEditor('<p>Hello</p>');
    const ok = ed.commands.setBlockBgColor('yellow');
    expect(ok).toBe(true);
    expect(ed.state.doc.firstChild?.attrs['bgColor']).toBe('yellow');
  });

  it('setBlockTextColor sets the attribute without touching bgColor', () => {
    const ed = makeEditor('<p data-bg-color="yellow">Hi</p>');
    ed.commands.setBlockTextColor('gray');
    const p = ed.state.doc.firstChild;
    expect(p?.attrs['textColor']).toBe('gray');
    expect(p?.attrs['bgColor']).toBe('yellow');
  });

  it('setBlockBgColor with null clears the attribute', () => {
    const ed = makeEditor('<p data-bg-color="yellow">Hi</p>');
    ed.commands.setBlockBgColor(null);
    expect(ed.state.doc.firstChild?.attrs['bgColor']).toBe(null);
  });

  it('unsetBlockColors clears both attributes', () => {
    const ed = makeEditor('<p data-bg-color="yellow" data-text-color="gray">Hi</p>');
    ed.commands.unsetBlockColors();
    const p = ed.state.doc.firstChild;
    expect(p?.attrs['bgColor']).toBe(null);
    expect(p?.attrs['textColor']).toBe(null);
  });

  it('setBlockBgColor rejects values outside the configured palette', () => {
    const ed = makeEditor('<p>Hello</p>');
    const ok = ed.commands.setBlockBgColor('not-a-real-color');
    expect(ok).toBe(false);
    expect(ed.state.doc.firstChild?.attrs['bgColor']).toBe(null);
  });

  it('targets the deepest typed ancestor when selection is nested', () => {
    const ed = makeEditor('<ul><li><p>Item</p></li></ul>');
    // Selection is inside the paragraph. The walk is deepest-first, so it
    // hits paragraph (depth 3) before listItem (depth 2) or bulletList
    // (depth 1). This keeps the command predictable for host code;
    // BlockContextMenu targets a specific block via its own position path.
    const ok = ed.commands.setBlockBgColor('blue');
    expect(ok).toBe(true);
    const ul = ed.state.doc.firstChild;
    const li = ul?.firstChild;
    const p = li?.firstChild;
    expect(p?.type.name).toBe('paragraph');
    expect(p?.attrs['bgColor']).toBe('blue');
    // Ancestors untouched.
    expect(li?.attrs['bgColor']).toBe(null);
    expect(ul?.attrs['bgColor']).toBe(null);
  });

  it('returns false when the selection is not inside a configured type', () => {
    const onlyParagraph = BlockColor.configure({ types: ['paragraph'] });
    host = document.createElement('div');
    host.className = 'dm-editor';
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: [Document, Text, Paragraph, Heading, onlyParagraph],
      content: '<h1>Heading</h1>',
    });
    // Selection starts at doc start (inside heading). heading isn't in types.
    const ok = editor.commands.setBlockBgColor('yellow');
    expect(ok).toBe(false);
  });
});

describe('BlockColor HTML serialization', () => {
  it('round-trips bgColor through getHTML', () => {
    const ed = makeEditor('<p>Hi</p>');
    ed.commands.setBlockBgColor('green');
    const html = ed.getHTML();
    expect(html).toContain('data-bg-color="green"');
  });

  it('omits the attribute when value is null', () => {
    const ed = makeEditor('<p>Hi</p>');
    const html = ed.getHTML();
    expect(html).not.toContain('data-bg-color');
    expect(html).not.toContain('data-text-color');
  });
});
