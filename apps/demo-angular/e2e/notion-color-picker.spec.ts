/**
 * E2E coverage for the named-token color system (Phase 1 + 2 of the Notion
 * color picker rollout).
 *
 * Scope is the DATA layer only; the picker popover and bubble-menu trigger
 * are added in later phases. Tests drive the editor via console commands
 * (page.evaluate) and assert against the rendered DOM. This catches things
 * jsdom unit tests cannot: real page reloads, computed CSS from the theme,
 * and round-tripping through getHTML.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = 'app-notion-demo .ProseMirror';
const modeToggleNotion = '.toolbar-mode-toggle button:has-text("Notion style")';
const STORAGE_KEY = 'dm-notion-color-recent';

async function goNotion(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector(modeToggleNotion);
  await page.click(modeToggleNotion);
  await page.waitForSelector(editorSelector);
  await page.waitForFunction(
    () => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']),
    { timeout: 3000 },
  );
}

async function setContentAndSelectAll(page: Page, html: string): Promise<void> {
  // Click the editor first so view.dom.isConnected is true AND the editor
  // gets DOM focus; without that, `commands.focus('all')` returns false and
  // the AllSelection dispatch is skipped (see commands/selectionCommands.ts).
  await page.click(editorSelector);
  await page.evaluate((h) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as {
      setContent: (h: string, emit: boolean) => void;
      commands: { focus: (pos?: string) => boolean };
    };
    ed.setContent(h, false);
    // 'all' selects the entire document (AllSelection); setMark then writes
    // to the doc rather than to stored marks.
    ed.commands.focus('all');
  }, html);
}

async function runCommand(
  page: Page,
  name: string,
  ...args: unknown[]
): Promise<boolean> {
  return page.evaluate(
    ({ n, a }) => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as {
        commands: Record<string, (...args: unknown[]) => boolean>;
      };
      const fn = ed.commands[n];
      return fn ? Boolean(fn(...a)) : false;
    },
    { n: name, a: args },
  );
}

async function getEditorHtml(page: Page): Promise<string> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as {
      getHTML: () => string;
    };
    return ed.getHTML();
  });
}

test.describe('Notion color picker - data layer', () => {
  test.beforeEach(async ({ page }) => {
    await goNotion(page);
    // Clear shared cross-test state. The editor instance has already been
    // constructed at this point and may have loaded a previous test's
    // recents; reset both the persisted store and the in-memory copy.
    await page.evaluate((k) => {
      localStorage.removeItem(k);
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
        | { commands: { clearRecentColors: () => boolean } }
        | undefined;
      ed?.commands.clearRecentColors();
      localStorage.removeItem(k);
    }, STORAGE_KEY);
  });

  test('setTextColorToken applies data-text-color to selection', async ({ page }) => {
    await setContentAndSelectAll(page, '<p>Hello world</p>');
    const ok = await runCommand(page, 'setTextColorToken', 'gray');
    expect(ok).toBe(true);

    const html = await getEditorHtml(page);
    expect(html).toContain('data-text-color="gray"');
    // Hex style must NOT be emitted alongside the token (mutual exclusion).
    expect(html).not.toMatch(/style="[^"]*color:/);
  });

  test('setBackgroundColorToken applies data-bg-color to selection', async ({ page }) => {
    await setContentAndSelectAll(page, '<p>Hello world</p>');
    const ok = await runCommand(page, 'setBackgroundColorToken', 'yellow');
    expect(ok).toBe(true);

    const html = await getEditorHtml(page);
    expect(html).toContain('data-bg-color="yellow"');
    expect(html).not.toMatch(/style="[^"]*background-color:/);
  });

  test('mutual exclusion: token → hex swaps data attr for inline style', async ({ page }) => {
    await setContentAndSelectAll(page, '<p>Hello</p>');

    await runCommand(page, 'setTextColorToken', 'gray');
    let html = await getEditorHtml(page);
    expect(html).toContain('data-text-color="gray"');

    // Apply hex via legacy command; token attr must vanish.
    await runCommand(page, 'setTextColor', '#ff0000');
    html = await getEditorHtml(page);
    expect(html).not.toContain('data-text-color');
    expect(html).toContain('color: #ff0000');
  });

  test('mutual exclusion: hex → token swaps inline style for data attr', async ({ page }) => {
    await setContentAndSelectAll(page, '<p>Hello</p>');

    await runCommand(page, 'setTextColor', '#00ff00');
    let html = await getEditorHtml(page);
    expect(html).toContain('color: #00ff00');

    await runCommand(page, 'setTextColorToken', 'purple');
    html = await getEditorHtml(page);
    expect(html).not.toMatch(/style="[^"]*color: #00ff00/);
    expect(html).toContain('data-text-color="purple"');
  });

  test('unsetTextColorToken removes the data attribute', async ({ page }) => {
    await setContentAndSelectAll(page, '<p>Hello</p>');
    await runCommand(page, 'setTextColorToken', 'red');
    expect(await getEditorHtml(page)).toContain('data-text-color="red"');

    await runCommand(page, 'unsetTextColorToken');
    expect(await getEditorHtml(page)).not.toContain('data-text-color');
  });

  test('pushRecentColor persists across page reload', async ({ page }) => {
    await runCommand(page, 'pushRecentColor', { kind: 'text', token: 'gray' });
    await runCommand(page, 'pushRecentColor', { kind: 'bg', token: 'yellow' });

    // Confirm persisted before reload.
    const stored = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    expect(JSON.parse(stored!)).toEqual([
      { kind: 'bg', token: 'yellow' },
      { kind: 'text', token: 'gray' },
    ]);

    await page.reload();
    // The app loads in its default mode (Standard) on reload; flip back to
    // Notion so app-notion-demo mounts and re-exposes __DEMO_EDITOR__.
    await page.waitForSelector(modeToggleNotion);
    await page.click(modeToggleNotion);
    await page.waitForSelector(editorSelector);
    await page.waitForFunction(
      () => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']),
      { timeout: 3000 },
    );

    const recentAfterReload = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as {
        storage: { notionColorPicker: { recent: unknown } };
      };
      return ed.storage.notionColorPicker.recent;
    });
    expect(recentAfterReload).toEqual([
      { kind: 'bg', token: 'yellow' },
      { kind: 'text', token: 'gray' },
    ]);
  });

  test('paste-from-Domternal preserves data-text-color (no inline style needed)', async ({ page }) => {
    // setContent reuses the parse pipeline, which mirrors paste behavior for
    // a span carrying ONLY data-text-color (no inline style). This is the
    // round-trip path that fails before the Phase 1 TextStyle.parseHTML
    // extension; see notion_improvement_2.md Phase 0c.
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as {
        setContent: (h: string, emit: boolean) => void;
      };
      ed.setContent('<p><span data-text-color="orange">Orange</span> rest</p>', false);
    });

    const html = await getEditorHtml(page);
    expect(html).toContain('data-text-color="orange"');
  });

  test('theme rendering: data-text-color produces a non-default computed color', async ({ page }) => {
    await setContentAndSelectAll(page, '<p>Theme test</p>');
    await runCommand(page, 'setTextColorToken', 'blue');

    // Read the computed color of the rendered span. The exact hex depends on
    // light vs dark theme; we just assert it is NOT the default editor text
    // color (which the unstyled paragraph uses), proving the theme variable
    // resolved and the rule applied.
    const { tinted, baseline } = await page.evaluate(() => {
      const tintedEl = document.querySelector('.ProseMirror [data-text-color="blue"]') as HTMLElement | null;
      const baselineEl = document.querySelector('.ProseMirror p') as HTMLElement | null;
      return {
        tinted: tintedEl ? getComputedStyle(tintedEl).color : null,
        baseline: baselineEl ? getComputedStyle(baselineEl).color : null,
      };
    });
    expect(tinted).not.toBeNull();
    expect(baseline).not.toBeNull();
    expect(tinted).not.toBe(baseline);
  });

  test('theme rendering: data-bg-color produces a non-transparent background', async ({ page }) => {
    await setContentAndSelectAll(page, '<p>BG test</p>');
    await runCommand(page, 'setBackgroundColorToken', 'pink');

    const bg = await page.evaluate(() => {
      const el = document.querySelector('.ProseMirror [data-bg-color="pink"]') as HTMLElement | null;
      return el ? getComputedStyle(el).backgroundColor : null;
    });
    expect(bg).not.toBeNull();
    // jsdom returns "" for unset bg; browser returns "rgba(0, 0, 0, 0)" for
    // transparent. Either way the tinted version must NOT be one of those.
    expect(bg).not.toBe('');
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg).not.toBe('transparent');
  });

  test('isOpen flag is exposed on storage for UI lifecycle', async ({ page }) => {
    const initial = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as {
        storage: { notionColorPicker: { isOpen: boolean } };
      };
      return ed.storage.notionColorPicker.isOpen;
    });
    expect(initial).toBe(false);

    // UI wrappers flip this when opening the popover. Verify the field is
    // writable and the new value sticks.
    const written = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as {
        storage: { notionColorPicker: { isOpen: boolean } };
      };
      ed.storage.notionColorPicker.isOpen = true;
      return ed.storage.notionColorPicker.isOpen;
    });
    expect(written).toBe(true);
  });

  test('clearRecentColors wipes storage and localStorage', async ({ page }) => {
    await runCommand(page, 'pushRecentColor', { kind: 'text', token: 'gray' });
    await runCommand(page, 'pushRecentColor', { kind: 'bg', token: 'red' });
    await runCommand(page, 'clearRecentColors');

    const recent = await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as {
        storage: { notionColorPicker: { recent: unknown } };
      };
      return ed.storage.notionColorPicker.recent;
    });
    expect(recent).toEqual([]);

    const stored = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    expect(stored).toBe('[]');
  });
});
