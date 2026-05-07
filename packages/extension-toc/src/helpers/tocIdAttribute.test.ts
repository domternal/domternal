import { afterEach, describe, expect, it } from 'vitest';
import {
  Editor,
  Document,
  Text,
  Paragraph,
  Heading,
  BaseKeymap,
  History,
} from '@domternal/core';
import { Extension } from '@domternal/core';
import { assignMissingTocIds } from './tocIdAttribute.js';

/**
 * Minimal Extension that adds a `tocId` attribute slot on `heading`.
 * The real `TableOfContents` extension does the same in 2e; we use a
 * standalone shim here so we can test `assignMissingTocIds` without
 * pulling the full extension's plugin lifecycle into scope.
 */
const TocIdAttrShim = Extension.create({
  name: 'tocIdAttrShim',
  addGlobalAttributes() {
    return [
      {
        types: ['heading'],
        attributes: {
          tocId: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-toc-id'),
            renderHTML: (attrs: Record<string, unknown>) => {
              const id = attrs['tocId'] as string | null;
              return id ? { 'data-toc-id': id } : null;
            },
          },
        },
      },
    ];
  },
});

const baseExtensions = [Document, Text, Paragraph, Heading, BaseKeymap, History, TocIdAttrShim];

const counterGenerator = (): (existingIds: ReadonlySet<string>) => string => {
  let n = 0;
  return () => `id-${String(++n)}`;
};

describe('assignMissingTocIds', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) editor.destroy();
    editor = undefined;
  });

  it('assigns a fresh ID to every heading without one', () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1>One</h1><h2>Two</h2><h3>Three</h3>',
    });
    const tr = editor.state.tr;
    assignMissingTocIds(editor.state.doc, tr, {
      anchorTypes: ['heading'],
      generateId: counterGenerator(),
    });
    expect(tr.docChanged).toBe(true);
    editor.view.dispatch(tr);

    const ids: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'heading') ids.push(node.attrs['tocId'] as string);
    });
    expect(ids).toEqual(['id-1', 'id-2', 'id-3']);
  });

  it('preserves existing tocId attributes carried in via parseHTML', () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1 data-toc-id="keep-me">Existing</h1><h2>Fresh</h2>',
    });
    const tr = editor.state.tr;
    assignMissingTocIds(editor.state.doc, tr, {
      anchorTypes: ['heading'],
      generateId: counterGenerator(),
    });
    editor.view.dispatch(tr);

    const ids: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'heading') ids.push(node.attrs['tocId'] as string);
    });
    // First heading keeps its loaded ID; second gets the first generated.
    expect(ids).toEqual(['keep-me', 'id-1']);
  });

  it('renames a duplicate when two headings share the same tocId on load (paste collision)', () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1 data-toc-id="dup">First</h1><h2 data-toc-id="dup">Second</h2>',
    });
    const tr = editor.state.tr;
    assignMissingTocIds(editor.state.doc, tr, {
      anchorTypes: ['heading'],
      generateId: counterGenerator(),
    });
    editor.view.dispatch(tr);

    const ids: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'heading') ids.push(node.attrs['tocId'] as string);
    });
    expect(ids[0]).toBe('dup');
    expect(ids[1]).not.toBe('dup');
    expect(ids[1]).toBe('id-1');
  });

  it('is a structural no-op (tr.docChanged === false) when every heading already has a unique tocId', () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1 data-toc-id="a">One</h1><h2 data-toc-id="b">Two</h2>',
    });
    const tr = editor.state.tr;
    assignMissingTocIds(editor.state.doc, tr, {
      anchorTypes: ['heading'],
      generateId: counterGenerator(),
    });
    expect(tr.docChanged).toBe(false);
  });

  it('skips collisions when the generator returns an in-use ID (loops until fresh)', () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<h1 data-toc-id="taken">First</h1><h2>Second</h2>',
    });
    // Generator: returns "taken" once (collision), then "fresh".
    let call = 0;
    const generator = (): string => {
      call += 1;
      return call === 1 ? 'taken' : 'fresh';
    };
    const tr = editor.state.tr;
    assignMissingTocIds(editor.state.doc, tr, {
      anchorTypes: ['heading'],
      generateId: generator,
    });
    editor.view.dispatch(tr);

    const ids: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'heading') ids.push(node.attrs['tocId'] as string);
    });
    expect(ids).toEqual(['taken', 'fresh']);
  });

  it('does not modify non-anchor node attrs (paragraphs stay untouched)', () => {
    editor = new Editor({
      extensions: baseExtensions,
      content: '<p>Plain</p><h1>Heading</h1>',
    });
    const tr = editor.state.tr;
    assignMissingTocIds(editor.state.doc, tr, {
      anchorTypes: ['heading'],
      generateId: counterGenerator(),
    });
    editor.view.dispatch(tr);

    const paragraph = editor.state.doc.firstChild!;
    expect(paragraph.type.name).toBe('paragraph');
    expect(paragraph.attrs['tocId']).toBeUndefined();
  });
});
