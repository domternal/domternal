import { afterEach, describe, expect, it } from 'vitest';
import {
  Editor,
  Document,
  Text,
  Paragraph,
  Heading,
  Blockquote,
  BulletList,
  ListItem,
  BaseKeymap,
  History,
} from '@domternal/core';
import { walkHeadings } from './headingWalk.js';

const baseExtensions = [Document, Text, Paragraph, Heading, BaseKeymap, History];
const defaultOptions = { levels: [1, 2, 3], anchorTypes: ['heading'] };

describe('walkHeadings', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
    editor = undefined;
  });

  it('returns one entry per top-level heading in document order', () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>Alpha</h1><h2>Beta</h2><h3>Gamma</h3>',
    });
    const entries = walkHeadings(editor.state.doc, defaultOptions);
    expect(entries.map((e) => ({ level: e.level, text: e.textContent }))).toEqual([
      { level: 1, text: 'Alpha' },
      { level: 2, text: 'Beta' },
      { level: 3, text: 'Gamma' },
    ]);
  });

  it('skips levels not in the filter', () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>Alpha</h1><h2>Beta</h2><h3>Gamma</h3>',
    });
    const entries = walkHeadings(editor.state.doc, { levels: [2], anchorTypes: ['heading'] });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe(2);
    expect(entries[0]?.textContent).toBe('Beta');
  });

  it('returns empty array when document has no headings', () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<p>Just a paragraph</p><p>Another</p>',
    });
    expect(walkHeadings(editor.state.doc, defaultOptions)).toEqual([]);
  });

  it('finds headings nested inside a blockquote', () => {
    editor = new Editor({
      extensions: [...baseExtensions, Blockquote],
      content: '<p>Lead</p><blockquote><h2>Quoted</h2></blockquote><h3>Trailing</h3>',
    });
    const entries = walkHeadings(editor.state.doc, defaultOptions);
    expect(entries.map((e) => e.textContent)).toEqual(['Quoted', 'Trailing']);
  });

  it('finds headings nested inside list items (Notion-style)', () => {
    editor = new Editor({
      extensions: [...baseExtensions, BulletList, ListItem],
      content: '<ul><li><p>Item</p><h2>Nested heading</h2></li></ul>',
    });
    const entries = walkHeadings(editor.state.doc, defaultOptions);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.level).toBe(2);
    expect(entries[0]?.textContent).toBe('Nested heading');
  });

  it('returns id="" when the heading has no id attribute (UniqueID not loaded)', () => {
    // Without UniqueID extension loaded, headings have no id slot.
    // The walk reports id: '' so callers know to either filter or
    // surface them as "unanchored" entries.
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>No id yet</h1>',
    });
    const entries = walkHeadings(editor.state.doc, defaultOptions);
    expect(entries[0]?.id).toBe('');
  });

  it('reads the id from a custom attrName when UniqueID is configured with one', () => {
    // Simulate UniqueID.configure({ attributeName: 'data-id' }): the
    // walk should read the heading's `data-id` attribute. We can't
    // easily register a custom global attribute in this isolated test,
    // so this test verifies the parameter plumbing rather than schema
    // integration (the latter is covered by TableOfContents.test.ts).
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>Heading</h1>',
    });
    const entries = walkHeadings(editor.state.doc, {
      levels: [1, 2, 3],
      anchorTypes: ['heading'],
      attrName: 'somethingElse',
    });
    // No `somethingElse` attribute on the schema, so the read returns
    // undefined and the walk reports id: ''. The contract is exercised
    // (no crash on missing attr) regardless.
    expect(entries[0]?.id).toBe('');
  });

  it('reports the heading position (used for click-to-scroll)', () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<p>Lead</p><h1>Target</h1><p>Trailing</p>',
    });
    const entries = walkHeadings(editor.state.doc, defaultOptions);
    expect(entries).toHaveLength(1);
    // Doc is `<p>Lead</p><h1>Target</h1><p>Trailing</p>` so the heading
    // starts after the lead paragraph (4 chars for "Lead" + 2 wrapper
    // tokens = pos 6). Exact value is schema-dependent; the contract
    // is that pos > 0 and points at the heading's start in the doc.
    expect(entries[0]?.pos).toBeGreaterThan(0);
  });

  it('honors a custom anchorTypes set (mock heading-like node name)', () => {
    // We cannot easily register a fake node here, so we exercise the
    // filter by passing an anchorTypes set that excludes 'heading'.
    // Result: even though the document contains real headings, the walk
    // returns nothing.
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>Real heading</h1>',
    });
    const entries = walkHeadings(editor.state.doc, {
      levels: [1, 2, 3],
      anchorTypes: ['someOtherCustomNode'],
    });
    expect(entries).toEqual([]);
  });
});
