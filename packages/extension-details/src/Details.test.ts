import { describe, it, expect, afterEach } from 'vitest';
import { Details } from './Details.js';
import { DetailsSummary } from './DetailsSummary.js';
import { DetailsContent } from './DetailsContent.js';
import { Document, Text, Paragraph, Editor } from '@domternal/core';

const allExtensions = [Document, Text, Paragraph, Details, DetailsSummary, DetailsContent];

describe('Details', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(Details.name).toBe('details');
    });

    it('is a node type', () => {
      expect(Details.type).toBe('node');
    });

    it('belongs to block group', () => {
      expect(Details.config.group).toBe('block');
    });

    it('has correct content spec', () => {
      expect(Details.config.content).toBe('detailsSummary detailsContent');
    });

    it('is defining', () => {
      expect(Details.config.defining).toBe(true);
    });

    it('has default options', () => {
      expect(Details.options).toEqual({
        persist: false,
        openClassName: 'is-open',
        HTMLAttributes: {},
      });
    });

    it('can configure HTMLAttributes', () => {
      const Custom = Details.configure({ HTMLAttributes: { class: 'accordion' } });
      expect(Custom.options.HTMLAttributes).toEqual({ class: 'accordion' });
    });
  });

  describe('parseHTML', () => {
    it('returns rules for details tag and div[data-type="details"]', () => {
      const rules = Details.config.parseHTML?.call(Details);
      expect(rules).toEqual([
        { tag: 'details' },
        { tag: 'div[data-type="details"]' },
      ]);
    });
  });

  describe('renderHTML', () => {
    it('renders details element', () => {
      const spec = Details.createNodeSpec();
      const mockNode = { attrs: {} } as any;
      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, number];
      expect(result[0]).toBe('details');
      expect(result[2]).toBe(0);
    });

    it('merges HTMLAttributes from options', () => {
      const Custom = Details.configure({ HTMLAttributes: { class: 'styled' } });
      const spec = Custom.createNodeSpec();
      const mockNode = { attrs: {} } as any;
      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, number];
      expect(result[1]['class']).toBe('styled');
    });
  });
});

describe('DetailsSummary', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(DetailsSummary.name).toBe('detailsSummary');
    });

    it('is a node type', () => {
      expect(DetailsSummary.type).toBe('node');
    });

    it('has correct content spec', () => {
      expect(DetailsSummary.config.content).toBe('inline*');
    });

    it('is defining', () => {
      expect(DetailsSummary.config.defining).toBe(true);
    });

    it('has default options', () => {
      expect(DetailsSummary.options).toEqual({
        HTMLAttributes: {},
      });
    });
  });

  describe('parseHTML', () => {
    it('returns rule for summary tag', () => {
      const rules = DetailsSummary.config.parseHTML?.call(DetailsSummary);
      expect(rules).toEqual([{ tag: 'summary' }]);
    });
  });

  describe('renderHTML', () => {
    it('renders summary element', () => {
      const spec = DetailsSummary.createNodeSpec();
      const mockNode = { attrs: {} } as any;
      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, number];
      expect(result[0]).toBe('summary');
      expect(result[2]).toBe(0);
    });
  });
});

describe('DetailsContent', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(DetailsContent.name).toBe('detailsContent');
    });

    it('is a node type', () => {
      expect(DetailsContent.type).toBe('node');
    });

    it('has correct content spec', () => {
      expect(DetailsContent.config.content).toBe('block+');
    });

    it('is defining', () => {
      expect(DetailsContent.config.defining).toBe(true);
    });

    it('has default options', () => {
      expect(DetailsContent.options).toEqual({
        HTMLAttributes: {},
      });
    });
  });

  describe('parseHTML', () => {
    it('returns rules for div[data-details-content] and div[data-type="detailsContent"]', () => {
      const rules = DetailsContent.config.parseHTML?.call(DetailsContent);
      expect(rules).toEqual([
        { tag: 'div[data-details-content]' },
        { tag: 'div[data-type="detailsContent"]' },
      ]);
    });
  });

  describe('renderHTML', () => {
    it('renders div with data attribute', () => {
      const spec = DetailsContent.createNodeSpec();
      const mockNode = { attrs: {} } as any;
      const result = spec.toDOM?.(mockNode) as [string, Record<string, unknown>, number];
      expect(result[0]).toBe('div');
      expect(result[1]['data-details-content']).toBe('');
      expect(result[2]).toBe(0);
    });
  });
});

describe('integration', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('creates editor with details nodes registered', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Hello</p>',
    });

    expect(editor.state.schema.nodes['details']).toBeDefined();
    expect(editor.state.schema.nodes['detailsSummary']).toBeDefined();
    expect(editor.state.schema.nodes['detailsContent']).toBeDefined();
  });

  it('parses details HTML correctly', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content here</p></div></details>',
    });

    const doc = editor.state.doc;
    const details = doc.child(0);
    expect(details.type.name).toBe('details');
    expect(details.childCount).toBe(2);
    expect(details.child(0).type.name).toBe('detailsSummary');
    expect(details.child(0).textContent).toBe('Title');
    expect(details.child(1).type.name).toBe('detailsContent');
    expect(details.child(1).child(0).type.name).toBe('paragraph');
    expect(details.child(1).child(0).textContent).toBe('Content here');
  });

  it('renders details HTML correctly', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Body</p></div></details>',
    });

    const html = editor.getHTML();
    expect(html).toContain('<details>');
    expect(html).toContain('<summary>Title</summary>');
    expect(html).toContain('data-details-content');
    expect(html).toContain('<p>Body</p>');
    expect(html).toContain('</details>');
  });

  it('round-trips HTML correctly', () => {
    const input = '<details><summary>FAQ</summary><div data-details-content><p>Answer here</p></div></details>';

    editor = new Editor({
      extensions: allExtensions,
      content: input,
    });

    const html1 = editor.getHTML();
    editor.destroy();

    editor = new Editor({
      extensions: allExtensions,
      content: html1,
    });

    const html2 = editor.getHTML();
    expect(html1).toBe(html2);
  });

  it('supports multiple details blocks', () => {
    editor = new Editor({
      extensions: allExtensions,
      content:
        '<details><summary>Q1</summary><div data-details-content><p>A1</p></div></details>' +
        '<details><summary>Q2</summary><div data-details-content><p>A2</p></div></details>',
    });

    const doc = editor.state.doc;
    expect(doc.childCount).toBe(2);
    expect(doc.child(0).type.name).toBe('details');
    expect(doc.child(1).type.name).toBe('details');
    expect(doc.child(0).child(0).textContent).toBe('Q1');
    expect(doc.child(1).child(0).textContent).toBe('Q2');
  });

  it('supports multiple blocks in content', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Para 1</p><p>Para 2</p></div></details>',
    });

    const content = editor.state.doc.child(0).child(1);
    expect(content.childCount).toBe(2);
    expect(content.child(0).textContent).toBe('Para 1');
    expect(content.child(1).textContent).toBe('Para 2');
  });

  it('applies custom HTMLAttributes on details', () => {
    const CustomDetails = Details.configure({ HTMLAttributes: { class: 'faq' } });
    editor = new Editor({
      extensions: [Document, Text, Paragraph, CustomDetails, DetailsSummary, DetailsContent],
      content: '<details><summary>Q</summary><div data-details-content><p>A</p></div></details>',
    });

    const html = editor.getHTML();
    expect(html).toContain('class="faq"');
  });
});

describe('commands', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('provides setDetails command', () => {
    const commands = Details.config.addCommands?.call(Details);
    expect(commands).toHaveProperty('setDetails');
    expect(typeof commands?.['setDetails']).toBe('function');
  });

  it('provides unsetDetails command', () => {
    const commands = Details.config.addCommands?.call(Details);
    expect(commands).toHaveProperty('unsetDetails');
  });

  it('provides toggleDetails command', () => {
    const commands = Details.config.addCommands?.call(Details);
    expect(commands).toHaveProperty('toggleDetails');
  });

  it('setDetails wraps paragraph in details', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Some text</p>',
    });

    // Select inside the paragraph
    const $pos = editor.state.doc.resolve(1);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        (editor.state.selection.constructor as any).near($pos)
      )
    );

    const result = editor.commands.setDetails();
    expect(result).toBe(true);

    const doc = editor.state.doc;
    const details = doc.child(0);
    expect(details.type.name).toBe('details');
    expect(details.child(0).type.name).toBe('detailsSummary');
    expect(details.child(1).type.name).toBe('detailsContent');
    expect(details.child(1).child(0).textContent).toBe('Some text');
  });

  it('unsetDetails extracts content from details', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Inner text</p></div></details>',
    });

    // Place cursor inside the details content
    const doc = editor.state.doc;
    const contentPos = doc.child(0).child(0).nodeSize + 1 + 1; // past summary, into content
    const $pos = editor.state.doc.resolve(contentPos);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        (editor.state.selection.constructor as any).near($pos)
      )
    );

    const result = editor.commands.unsetDetails();
    expect(result).toBe(true);

    const newDoc = editor.state.doc;
    // unsetDetails preserves the summary content as a paragraph, followed by content blocks
    expect(newDoc.child(0).type.name).toBe('paragraph');
    expect(newDoc.child(0).textContent).toBe('Title');
    expect(newDoc.child(1).type.name).toBe('paragraph');
    expect(newDoc.child(1).textContent).toBe('Inner text');
  });

  it('setDetails does nothing when already inside details', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    // Place cursor inside the details content
    const detailsContentStart = editor.state.doc.child(0).child(0).nodeSize + 1 + 1;
    const $pos = editor.state.doc.resolve(detailsContentStart);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        (editor.state.selection.constructor as any).near($pos)
      )
    );

    const result = editor.commands.setDetails();
    expect(result).toBe(false);
  });

  it('toggleDetails wraps when not in details', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Toggle me</p>',
    });

    const result = editor.commands.toggleDetails();
    expect(result).toBe(true);

    expect(editor.state.doc.child(0).type.name).toBe('details');
  });

  it('toggleDetails unwraps when in details', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    // Place cursor inside details content
    const detailsContentStart = editor.state.doc.child(0).child(0).nodeSize + 1 + 1;
    const $pos = editor.state.doc.resolve(detailsContentStart);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        (editor.state.selection.constructor as any).near($pos)
      )
    );

    const result = editor.commands.toggleDetails();
    expect(result).toBe(true);

    expect(editor.state.doc.child(0).type.name).toBe('paragraph');
  });

  it('provides openDetails command', () => {
    const commands = Details.config.addCommands?.call(Details);
    expect(commands).toHaveProperty('openDetails');
    expect(typeof commands?.['openDetails']).toBe('function');
  });

  it('provides closeDetails command', () => {
    const commands = Details.config.addCommands?.call(Details);
    expect(commands).toHaveProperty('closeDetails');
    expect(typeof commands?.['closeDetails']).toBe('function');
  });
});

describe('schema flags', () => {
  it('Details has isolating: true', () => {
    expect(Details.config.isolating).toBe(true);
  });

  it('DetailsSummary has isolating: true', () => {
    expect(DetailsSummary.config.isolating).toBe(true);
  });

  it('DetailsSummary has selectable: false', () => {
    expect(DetailsSummary.config.selectable).toBe(false);
  });

  it('DetailsContent has selectable: false', () => {
    expect(DetailsContent.config.selectable).toBe(false);
  });

  it('Details schema node has isolating flag', () => {
    const editor = new Editor({
      extensions: allExtensions,
      content: '<p>test</p>',
    });

    expect(editor.state.schema.nodes['details']!.spec.isolating).toBe(true);
    editor.destroy();
  });

  it('DetailsSummary schema node has isolating flag', () => {
    const editor = new Editor({
      extensions: allExtensions,
      content: '<p>test</p>',
    });

    expect(editor.state.schema.nodes['detailsSummary']!.spec.isolating).toBe(true);
    editor.destroy();
  });
});

describe('persist option', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('does not add open attribute by default', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const details = editor.state.doc.child(0);
    expect(details.attrs['open']).toBeUndefined();
  });

  it('adds open attribute when persist is enabled', () => {
    const PersistDetails = Details.configure({ persist: true });
    editor = new Editor({
      extensions: [Document, Text, Paragraph, PersistDetails, DetailsSummary, DetailsContent],
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const details = editor.state.doc.child(0);
    expect(details.attrs['open']).toBe(false);
  });

  it('parses open attribute from HTML when persist is enabled', () => {
    const PersistDetails = Details.configure({ persist: true });
    editor = new Editor({
      extensions: [Document, Text, Paragraph, PersistDetails, DetailsSummary, DetailsContent],
      content: '<details open><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const details = editor.state.doc.child(0);
    expect(details.attrs['open']).toBe(true);
  });

  it('openDetails returns false when persist is disabled', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    // Place cursor inside details
    const $pos = editor.state.doc.resolve(2);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        (editor.state.selection.constructor as any).near($pos)
      )
    );

    const result = editor.commands.openDetails();
    expect(result).toBe(false);
  });

  it('closeDetails returns false when persist is disabled', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const $pos = editor.state.doc.resolve(2);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        (editor.state.selection.constructor as any).near($pos)
      )
    );

    const result = editor.commands.closeDetails();
    expect(result).toBe(false);
  });

  it('openDetails opens a closed details when persist is enabled', () => {
    const PersistDetails = Details.configure({ persist: true });
    editor = new Editor({
      extensions: [Document, Text, Paragraph, PersistDetails, DetailsSummary, DetailsContent],
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    // Place cursor inside the summary
    const $pos = editor.state.doc.resolve(2);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        (editor.state.selection.constructor as any).near($pos)
      )
    );

    const result = editor.commands.openDetails();
    expect(result).toBe(true);
    expect(editor.state.doc.child(0).attrs['open']).toBe(true);
  });

  it('closeDetails closes an open details when persist is enabled', () => {
    const PersistDetails = Details.configure({ persist: true });
    editor = new Editor({
      extensions: [Document, Text, Paragraph, PersistDetails, DetailsSummary, DetailsContent],
      content: '<details open><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const $pos = editor.state.doc.resolve(2);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        (editor.state.selection.constructor as any).near($pos)
      )
    );

    const result = editor.commands.closeDetails();
    expect(result).toBe(true);
    expect(editor.state.doc.child(0).attrs['open']).toBe(false);
  });

  it('openDetails returns false when already open', () => {
    const PersistDetails = Details.configure({ persist: true });
    editor = new Editor({
      extensions: [Document, Text, Paragraph, PersistDetails, DetailsSummary, DetailsContent],
      content: '<details open><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const $pos = editor.state.doc.resolve(2);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        (editor.state.selection.constructor as any).near($pos)
      )
    );

    const result = editor.commands.openDetails();
    expect(result).toBe(false);
  });

  it('closeDetails returns false when already closed', () => {
    const PersistDetails = Details.configure({ persist: true });
    editor = new Editor({
      extensions: [Document, Text, Paragraph, PersistDetails, DetailsSummary, DetailsContent],
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const $pos = editor.state.doc.resolve(2);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        (editor.state.selection.constructor as any).near($pos)
      )
    );

    const result = editor.commands.closeDetails();
    expect(result).toBe(false);
  });
});

describe('Tiptap compatibility parsing', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('parses div[data-type="details"] format', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<div data-type="details"><summary>Title</summary><div data-type="detailsContent"><p>Body</p></div></div>',
    });

    const doc = editor.state.doc;
    const details = doc.child(0);
    expect(details.type.name).toBe('details');
    expect(details.child(0).type.name).toBe('detailsSummary');
    expect(details.child(0).textContent).toBe('Title');
    expect(details.child(1).type.name).toBe('detailsContent');
    expect(details.child(1).child(0).textContent).toBe('Body');
  });

  it('parses native <details> format', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Native</summary><div data-details-content><p>Works</p></div></details>',
    });

    const details = editor.state.doc.child(0);
    expect(details.type.name).toBe('details');
    expect(details.child(0).textContent).toBe('Native');
    expect(details.child(1).child(0).textContent).toBe('Works');
  });

  it('outputs semantic <details> HTML regardless of input format', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<div data-type="details"><summary>Title</summary><div data-type="detailsContent"><p>Body</p></div></div>',
    });

    const html = editor.getHTML();
    expect(html).toContain('<details>');
    expect(html).toContain('<summary>');
    expect(html).toContain('</details>');
  });
});

describe('openClassName option', () => {
  it('defaults to is-open', () => {
    expect(Details.options.openClassName).toBe('is-open');
  });

  it('can be configured', () => {
    const Custom = Details.configure({ openClassName: 'expanded' });
    expect(Custom.options.openClassName).toBe('expanded');
  });
});

describe('keyboard shortcuts', () => {
  it('Details defines Backspace shortcut', () => {
    const shortcuts = Details.config.addKeyboardShortcuts?.call(Details);
    expect(shortcuts).toHaveProperty('Backspace');
  });

  it('Details defines Enter shortcut', () => {
    const shortcuts = Details.config.addKeyboardShortcuts?.call(Details);
    expect(shortcuts).toHaveProperty('Enter');
  });

  it('Details defines ArrowRight shortcut', () => {
    const shortcuts = Details.config.addKeyboardShortcuts?.call(Details);
    expect(shortcuts).toHaveProperty('ArrowRight');
  });

  it('Details defines ArrowDown shortcut', () => {
    const shortcuts = Details.config.addKeyboardShortcuts?.call(Details);
    expect(shortcuts).toHaveProperty('ArrowDown');
  });

  it('DetailsContent defines Enter shortcut for double-Enter escape', () => {
    const shortcuts = DetailsContent.config.addKeyboardShortcuts?.call(DetailsContent);
    expect(shortcuts).toHaveProperty('Enter');
  });
});

describe('NodeViews', () => {
  it('Details defines addNodeView', () => {
    expect(Details.config.addNodeView).toBeDefined();
    expect(typeof Details.config.addNodeView).toBe('function');
  });

  it('DetailsContent defines addNodeView', () => {
    expect(DetailsContent.config.addNodeView).toBeDefined();
    expect(typeof DetailsContent.config.addNodeView).toBe('function');
  });
});

describe('ProseMirror plugins', () => {
  it('Details defines addProseMirrorPlugins', () => {
    expect(Details.config.addProseMirrorPlugins).toBeDefined();
    expect(typeof Details.config.addProseMirrorPlugins).toBe('function');
  });
});

describe('unsetDetails preserves summary', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('preserves summary text as a paragraph when unwrapping', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Summary text</summary><div data-details-content><p>Body paragraph</p></div></details>',
    });

    // Place cursor inside summary
    const $pos = editor.state.doc.resolve(2);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        (editor.state.selection.constructor as any).near($pos)
      )
    );

    editor.commands.unsetDetails();

    const doc = editor.state.doc;
    expect(doc.childCount).toBe(2);
    expect(doc.child(0).type.name).toBe('paragraph');
    expect(doc.child(0).textContent).toBe('Summary text');
    expect(doc.child(1).type.name).toBe('paragraph');
    expect(doc.child(1).textContent).toBe('Body paragraph');
  });

  it('preserves multiple content blocks when unwrapping', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>First</p><p>Second</p></div></details>',
    });

    const $pos = editor.state.doc.resolve(2);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        (editor.state.selection.constructor as any).near($pos)
      )
    );

    editor.commands.unsetDetails();

    const doc = editor.state.doc;
    expect(doc.childCount).toBe(3);
    expect(doc.child(0).textContent).toBe('Title');
    expect(doc.child(1).textContent).toBe('First');
    expect(doc.child(2).textContent).toBe('Second');
  });

  it('skips empty summary when unwrapping', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary></summary><div data-details-content><p>Content only</p></div></details>',
    });

    const $pos = editor.state.doc.resolve(2);
    editor.view.dispatch(
      editor.state.tr.setSelection(
        (editor.state.selection.constructor as any).near($pos)
      )
    );

    editor.commands.unsetDetails();

    const doc = editor.state.doc;
    expect(doc.child(0).type.name).toBe('paragraph');
    expect(doc.child(0).textContent).toBe('Content only');
  });
});
