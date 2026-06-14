/**
 * Notion-mode adjacent-list spacing.
 *
 * Notion chunks consecutive list items together regardless of list subtype:
 * a bullet -> numbered -> to-do run reads as one continuous block, with the
 * same tight gap at a type boundary as between two items of the same type.
 * Domternal uses a container-per-type model (<ul>/<ol>/<ul data-type=taskList>),
 * so by default a type change leaves the 0.75em (~12px) list-container gap.
 * Notion mode tightens that boundary to the within-list item gap (0.25em ~= 4px)
 * via `_notion-mode.scss`; classic mode is deliberately left at the wide gap.
 *
 * The test measures the real rendered vertical gap (collapsed margin) between
 * the two top-level list containers, then removes the `dm-notion-mode` class
 * (reverting to classic styling) and re-measures to prove the override is
 * scoped to notion mode only.
 */
import { test, expect, type Page } from '@playwright/test';
import { goNotion, setContent } from './notion-helpers';

const NOTION_SEL = '.app-notion-demo .ProseMirror';

// 2 bullets, then 2 numbered, then 1 to-do. Adjacent different-type lists, none
// of which merge (different container types), so three sibling list blocks.
const MIXED =
  '<ul><li><p>a</p></li><li><p>b</p></li></ul>' +
  '<ol><li><p>c</p></li><li><p>d</p></li></ol>' +
  '<ul data-type="taskList"><li data-type="taskItem"><p>e</p></li></ul>';

// One item with a nested LIST child, then one item with a nested HEADING child.
// Both nested children should sit at the same tight ~4px gap under their label.
const NESTED =
  '<ul><li><p>parent a</p>' +
  '<ul><li><p>child a1</p></li><li><p>child a2</p></li></ul>' +
  '</li></ul>' +
  '<ul><li><p>parent b</p><h3>nested heading</h3></li></ul>';

interface NestedGaps {
  labelToNestedList: number;
  labelToNestedHeading: number;
  nestedItemGap: number;
}

async function measureNested(page: Page, pmSelector: string): Promise<NestedGaps> {
  return page.evaluate((sel) => {
    const pm = document.querySelector(sel);
    if (!pm) throw new Error('editor not found: ' + sel);
    const topLists = [...pm.children].filter(
      (el) => el.tagName === 'UL' || el.tagName === 'OL',
    ) as HTMLElement[];
    const rect = (el: Element) => el.getBoundingClientRect();

    const item1 = topLists[0].querySelector(':scope > li') as HTMLElement;
    const label1 = item1.querySelector(':scope > p') as HTMLElement;
    const nestedList = item1.querySelector(':scope > ul, :scope > ol') as HTMLElement;
    const nestedItems = nestedList.querySelectorAll(':scope > li');

    const item2 = topLists[1].querySelector(':scope > li') as HTMLElement;
    const label2 = item2.querySelector(':scope > p') as HTMLElement;
    const heading = item2.querySelector(
      ':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6',
    ) as HTMLElement;

    return {
      labelToNestedList: rect(nestedList).top - rect(label1).bottom,
      labelToNestedHeading: rect(heading).top - rect(label2).bottom,
      nestedItemGap: rect(nestedItems[1]).top - rect(nestedItems[0]).bottom,
    };
  }, pmSelector);
}

interface Gaps {
  listCount: number;
  bulletToOrdered: number;
  orderedToTask: number | null;
  withinGap: number;
}

async function measure(page: Page, pmSelector: string): Promise<Gaps> {
  return page.evaluate((sel) => {
    const pm = document.querySelector(sel);
    if (!pm) throw new Error('editor not found: ' + sel);
    const lists = [...pm.children].filter(
      (el) => el.tagName === 'UL' || el.tagName === 'OL',
    ) as HTMLElement[];
    const rect = (el: Element) => el.getBoundingClientRect();
    const firstItems = lists[0].querySelectorAll(':scope > li');
    return {
      listCount: lists.length,
      bulletToOrdered: rect(lists[1]).top - rect(lists[0]).bottom,
      orderedToTask:
        lists.length > 2 ? rect(lists[2]).top - rect(lists[1]).bottom : null,
      withinGap: rect(firstItems[1]).top - rect(firstItems[0]).bottom,
    };
  }, pmSelector);
}

async function setNotionMode(page: Page, on: boolean): Promise<void> {
  await page.evaluate(
    ({ sel, enable }) => {
      const pm = document.querySelector(sel);
      const host = pm?.closest('.dm-editor');
      if (!host) throw new Error('.dm-editor host not found');
      host.classList.toggle('dm-notion-mode', enable);
    },
    { sel: NOTION_SEL, enable: on },
  );
}

test('notion mode chunks adjacent different-type lists; classic keeps the wide gap', async ({
  page,
}) => {
  await goNotion(page);
  await setContent(page, MIXED);

  // Notion mode: every type boundary collapses to the within-item gap (~4px),
  // not the default 0.75em (~12px) list-container gap.
  const notion = await measure(page, NOTION_SEL);
  expect(notion.listCount).toBe(3);
  expect(notion.bulletToOrdered).toBeLessThan(7);
  expect(Math.abs(notion.bulletToOrdered - notion.withinGap)).toBeLessThan(3);
  expect(notion.orderedToTask).not.toBeNull();
  expect(notion.orderedToTask as number).toBeLessThan(7);

  // Drop the dm-notion-mode class: the override is scoped to it, so the
  // boundary reverts to the wide container gap. Proves classic is unaffected.
  await setNotionMode(page, false);
  const classic = await measure(page, NOTION_SEL);
  expect(classic.bulletToOrdered).toBeGreaterThan(9);
  expect(classic.bulletToOrdered).toBeGreaterThan(classic.withinGap + 4);

  // The boundary gap is roughly 3x wider in classic than in notion mode.
  expect(classic.bulletToOrdered).toBeGreaterThan(notion.bulletToOrdered + 4);

  await setNotionMode(page, true); // restore
});

test('a nested list chunks under its label at the same tight gap as a nested non-list block, in both modes', async ({
  page,
}) => {
  await goNotion(page);
  await setContent(page, NESTED);

  // Notion mode: nested list sits ~4px under the label, matching the nested
  // heading (no 12px list-container gap), and nested items keep their 4px gap.
  const notion = await measureNested(page, NOTION_SEL);
  expect(notion.labelToNestedList).toBeLessThan(7);
  expect(notion.nestedItemGap).toBeLessThan(7);
  expect(Math.abs(notion.labelToNestedList - notion.labelToNestedHeading)).toBeLessThan(3);

  // The nested-list fix lives in the base stylesheet (not notion-mode only),
  // so removing the dm-notion-mode class must NOT loosen it back to 12px.
  await setNotionMode(page, false);
  const classic = await measureNested(page, NOTION_SEL);
  expect(classic.labelToNestedList).toBeLessThan(7);
  expect(Math.abs(classic.labelToNestedList - classic.labelToNestedHeading)).toBeLessThan(3);

  await setNotionMode(page, true); // restore
});
