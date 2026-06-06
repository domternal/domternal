/**
 * Unit coverage for `computeDropPlacement`. The DropPlacement shape carries
 * `mode: 'sibling' | 'nested'` plus optional `targetItemPos` / `wrapperPos`.
 * These tests lock the contract across all resolver branches:
 *
 *  1. Empty doc → null
 *  2. Mode A (top-level only) - cursor inside / at top / below last
 *  3. Inter-block gap canonicalisation
 *  4. Mode B (nested deepest-Y match)
 *  5. X-threshold detection (nested mode)
 *  6. Type-narrowing - 'sibling' branch never carries targetItemPos
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
  OrderedList,
  ListItem,
  TaskList,
  TaskItem,
  Editor,
} from '@domternal/core';
import type { EditorView } from '@domternal/pm/view';
import { computeDropPlacement, resolveNestedConfig, type DropPlacement } from './BlockHandle.js';

const extensions = [Document, Text, Paragraph, Heading, BulletList, OrderedList, ListItem, TaskList, TaskItem];

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

      // nestThreshold=0 disables X-detection so the sibling-only path runs.
      // Default threshold of 28 would otherwise flip clientX=100 over a list
      // item rect into nested mode (covered by the nested-mode tests below).
      const result = computeDropPlacement(viewStub(editor, rects), 100, 125, NESTED_LIST, 0);
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

      // Lower half of liTwo (mid=175, Y=180 lower). nestThreshold=0
      // disables nested-mode so the result stays sibling regardless of X.
      const result = computeDropPlacement(viewStub(editor, rects), 100, 180, NESTED_LIST, 0);
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
      // nestThreshold=0 keeps the test on the sibling-only path so the
      // canonical inter-item gap behaviour remains the assertion target.
      const result = computeDropPlacement(viewStub(editor, rects), 100, 155, NESTED_LIST, 0);
      expect(result?.mode).toBe('sibling');
      expect(result?.pos).toBe(liApple);
      expect(result?.insertAfter).toBe(true);
      editor.destroy();
    });
  });

  describe('X-threshold detection (nested mode)', () => {
    // Default threshold is 28px from the LEFT edge of the target rect.
    // All tests here use a target rect with `left: 0` so `clientX` maps
    // 1:1 to "px from left edge".

    it('cursor with X >= threshold over a listItem returns mode "nested" + targetItemPos + wrapperPos', () => {
      const editor = makeEditor('<ul><li><p>Apple</p></li></ul>');
      const ulPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const liApple = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Apple');
      const rects = new Map<number, HTMLElement>([
        [ulPos, elWithRect({ top: 100, bottom: 150 })],
        [liApple, elWithRect({ top: 100, bottom: 150 })],
      ]);

      const result = computeDropPlacement(viewStub(editor, rects), 50, 125, NESTED_LIST);
      expect(result?.mode).toBe('nested');
      expect(result?.targetItemPos).toBe(liApple);
      expect(result?.wrapperPos).toBe(ulPos);
      editor.destroy();
    });

    it('cursor with X just BELOW threshold (27 < 28) over a listItem stays sibling', () => {
      const editor = makeEditor('<ul><li><p>Apple</p></li></ul>');
      const ulPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const liApple = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Apple');
      const rects = new Map<number, HTMLElement>([
        [ulPos, elWithRect({ top: 100, bottom: 150 })],
        [liApple, elWithRect({ top: 100, bottom: 150 })],
      ]);

      const result = computeDropPlacement(viewStub(editor, rects), 27, 125, NESTED_LIST);
      expect(result?.mode).toBe('sibling');
      editor.destroy();
    });

    it('cursor with X EXACTLY at threshold (28) flips to nested', () => {
      // `>= threshold` is the boundary so the threshold value itself is
      // already in the nested zone (matches Notion's "everything past
      // the bullet is the indent zone").
      const editor = makeEditor('<ul><li><p>Apple</p></li></ul>');
      const ulPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const liApple = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Apple');
      const rects = new Map<number, HTMLElement>([
        [ulPos, elWithRect({ top: 100, bottom: 150 })],
        [liApple, elWithRect({ top: 100, bottom: 150 })],
      ]);

      const result = computeDropPlacement(viewStub(editor, rects), 28, 125, NESTED_LIST);
      expect(result?.mode).toBe('nested');
      editor.destroy();
    });

    it('cursor with Y ABOVE the listItem rect stays sibling even with nested-zone X', () => {
      const editor = makeEditor('<ul><li><p>Apple</p></li><li><p>Banana</p></li></ul>');
      const ulPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const liApple = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Apple');
      const liBanana = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Banana');
      const rects = new Map<number, HTMLElement>([
        [ulPos, elWithRect({ top: 100, bottom: 200 })],
        [liApple, elWithRect({ top: 100, bottom: 150 })],
        [liBanana, elWithRect({ top: 150, bottom: 200 })],
      ]);

      // Y=140 is on liApple (resolved.rect contains it). X=50 is in nested zone.
      // But the resolver lands on liApple at Y=140; that IS inside its rect.
      // To force "Y above" we need clientY < resolved.rect.top - which means
      // the resolver wouldn't land on a list item in the first place. This
      // test instead simulates "above the FIRST listItem" by stubbing only
      // the wrapper rect and pointing Y just above the wrapper - resolver
      // falls back to closest-by-Y on the wrapper itself, not on a listItem.
      const result = computeDropPlacement(viewStub(editor, rects), 50, 90, NESTED_LIST);
      // Above the first listItem -> closest-by-Y resolves to a non-listItem
      // top-level fallback OR to the closest item; either way the X path
      // checks isInsideY which fails when the rect doesn't contain Y.
      expect(result?.mode).toBe('sibling');
      editor.destroy();
    });

    it('cursor over a non-listItem target (paragraph) stays sibling regardless of X', () => {
      // X-detection only fires for listItem/taskItem targets.
      const editor = makeEditor('<p>Hello world</p>');
      const pPos = 0;
      const rects = new Map<number, HTMLElement>([
        [pPos, elWithRect({ top: 100, bottom: 130 })],
      ]);

      // Even with X=200 (well past 28px threshold), a paragraph target
      // stays in sibling mode.
      const result = computeDropPlacement(viewStub(editor, rects), 200, 115, NESTED_LIST);
      expect(result?.mode).toBe('sibling');
      editor.destroy();
    });

    it('taskItem target with nested-zone X returns mode "nested" (parity with bulletList)', () => {
      const editor = makeEditor('<ul data-type="taskList"><li data-type="taskItem"><p>Task</p></li></ul>');
      const tlPos = posOf(editor, (n) => n.type.name === 'taskList');
      const liTask = posOf(editor, (n) => n.type.name === 'taskItem' && n.textContent === 'Task');
      const rects = new Map<number, HTMLElement>([
        [tlPos, elWithRect({ top: 100, bottom: 150 })],
        [liTask, elWithRect({ top: 100, bottom: 150 })],
      ]);

      const result = computeDropPlacement(viewStub(editor, rects), 50, 125, NESTED_LIST);
      expect(result?.mode).toBe('nested');
      expect(result?.targetItemPos).toBe(liTask);
      expect(result?.wrapperPos).toBe(tlPos);
      editor.destroy();
    });

    it('orderedList listItem with nested-zone X returns mode "nested"', () => {
      const editor = makeEditor('<ol><li><p>One</p></li></ol>');
      const olPos = posOf(editor, (n) => n.type.name === 'orderedList');
      const liOne = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'One');
      const rects = new Map<number, HTMLElement>([
        [olPos, elWithRect({ top: 100, bottom: 150 })],
        [liOne, elWithRect({ top: 100, bottom: 150 })],
      ]);

      const result = computeDropPlacement(viewStub(editor, rects), 50, 125, NESTED_LIST);
      expect(result?.mode).toBe('nested');
      expect(result?.targetItemPos).toBe(liOne);
      expect(result?.wrapperPos).toBe(olPos);
      editor.destroy();
    });

    it('nestThreshold=0 disables nested mode entirely (every X stays sibling)', () => {
      const editor = makeEditor('<ul><li><p>Apple</p></li></ul>');
      const ulPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const liApple = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Apple');
      const rects = new Map<number, HTMLElement>([
        [ulPos, elWithRect({ top: 100, bottom: 150 })],
        [liApple, elWithRect({ top: 100, bottom: 150 })],
      ]);

      // X=500 is way past any reasonable threshold but nestThreshold=0 disables.
      const result = computeDropPlacement(viewStub(editor, rects), 500, 125, NESTED_LIST, 0);
      expect(result?.mode).toBe('sibling');
      editor.destroy();
    });

    it('custom nestThreshold=50 - X=49 stays sibling, X=50 flips to nested', () => {
      const editor = makeEditor('<ul><li><p>Apple</p></li></ul>');
      const ulPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const liApple = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Apple');
      const rects = new Map<number, HTMLElement>([
        [ulPos, elWithRect({ top: 100, bottom: 150 })],
        [liApple, elWithRect({ top: 100, bottom: 150 })],
      ]);

      const below = computeDropPlacement(viewStub(editor, rects), 49, 125, NESTED_LIST, 50);
      expect(below?.mode).toBe('sibling');

      const at = computeDropPlacement(viewStub(editor, rects), 50, 125, NESTED_LIST, 50);
      expect(at?.mode).toBe('nested');
      editor.destroy();
    });

    it('cursor with X to the LEFT of the target rect (negative xInTarget) stays sibling', () => {
      // Left rect edge=200; clientX=10 -> xInTarget=-190 (outside target).
      // X-detection requires xInTarget >= 0 AND >= threshold.
      const editor = makeEditor('<ul><li><p>Apple</p></li></ul>');
      const ulPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const liApple = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Apple');
      const rects = new Map<number, HTMLElement>([
        [ulPos, elWithRect({ top: 100, bottom: 150, left: 200, right: 800 })],
        [liApple, elWithRect({ top: 100, bottom: 150, left: 200, right: 800 })],
      ]);

      const result = computeDropPlacement(viewStub(editor, rects), 10, 125, NESTED_LIST);
      expect(result?.mode).toBe('sibling');
      editor.destroy();
    });

    it('cursor with X past the RIGHT edge of the target rect stays sibling', () => {
      // Right rect edge=200; clientX=300 -> xInTarget=100, but >width=200.
      const editor = makeEditor('<ul><li><p>Apple</p></li></ul>');
      const ulPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const liApple = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Apple');
      const rects = new Map<number, HTMLElement>([
        [ulPos, elWithRect({ top: 100, bottom: 150, left: 0, right: 200 })],
        [liApple, elWithRect({ top: 100, bottom: 150, left: 0, right: 200 })],
      ]);

      const result = computeDropPlacement(viewStub(editor, rects), 300, 125, NESTED_LIST);
      expect(result?.mode).toBe('sibling');
      editor.destroy();
    });

    it('default threshold (28) is applied when no nestThreshold arg is passed', () => {
      // Verify the param default. clientX=28 must flip to nested.
      const editor = makeEditor('<ul><li><p>Apple</p></li></ul>');
      const ulPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const liApple = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Apple');
      const rects = new Map<number, HTMLElement>([
        [ulPos, elWithRect({ top: 100, bottom: 150 })],
        [liApple, elWithRect({ top: 100, bottom: 150 })],
      ]);

      const result = computeDropPlacement(viewStub(editor, rects), 28, 125, NESTED_LIST);
      expect(result?.mode).toBe('nested');
      editor.destroy();
    });

    it('wrapperPos for a NESTED listItem (li inside li) returns the INNER list wrapper, not the outer one', () => {
      // Doc shape:
      //   bulletList (outer)
      //   └─ listItem (outer)
      //      ├─ paragraph "Outer label"
      //      └─ bulletList (inner)
      //         └─ listItem (inner) "Inner"
      // Drop with nested-zone X on the INNER listItem must surface the
      // INNER ul as wrapperPos so the tr math inserts the dragged block
      // as a child of the INNER listItem, not the outer one.
      const editor = makeEditor(
        '<ul><li><p>Outer label</p><ul><li><p>Inner</p></li></ul></li></ul>',
      );
      const innerLiPos = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Inner');
      // The inner ul sits one position before the inner listItem.
      // Compute by walking parent chain: doc.resolve(innerLiPos).before().
      const $inner = editor.state.doc.resolve(innerLiPos);
      const expectedInnerUl = $inner.before();

      const rects = new Map<number, HTMLElement>([
        [innerLiPos, elWithRect({ top: 100, bottom: 150 })],
        [expectedInnerUl, elWithRect({ top: 100, bottom: 150 })],
      ]);

      const result = computeDropPlacement(viewStub(editor, rects), 50, 125, NESTED_LIST);
      expect(result?.mode).toBe('nested');
      expect(result?.targetItemPos).toBe(innerLiPos);
      // wrapperPos must equal the INNER ul's position, not the outer ul.
      expect(result?.wrapperPos).toBe(expectedInnerUl);
      editor.destroy();
    });

    it('nested mode keeps Y-mid based insertAfter so the existing pipeline produces an unchanged sibling-style move', () => {
      // Nested mode sets `mode='nested'` but does NOT change `insertAfter`:
      // the field continues to mirror cursor Y vs rect mid-line. The drop
      // pipeline's nested branch ignores insertAfter and dispatches via
      // `insertAsListItemChild` instead.
      const editor = makeEditor('<ul><li><p>Apple</p></li></ul>');
      const ulPos = posOf(editor, (n) => n.type.name === 'bulletList');
      const liApple = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Apple');
      const rects = new Map<number, HTMLElement>([
        [ulPos, elWithRect({ top: 100, bottom: 150 })],
        [liApple, elWithRect({ top: 100, bottom: 150 })],
      ]);

      // Lower half of the item (mid=125, Y=145 lower) -> insertAfter=true.
      const lower = computeDropPlacement(viewStub(editor, rects), 50, 145, NESTED_LIST);
      expect(lower?.mode).toBe('nested');
      expect(lower?.insertAfter).toBe(true);

      // Upper half (Y=110 upper) -> insertAfter=false.
      const upper = computeDropPlacement(viewStub(editor, rects), 50, 110, NESTED_LIST);
      expect(upper?.mode).toBe('nested');
      expect(upper?.insertAfter).toBe(false);
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
          throw new Error('sibling-mode invariant broken: nested mode produced on a non-nested resolver branch');
        default: {
          const _exhaustive: never = result.mode;
          throw new Error(`unexpected mode: ${String(_exhaustive)}`);
        }
      }
      editor.destroy();
    });

    it('exported DropPlacement interface accepts a "nested" placement shape (forward-compat type test)', () => {
      // Ensures the type allows both placement modes. Constructed shape
      // is for type-checking only.
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

describe('computeDropPlacement - hysteresis (drag-session stickiness)', () => {
  // li-inside-li fixture: the outer item rect (100-300) spans its label PLUS
  // a nested sublist; the inner item is short (150-200). The boundary at
  // inner.top=150 is where "smallest height wins" flips the resolver. Tests
  // use nestThreshold=0 to stay on the sibling path so the assertion can
  // target which ITEM the resolver locked onto (exposed via resolvedBlockPos).
  function nestedView(editor: Editor, outerLi: number, innerLi: number): EditorView {
    const rects = new Map<number, HTMLElement>([
      [outerLi, elWithRect({ top: 100, bottom: 300 })],
      [innerLi, elWithRect({ top: 150, bottom: 200 })],
    ]);
    return viewStub(editor, rects);
  }

  function listItemView(editor: Editor): EditorView {
    const ulPos = posOf(editor, (n) => n.type.name === 'bulletList');
    const liApple = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Apple');
    const rects = new Map<number, HTMLElement>([
      [ulPos, elWithRect({ top: 100, bottom: 150 })],
      [liApple, elWithRect({ top: 100, bottom: 150 })],
    ]);
    return viewStub(editor, rects);
  }

  it('exposes resolvedBlockPos for incumbent tracking', () => {
    const editor = makeEditor('<ul><li><p>Apple</p></li></ul>');
    const liApple = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Apple');
    const result = computeDropPlacement(listItemView(editor), 100, 125, NESTED_LIST, 0);
    expect(result?.resolvedBlockPos).toBe(liApple);
    editor.destroy();
  });

  it('Y-hysteresis: incumbent=inner keeps the resolver on the inner item through a sub-band wobble', () => {
    const editor = makeEditor('<ul><li><p>Outer label</p><ul><li><p>Inner</p></li></ul></li></ul>');
    const outerLi = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent.startsWith('Outer'));
    const innerLi = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Inner');
    const view = nestedView(editor, outerLi, innerLi);

    // Baseline: Y=147 (3px above inner.top=150) with no incumbent -> outer.
    const baseline = computeDropPlacement(view, 100, 147, NESTED_LIST, 0);
    expect(baseline?.resolvedBlockPos).toBe(outerLi);

    // Same cursor, inner as incumbent + hysteresis on -> stays on inner.
    const sticky = computeDropPlacement(view, 100, 147, NESTED_LIST, 0, {
      incumbentPos: innerLi,
      hysteresis: true,
    });
    expect(sticky?.resolvedBlockPos).toBe(innerLi);
    editor.destroy();
  });

  it('Y-hysteresis: incumbent yields once the cursor crosses decisively (beyond the band)', () => {
    const editor = makeEditor('<ul><li><p>Outer label</p><ul><li><p>Inner</p></li></ul></li></ul>');
    const outerLi = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent.startsWith('Outer'));
    const innerLi = posOf(editor, (n) => n.type.name === 'listItem' && n.textContent === 'Inner');
    const view = nestedView(editor, outerLi, innerLi);

    // Y=142 is 8px above inner.top, past the 6px band -> back to outer.
    const result = computeDropPlacement(view, 100, 142, NESTED_LIST, 0, {
      incumbentPos: innerLi,
      hysteresis: true,
    });
    expect(result?.resolvedBlockPos).toBe(outerLi);
    editor.destroy();
  });

  it('X-hysteresis: a latched nested mode stays nested in the band where an unlatched cursor would not enter', () => {
    // Asymmetric: enter at threshold 28, sticky-exit at 28-8=20. X=24 sits in
    // [20, 28), so the result depends purely on the latch.
    const editor = makeEditor('<ul><li><p>Apple</p></li></ul>');
    const view = listItemView(editor);

    const fromSibling = computeDropPlacement(view, 24, 125, NESTED_LIST, 28, {
      nestLatched: false,
      hysteresis: true,
    });
    expect(fromSibling?.mode).toBe('sibling');

    const fromNested = computeDropPlacement(view, 24, 125, NESTED_LIST, 28, {
      nestLatched: true,
      hysteresis: true,
    });
    expect(fromNested?.mode).toBe('nested');
    editor.destroy();
  });

  it('X-hysteresis: a latched nested mode leaves only once X drops below threshold-band', () => {
    const editor = makeEditor('<ul><li><p>Apple</p></li></ul>');
    const view = listItemView(editor);

    // X=18 (<20 leave threshold) drops nested even when latched.
    const result = computeDropPlacement(view, 18, 125, NESTED_LIST, 28, {
      nestLatched: true,
      hysteresis: true,
    });
    expect(result?.mode).toBe('sibling');
    editor.destroy();
  });

  it('without the hysteresis flag the nestThreshold stays a hard step regardless of latch', () => {
    const editor = makeEditor('<ul><li><p>Apple</p></li></ul>');
    const view = listItemView(editor);

    // X=30 >= 28 and no hysteresis flag -> nested even though nestLatched is false.
    const result = computeDropPlacement(view, 30, 125, NESTED_LIST, 28, { nestLatched: false });
    expect(result?.mode).toBe('nested');
    editor.destroy();
  });
});

describe('computeDropPlacement - position-aware nested child slot', () => {
  // A single list item with a label + two block children: [L, A, B]. The
  // item rect spans all three (100-220); each child gets its own band.
  function multiChildView(editor: Editor): {
    view: EditorView;
    liPos: number;
  } {
    const ulPos = posOf(editor, (n) => n.type.name === 'bulletList');
    const liPos = posOf(editor, (n) => n.type.name === 'listItem');
    const pL = posOf(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'L');
    const pA = posOf(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'A');
    const pB = posOf(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'B');
    const rects = new Map<number, HTMLElement>([
      [ulPos, elWithRect({ top: 100, bottom: 220 })],
      [liPos, elWithRect({ top: 100, bottom: 220 })],
      [pL, elWithRect({ top: 100, bottom: 140 })],
      [pA, elWithRect({ top: 140, bottom: 180 })], // mid = 160
      [pB, elWithRect({ top: 180, bottom: 220 })], // mid = 200
    ]);
    return { view: viewStub(editor, rects), liPos };
  }

  it('cursor in the FIRST-child zone (below label, above first child mid) resolves childIndex 1', () => {
    const editor = makeEditor('<ul><li><p>L</p><p>A</p><p>B</p></li></ul>');
    const { view } = multiChildView(editor);
    const r = computeDropPlacement(view, 50, 145, NESTED_LIST); // 145 < A.mid(160)
    expect(r?.mode).toBe('nested');
    expect(r?.childIndex).toBe(1);
    expect(r?.nestedGapRect).toBeDefined();
    editor.destroy();
  });

  it('cursor in a BETWEEN zone (past first child mid) resolves childIndex 2', () => {
    const editor = makeEditor('<ul><li><p>L</p><p>A</p><p>B</p></li></ul>');
    const { view } = multiChildView(editor);
    const r = computeDropPlacement(view, 50, 170, NESTED_LIST); // A.mid(160) <= 170 < B.mid(200)
    expect(r?.mode).toBe('nested');
    expect(r?.childIndex).toBe(2);
    editor.destroy();
  });

  it('cursor in the LAST zone (past last child mid) resolves childIndex === childCount (append)', () => {
    const editor = makeEditor('<ul><li><p>L</p><p>A</p><p>B</p></li></ul>');
    const { view } = multiChildView(editor);
    const r = computeDropPlacement(view, 50, 210, NESTED_LIST); // >= B.mid(200)
    expect(r?.mode).toBe('nested');
    expect(r?.childIndex).toBe(3); // childCount of [L,A,B]
    editor.destroy();
  });

  it('an empty-children item (label only) resolves childIndex 1', () => {
    const editor = makeEditor('<ul><li><p>Solo</p></li></ul>');
    const ulPos = posOf(editor, (n) => n.type.name === 'bulletList');
    const liPos = posOf(editor, (n) => n.type.name === 'listItem');
    const pSolo = posOf(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'Solo');
    const rects = new Map<number, HTMLElement>([
      [ulPos, elWithRect({ top: 100, bottom: 140 })],
      [liPos, elWithRect({ top: 100, bottom: 140 })],
      [pSolo, elWithRect({ top: 100, bottom: 140 })],
    ]);
    const r = computeDropPlacement(viewStub(editor, rects), 50, 120, NESTED_LIST);
    expect(r?.mode).toBe('nested');
    expect(r?.childIndex).toBe(1);
    editor.destroy();
  });

  it('child-slot hysteresis: incumbentChildIndex sticks within the band, flips past it', () => {
    const editor = makeEditor('<ul><li><p>L</p><p>A</p><p>B</p></li></ul>');
    const { view } = multiChildView(editor);

    // Y=163 is 3px past A.mid(160). Stateless -> index 2.
    const stateless = computeDropPlacement(view, 50, 163, NESTED_LIST);
    expect(stateless?.childIndex).toBe(2);

    // With incumbent=1 + hysteresis, 3px (< 6px band) keeps index 1.
    const sticky = computeDropPlacement(view, 50, 163, NESTED_LIST, 28, {
      incumbentChildIndex: 1,
      hysteresis: true,
    });
    expect(sticky?.childIndex).toBe(1);

    // 10px past the boundary (> band) flips to 2 even with incumbent=1.
    const flipped = computeDropPlacement(view, 50, 170, NESTED_LIST, 28, {
      incumbentChildIndex: 1,
      hysteresis: true,
    });
    expect(flipped?.childIndex).toBe(2);
    editor.destroy();
  });

  it('sibling placements never carry childIndex / nestedGapRect', () => {
    const editor = makeEditor('<ul><li><p>L</p><p>A</p><p>B</p></li></ul>');
    const { view } = multiChildView(editor);
    // nestThreshold=0 forces sibling mode.
    const r = computeDropPlacement(view, 50, 145, NESTED_LIST, 0);
    expect(r?.mode).toBe('sibling');
    expect(r?.childIndex).toBeUndefined();
    expect(r?.nestedGapRect).toBeUndefined();
    editor.destroy();
  });

  describe('flagship: outer item with a nested sublist', () => {
    // taskItem "AI" whose children are [label, nested taskList]. The outer
    // item is the deepest match ONLY in the label band (Y 100-145); the
    // nested list rows resolve to the INNER item (deepest-match).
    function flagshipView(editor: Editor): {
      view: EditorView;
      outerTI: number;
      innerTI: number;
    } {
      const outerTL = posOf(editor, (n) => n.type.name === 'taskList');
      const outerTI = posOf(editor, (n) => n.type.name === 'taskItem');
      const pAI = posOf(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'AI');
      const innerTI = posOf(editor, (n) => n.type.name === 'taskItem' && n.textContent === 'Wire');
      const innerTL = editor.state.doc.resolve(innerTI).before();
      const pWire = posOf(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'Wire');
      const rects = new Map<number, HTMLElement>([
        [outerTL, elWithRect({ top: 100, bottom: 300 })],
        [outerTI, elWithRect({ top: 100, bottom: 300 })],
        [pAI, elWithRect({ top: 100, bottom: 145 })],
        [innerTL, elWithRect({ top: 150, bottom: 300 })],
        [innerTI, elWithRect({ top: 150, bottom: 200 })],
        [pWire, elWithRect({ top: 150, bottom: 200 })],
      ]);
      return { view: viewStub(editor, rects), outerTI, innerTI };
    }

    const FLAGSHIP_HTML =
      '<ul data-type="taskList"><li data-type="taskItem"><p>AI</p>' +
      '<ul data-type="taskList"><li data-type="taskItem"><p>Wire</p></li></ul>' +
      '</li></ul>';

    it('cursor in the outer label band resolves to the OUTER item at childIndex 1 (before the sublist)', () => {
      const editor = makeEditor(FLAGSHIP_HTML);
      const { view, outerTI } = flagshipView(editor);
      const r = computeDropPlacement(view, 50, 130, NESTED_LIST); // label band
      expect(r?.mode).toBe('nested');
      expect(r?.targetItemPos).toBe(outerTI);
      expect(r?.childIndex).toBe(1);
      editor.destroy();
    });

    it('cursor on a nested-list row resolves to the INNER item (documented reachability limit)', () => {
      const editor = makeEditor(FLAGSHIP_HTML);
      const { view, innerTI } = flagshipView(editor);
      const r = computeDropPlacement(view, 50, 170, NESTED_LIST); // inner row
      expect(r?.mode).toBe('nested');
      expect(r?.targetItemPos).toBe(innerTI);
      editor.destroy();
    });
  });

  it('the nested gap takes left/width from the ITEM, not the (indented) child', () => {
    // Item rect left=10/width=500; child A is indented to left=40. The first-
    // child gap must align to the item's content column (10), not A's 40, so
    // the indented indicator lands where a child block actually renders.
    const editor = makeEditor('<ul><li><p>L</p><p>A</p></li></ul>');
    const ulPos = posOf(editor, (n) => n.type.name === 'bulletList');
    const liPos = posOf(editor, (n) => n.type.name === 'listItem');
    const pL = posOf(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'L');
    const pA = posOf(editor, (n) => n.type.name === 'paragraph' && n.textContent === 'A');
    const rects = new Map<number, HTMLElement>([
      [ulPos, elWithRect({ top: 100, bottom: 200, left: 10, right: 510 })],
      [liPos, elWithRect({ top: 100, bottom: 200, left: 10, right: 510 })],
      [pL, elWithRect({ top: 100, bottom: 150, left: 10, right: 510 })],
      [pA, elWithRect({ top: 150, bottom: 200, left: 40, right: 510 })],
    ]);
    const r = computeDropPlacement(viewStub(editor, rects), 50, 130, NESTED_LIST); // first-child zone
    expect(r?.childIndex).toBe(1);
    expect(r?.nestedGapRect?.left).toBe(10);
    expect(r?.nestedGapRect?.width).toBe(500);
    editor.destroy();
  });

  it('the X-latch is scoped to the latched item: a different incumbentPos drops the latch', () => {
    const editor = makeEditor('<ul><li><p>Apple</p></li></ul>');
    const liApple = posOf(editor, (n) => n.type.name === 'listItem');
    const ulPos = posOf(editor, (n) => n.type.name === 'bulletList');
    const rects = new Map<number, HTMLElement>([
      [ulPos, elWithRect({ top: 100, bottom: 150 })],
      [liApple, elWithRect({ top: 100, bottom: 150 })],
    ]);
    const view = viewStub(editor, rects);
    // X=24 sits in the sticky band [20, 28): latched only when the incumbent matches.
    const sameItem = computeDropPlacement(view, 24, 125, NESTED_LIST, 28, {
      incumbentPos: liApple, nestLatched: true, hysteresis: true,
    });
    expect(sameItem?.mode).toBe('nested');
    const otherItem = computeDropPlacement(view, 24, 125, NESTED_LIST, 28, {
      incumbentPos: liApple + 9999, nestLatched: true, hysteresis: true,
    });
    expect(otherItem?.mode).toBe('sibling');
    editor.destroy();
  });
});
