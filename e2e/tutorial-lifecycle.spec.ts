import { expect, test, type Page } from '@playwright/test';

interface Snapshot {
  connected: boolean;
  sameEditor: boolean;
  sameView: boolean;
  sameDoc: boolean;
  sameSentinel: boolean;
  sameHistoryState: boolean;
  history: number;
  selection: unknown;
  transactions: { docChanged: boolean; selectionSet: boolean; steps: number }[];
  created: number;
  views: number;
  destroyedViews: number;
  adopts: number;
  activeEditors: number;
  submits: number;
  renders: number;
}

interface LifecycleProbe {
  ready: boolean;
  prepare(): Snapshot;
  snapshot(): Snapshot;
  show(): void;
  hide(): void;
  remount(): void;
  destroy(): void;
  stats(): Pick<Snapshot, 'submits' | 'renders' | 'activeEditors' | 'views' | 'destroyedViews'>;
  selectText(from?: number, to?: number): void;
  selectCells(): void;
  selection(): { cell: boolean; from: number; to: number; canMerge: boolean; focused: boolean };
  html(): string;
  undo(): boolean;
  setEditable(value: boolean): void;
  rerenderChildren(): void;
}

declare global {
  interface Window { __tutorialLifecycle: LifecycleProbe }
}

const fixtureUrl = process.env['TUTORIAL_FIXTURE_URL'] ?? 'http://127.0.0.1:5793';
const errors = new WeakMap<Page, string[]>();

async function open(page: Page, framework: string, mode: string, immediate = false): Promise<void> {
  const failures: string[] = [];
  errors.set(page, failures);
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => {
    if (/getSnapshot.*cached|Maximum update depth|Two different copies/.test(message.text())) failures.push(message.text());
  });
  await page.goto(`${fixtureUrl}/tutorial-lifecycle/?framework=${framework}&mode=${mode}&immediate=${String(immediate)}`);
  await page.waitForFunction(() => window.__tutorialLifecycle.ready);
  await expect.poll(() => page.evaluate(() => window.__tutorialLifecycle.snapshot().activeEditors)).toBe(1);
}

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => window.__tutorialLifecycle.snapshot());
}

function expectPreserved(current: Snapshot, before: Snapshot): void {
  expect(current.sameEditor).toBe(true);
  expect(current.sameView).toBe(true);
  expect(current.sameDoc).toBe(true);
  expect(current.sameSentinel).toBe(true);
  expect(current.sameHistoryState).toBe(true);
  expect(current.selection).toEqual(before.selection);
  expect(current.history).toBe(before.history);
  expect(current.created).toBe(before.created);
  expect(current.views).toBe(before.views);
  expect(current.destroyedViews).toBe(before.destroyedViews);
  // Host controls can dispatch metadata-only transactions during rebind.
  for (const transaction of current.transactions) {
    expect(transaction).toEqual({ docChanged: false, selectionSet: false, steps: 0 });
  }
}

async function selectText(page: Page): Promise<void> {
  await page.evaluate(() => { window.__tutorialLifecycle.selectText(); });
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Alpha');
  await expect(page.locator('.ProseMirror')).toBeFocused();
}

async function selectCells(page: Page): Promise<void> {
  await page.evaluate(() => { window.__tutorialLifecycle.selectCells(); });
  await expect(page.locator('.selectedCell')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => window.__tutorialLifecycle.selection().cell)).toBe(true);
  await expect(page.getByTestId('merge')).toBeEnabled();
}

test.afterEach(({ page }) => {
  expect(errors.get(page) ?? []).toEqual([]);
});

for (const framework of ['react', 'vue']) {
  for (const mode of ['compound', 'standalone', 'direct']) {
    for (const immediate of [false, true]) {
      test(`${framework}: ${mode} adopts real host controls with immediatelyRender=${String(immediate)}`, async ({ page }) => {
        await open(page, framework, mode, immediate);
        const delayed = mode !== 'direct';
        expect((await snapshot(page)).connected).toBe(!delayed);
        const before = await page.evaluate(() => window.__tutorialLifecycle.prepare());
        expect(before.history).toBeGreaterThan(0);
        if (delayed) await page.evaluate(() => { window.__tutorialLifecycle.show(); });
        await expect(page.locator('.dm-editor .dm-block-handle')).toHaveCount(1);
        await expect.poll(async () => (await snapshot(page)).connected).toBe(true);
        expectPreserved(await snapshot(page), before);

        if (delayed) {
          await page.evaluate(() => { window.__tutorialLifecycle.hide(); });
          await expect.poll(async () => (await snapshot(page)).connected).toBe(false);
          await expect(page.locator('.dm-block-handle')).toHaveCount(0);
          await page.evaluate(() => { window.__tutorialLifecycle.show(); });
          await expect.poll(async () => (await snapshot(page)).connected).toBe(true);
          const adoptsBeforeRemount = (await snapshot(page)).adopts;
          await page.evaluate(() => { window.__tutorialLifecycle.remount(); });
          await expect.poll(async () => (await snapshot(page)).adopts).toBeGreaterThan(adoptsBeforeRemount);
          await expect.poll(async () => (await snapshot(page)).connected).toBe(true);
          await expect(page.locator('.dm-editor .dm-block-handle')).toHaveCount(1);
          expectPreserved(await snapshot(page), before);
        }

        const stableAdopts = (await snapshot(page)).adopts;
        await page.locator('.ProseMirror > p').first().hover();
        await expect(page.locator('.dm-block-handle')).toHaveAttribute('data-show', '');
        await page.getByRole('button', { name: 'Drag to reorder, click for options', exact: true }).click();
        const blockMenu = page.getByRole('menu', { name: 'Block options', exact: true });
        await expect(blockMenu).toBeVisible();
        // Opening schedules initial keyboard focus after the first layout frame.
        await expect(blockMenu.getByRole('menuitem').first()).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(page.locator('.dm-block-context-menu')).not.toHaveAttribute('data-show', '');
        expect((await snapshot(page)).adopts).toBe(stableAdopts);
        expect(await page.evaluate(() => window.__tutorialLifecycle.undo())).toBe(true);
        expect(await page.evaluate(() => window.__tutorialLifecycle.html())).not.toContain('Before adoption.');

        await page.evaluate(() => { window.__tutorialLifecycle.destroy(); });
        await expect.poll(() => page.evaluate(() => window.__tutorialLifecycle.stats().activeEditors)).toBe(0);
        await expect(page.locator('.dm-block-handle, .dm-block-context-menu')).toHaveCount(0);
        const after = await page.evaluate(() => window.__tutorialLifecycle.stats());
        expect(after.destroyedViews).toBe(after.views);
      });
    }
  }
}

test('React allocating selectors render command availability and selection-only updates without a loop', async ({ page }) => {
  await open(page, 'react', 'toolbar');
  await selectCells(page);
  await expect(page.getByTestId('selector')).toContainText('"merge":true');
  await selectText(page);
  await expect(page.getByTestId('selector')).toContainText('"range":[1,6]');
  await expect(page.getByTestId('selector')).toContainText('"merge":false');
  await page.getByTestId('bold').click();
  await expect(page.getByTestId('selector')).toContainText('"bold":true');
  await expect(page.getByTestId('selector')).toContainText('"type":"bold"');
  expect(await page.evaluate(() => window.__tutorialLifecycle.stats().renders)).toBeLessThan(100);
});

test('React all-in-one children stay before the editor while their state and editor selection survive rerender', async ({ page }) => {
  await open(page, 'react', 'children');
  await expect(page.getByTestId('child-label')).toHaveText('Initial: provided');
  await page.getByRole('button', { name: 'Child count 0' }).click();
  await selectText(page);
  const before = await page.evaluate(() => window.__tutorialLifecycle.html());
  const selection = await page.evaluate(() => window.__tutorialLifecycle.selection());
  await page.evaluate(() => { window.__tutorialLifecycle.rerenderChildren(); });
  await expect(page.getByRole('button', { name: 'Child count 1' })).toBeVisible();
  await expect(page.getByTestId('child-label')).toHaveText('Updated: provided');
  await expect(page.locator('.dm-toolbar')).toHaveCount(0);
  expect(await page.evaluate(() => {
    const host = document.querySelector('.dm-editor');
    return ['children', 'footer'].every(id => {
      const child = document.querySelector(`[data-testid="${id}"]`);
      return host && child?.parentElement === host.parentElement
        && Boolean(child.compareDocumentPosition(host) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
  })).toBe(true);
  await expect(page.locator('.ProseMirror [data-testid], .dm-editor .child-header, .dm-editor .child-footer')).toHaveCount(0);
  expect(await page.evaluate(() => window.__tutorialLifecycle.html())).toBe(before);
  expect(await page.evaluate(() => window.__tutorialLifecycle.selection())).toEqual(selection);
});
