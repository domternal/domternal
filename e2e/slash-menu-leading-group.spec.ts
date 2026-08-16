/**
 * The slash menu's leading group, the one with no heading.
 *
 * An ungrouped item leads the menu. Every free extension declares a group, so
 * a free build shows no such section and no separator rule, which ships with
 * whichever package supplies the ungrouped item rather than with the theme.
 * The Pro suite owns the other half.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

const GROUP = '.dm-slash-command-group';
const LABEL = '.dm-slash-command-group-label';
const ITEM = '.dm-slash-command-item';

async function openSlashMenu(page: Page, target: DemoTarget): Promise<void> {
  await page.goto(target.baseURL + '/');
  await page.waitForSelector(target.notionToggle);
  await page.click(target.notionToggle);
  await page.waitForSelector(target.editorSelector);
  await page.click(`${target.editorSelector} > *:first-child`);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await expect(page.locator(ITEM).first()).toBeVisible();
}

/** Every child of the popup in document order, tagged by what it is. */
function popupOutline(page: Page): Promise<{ kind: string }[]> {
  return page.evaluate(
    ({ groupSelector, labelSelector }) => {
      const first = document.querySelector(groupSelector);
      const root = first?.parentElement;
      if (!root) return [];
      return Array.from(root.children).map((child) => ({
        kind: child.matches(labelSelector)
          ? 'label'
          : child.matches(groupSelector)
            ? 'group'
            : 'other',
      }));
    },
    { groupSelector: GROUP, labelSelector: LABEL },
  );
}

function itemLabels(page: Page): Promise<string[]> {
  return page.evaluate(
    (selector) =>
      Array.from(document.querySelectorAll(selector)).map((element) =>
        (element.querySelector('.dm-slash-command-item-label')?.textContent ?? '').trim(),
      ),
    ITEM,
  );
}

for (const target of demoTargets) {
  test.describe(`${target.name} slash menu without a leading group`, () => {
    test('every group has a heading, so the menu opens on a category', async ({ page }) => {
      await openSlashMenu(page, target);

      const outline = await popupOutline(page);
      expect(outline.length, 'the popup rendered something').toBeGreaterThan(1);
      expect(outline[0]?.kind, 'the first child is a heading, not a group').toBe('label');
      const headless = outline.filter(
        (child, index) => child.kind === 'group' && outline[index - 1]?.kind !== 'label',
      );
      expect(headless, 'no group is missing its heading').toEqual([]);
    });

    test('no rule is drawn above the first heading', async ({ page }) => {
      // Nothing here supplies a leading ungrouped item, so no line over nothing.
      await openSlashMenu(page, target);

      const border = await page
        .locator(LABEL)
        .first()
        .evaluate((element) => getComputedStyle(element).borderTopWidth);
      expect(border).toBe('0px');
    });

    test('the headings stay in one uninterrupted run', async ({ page }) => {
      await openSlashMenu(page, target);
      const labels = await itemLabels(page);

      const first = labels.indexOf('Heading 1');
      expect(first, 'Heading 1 is in the menu').toBeGreaterThanOrEqual(0);
      expect(labels.slice(first, first + 3), 'nothing is wedged between them').toEqual([
        'Heading 1',
        'Heading 2',
        'Heading 3',
      ]);
    });

    test('every item keeps its description', async ({ page }) => {
      // A leading item with no description must not become descriptions
      // dropped menu-wide.
      await openSlashMenu(page, target);

      const missing = await page.evaluate(
        (selector) =>
          Array.from(document.querySelectorAll(selector))
            .filter(
              (element) => element.querySelector('.dm-slash-command-item-description') === null,
            )
            .map((element) =>
              (element.querySelector('.dm-slash-command-item-label')?.textContent ?? '').trim(),
            ),
        ITEM,
      );
      expect(missing, 'these rows lost their description').toEqual([]);
    });
  });
}
