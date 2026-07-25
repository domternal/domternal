/**
 * Tests for UniqueID extension
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Fragment, Slice } from '@domternal/pm/model';
import { UniqueID } from './UniqueID.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Heading } from '../nodes/Heading.js';
import { History } from './History.js';
import { Editor } from '../Editor.js';

describe('UniqueID', () => {
  describe('configuration', () => {
    it('has correct name', () => {
      expect(UniqueID.name).toBe('uniqueID');
    });

    it('has default options', () => {
      expect(UniqueID.options.types).toContain('paragraph');
      expect(UniqueID.options.types).toContain('heading');
      expect(UniqueID.options.attributeName).toBe('id');
      expect(UniqueID.options.filterDuplicates).toBe(true);
      expect(typeof UniqueID.options.generateID).toBe('function');
    });

    it('can configure with custom types', () => {
      const CustomUniqueID = UniqueID.configure({
        types: ['paragraph'],
      });
      expect(CustomUniqueID.options.types).toEqual(['paragraph']);
    });

    it('can configure with custom attribute name', () => {
      const CustomUniqueID = UniqueID.configure({
        attributeName: 'data-id',
      });
      expect(CustomUniqueID.options.attributeName).toBe('data-id');
    });

    it('can configure with custom ID generator', () => {
      const customGenerator = (): string => 'custom-id';
      const CustomUniqueID = UniqueID.configure({
        generateID: customGenerator,
      });
      expect(CustomUniqueID.options.generateID()).toBe('custom-id');
    });

    it('can disable duplicate filtering', () => {
      const CustomUniqueID = UniqueID.configure({
        filterDuplicates: false,
      });
      expect(CustomUniqueID.options.filterDuplicates).toBe(false);
    });
  });

  describe('addGlobalAttributes', () => {
    it('provides id attribute for configured types', () => {
      const globalAttrs = UniqueID.config.addGlobalAttributes?.call(UniqueID);

      expect(globalAttrs).toHaveLength(1);
      expect(globalAttrs?.[0]?.types).toContain('paragraph');
      expect(globalAttrs?.[0]?.attributes).toHaveProperty('id');
    });

    it('id attribute has correct defaults', () => {
      const globalAttrs = UniqueID.config.addGlobalAttributes?.call(UniqueID);
      const idAttr = globalAttrs?.[0]?.attributes['id'];

      expect(idAttr?.default).toBe(null);
      expect(idAttr?.parseHTML).toBeDefined();
      expect(idAttr?.renderHTML).toBeDefined();
    });

    it('parseHTML extracts id from element', () => {
      const globalAttrs = UniqueID.config.addGlobalAttributes?.call(UniqueID);
      const parseHTML = globalAttrs?.[0]?.attributes['id']?.parseHTML;

      const element = document.createElement('p');
      element.setAttribute('id', 'test-id');

      expect(parseHTML?.(element)).toBe('test-id');
    });

    it('renderHTML outputs id attribute', () => {
      const globalAttrs = UniqueID.config.addGlobalAttributes?.call(UniqueID);
      const renderHTML = globalAttrs?.[0]?.attributes['id']?.renderHTML;

      const result = renderHTML?.({ id: 'unique-123' });
      expect(result).toEqual({ id: 'unique-123' });
    });

    it('renderHTML returns null for null id', () => {
      const globalAttrs = UniqueID.config.addGlobalAttributes?.call(UniqueID);
      const renderHTML = globalAttrs?.[0]?.attributes['id']?.renderHTML;

      const result = renderHTML?.({ id: null });
      expect(result).toBe(null);
    });
  });

  describe('UUID generator', () => {
    it('generates valid UUID format', () => {
      const id = UniqueID.options.generateID();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(id).toMatch(uuidRegex);
    });

    it('generates unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(UniqueID.options.generateID());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('addProseMirrorPlugins', () => {
    it('returns plugins array', () => {
      const plugins = UniqueID.config.addProseMirrorPlugins?.call(UniqueID);

      expect(Array.isArray(plugins)).toBe(true);
      expect(plugins?.length).toBeGreaterThan(0);
    });
  });

  describe('integration', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) {
        editor.destroy();
      }
    });

    it('works with Editor', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, UniqueID],
        content: '<p>Test content</p>',
      });

      expect(editor.getText()).toContain('Test content');
    });

    // The assignment sweep runs from the plugin view on a macrotask, so the
    // attribute is present but still null on the tick the editor is built.
    // Every consumer that resolves a block by id depends on this landing.
    it('assigns ID to new paragraphs', async () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, UniqueID],
        content: '<p>Test</p>',
      });

      expect('id' in editor.state.doc.child(0).attrs).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(typeof editor.state.doc.child(0).attrs['id']).toBe('string');
    });

    it('preserves existing IDs', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, UniqueID],
        content: '<p id="existing-id">Test</p>',
      });

      const doc = editor.state.doc;
      const paragraph = doc.child(0);

      expect(paragraph.attrs['id']).toBe('existing-id');
    });

    it('uses custom ID generator', async () => {
      let counter = 0;
      const CustomUniqueID = UniqueID.configure({
        generateID: (): string => `custom-${String(++counter)}`,
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomUniqueID],
        content: '<p>First</p><p>Second</p>',
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      const doc = editor.state.doc;
      expect(doc.child(0).attrs['id']).toMatch(/^custom-/);
      expect(doc.child(1).attrs['id']).toMatch(/^custom-/);
    });

    it('uses custom attribute name', () => {
      const CustomUniqueID = UniqueID.configure({
        attributeName: 'data-block-id',
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomUniqueID],
        content: '<p data-block-id="my-id">Test</p>',
      });

      const doc = editor.state.doc;
      const paragraph = doc.child(0);

      expect(paragraph.attrs['data-block-id']).toBe('my-id');
    });

    it('only applies to configured types', () => {
      const CustomUniqueID = UniqueID.configure({
        types: ['heading'],
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, Heading, CustomUniqueID],
        content: '<p>Paragraph</p><h1>Heading</h1>',
      });

      const doc = editor.state.doc;
      const paragraph = doc.child(0);
      const heading = doc.child(1);

      // Paragraph should not have ID (not in types)
      expect(paragraph.attrs['id']).toBeUndefined();
      // Heading should have ID
      expect(heading.attrs['id']).toBeDefined();
    });

    it('renderHTML returns null for empty string id', () => {
      const globalAttrs = UniqueID.config.addGlobalAttributes?.call(UniqueID);
      const renderHTML = globalAttrs?.[0]?.attributes['id']?.renderHTML;

      const result = renderHTML?.({ id: '' });
      expect(result).toBe(null);
    });

    it('renderHTML returns null for undefined id', () => {
      const globalAttrs = UniqueID.config.addGlobalAttributes?.call(UniqueID);
      const renderHTML = globalAttrs?.[0]?.attributes['id']?.renderHTML;

      const result = renderHTML?.({ id: undefined });
      expect(result).toBe(null);
    });

    it('parseHTML returns null when no attribute', () => {
      const globalAttrs = UniqueID.config.addGlobalAttributes?.call(UniqueID);
      const parseHTML = globalAttrs?.[0]?.attributes['id']?.parseHTML;

      const element = document.createElement('p');
      expect(parseHTML?.(element)).toBe(null);
    });

    it('custom attributeName reflects in globalAttributes', () => {
      const CustomUniqueID = UniqueID.configure({
        attributeName: 'data-block-id',
      });

      const globalAttrs = CustomUniqueID.config.addGlobalAttributes?.call(CustomUniqueID);
      expect(globalAttrs?.[0]?.attributes).toHaveProperty('data-block-id');
    });

    it('custom types reflects in globalAttributes', () => {
      const CustomUniqueID = UniqueID.configure({
        types: ['paragraph'],
      });

      const globalAttrs = CustomUniqueID.config.addGlobalAttributes?.call(CustomUniqueID);
      expect(globalAttrs?.[0]?.types).toEqual(['paragraph']);
    });

    it('filterDuplicates false disables transformPasted', () => {
      const CustomUniqueID = UniqueID.configure({
        filterDuplicates: false,
      });

      const plugins = CustomUniqueID.config.addProseMirrorPlugins?.call(CustomUniqueID);
      expect(Array.isArray(plugins)).toBe(true);
      expect(plugins?.length).toBeGreaterThan(0);
      // Plugin should not have transformPasted in props
      const plugin = plugins?.[0];
      expect(plugin?.props.transformPasted).toBeUndefined();
    });

    it('filterDuplicates true enables transformPasted', () => {
      const plugins = UniqueID.config.addProseMirrorPlugins?.call(UniqueID);
      const plugin = plugins?.[0];
      expect(plugin?.props.transformPasted).toBeDefined();
    });

    it('multiple paragraphs get unique existing IDs preserved', () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, UniqueID],
        content: '<p id="a">First</p><p id="b">Second</p>',
      });

      const doc = editor.state.doc;
      expect(doc.child(0).attrs['id']).toBe('a');
      expect(doc.child(1).attrs['id']).toBe('b');
    });

    it('appendTransaction assigns IDs to nodes after doc change', () => {
      vi.useFakeTimers();

      let counter = 0;
      const CustomUniqueID = UniqueID.configure({
        types: ['paragraph'],
        generateID: () => `gen-${String(++counter)}`,
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomUniqueID],
        content: '<p>Hello</p>',
      });

      // Paragraph has id: null (setTimeout from view callback hasn't fired)
      // Insert text to trigger a doc-changing transaction -> appendTransaction fires
      editor.view.dispatch(editor.state.tr.insertText('x', 1));

      // appendTransaction should have assigned an ID
      const paragraph = editor.state.doc.child(0);
      expect(paragraph.attrs['id']).toMatch(/^gen-/);

      vi.useRealTimers();
    });

    it('transformPasted regenerates duplicate IDs', () => {
      vi.useFakeTimers();

      let callCount = 0;
      const CustomUniqueID = UniqueID.configure({
        types: ['paragraph'],
        generateID: () => `new-id-${String(++callCount)}`,
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomUniqueID],
        content: '<p id="dup-id">Existing</p>',
      });

      // Find the plugin with transformPasted
      const plugin = editor.state.plugins.find(p => p.props.transformPasted !== undefined);
      expect(plugin).toBeDefined();

      const transformPasted = plugin!.props.transformPasted!;

      // Create a paste slice with a paragraph that has the same ID as existing content
      const pasteNode = editor.state.schema.nodes['paragraph']!.create(
        { id: 'dup-id' },
        editor.state.schema.text('Pasted')
      );
      const slice = new Slice(Fragment.from(pasteNode), 0, 0);

      const result = transformPasted.call(plugin!, slice, editor.view, false);
      const pastedParagraph = result.content.firstChild;

      // Duplicate ID should have been regenerated
      expect(pastedParagraph?.attrs['id']).not.toBe('dup-id');
      expect(pastedParagraph?.attrs['id']).toMatch(/^new-id-/);

      vi.useRealTimers();
    });

    it('transformPasted preserves unique IDs', () => {
      vi.useFakeTimers();

      const CustomUniqueID = UniqueID.configure({
        types: ['paragraph'],
      });

      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomUniqueID],
        content: '<p id="existing-id">Existing</p>',
      });

      const plugin = editor.state.plugins.find(p => p.props.transformPasted !== undefined);
      const transformPasted = plugin!.props.transformPasted!;

      // Create a paste slice with a unique (non-duplicate) ID
      const pasteNode = editor.state.schema.nodes['paragraph']!.create(
        { id: 'unique-new-id' },
        editor.state.schema.text('Pasted')
      );
      const slice = new Slice(Fragment.from(pasteNode), 0, 0);

      const result = transformPasted.call(plugin!, slice, editor.view, false);
      const pastedParagraph = result.content.firstChild;

      // Unique ID should be preserved
      expect(pastedParagraph?.attrs['id']).toBe('unique-new-id');

      vi.useRealTimers();
    });

    // ────────────────────────────────────────────────────────────────
    // Collision rename in setContent / appendTransaction path
    // (covers the path NOT served by transformPasted: when duplicate
    // ids arrive via initial setContent or via PM transactions that
    // copy a node with its id - e.g. duplicateBlock helpers that
    // spread attrs without overriding the id field.)
    // ────────────────────────────────────────────────────────────────

    it('setContent with duplicate ids: first wins, second is renamed unique', async () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Heading, UniqueID],
        content: '<h1 id="duplicate">First</h1><h2 id="duplicate">Second</h2>',
      });

      // Defer past the setTimeout(0) in UniqueID's view().init so the
      // initial assignMissingIDs pass runs and processes both nodes.
      await new Promise<void>((r) => setTimeout(r, 0));

      const doc = editor.state.doc;
      const firstId = doc.child(0).attrs['id'] as string;
      const secondId = doc.child(1).attrs['id'] as string;

      // First-wins rule: the first occurrence keeps the user-supplied id.
      expect(firstId).toBe('duplicate');
      // Second one gets a fresh id, NOT the duplicate.
      expect(secondId).not.toBe('duplicate');
      expect(secondId.length).toBeGreaterThan(0);
      // Both ids are unique inside the doc.
      expect(firstId).not.toBe(secondId);
    });

    it('three nodes with the same id: first keeps it, the other two get fresh distinct ids', async () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Heading, UniqueID],
        content:
          '<h1 id="x">One</h1><h2 id="x">Two</h2><h3 id="x">Three</h3>',
      });
      await new Promise<void>((r) => setTimeout(r, 0));

      const ids = [
        editor.state.doc.child(0).attrs['id'] as string,
        editor.state.doc.child(1).attrs['id'] as string,
        editor.state.doc.child(2).attrs['id'] as string,
      ];

      expect(ids[0]).toBe('x');
      expect(ids[1]).not.toBe('x');
      expect(ids[2]).not.toBe('x');
      // All three ids end up unique.
      expect(new Set(ids).size).toBe(3);
    });

    it('appendTransaction renames duplicate id created mid-doc (not paste path)', async () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, Heading, UniqueID],
        content: '<h1 id="anchor">Original</h1>',
      });
      await new Promise<void>((r) => setTimeout(r, 0));

      // Insert a second heading carrying the SAME id at the end of
      // the doc. This is the path duplicateBlock would take (spread
      // attrs onto a fresh node). It is NOT a paste; transformPasted
      // does not run. assignMissingIDs MUST detect the collision and
      // rename the new one.
      const headingType = editor.state.schema.nodes['heading']!;
      const newH = headingType.create({ level: 2, id: 'anchor' }, editor.state.schema.text('Copy'));
      editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, newH));

      // Wait for appendTransaction to run + schedule its setNodeMarkup.
      await new Promise<void>((r) => setTimeout(r, 0));

      const idA = editor.state.doc.child(0).attrs['id'] as string;
      const idB = editor.state.doc.child(1).attrs['id'] as string;
      expect(idA).toBe('anchor');
      expect(idB).not.toBe('anchor');
      expect(idB.length).toBeGreaterThan(0);
      expect(idA).not.toBe(idB);
    });
  });
  describe('id stability (the guarantees every id consumer relies on)', () => {
    let editor: Editor | undefined;

    afterEach(() => {
      if (editor && !editor.isDestroyed) editor.destroy();
    });

    it('the startup id sweep is not on the undo stack', async () => {
      editor = new Editor({
        extensions: [Document, Text, Paragraph, History, UniqueID],
        content: '<p>First</p><p>Second</p>',
      });
      // The sweep that stamps ids onto content that arrived without them runs
      // from the plugin view on its own macrotask, so it is a transaction of
      // its own rather than part of any user edit.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const stamped = editor.state.doc.child(0).attrs['id'] as string;
      expect(typeof stamped).toBe('string');

      // Undo with nothing to undo must be a no-op. If the sweep were on the
      // stack, the user's first undo would silently strip the ids instead, the
      // next sweep would mint DIFFERENT ones, and every reference to the old
      // ids (a `#hash` anchor, a table-of-contents deep link, a copied block
      // link) would break with no visible cause.
      editor.commands.undo();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(editor.state.doc.child(0).attrs['id']).toBe(stamped);
      expect(editor.state.doc.childCount).toBe(2);
    });

    it('an internal MOVE drag keeps the block id, a copy drag does not', () => {
      const CustomUniqueID = UniqueID.configure({
        types: ['paragraph'],
        generateID: () => 'regenerated',
      });
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomUniqueID],
        content: '<p id="keep-me">Dragged</p>',
      });

      const plugin = editor.state.plugins.find((p) => p.props.transformPasted !== undefined);
      const transformPasted = plugin!.props.transformPasted!;
      const dragged = editor.state.schema.nodes['paragraph']!.create(
        { id: 'keep-me' },
        editor.state.schema.text('Dragged')
      );
      const slice = new Slice(Fragment.from(dragged), 0, 0);

      // ProseMirror runs transformPasted on the dragged slice BEFORE deleting
      // the source, so a plain move looks exactly like a duplicate. Keeping the
      // id is what makes a move a move rather than a delete plus a re-create.
      const view = editor.view as unknown as { dragging: { move: boolean } | null };
      view.dragging = { move: true };
      const moved = transformPasted.call(plugin!, slice, editor.view, false);
      expect(moved.content.firstChild?.attrs['id']).toBe('keep-me');

      // An alt-drag copy leaves `move` false and must still regenerate, or the
      // document would carry the same id twice.
      view.dragging = { move: false };
      const copied = transformPasted.call(plugin!, slice, editor.view, false);
      expect(copied.content.firstChild?.attrs['id']).toBe('regenerated');
      view.dragging = null;
    });

    it('a duplicate landing ABOVE the original renames the copy, not the original', async () => {
      let counter = 0;
      const CustomUniqueID = UniqueID.configure({
        types: ['paragraph'],
        generateID: () => `fresh-${String(++counter)}`,
      });
      editor = new Editor({
        extensions: [Document, Text, Paragraph, CustomUniqueID],
        content: '<p id="anchor">Original</p>',
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Insert a copy carrying the same id at the very TOP, the case the old
      // "first in document order wins" rule got backwards.
      const copy = editor.state.schema.nodes['paragraph']!.create(
        { id: 'anchor' },
        editor.state.schema.text('Copy')
      );
      editor.view.dispatch(editor.state.tr.insert(0, copy));
      await new Promise((resolve) => setTimeout(resolve, 0));

      const first = editor.state.doc.child(0);
      const second = editor.state.doc.child(1);
      expect(first.textContent).toBe('Copy');
      expect(second.textContent).toBe('Original');
      // The node that already held the id keeps it wherever it now sits.
      expect(second.attrs['id']).toBe('anchor');
      expect(first.attrs['id']).not.toBe('anchor');
    });
  });
});
