/**
 * Unit coverage for `computeDropPlacement` after the DropPlacement type
 * extension. Phase 2 of plan 3 added `mode: 'sibling' | 'nested'` plus
 * optional `targetItemPos` / `wrapperPos` to the returned shape; every
 * existing return path commits to `mode: 'sibling'` until X-threshold
 * detection ships in a follow-up phase. These tests lock that contract
 * across all branches of the resolver:
 *
 *  1. Empty doc → null
 *  2. Mode A (top-level only) - cursor inside / at top / below last
 *  3. Inter-block gap canonicalisation - mode kept 'sibling'
 *  4. Mode B (nested deepest-Y match) - mode kept 'sibling'
 *  5. Type-narrowing - 'sibling' branch never carries targetItemPos
 *
 * jsdom doesn't perform layout, so DOM rects are hand-built via the
 * `viewStub` helper (mirrors the pattern in
 * `helpers/findTopLevelBlock.test.ts`). The stub feeds rects through
 * a mocked `view.nodeDOM` and `view.dom` so the function's path
 * resolution behaves deterministically without a real browser.
 */
import { describe, it, expect } from 'vitest';
import {
  Document,
  Text,
  Paragraph,
  Heading,
  BulletList,
  ListItem,
  TaskList,
  TaskItem,
  Editor,
} from '@domternal/core';
import type { EditorView } from '@domternal/pm/view';
import { computeDropPlacement, resolveNestedConfig, type DropPlacement } from './BlockHandle.js';

const extensions = [Document, Text, Paragraph, Heading, BulletList, ListItem, TaskList, TaskItem];

function makeEditor(html: string): Editor {
  return new Editor({ extensions, content: html });
}

interface RectSpec { top: number; bottom: number; left?: number; right?: number; }

function elWithRect(spec: RectSpec): HTMLElement {
  const left = spec.left ?? 0;
  const right = spec.right ?? 1000;
  const el = document.createElement('div');
  el.getBoundingClientRect = () => new DOMRect(left, spec.top, right - left, spec.bottom - spec.top);
  return el;
}

/**
 * Builds an `EditorView`-shaped stub that hands out hand-rolled
 * `getBoundingClientRect` results for known positions. `editorContentRect`
 * is the rect of `view.dom.firstElementChild` used by `clampToContent` to
 * decide whether the cursor is inside the editor's content column.
 */
function viewStub(
  editor: Editor,
  rects: Map<number, HTMLElement>,
  editorContentRect: RectSpec = { top: 0, bottom: 10_000, left: 0, right: 1000 },
): EditorView {
  const editorContentEl = elWithRect(editorContentRect);
  const dom: Partial<HTMLElement> & { firstElementChild: HTMLElement; lastElementChild: HTMLElement } = {
    firstElementChild: editorContentEl,
    lastElementChild: editorContentEl,
  };
  return {
    state: editor.state,
    nodeDOM: (pos: number) => rects.get(pos) ?? null,
    dom,
    posAtCoords: () => null,
  } as unknown as EditorView;
}

function posOf(editor: Editor, predicate: (n: { type: { name: string }; textContent: string }) => boolean): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (predicate(node)) { found = pos; return false; }
    return true;
  });
  if (found === -1) throw new Error('node not found');
  return found;
}

const NESTED_DISABLED = resolveNestedConfig(false);
const NESTED_LIST = resolveNestedConfig({ allowedNodes: ['listItem', 'taskItem'] });

describe('computeDropPlacement - DropPlacement.mode contract', () => {
  describe('Mode A (top-level only, nested disabled)', () => {
    it('returns null for an empty doc', () => {
      // Empty doc has no blocks, so resolveTopLevelByY returns null → bail.
      const editor = new Editor({ extensions, content: '' });
      const result = computeDropPlacement(viewStub(editor, new Map()), 100, 50, NESTED_DISABLED);
      expect(result).toBeNull();
      editor.destroy();
    });

    it('returns mode "sibling" when cursor is inside a single paragraph', () => {
      const editor = makeEditor('<p>Only one</p>');
      const pPos = posOf(editor, (n) => n.type.name === 'paragraph');
      const rects = new Map<number, HTMLElement>([
        [pPos, elWithRect({ top: 100, bottom: 130 })],
      ]);

      const result = computeDropPlacement(viewStub(editor, rects), 50, 115, NESTED_DISABLED);
      expect(result).not.toBeNull();
      expect(result?.mode).toBe('sibling');
      expect(result?.targetItemPos).toBeUndefined();
      expect(result?.wrapperPos).toBeUndefined();
      editor.destroy();
    });

    it('cursor on UPPER half of a single paragraph - has no prev sibling, returns insertAfter=false + mode "sibling"', () => {
      const editor = makeEditor('<p>Only one</p>');
      const pPos = posOf(editor, (n) => n.type.name === 'paragraph');
      const rects = new Map<number, HTMLElement>([
        [pPos, elWithRect({ top: 100, bottom: 130 })],
      ]);

      const result = computeDropPlacement(viewStub(editor, rects), 50, 105, NESTED_DISABLED); // upper half
      expect(result?.mode).toBe('sibling');
      expect(result?.insertAfter).toBe(false);
      editor.destroy();
    });

    it('cursor on LOWER half of a paragraph - returns insertAfter=true + mode "sibling"', () => {
      const editor = makeEditor('<p>Only one</p>');
      const pPos = posOf(editor, (n) => n.type.name === 'paragraph');
      const rects = new Map<number, HTMLElement>([
        [pPos, elWithRect({ top: 100, bottom: 130 })],
      ]);

      const result = computeDropPlacement(viewStub(editor, rects), 50, 125, NESTED_DISABLED); // lower half
      expect(result?.mode).toBe('sibling');
      expect(result?.insertAfter).toBe(true);
      editor.destroy();
    });

    it('cursor in INTER-BLOCK gap canonicalises to "after upper sibling" - mode kept "sibling"', () => {
      // Two stacked paragraphs at distinct Y rects. Cursor on UPPER half of
      // the lower paragraph. Without canonicalisation the resolver would
      // return { upper, insertAfter: true } OR { lower, insertAfter: false }
      // based on Y proximity; canonical path always returns the upper with
      // insertAfter=true so the indicator draws ONE line at the gap.
      const editor = makeEditor('<p>First</p><p>Second</p>');
      const firstPos = 0;
      const secondPos = posOf(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'Second');
      const rects = new Map<number, HTMLElement>([
        [firstPos, elWithRect({ top: 100, bottom: 130 })],
        [secondPos, elWithRect({ top: 130, bottom: 160 })],
      ]);

      const result = computeDropPlacement(viewStub(editor, rects), 50, 135, NESTED_DISABLED); // upper third of "Second"
      expect(result?.mode).toBe('sibling');
      expect(result?.insertAfter).toBe(true);
      // After canonicalisation, pos points to the upper sibling, not the lower.
      expect(result?.pos).toBe(firstPos);
      editor.destroy();
    });

    it('cursor BELOW the last block falls back to closest-by-Y - mode kept "sibling"', () => {
      const editor = makeEditor('<p>Top</p><p>Bottom</p>');
      const firstPos = 0;
      const bottomPos = posOf(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'Bottom');
      const rects = new Map<number, HTMLElement>([
        [firstPos, elWithRect({ top: 100, bottom: 130 })],
        [bottomPos, elWithRect({ top: 130, bottom: 160 })],
      ]);

      const result = computeDropPlacement(viewStub(editor, rects), 50, 500, NESTED_DISABLED); // way below
      expect(result?.mode).toBe('sibling');
      // Closest-by-Y resolves to the bottom paragraph.
      expect(result?.pos).toBe(bottomPos);
      editor.destroy();
    });

    it('cursor ABOVE the first block falls back to closest-by-Y - mode kept "sibling"', () => {
      const editor = makeEditor('<p>Top</p><p>Bottom</p>');
      const firstPos = 0;
      const bottomPos = posOf(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'Bottom');
      const rects = new Map<number, HTMLElement>([
        [firstPos, elWithRect({ top: 100, bottom: 130 })],
        [bottomPos, elWithRect({ top: 130, bottom: 160 })],
      ]);

      const result = computeDropPlacement(viewStub(editor, rects), 50, 0, NESTED_DISABLED); // above first block
      expect(result?.mode).toBe('sibling');
      expect(result?.pos).toBe(firstPos);
      editor.destroy();
    });

    it('heading after paragraph - cursor on LOWER half of heading row resolves to heading + mode "sibling"', () => {
      const editor = makeEditor('<p>Above</p><h2>Title</h2>');
      const aboveP = 0;
      const hPos = posOf(editor, (n) => n.type.name === 'heading');
      const rects = new Map<number, HTMLElement>([
        [aboveP, elWithRect({ top: 100, bottom: 130 })],
        [hPos, elWithRect({ top: 130, bottom: 200 })],
      ]);

      // Lower half of heading (mid = 165) so insertAfter=true and the
      // canonical "upper-sibling" fallback does NOT fire.
      const result = computeDropPlacement(viewStub(editor, rects), 100, 180, NESTED_DISABLED);
      expect(result?.mode).toBe('sibling');
      expect(result?.pos).toBe(hPos);
      expect(result?.insertAfter).toBe(true);
      editor.destroy();
    });
  });

  describe('Mode B (nested deepest-Y match)', () => {
    it('cursor over a listItem inside a bulletList resolves to listItem + mode "sibling"', () => {
      const editor = makeEditor('<ul><li><p>Apple</p></li><li><p>Banana</p></li></ul>');
      const ulPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const liApple = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Apple');
      const liBanana = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Banana');
      const rects = new Map<number, HTMLElement>([
        [ulPos, elWithRect({ top: 100, bottom: 200 })],
        [liApple, elWithRect({ top: 100, bottom: 150 })],
        [liBanana, elWithRect({ top: 150, bottom: 200 })],
      ]);

      const result = computeDropPlacement(viewStub(editor, rects), 100, 125, NESTED_LIST);
      expect(result?.mode).toBe('sibling');
      expect(result?.targetItemPos).toBeUndefined();
      expect(result?.wrapperPos).toBeUndefined();
      editor.destroy();
    });

    it('cursor on lower half of a taskItem resolves to that item + mode "sibling" + insertAfter=true', () => {
      const editor = makeEditor(
        '<ul data-type="taskList"><li data-type="taskItem"><p>One</p></li><li data-type="taskItem"><p>Two</p></li></ul>',
      );
      const tlPos = posOf(editor, (n) => n.type.name === 'taskList');
      const liOne = posOf(editor, (n) => n.type.name === 'taskItem' && n.textContent === 'One');
      const liTwo = posOf(editor, (n) => n.type.name === 'taskItem' && n.textContent === 'Two');
      const rects = new Map<number, HTMLElement>([
        [tlPos, elWithRect({ top: 100, bottom: 200 })],
        [liOne, elWithRect({ top: 100, bottom: 150 })],
        [liTwo, elWithRect({ top: 150, bottom: 200 })],
      ]);

      // Lower half of liTwo (170 > 175 mid? mid is 175, so 180 is lower half)
      const result = computeDropPlacement(viewStub(editor, rects), 100, 180, NESTED_LIST);
      expect(result?.mode).toBe('sibling');
      expect(result?.insertAfter).toBe(true);
      expect(result?.pos).toBe(liTwo);
      editor.destroy();
    });

    it('inter-listItem gap canonicalises (mode "sibling" preserved through prev-sibling fallback)', () => {
      const editor = makeEditor('<ul><li><p>Apple</p></li><li><p>Banana</p></li></ul>');
      const ulPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const liApple = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Apple');
      const liBanana = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Banana');
      const rects = new Map<number, HTMLElement>([
        [ulPos, elWithRect({ top: 100, bottom: 200 })],
        [liApple, elWithRect({ top: 100, bottom: 150 })],
        [liBanana, elWithRect({ top: 150, bottom: 200 })],
      ]);

      // Upper half of Banana - canonical path picks Apple with insertAfter=true.
      const result = computeDropPlacement(viewStub(editor, rects), 100, 155, NESTED_LIST);
      expect(result?.mode).toBe('sibling');
      expect(result?.pos).toBe(liApple);
      expect(result?.insertAfter).toBe(true);
      editor.destroy();
    });
  });

  describe('Type narrowing', () => {
    it('"sibling" mode never reads as "nested" - TS branch on mode is exhaustive', () => {
      // Compile-time-ish check: the runtime returns 'sibling', so the
      // 'nested' branch must never execute. This guards against future
      // accidental promotion (e.g. someone changes mode to 'nested' on a
      // wrong return path before X-detection is wired in).
      const editor = makeEditor('<p>X</p>');
      const pPos = 0;
      const rects = new Map<number, HTMLElement>([
        [pPos, elWithRect({ top: 100, bottom: 130 })],
      ]);
      const result: DropPlacement | null = computeDropPlacement(viewStub(editor, rects), 50, 115, NESTED_DISABLED);
      if (!result) throw new Error('expected non-null');

      // Exhaustive switch - if a new mode value sneaks in, this test
      // surfaces it via the default branch throwing.
      switch (result.mode) {
        case 'sibling':
          expect(result.targetItemPos).toBeUndefined();
          expect(result.wrapperPos).toBeUndefined();
          break;
        case 'nested':
          throw new Error('Phase 2 invariant broken: nested mode produced before X-detection ships');
        default: {
          const _exhaustive: never = result.mode;
          throw new Error(`unexpected mode: ${String(_exhaustive)}`);
        }
      }
      editor.destroy();
    });

    it('exported DropPlacement interface accepts a "nested" placement shape (forward-compat type test)', () => {
      // Ensures the type allows both modes once Phase 3 wires up the
      // detection. Constructed shape is for type-checking only - not
      // produced by the runtime yet.
      const nestedShape: DropPlacement = {
        pos: 100,
        rect: new DOMRect(0, 0, 0, 0),
        insertAfter: false,
        mode: 'nested',
        targetItemPos: 105,
        wrapperPos: 95,
      };
      expect(nestedShape.mode).toBe('nested');
      expect(nestedShape.targetItemPos).toBe(105);
      expect(nestedShape.wrapperPos).toBe(95);
    });

    it('"sibling" placement compiles WITHOUT targetItemPos / wrapperPos (optional)', () => {
      const siblingShape: DropPlacement = {
        pos: 0,
        rect: new DOMRect(),
        insertAfter: false,
        mode: 'sibling',
      };
      expect(siblingShape.mode).toBe('sibling');
      expect(siblingShape.targetItemPos).toBeUndefined();
      expect(siblingShape.wrapperPos).toBeUndefined();
    });
  });
});
