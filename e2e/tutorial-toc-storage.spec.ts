import { test, expect, type Page } from '@playwright/test';

interface TocEntrySnapshot {
  id: string;
  active: boolean;
  passed: boolean;
  connected: boolean;
  owned: boolean;
}

interface TutorialSnapshot {
  sourceIdentity: boolean;
  activeId: string | null;
  entries: TocEntrySnapshot[];
  subscribers: number;
  updates: number;
  incoherentUpdates: number;
  transactions: number;
  sameDoc: boolean;
  sameState: boolean;
  scrollTop: number;
  rootTop: number;
  windowScroll: number;
  html: string;
  language: string | null;
  canonicalLanguages: string[];
  wrongStorageKeyPresent: boolean;
}

interface TutorialTocProbe {
  ready: boolean;
  snapshot(): TutorialSnapshot;
  scrollPast(id: string): void;
  insertBlock(): boolean;
  reloadJSON(): void;
  navigate(id: string): boolean;
  destroy(): void;
  counts(): { updates: number; incoherentUpdates: number; transactions: number };
}

declare global {
  interface Window { __TUTORIAL_TOC__: TutorialTocProbe }
}

const fixtureOrigin = process.env['TUTORIAL_FIXTURE_URL'] ?? 'http://127.0.0.1:5793';
const errors = new WeakMap<Page, string[]>();
const snapshot = (page: Page): Promise<TutorialSnapshot> =>
  page.evaluate(() => window.__TUTORIAL_TOC__.snapshot());

async function openFixture(page: Page, query = '', hash = ''): Promise<void> {
  await page.goto(`${fixtureOrigin}/tutorial-toc/?${query}${hash}`);
  await page.waitForFunction(() => window.__TUTORIAL_TOC__.ready);
  expect((await snapshot(page)).sourceIdentity).toBe(true);
}

test.use({ viewport: { width: 1100, height: 900 } });

test.beforeEach(async ({ page }) => {
  const observed: string[] = [];
  errors.set(page, observed);
  page.on('pageerror', (error) => observed.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

test('TOC alone updates DOM references, flags and callbacks in a bordered scroll container', async ({ page }) => {
  await openFixture(page);
  await expect.poll(async () => (await snapshot(page)).activeId).toBe('first');
  await expect(page.locator('.dm-toc-outline, .dm-toc-block')).toHaveCount(0);
  const before = await snapshot(page);
  expect(before.subscribers).toBe(0);
  expect(before.rootTop).toBeGreaterThan(100);
  expect(before.entries).toEqual([
    { id: 'first', active: true, passed: false, connected: true, owned: true },
    { id: 'second', active: false, passed: false, connected: true, owned: true },
    { id: 'third', active: false, passed: false, connected: true, owned: true },
  ]);

  await page.evaluate(() => { window.__TUTORIAL_TOC__.scrollPast('second'); });
  await expect.poll(async () => (await snapshot(page)).activeId).toBe('second');
  await expect(page.locator('#status')).toHaveText('Active heading: second');
  const after = await snapshot(page);
  expect(after.entries).toEqual([
    { id: 'first', active: false, passed: true, connected: true, owned: true },
    { id: 'second', active: true, passed: true, connected: true, owned: true },
    { id: 'third', active: false, passed: false, connected: true, owned: true },
  ]);
  expect(after.updates).toBeGreaterThan(before.updates);
  expect(after.incoherentUpdates).toBe(0);
  expect(after.scrollTop).toBeGreaterThan(0);
  expect(after.windowScroll).toBe(0);
  expect(after.sameDoc).toBe(true);
  expect(after.sameState).toBe(true);
  expect(after.transactions).toBe(0);

  const cleanup = await page.evaluate(async () => {
    const probe = window.__TUTORIAL_TOC__;
    probe.destroy();
    const before = probe.counts();
    const root = document.querySelector('#scroller')!;
    root.scrollTop = 0;
    root.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { before, after: probe.counts() };
  });
  expect(cleanup.after).toEqual(cleanup.before);
});

test('the observer handles the initial hash without a block or floating outline', async ({ page }) => {
  await openFixture(page, '', '#second');
  await expect(page.locator('.dm-toc-outline, .dm-toc-block')).toHaveCount(0);
  await expect.poll(async () => (await snapshot(page)).activeId).toBe('second');
  expect((await snapshot(page)).scrollTop).toBeGreaterThan(0);
  expect((await snapshot(page)).windowScroll).toBe(0);
  await expect(page).toHaveURL(/#second$/);
  const before = await snapshot(page);
  expect(await page.evaluate(() => window.__TUTORIAL_TOC__.navigate('missing'))).toBe(false);
  expect((await snapshot(page)).scrollTop).toBe(before.scrollTop);
  await expect(page).toHaveURL(/#second$/);
});

