/**
 * setContent leaves the caret at the last TEXT position, never a NodeSelection
 * on a trailing atom, across all four demos (commit 9ed2a80).
 *
 * A full-document replace maps the selection to wherever the mapping strands
 * it. For a document ENDING in a leaf atom (e.g. a horizontalRule) that is a
 * NodeSelection on the atom, which disables mark commands and makes the next
 * keystroke REPLACE the atom instead of appending after the seeded content.
 * The setContent command normalizes to `TextSelection.between($end, $end, -1)`
 * (packages/core/src/commands/contentCommands.ts), skipping the atom back to
 * the last text block. These tests seed content ending in an atom and in plain
 * text, then verify the resolved selection and that a typed character appends.
 *
 * Selection kind is read via `selection.toJSON().type` ('text' | 'node' |
 * 'all'), which prosemirror-state serializes from a registered jsonID and is
 * therefore stable under the demos' minified/dev builds alike.
 *
 * The Notion demo does NOT load the TrailingNode extension, so a document ending
 * in `<hr>` genuinely ends in the atom (no auto-appended paragraph); each atom
 * test asserts that premise (`lastChild === 'horizontalRule'`) so it cannot
 * pass for the wrong reason.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

/** Partial shape of the editor exposed at `window.__DEMO_EDITOR__`. */
type DemoEditor = {
  setContent: (html: string, emit: boolean) => void;
  getHTML: () => string;
  getText: () => string;
  commands: { focus: () => void };
  view: {
    state: {
      selection: {
        empty: boolean;
        $head: { parent: { type: { name: string } } };
        toJSON: () => { type: string };
      };
      doc: { lastChild: { type: { name: string } } | null };
    };
  };
};

async function goNotion(page: Page, target: DemoTarget): Promise<void> {
  await page.goto(target.baseURL + '/');
  await page.waitForSelector(target.notionToggle);
  await page.click(target.notionToggle);
  await page.waitForSelector(target.editorSelector);
  await page.waitForFunction(
    () => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']),
    { timeout: 3000 },
  );
}

/**
 * Replace the whole document and focus. `focus()` with no argument only calls
 * `view.focus()` and preserves the selection setContent just resolved (see the
 * focus command in packages/core/src/commands/selectionCommands.ts), so the DOM
 * caret lands exactly where the command placed the state selection.
 */
async function setContent(page: Page, html: string): Promise<void> {
  await page.evaluate((h) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | DemoEditor
      | undefined;
    ed?.setContent(h, false);
    ed?.commands.focus();
  }, html);
}

interface EditorSnapshot {
  /** Selection kind from `selection.toJSON().type`: 'text' | 'node' | 'all'. */
  selectionType: string;
  /** Whether the selection is collapsed to a bare cursor. */
  empty: boolean;
  /** Node type holding the selection head (a text block when the cursor is in text). */
  headParent: string;
  /** Type of the document's last child, to confirm the doc really ends where seeded. */
  lastChild: string;
  html: string;
  text: string;
}

async function snapshot(page: Page): Promise<EditorSnapshot> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | DemoEditor
      | undefined;
    if (!ed) throw new Error('__DEMO_EDITOR__ not found');
    const sel = ed.view.state.selection;
    return {
      selectionType: sel.toJSON().type,
      empty: sel.empty,
      headParent: sel.$head.parent.type.name,
      lastChild: ed.view.state.doc.lastChild?.type.name ?? '',
      html: ed.getHTML(),
      text: ed.getText(),
    };
  });
}

function editorText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | DemoEditor
      | undefined;
    return ed?.getText() ?? '';
  });
}

for (const target of demoTargets) {
  test.describe(`${target.name} - setContent caret landing`, () => {
    test.beforeEach(async ({ page }) => {
      await goNotion(page, target);
    });

    test('content ending in a trailing atom leaves a text caret, so typing appends', async ({ page }) => {
      await setContent(page, '<p>Alpha</p><hr>');

      const before = await snapshot(page);
      // Premise: with no TrailingNode, the document genuinely ends in the atom.
      expect(before.lastChild).toBe('horizontalRule');
      // Contract: a collapsed TEXT selection inside the paragraph, NOT a
      // NodeSelection on the trailing rule (which would report type 'node').
      expect(before.selectionType).toBe('text');
      expect(before.empty).toBe(true);
      expect(before.headParent).toBe('paragraph');

      // Typing a character appends after the seeded text; the atom survives.
      await page.keyboard.type('Z');
      await expect.poll(() => editorText(page)).toContain('AlphaZ');

      const after = await snapshot(page);
      // The rule was not node-selected and replaced: it is still present...
      expect(after.html).toMatch(/<hr[\s>]/);
      // ...and the character glued onto 'Alpha' (a contiguous 'AlphaZ' can only
      // mean it was inserted inside that text run, before the rule).
      expect(after.text).toContain('AlphaZ');
      const hrMatch = /<hr[\s>]/.exec(after.html);
      expect(hrMatch).not.toBeNull();
      const alphaIdx = after.html.indexOf('Alpha');
      expect(alphaIdx).toBeGreaterThanOrEqual(0);
      expect(alphaIdx).toBeLessThan(hrMatch!.index);
    });

    test('an atom-final document that already carries text keeps that text after typing', async ({ page }) => {
      // A leading text block plus a trailing rule: typing must extend the text
      // block, never swap the rule for the typed character.
      await setContent(page, '<p>Bravo</p><p>Charlie</p><hr>');

      const before = await snapshot(page);
      expect(before.lastChild).toBe('horizontalRule');
      expect(before.selectionType).toBe('text');
      expect(before.empty).toBe(true);
      expect(before.headParent).toBe('paragraph');

      await page.keyboard.type('!');
      await expect.poll(() => editorText(page)).toContain('Charlie!');

      const after = await snapshot(page);
      expect(after.html).toMatch(/<hr[\s>]/);
      expect(after.text).toContain('Bravo');
      expect(after.text).toContain('Charlie!');
      // The caret sat at the end of the last TEXT block, so the earlier block
      // is untouched.
      expect(after.text).not.toContain('Bravo!');
    });

    test('content ending in a paragraph lands the caret at the end of the last text block', async ({ page }) => {
      await setContent(page, '<p>First</p><p>Second</p>');

      const before = await snapshot(page);
      expect(before.lastChild).toBe('paragraph');
      expect(before.selectionType).toBe('text');
      expect(before.empty).toBe(true);
      expect(before.headParent).toBe('paragraph');

      await page.keyboard.type('Z');
      await expect.poll(() => editorText(page)).toContain('SecondZ');

      const after = await snapshot(page);
      // Appended to the LAST paragraph; the first paragraph is left alone.
      expect(after.text).toContain('First');
      expect(after.text).toContain('SecondZ');
      expect(after.text).not.toContain('FirstZ');
    });
  });
}
