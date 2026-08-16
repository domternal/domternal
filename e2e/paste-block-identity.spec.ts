/**
 * Block ids across a real copy and paste.
 *
 * Everything that names a block from outside the document rides on the id: a
 * table-of-contents entry, a `#hash` link, Copy link, and a Pro block comment.
 *
 * Ids are regenerated to avoid a duplicate, judged against the document as it
 * stands at paste time. That is wrong for a paste REPLACING its own source:
 * the incumbents it sees are the blocks about to be deleted. Ctrl+A then
 * Ctrl+V renamed everything, and the next paste, finding those ids free, kept
 * them, so ids flickered on alternate pastes.
 *
 * Driven through the real clipboard, since that is the mechanism under test.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

const CONTENT = '<h1>Title</h1><p>First paragraph</p><p>Second paragraph</p>';

async function openNotionDemo(page: Page, target: DemoTarget): Promise<void> {
  await page.goto(target.baseURL + '/');
  await page.waitForSelector(target.notionToggle);
  await page.click(target.notionToggle);
  await page.waitForSelector(target.editorSelector);
  await page.waitForFunction(
    () => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']),
    { timeout: 5000 },
  );
}

/** Seeds the document and puts the caret in it, so the keyboard reaches it. */
async function seed(page: Page, target: DemoTarget, html: string): Promise<void> {
  await page.evaluate((markup) => {
    const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { setContent: (h: string, emit: boolean) => void }
      | undefined;
    editor?.setContent(markup, false);
  }, html);
  await page.click(`${target.editorSelector} > *:first-child`);
}

/** The id attribute of every top-level block, in document order. */
function blockIds(page: Page, target: DemoTarget): Promise<string[]> {
  return page.evaluate(
    (selector) =>
      Array.from(document.querySelectorAll(`${selector} > *`)).map((element) => element.id),
    target.editorSelector,
  );
}

// `(string | null)[]`, because the two repos' DOM lib types disagree on
// whether `textContent` is nullable, and this file is mirrored between them.
function blockText(page: Page, target: DemoTarget): Promise<(string | null)[]> {
  return page.evaluate(
    (selector) =>
      Array.from(document.querySelectorAll(`${selector} > *`)).map(
        (element) => element.textContent,
      ),
    target.editorSelector,
  );
}

async function selectAll(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+a');
}

/** A paste is several transactions; assert against a settled document. */
async function pasteAndSettle(page: Page, target: DemoTarget): Promise<void> {
  await page.keyboard.press('ControlOrMeta+v');
  let previous: string[] = [];
  await expect
    .poll(
      async () => {
        const current = await blockIds(page, target);
        const stable = current.length > 0 && current.join(',') === previous.join(',');
        previous = current;
        return stable;
      },
      { timeout: 5000, intervals: [100, 100, 100, 100, 100] },
    )
    .toBe(true);
}

for (const target of demoTargets) {
  test.describe(`${target.name} block ids across a copy and paste`, () => {
    test('a paste over the whole document keeps every id, and keeps it on the next paste too', async ({
      page,
    }) => {
      await openNotionDemo(page, target);
      await seed(page, target, CONTENT);

      const before = await blockIds(page, target);
      // The premise: without ids this file compares empty strings to empty
      // strings and passes on anything.
      expect(before, 'the demo seeded three blocks').toHaveLength(3);
      expect(before.every((id) => id.length > 0), 'every block carries an id').toBe(true);
      expect(new Set(before).size, 'the ids are distinct').toBe(3);

      await selectAll(page);
      await page.keyboard.press('ControlOrMeta+c');
      await selectAll(page);
      await pasteAndSettle(page, target);

      expect(await blockIds(page, target), 'ids survive the paste that replaced them').toEqual(
        before,
      );
      expect(await blockText(page, target)).toEqual([
        'Title',
        'First paragraph',
        'Second paragraph',
      ]);

      // Twice: the defect alternated, so one paste cannot tell a fix from
      // the bug's other half.
      await selectAll(page);
      await pasteAndSettle(page, target);
      expect(await blockIds(page, target), 'and again on the paste after that').toEqual(before);
    });

    test('a copy pasted alongside its original gets fresh ids', async ({ page }) => {
      await openNotionDemo(page, target);
      await seed(page, target, '<p>Only paragraph</p>');

      const before = await blockIds(page, target);
      expect(before).toHaveLength(1);

      await selectAll(page);
      await page.keyboard.press('ControlOrMeta+c');
      // Through the editor, not a navigation key: the caret is setup, and a
      // selection left standing would turn this into the replacement case.
      await page.evaluate(() => {
        const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
          | { commands: { focus: (position: string) => void } }
          | undefined;
        editor?.commands.focus('end');
      });
      await pasteAndSettle(page, target);

      const after = await blockIds(page, target);
      // The original is still here, so the copy is a second, unrelated block
      // and must not answer to the same id.
      expect(after.length, 'the paste added a block').toBeGreaterThan(before.length);
      expect(after[0], 'the original keeps its id').toBe(before[0]);
      expect(new Set(after).size, 'no id is in the document twice').toBe(after.length);
    });

    test('a cut and pasted document keeps its ids', async ({ page }) => {
      await openNotionDemo(page, target);
      await seed(page, target, CONTENT);
      const before = await blockIds(page, target);

      // A cut empties the document first, so nothing holds these ids by paste
      // time. The case a fix could break by over-correcting.
      await selectAll(page);
      await page.keyboard.press('ControlOrMeta+x');
      await expect
        .poll(async () => (await blockText(page, target)).join(''), { timeout: 5000 })
        .toBe('');
      await pasteAndSettle(page, target);

      expect(await blockIds(page, target)).toEqual(before);
    });
  });
}
