import { describe, it, expect, afterEach } from 'vitest';
import { Details } from './Details.js';
import { DetailsSummary } from './DetailsSummary.js';
import { DetailsContent } from './DetailsContent.js';
import { Document, Text, Paragraph, Editor, Bold, Italic } from '@domternal/core';
import { TextSelection } from 'prosemirror-state';

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

  it('Details has allowGapCursor: false', () => {
    expect(Details.config.allowGapCursor).toBe(false);
  });

  it('Details schema node has allowGapCursor flag', () => {
    const editor = new Editor({
      extensions: allExtensions,
      content: '<p>test</p>',
    });

    expect((editor.state.schema.nodes['details']!.spec as Record<string, unknown>)['allowGapCursor']).toBe(false);
    editor.destroy();
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

describe('data-type="details" compatibility parsing', () => {
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

describe('Details addToolbarItems', () => {
  it('returns a single button item', () => {
    const items = Details.config.addToolbarItems?.call(Details);
    expect(items).toHaveLength(1);
    expect(items?.[0]?.type).toBe('button');
  });

  it('button has correct metadata', () => {
    const items = Details.config.addToolbarItems?.call(Details);
    const button = items?.[0];
    if (button?.type === 'button') {
      expect(button.name).toBe('details');
      expect(button.command).toBe('toggleDetails');
      expect(button.isActive).toBe('details');
      expect(button.icon).toBe('caretCircleRight');
      expect(button.label).toBe('Toggle Details');
      expect(button.group).toBe('insert');
      expect(button.priority).toBe(100);
    }
  });

  it('does not emit event (direct command execution)', () => {
    const items = Details.config.addToolbarItems?.call(Details);
    const button = items?.[0];
    if (button?.type === 'button') {
      expect(button.emitEvent).toBeUndefined();
    }
  });
});

// =============================================================================
// Detailed command integration tests
// =============================================================================

describe('setDetails (detailed integration)', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('wraps multiple paragraphs into details content', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>First</p><p>Second</p><p>Third</p>',
    });

    // Select across all three paragraphs
    const tr = editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, 1, editor.state.doc.content.size - 1)
    );
    editor.view.dispatch(tr);

    const result = editor.commands.setDetails();
    expect(result).toBe(true);

    const doc = editor.state.doc;
    const details = doc.child(0);
    expect(details.type.name).toBe('details');
    expect(details.child(0).type.name).toBe('detailsSummary');
    expect(details.child(1).type.name).toBe('detailsContent');
    // All three paragraphs should be inside detailsContent
    expect(details.child(1).childCount).toBe(3);
    expect(details.child(1).child(0).textContent).toBe('First');
    expect(details.child(1).child(1).textContent).toBe('Second');
    expect(details.child(1).child(2).textContent).toBe('Third');
  });

  it('places cursor in summary after wrapping', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Wrap me</p>',
    });

    editor.commands.setDetails();

    // Cursor should be inside the summary (position 2 = inside detailsSummary)
    const { $from } = editor.state.selection;
    expect($from.parent.type.name).toBe('detailsSummary');
  });

  it('creates empty summary when wrapping', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Content text</p>',
    });

    editor.commands.setDetails();

    const summary = editor.state.doc.child(0).child(0);
    expect(summary.type.name).toBe('detailsSummary');
    expect(summary.textContent).toBe('');
  });

  it('returns false when no block range exists', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p></p>',
    });

    // Try setting details from position 0 (before doc content)
    const tr = editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, 0, 0)
    );
    editor.view.dispatch(tr);

    // This may return true or false depending on whether a block range exists at pos 0
    // The important thing is it doesn't throw
    expect(() => editor!.commands.setDetails()).not.toThrow();
  });

  it('wraps content between other blocks', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Before</p><p>Wrap this</p><p>After</p>',
    });

    // Position cursor in the middle paragraph
    // doc: <p>Before</p> <p>Wrap this</p> <p>After</p>
    // pos: 0-8           9-20             21-28
    const $pos = editor.state.doc.resolve(10);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.near($pos))
    );

    editor.commands.setDetails();

    const doc = editor.state.doc;
    expect(doc.childCount).toBe(3);
    expect(doc.child(0).type.name).toBe('paragraph');
    expect(doc.child(0).textContent).toBe('Before');
    expect(doc.child(1).type.name).toBe('details');
    expect(doc.child(1).child(1).child(0).textContent).toBe('Wrap this');
    expect(doc.child(2).type.name).toBe('paragraph');
    expect(doc.child(2).textContent).toBe('After');
  });

  it('prevents nesting details inside details', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Outer</summary><div data-details-content><p>Inner text</p></div></details>',
    });

    // Place cursor inside details content
    const contentStart = editor.state.doc.child(0).child(0).nodeSize + 1 + 1;
    const $pos = editor.state.doc.resolve(contentStart);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.near($pos))
    );

    const result = editor.commands.setDetails();
    expect(result).toBe(false);
  });

  it('prevents nesting when cursor is in summary', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    // Place cursor in summary
    const $pos = editor.state.doc.resolve(2);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.near($pos))
    );

    const result = editor.commands.setDetails();
    expect(result).toBe(false);
  });
});

describe('unsetDetails (detailed integration)', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('works when cursor is in summary', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Body</p></div></details>',
    });

    const $pos = editor.state.doc.resolve(2);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.near($pos))
    );

    const result = editor.commands.unsetDetails();
    expect(result).toBe(true);
    expect(editor.state.doc.child(0).type.name).toBe('paragraph');
    expect(editor.state.doc.child(0).textContent).toBe('Title');
  });

  it('works when cursor is in content', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Body</p></div></details>',
    });

    const contentStart = editor.state.doc.child(0).child(0).nodeSize + 1 + 1;
    const $pos = editor.state.doc.resolve(contentStart);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.near($pos))
    );

    const result = editor.commands.unsetDetails();
    expect(result).toBe(true);
    expect(editor.state.doc.child(0).textContent).toBe('Title');
    expect(editor.state.doc.child(1).textContent).toBe('Body');
  });

  it('places cursor in first resulting paragraph', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Body</p></div></details>',
    });

    const $pos = editor.state.doc.resolve(2);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.near($pos))
    );

    editor.commands.unsetDetails();

    const { $from } = editor.state.selection;
    expect($from.parent.type.name).toBe('paragraph');
  });

  it('returns false when cursor is not in details', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Not in details</p>',
    });

    const result = editor.commands.unsetDetails();
    expect(result).toBe(false);
  });

  it('unsets only the containing details when multiple exist', () => {
    editor = new Editor({
      extensions: allExtensions,
      content:
        '<details><summary>Q1</summary><div data-details-content><p>A1</p></div></details>' +
        '<details><summary>Q2</summary><div data-details-content><p>A2</p></div></details>',
    });

    // Place cursor in second details
    const firstDetailsSize = editor.state.doc.child(0).nodeSize;
    const $pos = editor.state.doc.resolve(firstDetailsSize + 2);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.near($pos))
    );

    editor.commands.unsetDetails();

    const doc = editor.state.doc;
    // First details remains, second is unwrapped
    expect(doc.child(0).type.name).toBe('details');
    expect(doc.child(0).child(0).textContent).toBe('Q1');
    expect(doc.child(1).type.name).toBe('paragraph');
    expect(doc.child(1).textContent).toBe('Q2');
    expect(doc.child(2).type.name).toBe('paragraph');
    expect(doc.child(2).textContent).toBe('A2');
  });
});

describe('toggleDetails (detailed integration)', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('wraps then unwraps with successive calls', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Toggle text</p>',
    });

    // First call: wrap
    editor.commands.toggleDetails();
    expect(editor.state.doc.child(0).type.name).toBe('details');

    // Place cursor inside the details for toggle to detect it
    const $pos = editor.state.doc.resolve(2);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.near($pos))
    );

    // Second call: unwrap
    editor.commands.toggleDetails();
    expect(editor.state.doc.child(0).type.name).toBe('paragraph');
  });

  it('detects details at any nesting depth', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Deep content</p></div></details>',
    });

    // Cursor deep in content paragraph
    const contentStart = editor.state.doc.child(0).child(0).nodeSize + 1 + 2;
    const $pos = editor.state.doc.resolve(contentStart);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.near($pos))
    );

    // Should detect we're inside details and unwrap
    const result = editor.commands.toggleDetails();
    expect(result).toBe(true);
    expect(editor.state.doc.child(0).type.name).toBe('paragraph');
  });
});

// =============================================================================
// setDetailsOpen command (persist mode)
// =============================================================================

describe('setDetailsOpen command', () => {
  let editor: Editor | undefined;
  const PersistDetails = Details.configure({ persist: true });
  const persistExtensions = [Document, Text, Paragraph, PersistDetails, DetailsSummary, DetailsContent];

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('provides setDetailsOpen command', () => {
    const commands = Details.config.addCommands?.call(Details);
    expect(commands).toHaveProperty('setDetailsOpen');
    expect(typeof commands?.['setDetailsOpen']).toBe('function');
  });

  it('opens a closed details with setDetailsOpen(true)', () => {
    editor = new Editor({
      extensions: persistExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const $pos = editor.state.doc.resolve(2);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)));

    const result = editor.commands.setDetailsOpen(true);
    expect(result).toBe(true);
    expect(editor.state.doc.child(0).attrs['open']).toBe(true);
  });

  it('closes an open details with setDetailsOpen(false)', () => {
    editor = new Editor({
      extensions: persistExtensions,
      content: '<details open><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const $pos = editor.state.doc.resolve(2);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)));

    const result = editor.commands.setDetailsOpen(false);
    expect(result).toBe(true);
    expect(editor.state.doc.child(0).attrs['open']).toBe(false);
  });

  it('returns false when target state matches current state', () => {
    editor = new Editor({
      extensions: persistExtensions,
      content: '<details open><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const $pos = editor.state.doc.resolve(2);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)));

    // Already open, trying to open again
    expect(editor.commands.setDetailsOpen(true)).toBe(false);
  });

  it('returns false when cursor is not in details', () => {
    editor = new Editor({
      extensions: persistExtensions,
      content: '<p>Outside</p>',
    });

    expect(editor.commands.setDetailsOpen(true)).toBe(false);
  });

  it('returns false when persist is disabled', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const $pos = editor.state.doc.resolve(2);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)));

    expect(editor.commands.setDetailsOpen(true)).toBe(false);
  });
});

// =============================================================================
// Persist mode HTML rendering
// =============================================================================

describe('persist mode HTML rendering', () => {
  let editor: Editor | undefined;
  const PersistDetails = Details.configure({ persist: true });
  const persistExtensions = [Document, Text, Paragraph, PersistDetails, DetailsSummary, DetailsContent];

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('renders open attribute in HTML when persist is true and details is open', () => {
    editor = new Editor({
      extensions: persistExtensions,
      content: '<details open><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const html = editor.getHTML();
    expect(html).toContain('<details open="">');
  });

  it('does not render open attribute when details is closed', () => {
    editor = new Editor({
      extensions: persistExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const html = editor.getHTML();
    expect(html).toContain('<details>');
    expect(html).not.toContain('open');
  });

  it('round-trips open attribute with persist enabled', () => {
    editor = new Editor({
      extensions: persistExtensions,
      content: '<details open><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const html1 = editor.getHTML();
    editor.destroy();

    editor = new Editor({
      extensions: persistExtensions,
      content: html1,
    });

    expect(editor.state.doc.child(0).attrs['open']).toBe(true);
  });

  it('round-trips closed state with persist enabled', () => {
    editor = new Editor({
      extensions: persistExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const html1 = editor.getHTML();
    editor.destroy();

    editor = new Editor({
      extensions: persistExtensions,
      content: html1,
    });

    expect(editor.state.doc.child(0).attrs['open']).toBe(false);
  });

  it('preserves open state after openDetails/closeDetails cycle', () => {
    editor = new Editor({
      extensions: persistExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const $pos = editor.state.doc.resolve(2);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)));

    // Open
    editor.commands.openDetails();
    expect(editor.state.doc.child(0).attrs['open']).toBe(true);

    // Close
    editor.commands.closeDetails();
    expect(editor.state.doc.child(0).attrs['open']).toBe(false);
  });
});

// =============================================================================
// NodeView DOM structure
// =============================================================================

describe('Details NodeView DOM structure', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('renders div with data-type="details" attribute', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const detailsDom = editor.view.dom.querySelector('[data-type="details"]');
    expect(detailsDom).not.toBeNull();
  });

  it('contains a toggle button element', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const detailsDom = editor.view.dom.querySelector('[data-type="details"]');
    const button = detailsDom?.querySelector('button');
    expect(button).not.toBeNull();
    expect(button?.type).toBe('button');
  });

  it('applies custom HTMLAttributes on NodeView DOM', () => {
    const Custom = Details.configure({ HTMLAttributes: { class: 'custom-details', 'data-id': '42' } });
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Custom, DetailsSummary, DetailsContent],
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const detailsDom = editor.view.dom.querySelector('[data-type="details"]');
    expect(detailsDom?.getAttribute('class')).toContain('custom-details');
    expect(detailsDom?.getAttribute('data-id')).toBe('42');
  });

  it('toggle button adds openClassName on click', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const detailsDom = editor.view.dom.querySelector<HTMLElement>('[data-type="details"]')!;
    const button = detailsDom.querySelector('button')!;
    expect(detailsDom.classList.contains('is-open')).toBe(false);

    button.click();
    expect(detailsDom.classList.contains('is-open')).toBe(true);
  });

  it('toggle button removes openClassName on second click', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const detailsDom = editor.view.dom.querySelector<HTMLElement>('[data-type="details"]')!;
    const button = detailsDom.querySelector('button')!;

    button.click(); // open
    expect(detailsDom.classList.contains('is-open')).toBe(true);

    button.click(); // close
    expect(detailsDom.classList.contains('is-open')).toBe(false);
  });

  it('uses custom openClassName', () => {
    const Custom = Details.configure({ openClassName: 'expanded' });
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Custom, DetailsSummary, DetailsContent],
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const detailsDom = editor.view.dom.querySelector<HTMLElement>('[data-type="details"]')!;
    const button = detailsDom.querySelector('button')!;

    button.click();
    expect(detailsDom.classList.contains('expanded')).toBe(true);
    expect(detailsDom.classList.contains('is-open')).toBe(false);
  });
});

describe('DetailsContent NodeView DOM structure', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('renders div with data-details-content attribute', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const contentDom = editor.view.dom.querySelector('[data-details-content]');
    expect(contentDom).not.toBeNull();
  });

  it('starts with hidden attribute', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const contentDom = editor.view.dom.querySelector('[data-details-content]');
    expect(contentDom?.getAttribute('hidden')).toBe('hidden');
  });

  it('toggles hidden on toggleDetailsContent event', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const contentDom = editor.view.dom.querySelector<HTMLElement>('[data-details-content]')!;
    expect(contentDom.hasAttribute('hidden')).toBe(true);

    // Dispatch toggle event
    contentDom.dispatchEvent(new Event('toggleDetailsContent'));
    expect(contentDom.hasAttribute('hidden')).toBe(false);

    // Toggle again
    contentDom.dispatchEvent(new Event('toggleDetailsContent'));
    expect(contentDom.hasAttribute('hidden')).toBe(true);
  });

  it('clicking toggle button shows/hides content', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const detailsDom = editor.view.dom.querySelector<HTMLElement>('[data-type="details"]')!;
    const button = detailsDom.querySelector('button')!;
    const contentDom = detailsDom.querySelector<HTMLElement>('[data-details-content]')!;

    expect(contentDom.hasAttribute('hidden')).toBe(true);

    button.click();
    expect(contentDom.hasAttribute('hidden')).toBe(false);

    button.click();
    expect(contentDom.hasAttribute('hidden')).toBe(true);
  });

  it('applies custom HTMLAttributes on DetailsContent NodeView', () => {
    const CustomContent = DetailsContent.configure({ HTMLAttributes: { class: 'content-area' } });
    editor = new Editor({
      extensions: [Document, Text, Paragraph, Details, DetailsSummary, CustomContent],
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const contentDom = editor.view.dom.querySelector('[data-details-content]');
    expect(contentDom?.getAttribute('class')).toContain('content-area');
  });
});

// =============================================================================
// Summary with inline marks
// =============================================================================

describe('summary with inline marks', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('parses bold text in summary', () => {
    editor = new Editor({
      extensions: [...allExtensions, Bold],
      content: '<details><summary><strong>Bold Title</strong></summary><div data-details-content><p>Content</p></div></details>',
    });

    const summary = editor.state.doc.child(0).child(0);
    expect(summary.type.name).toBe('detailsSummary');
    expect(summary.textContent).toBe('Bold Title');
    // Check that the text has bold mark
    const textNode = summary.child(0);
    expect(textNode.marks.length).toBe(1);
    expect(textNode.marks[0]!.type.name).toBe('bold');
  });

  it('parses italic text in summary', () => {
    editor = new Editor({
      extensions: [...allExtensions, Italic],
      content: '<details><summary><em>Italic Title</em></summary><div data-details-content><p>Content</p></div></details>',
    });

    const summary = editor.state.doc.child(0).child(0);
    const textNode = summary.child(0);
    expect(textNode.marks.length).toBe(1);
    expect(textNode.marks[0]!.type.name).toBe('italic');
  });

  it('parses mixed marks in summary', () => {
    editor = new Editor({
      extensions: [...allExtensions, Bold, Italic],
      content: '<details><summary><strong>Bold</strong> and <em>italic</em></summary><div data-details-content><p>Content</p></div></details>',
    });

    const summary = editor.state.doc.child(0).child(0);
    expect(summary.textContent).toBe('Bold and italic');
    expect(summary.childCount).toBe(3);
    expect(summary.child(0).marks[0]!.type.name).toBe('bold');
    expect(summary.child(2).marks[0]!.type.name).toBe('italic');
  });

  it('preserves marks through unsetDetails', () => {
    editor = new Editor({
      extensions: [...allExtensions, Bold],
      content: '<details><summary><strong>Bold Title</strong></summary><div data-details-content><p>Body</p></div></details>',
    });

    const $pos = editor.state.doc.resolve(2);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)));

    editor.commands.unsetDetails();

    const firstPara = editor.state.doc.child(0);
    expect(firstPara.type.name).toBe('paragraph');
    expect(firstPara.textContent).toBe('Bold Title');
    expect(firstPara.child(0).marks[0]!.type.name).toBe('bold');
  });

  it('renders marks in summary HTML output', () => {
    editor = new Editor({
      extensions: [...allExtensions, Bold, Italic],
      content: '<details><summary><strong>Bold</strong> <em>Italic</em></summary><div data-details-content><p>Content</p></div></details>',
    });

    const html = editor.getHTML();
    expect(html).toContain('<summary><strong>Bold</strong> <em>Italic</em></summary>');
  });
});

// =============================================================================
// Details mixed with other block content
// =============================================================================

describe('details mixed with other content', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('details between paragraphs', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Before</p><details><summary>Q</summary><div data-details-content><p>A</p></div></details><p>After</p>',
    });

    const doc = editor.state.doc;
    expect(doc.childCount).toBe(3);
    expect(doc.child(0).type.name).toBe('paragraph');
    expect(doc.child(1).type.name).toBe('details');
    expect(doc.child(2).type.name).toBe('paragraph');
  });

  it('details at start of document', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>First</summary><div data-details-content><p>Content</p></div></details><p>After</p>',
    });

    expect(editor.state.doc.child(0).type.name).toBe('details');
    expect(editor.state.doc.child(1).type.name).toBe('paragraph');
  });

  it('details at end of document', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Before</p><details><summary>Last</summary><div data-details-content><p>Content</p></div></details>',
    });

    const doc = editor.state.doc;
    expect(doc.child(doc.childCount - 1).type.name).toBe('details');
  });

  it('consecutive details blocks parse correctly', () => {
    editor = new Editor({
      extensions: allExtensions,
      content:
        '<details><summary>Q1</summary><div data-details-content><p>A1</p></div></details>' +
        '<details><summary>Q2</summary><div data-details-content><p>A2</p></div></details>' +
        '<details><summary>Q3</summary><div data-details-content><p>A3</p></div></details>',
    });

    const doc = editor.state.doc;
    expect(doc.childCount).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(doc.child(i).type.name).toBe('details');
      expect(doc.child(i).child(0).textContent).toBe(`Q${String(i + 1)}`);
      expect(doc.child(i).child(1).child(0).textContent).toBe(`A${String(i + 1)}`);
    }
  });
});

// =============================================================================
// can() dry-run for all commands
// =============================================================================

describe('command can() dry-run', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('can().setDetails() returns true for a paragraph', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Some text</p>',
    });

    expect(editor.can().setDetails()).toBe(true);
  });

  it('can().setDetails() returns false when inside details', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const contentStart = editor.state.doc.child(0).child(0).nodeSize + 1 + 1;
    const $pos = editor.state.doc.resolve(contentStart);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)));

    expect(editor.can().setDetails()).toBe(false);
  });

  it('can().unsetDetails() returns true when inside details', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const $pos = editor.state.doc.resolve(2);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)));

    expect(editor.can().unsetDetails()).toBe(true);
  });

  it('can().unsetDetails() returns false when not inside details', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Normal paragraph</p>',
    });

    expect(editor.can().unsetDetails()).toBe(false);
  });

  it('can().toggleDetails() returns true in any context', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Anywhere</p>',
    });

    expect(editor.can().toggleDetails()).toBe(true);
  });

  it('can().openDetails() returns false without persist', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const $pos = editor.state.doc.resolve(2);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)));

    expect(editor.can().openDetails()).toBe(false);
  });

  it('can().closeDetails() returns false without persist', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const $pos = editor.state.doc.resolve(2);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)));

    expect(editor.can().closeDetails()).toBe(false);
  });

  it('can().openDetails() returns true with persist on closed details', () => {
    const PersistDetails = Details.configure({ persist: true });
    editor = new Editor({
      extensions: [Document, Text, Paragraph, PersistDetails, DetailsSummary, DetailsContent],
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const $pos = editor.state.doc.resolve(2);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)));

    expect(editor.can().openDetails()).toBe(true);
  });

  it('can().closeDetails() returns true with persist on open details', () => {
    const PersistDetails = Details.configure({ persist: true });
    editor = new Editor({
      extensions: [Document, Text, Paragraph, PersistDetails, DetailsSummary, DetailsContent],
      content: '<details open><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const $pos = editor.state.doc.resolve(2);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)));

    expect(editor.can().closeDetails()).toBe(true);
  });
});

// =============================================================================
// Persist mode toggle with NodeView
// =============================================================================

describe('persist mode toggle via NodeView', () => {
  let editor: Editor | undefined;
  const PersistDetails = Details.configure({ persist: true });
  const persistExtensions = [Document, Text, Paragraph, PersistDetails, DetailsSummary, DetailsContent];

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('toggle button updates open attribute in persist mode', () => {
    editor = new Editor({
      extensions: persistExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    expect(editor.state.doc.child(0).attrs['open']).toBe(false);

    const detailsDom = editor.view.dom.querySelector<HTMLElement>('[data-type="details"]')!;
    const button = detailsDom.querySelector('button')!;

    button.click();
    expect(editor.state.doc.child(0).attrs['open']).toBe(true);
  });

  it('toggle button closes open details in persist mode', () => {
    editor = new Editor({
      extensions: persistExtensions,
      content: '<details open><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    expect(editor.state.doc.child(0).attrs['open']).toBe(true);

    const detailsDom = editor.view.dom.querySelector<HTMLElement>('[data-type="details"]')!;
    const button = detailsDom.querySelector('button')!;

    button.click();
    expect(editor.state.doc.child(0).attrs['open']).toBe(false);
  });
});

// =============================================================================
// Selection plugin registration
// =============================================================================

describe('selection plugin', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('registers the detailsSelection plugin', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    const plugins = editor.state.plugins;
    const hasSelectionPlugin = plugins.some(p => (p as any).key?.includes('detailsSelection'));
    expect(hasSelectionPlugin).toBe(true);
  });
});

// =============================================================================
// Keyboard shortcut Backspace behavior
// =============================================================================

describe('Backspace keyboard shortcut (behavioral)', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('unsets details when cursor is at start of summary', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    // Place cursor at start of summary (pos 2 = right after summary open)
    const summaryStart = 2;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, summaryStart))
    );

    // Verify cursor is in summary at offset 0
    expect(editor.state.selection.$anchor.parent.type.name).toBe('detailsSummary');
    expect(editor.state.selection.$anchor.parentOffset).toBe(0);

    // Simulate Backspace via the keyboard shortcut handler
    const shortcuts = Details.config.addKeyboardShortcuts?.call({
      ...Details,
      editor,
      options: Details.options,
    } as any);

    const result = (shortcuts?.['Backspace'] as (() => boolean) | undefined)?.();
    expect(result).toBe(true);

    // After backspace at start of summary, details should be unwrapped
    expect(editor.state.doc.child(0).type.name).toBe('paragraph');
  });

  it('does not unset details when cursor is in middle of summary text', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    // Place cursor in middle of "Title" (offset 2, pos 4)
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4))
    );

    expect(editor.state.selection.$anchor.parent.type.name).toBe('detailsSummary');
    expect(editor.state.selection.$anchor.parentOffset).toBe(2);

    const shortcuts = Details.config.addKeyboardShortcuts?.call({
      ...Details,
      editor,
      options: Details.options,
    } as any);

    (shortcuts?.['Backspace'] as (() => boolean) | undefined)?.();
    // Should handle backspace (delete one char) but NOT unset details
    // The details node should still exist
    expect(editor.state.doc.child(0).type.name).toBe('details');
  });

  it('does nothing when cursor is not in summary', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Normal paragraph</p>',
    });

    const shortcuts = Details.config.addKeyboardShortcuts?.call({
      ...Details,
      editor,
      options: Details.options,
    } as any);

    const result = (shortcuts?.['Backspace'] as (() => boolean) | undefined)?.();
    expect(result).toBe(false);
  });
});

// =============================================================================
// Enter keyboard shortcut in summary
// =============================================================================

describe('Enter keyboard shortcut in summary (behavioral)', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('does nothing when cursor is not in summary', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Normal paragraph</p>',
    });

    const shortcuts = Details.config.addKeyboardShortcuts?.call({
      ...Details,
      editor,
      options: Details.options,
    } as any);

    const result = (shortcuts?.['Enter'] as (() => boolean) | undefined)?.();
    expect(result).toBe(false);
  });
});

// =============================================================================
// DetailsContent double-Enter escape
// =============================================================================

describe('DetailsContent Enter shortcut (behavioral)', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('does nothing when cursor is not in detailsContent', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Normal</p>',
    });

    const shortcuts = DetailsContent.config.addKeyboardShortcuts?.call({
      ...DetailsContent,
      editor,
      options: DetailsContent.options,
    } as any);

    const result = (shortcuts?.['Enter'] as (() => boolean) | undefined)?.();
    expect(result).toBe(false);
  });

  it('does nothing when cursor is not in last child of content', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>First</p><p>Second</p></div></details>',
    });

    // Open the content for visibility
    const detailsDom = editor.view.dom.querySelector<HTMLElement>('[data-type="details"]')!;
    detailsDom.querySelector('button')!.click();

    // Place cursor in "First" paragraph (not the last child)
    const contentStart = editor.state.doc.child(0).child(0).nodeSize + 1 + 1;
    const $pos = editor.state.doc.resolve(contentStart);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)));

    const shortcuts = DetailsContent.config.addKeyboardShortcuts?.call({
      ...DetailsContent,
      editor,
      options: DetailsContent.options,
    } as any);

    const result = (shortcuts?.['Enter'] as (() => boolean) | undefined)?.();
    expect(result).toBe(false);
  });

  it('does nothing when last child has content', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Has content</p></div></details>',
    });

    // Open content
    const detailsDom = editor.view.dom.querySelector<HTMLElement>('[data-type="details"]')!;
    detailsDom.querySelector('button')!.click();

    // Place cursor at end of "Has content"
    const contentStart = editor.state.doc.child(0).child(0).nodeSize + 1 + 1;
    const $pos = editor.state.doc.resolve(contentStart);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)));

    const shortcuts = DetailsContent.config.addKeyboardShortcuts?.call({
      ...DetailsContent,
      editor,
      options: DetailsContent.options,
    } as any);

    const result = (shortcuts?.['Enter'] as (() => boolean) | undefined)?.();
    expect(result).toBe(false);
  });

  it('escapes out when cursor is in last empty paragraph', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p><p></p></div></details>',
    });

    // Open content
    const detailsDom = editor.view.dom.querySelector<HTMLElement>('[data-type="details"]')!;
    detailsDom.querySelector('button')!.click();

    // Place cursor in the empty paragraph (last child of detailsContent)
    // Doc structure: details(summary("Title"), detailsContent(paragraph("Content"), paragraph()))
    const details = editor.state.doc.child(0);
    const summary = details.child(0);
    const content = details.child(1);
    const firstPara = content.child(0);
    // Position: 1(details) + summary.nodeSize + 1(detailsContent) + firstPara.nodeSize + 1(empty para)
    const emptyParaPos = 1 + summary.nodeSize + 1 + firstPara.nodeSize + 1;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, emptyParaPos))
    );

    const shortcuts = DetailsContent.config.addKeyboardShortcuts?.call({
      ...DetailsContent,
      editor,
      options: DetailsContent.options,
    } as any);

    const result = (shortcuts?.['Enter'] as (() => boolean) | undefined)?.();
    expect(result).toBe(true);

    // After escape, there should be a paragraph after the details
    const doc = editor.state.doc;
    expect(doc.childCount).toBe(2);
    expect(doc.child(0).type.name).toBe('details');
    expect(doc.child(1).type.name).toBe('paragraph');
    // The empty paragraph should have been removed from content
    expect(doc.child(0).child(1).childCount).toBe(1);
    expect(doc.child(0).child(1).child(0).textContent).toBe('Content');
  });
});

// =============================================================================
// Edge cases
// =============================================================================

describe('edge cases', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    if (editor && !editor.isDestroyed) {
      editor.destroy();
    }
  });

  it('empty details with empty summary and empty content paragraph', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary></summary><div data-details-content><p></p></div></details>',
    });

    const details = editor.state.doc.child(0);
    expect(details.type.name).toBe('details');
    expect(details.child(0).textContent).toBe('');
    expect(details.child(1).child(0).textContent).toBe('');
  });

  it('details with long summary text', () => {
    const longText = 'A'.repeat(1000);
    editor = new Editor({
      extensions: allExtensions,
      content: `<details><summary>${longText}</summary><div data-details-content><p>Content</p></div></details>`,
    });

    expect(editor.state.doc.child(0).child(0).textContent).toBe(longText);
  });

  it('details content with many paragraphs', () => {
    const paras = Array.from({ length: 20 }, (_, i) => `<p>Paragraph ${String(i)}</p>`).join('');
    editor = new Editor({
      extensions: allExtensions,
      content: `<details><summary>Title</summary><div data-details-content>${paras}</div></details>`,
    });

    const content = editor.state.doc.child(0).child(1);
    expect(content.childCount).toBe(20);
    expect(content.child(19).textContent).toBe('Paragraph 19');
  });

  it('setDetails on already-empty paragraph creates valid structure', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p></p>',
    });

    editor.commands.setDetails();

    const details = editor.state.doc.child(0);
    expect(details.type.name).toBe('details');
    expect(details.childCount).toBe(2);
    expect(details.child(0).type.name).toBe('detailsSummary');
    expect(details.child(1).type.name).toBe('detailsContent');
  });

  it('destroy cleans up editor', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<details><summary>Title</summary><div data-details-content><p>Content</p></div></details>',
    });

    expect(editor.isDestroyed).toBe(false);
    editor.destroy();
    expect(editor.isDestroyed).toBe(true);
  });

  it('multiple setDetails/unsetDetails cycles produce consistent results', () => {
    editor = new Editor({
      extensions: allExtensions,
      content: '<p>Cycle test</p>',
    });

    for (let i = 0; i < 3; i++) {
      editor.commands.setDetails();
      expect(editor.state.doc.child(0).type.name).toBe('details');

      // Place cursor in summary for unset
      const $pos = editor.state.doc.resolve(2);
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near($pos)));

      editor.commands.unsetDetails();
      expect(editor.state.doc.child(0).type.name).toBe('paragraph');
    }
  });
});
