import { describe, it, expect, afterEach } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { StarterKit } from '../extensions/StarterKit.js';
import type { ToolbarButton } from '../types/Toolbar.js';
import {
  buildBubbleItemMaps,
  createBubbleShouldShow,
  detectBubbleContext,
  filterBubbleItemsBySchema,
  getBubbleFormatItems,
  isInsideTableCell,
  resolveBubbleMenuItems,
  resolveBubbleNames,
  type BubbleContexts,
  type BubbleItemMaps,
  type BubbleMenuItem,
  type SelectionShape,
} from './bubbleMenuResolver.js';

/** `|` for a separator, the item's name otherwise. */
const names = (items: BubbleMenuItem[]): string[] =>
  items.map((item) => (item.type === 'separator' ? '|' : item.name));

describe('bubbleMenuResolver', () => {
  let editor: Editor | undefined;

  afterEach(() => {
    editor?.destroy();
    editor = undefined;
  });

  const makeEditor = (content = '<p>hello world</p>'): Editor =>
    new Editor({ extensions: [StarterKit], content });

  /** A real text selection: the resolver reads the live one off the state. */
  const select = (ed: Editor, from: number, to: number): void => {
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, from, to)));
  };

  // --- buildBubbleItemMaps -------------------------------------------------

  describe('buildBubbleItemMaps', () => {
    it('indexes buttons by name', () => {
      editor = makeEditor();
      const { itemMap } = buildBubbleItemMaps(editor);
      expect(itemMap.get('bold')?.name).toBe('bold');
      expect(itemMap.get('link')?.name).toBe('link');
    });

    it('indexes a dropdown and its children, so either can be named', () => {
      editor = makeEditor();
      const { itemMap, dropdownMap } = buildBubbleItemMaps(editor);
      // StarterKit's Heading contributes the `heading` dropdown.
      expect(dropdownMap.get('heading')?.type).toBe('dropdown');
      // Its children are reachable as buttons on their own.
      expect(itemMap.get('heading1')?.name).toBe('heading1');
    });

    it('groups bubble defaults by the context each item declares', () => {
      editor = makeEditor();
      const { bubbleDefaults } = buildBubbleItemMaps(editor);
      // Image and HR are not in StarterKit, so only what StarterKit declares
      // can appear; the map must at least be built without throwing.
      expect(bubbleDefaults).toBeInstanceOf(Map);
      for (const list of bubbleDefaults.values()) {
        // A default list can never open or end with a separator: one is
        // written only between two runs of items.
        expect(list[0]?.type).not.toBe('separator');
        expect(list[list.length - 1]?.type).not.toBe('separator');
      }
    });
  });

  // --- resolveBubbleNames --------------------------------------------------

  describe('resolveBubbleNames', () => {
    let maps: BubbleItemMaps | undefined;

    const resolve = (list: string[]): string[] => {
      editor ??= makeEditor();
      maps ??= buildBubbleItemMaps(editor);
      return names(resolveBubbleNames(list, maps.itemMap, maps.dropdownMap));
    };

    it('turns a pipe into a separator', () => {
      expect(resolve(['bold', '|', 'italic'])).toEqual(['bold', '|', 'italic']);
    });

    it('skips a name the editor does not carry', () => {
      // `ai` is a Pro extension: this is the every-free-build case.
      expect(resolve(['ai', 'bold'])).toEqual(['bold']);
    });

    it('leaves the separator beside a skipped name, for the collapse pass', () => {
      // Proving the split of responsibilities rather than the outcome: this
      // function must NOT clean up, or it would run before schema filtering
      // has had its turn to remove things.
      expect(resolve(['ai', '|', 'bold'])).toEqual(['|', 'bold']);
    });

    it('prefers a dropdown over a button of the same name', () => {
      editor = makeEditor();
      const built = buildBubbleItemMaps(editor);
      const fake: ToolbarButton = {
        type: 'button',
        name: 'heading',
        command: 'focus',
        icon: 'textT',
        label: 'not the dropdown',
      };
      built.itemMap.set('heading', fake);
      const [resolved] = resolveBubbleNames(['heading'], built.itemMap, built.dropdownMap);
      expect(resolved?.type).toBe('dropdown');
    });
  });

  // --- getBubbleFormatItems ------------------------------------------------

  it('getBubbleFormatItems returns only the format group, highest priority first', () => {
    editor = makeEditor();
    const { itemMap } = buildBubbleItemMaps(editor);
    const items = getBubbleFormatItems(itemMap);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => item.group === 'format')).toBe(true);
    const priorities = items.map((item) => item.priority ?? 100);
    expect([...priorities].sort((a, b) => b - a)).toEqual(priorities);
  });

  // --- detectBubbleContext -------------------------------------------------

  describe('detectBubbleContext', () => {
    const ctxs: BubbleContexts = { text: ['bold'], codeBlock: ['undo'] };
    const pos = (parentName: string, marks?: string, depth = 1): SelectionShape['$from'] => ({
      parent: { type: { name: parentName, spec: marks === undefined ? {} : { marks } } },
      depth,
      node: () => ({ type: { name: parentName } }),
    });

    it('refuses a cell selection outright', () => {
      const sel = {
        empty: false,
        $anchorCell: {},
        $from: pos('paragraph'),
        $to: pos('paragraph'),
      } as unknown as SelectionShape;
      expect(detectBubbleContext(sel, ctxs)).toBeNull();
    });

    it('names the node type for a node selection', () => {
      const sel = {
        empty: false,
        node: { type: { name: 'image' } },
        $from: pos('paragraph'),
        $to: pos('paragraph'),
      } as SelectionShape;
      expect(detectBubbleContext(sel, ctxs)).toBe('image');
    });

    it('returns null for an empty selection', () => {
      const sel = { empty: true, $from: pos('paragraph'), $to: pos('paragraph') } as SelectionShape;
      expect(detectBubbleContext(sel, ctxs)).toBeNull();
    });

    it('prefers a context named after the parent node', () => {
      const sel = {
        empty: false,
        $from: pos('codeBlock'),
        $to: pos('codeBlock'),
      } as SelectionShape;
      expect(detectBubbleContext(sel, ctxs)).toBe('codeBlock');
    });

    it("falls back to 'text' when the parent allows marks", () => {
      const sel = {
        empty: false,
        $from: pos('paragraph'),
        $to: pos('paragraph'),
      } as SelectionShape;
      expect(detectBubbleContext(sel, ctxs)).toBe('text');
    });

    it('reads $to when $from resolves to nothing, so a cross-block selection still has a menu', () => {
      const sel = {
        empty: false,
        $from: pos('unknownBlock', ''),
        $to: pos('paragraph'),
      } as SelectionShape;
      expect(detectBubbleContext(sel, ctxs)).toBe('text');
    });

    it("returns 'table' inside one cell and null across two", () => {
      const cell = (id: string): SelectionShape['$from'] => {
        const node = { type: { name: 'tableCell' }, id };
        return {
          parent: { type: { name: 'paragraph', spec: {} } },
          depth: 2,
          node: () => node,
        };
      };
      const one = cell('a');
      expect(
        detectBubbleContext({ empty: false, $from: one, $to: one }, ctxs),
      ).toBe('table');
      expect(
        detectBubbleContext(
          { empty: false, $from: cell('a'), $to: cell('b') },
          ctxs,
        ),
      ).toBeNull();
    });
  });

  it('isInsideTableCell walks up to the cell', () => {
    const inCell = {
      parent: { type: { name: 'paragraph', spec: {} } },
      depth: 3,
      node: (d: number) => ({ type: { name: d === 2 ? 'tableCell' : 'paragraph' } }),
    };
    expect(isInsideTableCell(inCell)).toBe(true);
    expect(
      isInsideTableCell({ ...inCell, node: () => ({ type: { name: 'paragraph' } }) }),
    ).toBe(false);
  });

  // --- filterBubbleItemsBySchema -------------------------------------------

  describe('filterBubbleItemsBySchema', () => {
    it('passes text and table through untouched', () => {
      editor = makeEditor();
      const { itemMap } = buildBubbleItemMaps(editor);
      const items = getBubbleFormatItems(itemMap);
      expect(filterBubbleItemsBySchema(editor, 'text', items)).toBe(items);
      expect(filterBubbleItemsBySchema(editor, 'table', items)).toBe(items);
    });

    it('drops a mark the node type refuses', () => {
      editor = makeEditor();
      const { itemMap } = buildBubbleItemMaps(editor);
      const bold = itemMap.get('bold');
      expect(bold).toBeDefined();
      // CodeBlock declares `marks: ''`, so nothing inline survives there.
      expect(filterBubbleItemsBySchema(editor, 'codeBlock', [bold!])).toEqual([]);
    });

    it('keeps an item that is not a mark', () => {
      editor = makeEditor();
      const { itemMap } = buildBubbleItemMaps(editor);
      const undo = itemMap.get('undo');
      expect(undo).toBeDefined();
      expect(filterBubbleItemsBySchema(editor, 'codeBlock', [undo!])).toEqual([undo]);
    });
  });

  // --- resolveBubbleMenuItems ----------------------------------------------

  describe('resolveBubbleMenuItems', () => {
    const run = (contexts: BubbleContexts | undefined, fallback: string[] = []): string[] => {
      const maps = buildBubbleItemMaps(editor!);
      return names(
        resolveBubbleMenuItems({
          editor: editor!,
          maps,
          contexts,
          fallbackItems: resolveBubbleNames(fallback, maps.itemMap, maps.dropdownMap),
        }),
      );
    };

    it('resolves a named list for the detected context', () => {
      editor = makeEditor();
      select(editor, 1, 6);
      expect(run({ text: ['bold', '|', 'link'] })).toEqual(['bold', '|', 'link']);
    });

    it('drops the separator left behind by a name the editor does not carry', () => {
      editor = makeEditor();
      select(editor, 1, 6);
      // The Notion default's shape: `ai` leads, and every free build skips it.
      expect(run({ text: ['ai', '|', 'bold', 'italic'] })).toEqual(['bold', 'italic']);
    });

    it('drops a separator orphaned by SCHEMA filtering, not only by a missing name', () => {
      // The reason the cleanup runs here and not inside name resolution: this
      // list resolves completely, and it is the selection that empties it.
      editor = new Editor({
        extensions: [StarterKit],
        content: '<pre><code>const a = 1</code></pre>',
      });
      select(editor, 2, 7);
      expect(run({ codeBlock: ['bold', '|', 'undo'] })).toEqual(['undo']);
    });

    it('collapses a run of separators down to one', () => {
      editor = makeEditor();
      select(editor, 1, 6);
      expect(run({ text: ['bold', '|', 'ai', '|', 'italic'] })).toEqual(['bold', '|', 'italic']);
    });

    it('drops a trailing separator', () => {
      editor = makeEditor();
      select(editor, 1, 6);
      expect(run({ text: ['bold', '|', 'ai'] })).toEqual(['bold']);
    });

    it('returns nothing when the context is disabled with null', () => {
      editor = makeEditor();
      select(editor, 1, 6);
      expect(run({ text: null })).toEqual([]);
    });

    it('returns nothing for an empty list', () => {
      editor = makeEditor();
      select(editor, 1, 6);
      expect(run({ text: [] })).toEqual([]);
    });

    it('`true` means every format mark the context allows', () => {
      editor = makeEditor();
      select(editor, 1, 6);
      const resolved = run({ text: true });
      expect(resolved).toContain('bold');
      expect(resolved).not.toContain('|');
    });

    it('falls back to the fixed list with no contexts at all', () => {
      editor = makeEditor();
      select(editor, 1, 6);
      expect(run(undefined, ['bold', '|', 'italic'])).toEqual(['bold', '|', 'italic']);
    });

    it('returns nothing when no context matches', () => {
      editor = makeEditor();
      select(editor, 1, 6);
      expect(run({ codeBlock: ['undo'] })).toEqual([]);
    });
  });

  // --- createBubbleShouldShow ----------------------------------------------

  describe('createBubbleShouldShow', () => {
    /* The rule reads `state.selection` and nothing else, but its signature is
       the plugin's full props, so the rest is filled in by the cast. */
    const state = (selection: unknown): Parameters<NonNullable<ReturnType<typeof createBubbleShouldShow>>>[0] =>
      ({ state: { selection } }) as unknown as Parameters<NonNullable<ReturnType<typeof createBubbleShouldShow>>>[0];
    const textSel = {
      empty: false,
      $from: { parent: { type: { name: 'paragraph', spec: {} } }, depth: 1, node: () => ({ type: { name: 'paragraph' } }) },
      $to: { parent: { type: { name: 'paragraph', spec: {} } }, depth: 1, node: () => ({ type: { name: 'paragraph' } }) },
    };

    it('shows for a context with items and hides for one disabled with null', () => {
      editor = makeEditor();
      const maps = buildBubbleItemMaps(editor);
      expect(createBubbleShouldShow(maps, { text: ['bold'] })(state(textSel))).toBe(true);
      expect(createBubbleShouldShow(maps, { text: null })(state(textSel))).toBe(false);
      expect(createBubbleShouldShow(maps, { text: [] })(state(textSel))).toBe(false);
    });

    it('hides on an empty selection in the no-contexts mode', () => {
      editor = makeEditor();
      const maps = buildBubbleItemMaps(editor);
      const show = createBubbleShouldShow(maps);
      expect(show(state({ ...textSel, empty: true }))).toBe(false);
      expect(show(state(textSel))).toBe(true);
    });

    it('hides inside a table cell in the no-contexts mode', () => {
      editor = makeEditor();
      const maps = buildBubbleItemMaps(editor);
      const inCell = {
        empty: false,
        $from: { parent: { type: { name: 'paragraph', spec: {} } }, depth: 2, node: (d: number) => ({ type: { name: d === 2 ? 'tableCell' : 'paragraph' } }) },
        $to: { parent: { type: { name: 'paragraph', spec: {} } }, depth: 2, node: () => ({ type: { name: 'tableCell' } }) },
      };
      expect(createBubbleShouldShow(maps)(state(inCell))).toBe(false);
    });

    it('agrees with the resolver: it never opens a menu that would be empty', () => {
      // The pair has to hold together, or the reader gets an empty box or a
      // feature that never appears.
      editor = makeEditor();
      select(editor, 1, 6);
      const maps = buildBubbleItemMaps(editor);
      for (const contexts of [
        { text: ['bold', '|', 'link'] },
        { text: [] },
        { text: null },
        { text: true },
      ] as BubbleContexts[]) {
        const shows = createBubbleShouldShow(maps, contexts)(state(editor.state.selection));
        const items = resolveBubbleMenuItems({ editor, maps, contexts, fallbackItems: [] });
        expect(shows).toBe(items.length > 0);
      }
    });
  });
});
