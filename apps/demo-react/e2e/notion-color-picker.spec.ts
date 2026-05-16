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

const editorSelector = '.app-notion-demo .ProseMirror';
const modeToggleNotion = '.toolbar-mode-toggle button:has-text("Notion style")';

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

const triggerSelector = '.dm-bubble-menu .dm-ncp-trigger';
const panelSelector = '.dm-notion-color-picker';

/**
 * Triple-click the first paragraph to select its text as a real
 * TextSelection. The bubble menu's defaultShouldShow rejects non-text
 * selections (e.g. AllSelection from `focus('all')`), so UI-flow tests need
 * a genuine selection range that ProseMirror sets via native browser events.
 */
async function selectFirstParagraph(page: Page): Promise<void> {
  await page.locator(`${editorSelector} p`).first().click({ clickCount: 3 });
  await page.waitForSelector('.dm-bubble-menu[data-show]', { timeout: 5000 });
}

test.describe('Notion color picker - data layer', () => {
  test.beforeEach(async ({ page }) => {
    await goNotion(page);
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

  test('inline span with data-bg-color uses horizontal padding (no block padding leak)', async ({ page }) => {
    // The block-level rule in _block-colors.scss applies padding-block to ANY
    // [data-bg-color]; for inline spans that bleeds the tint into adjacent
    // lines. _inline-colors.scss overrides with horizontal padding only.
    await setContentAndSelectAll(page, '<p>Hello world</p>');
    await runCommand(page, 'setBackgroundColorToken', 'pink');

    const padding = await page.evaluate(() => {
      const el = document.querySelector('.ProseMirror span[data-bg-color="pink"]') as HTMLElement | null;
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        top: cs.paddingTop,
        bottom: cs.paddingBottom,
        left: cs.paddingLeft,
        right: cs.paddingRight,
      };
    });
    expect(padding).not.toBeNull();
    expect(padding!.top).toBe('0px');
    expect(padding!.bottom).toBe('0px');
    // Horizontal padding should be non-zero so the tint visually hugs the text.
    expect(padding!.left).not.toBe('0px');
    expect(padding!.right).not.toBe('0px');
  });

  // ===========================================================================
  // UI (Phase 4) - bubble menu trigger + popover lifecycle
  // ===========================================================================

  test('UI: bubble menu shows "A" trigger when NotionColorPicker is loaded', async ({ page }) => {
    await setContentAndSelectAll(page, '<p>Hello world</p>');
    await expect(page.locator(triggerSelector)).toBeVisible();
  });

  test('UI: clicking "A" opens the picker panel', async ({ page }) => {
    await setContentAndSelectAll(page, '<p>Hello world</p>');
    await page.click(triggerSelector);
    await expect(page.locator(panelSelector)).toBeVisible();
  });

  test('UI: clicking "A" while open toggles the picker closed', async ({ page }) => {
    await setContentAndSelectAll(page, '<p>Hello world</p>');
    await page.click(triggerSelector);
    await expect(page.locator(panelSelector)).toBeVisible();
    await page.click(triggerSelector);
    await expect(page.locator(panelSelector)).not.toBeVisible();
  });

  test('UI: text-color swatch click applies token and keeps picker open', async ({ page }) => {
    await setContentAndSelectAll(page, '<p>Hello world</p>');
    await page.click(triggerSelector);
    // First swatch is "Default" (data-color="null"); pick the gray one.
    await page.click(`${panelSelector} .dm-ncp-swatch--text[data-color="gray"]`);

    await expect(page.locator(panelSelector)).toBeVisible();
    const html = await getEditorHtml(page);
    expect(html).toContain('data-text-color="gray"');
  });

  test('UI: bg-color swatch click applies token and keeps picker open', async ({ page }) => {
    await setContentAndSelectAll(page, '<p>Hello world</p>');
    await page.click(triggerSelector);
    await page.click(`${panelSelector} .dm-ncp-swatch--bg[data-color="yellow"]`);

    await expect(page.locator(panelSelector)).toBeVisible();
    const html = await getEditorHtml(page);
    expect(html).toContain('data-bg-color="yellow"');
  });

  test('UI: chained picks - text then bg on the same open both apply', async ({ page }) => {
    await setContentAndSelectAll(page, '<p>Hello world</p>');
    await page.click(triggerSelector);
    await page.click(`${panelSelector} .dm-ncp-swatch--text[data-color="purple"]`);
    await page.click(`${panelSelector} .dm-ncp-swatch--bg[data-color="green"]`);

    await expect(page.locator(panelSelector)).toBeVisible();
    const html = await getEditorHtml(page);
    expect(html).toContain('data-text-color="purple"');
    expect(html).toContain('data-bg-color="green"');
  });

  test('UI: active ring jumps to newly picked swatch immediately', async ({ page }) => {
    await setContentAndSelectAll(page, '<p>Hello world</p>');
    await page.click(triggerSelector);

    await page.click(`${panelSelector} .dm-ncp-swatch--text[data-color="blue"]`);
    await expect(
      page.locator(`${panelSelector} .dm-ncp-swatch--text[data-color="blue"].dm-ncp-active`),
    ).toBeVisible();

    // Switching colors clears the old active ring and adds it to the new one.
    await page.click(`${panelSelector} .dm-ncp-swatch--text[data-color="red"]`);
    await expect(
      page.locator(`${panelSelector} .dm-ncp-swatch--text[data-color="blue"].dm-ncp-active`),
    ).toHaveCount(0);
    await expect(
      page.locator(`${panelSelector} .dm-ncp-swatch--text[data-color="red"].dm-ncp-active`),
    ).toBeVisible();
  });

  test('UI: active ring on currently applied token', async ({ page }) => {
    await setContentAndSelectAll(page, '<p>Hello world</p>');
    await runCommand(page, 'setTextColorToken', 'red');

    // Reselect (setTextColorToken via command path doesn't preserve selection
    // visualization but selection is still there).
    await selectFirstParagraph(page);
    await page.click(triggerSelector);

    // The red text swatch should carry the active class.
    const active = page.locator(
      `${panelSelector} .dm-ncp-swatch--text[data-color="red"].dm-ncp-active`,
    );
    await expect(active).toBeVisible();
  });

  test('UI: Escape closes the picker', async ({ page }) => {
    await setContentAndSelectAll(page, '<p>Hello world</p>');
    await page.click(triggerSelector);
    await expect(page.locator(panelSelector)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator(panelSelector)).not.toBeVisible();
  });

  test('UI: outside click closes the picker', async ({ page }) => {
    await setContentAndSelectAll(page, '<p>Hello world</p>');
    await page.click(triggerSelector);
    await expect(page.locator(panelSelector)).toBeVisible();

    // Click on the page heading (well outside both panel and trigger).
    await page.locator('h3').first().click();
    await expect(page.locator(panelSelector)).not.toBeVisible();
  });

  test('UI: Default text swatch clears an existing token', async ({ page }) => {
    await setContentAndSelectAll(page, '<p>Hello world</p>');
    await runCommand(page, 'setTextColorToken', 'red');
    expect(await getEditorHtml(page)).toContain('data-text-color="red"');

    await selectFirstParagraph(page);
    await page.click(triggerSelector);
    await page.click(`${panelSelector} .dm-ncp-swatch--text[data-color="null"]`);
    // Picker stays open after the pick (consistent with bubble menu behavior).
    await expect(page.locator(panelSelector)).toBeVisible();

    const html = await getEditorHtml(page);
    expect(html).not.toContain('data-text-color');
  });

  test('UI: first text + bg swatches render the strike-through default indicator', async ({ page }) => {
    await selectFirstParagraph(page);
    await page.click(triggerSelector);

    // Both null swatches carry the gradient background-image so users see
    // the same "no color" cue on the Text + Background rows.
    const textNull = page.locator(`${panelSelector} .dm-ncp-swatch--text[data-color="null"]`);
    const bgNull = page.locator(`${panelSelector} .dm-ncp-swatch--bg[data-color="null"]`);
    await expect(textNull).toBeVisible();
    await expect(bgNull).toBeVisible();

    // The slash is painted via the `::after` pseudo so it can overlay the
    // text swatch's "A" glyph; check the pseudo's computed style.
    const hasSlash = await Promise.all([
      textNull.evaluate((el) => getComputedStyle(el, '::after').backgroundImage),
      bgNull.evaluate((el) => getComputedStyle(el, '::after').backgroundImage),
    ]);
    expect(hasSlash[0]).toContain('linear-gradient');
    expect(hasSlash[1]).toContain('linear-gradient');
  });

  test('UI: image bubble menu hides "A" color trigger and "..." block-menu trigger', async ({ page }) => {
    // Insert an image and select it as a NodeSelection. Its bubble menu
    // exposes its own image actions (float, delete, etc.) - the trailing
    // text-color and block-context triggers would be redundant or wrong
    // for a node selection and must not render.
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as {
        setContent: (h: string, emit: boolean) => void;
      };
      ed.setContent('<p>before</p><img src="https://placekitten.com/200/120" alt="x"><p>after</p>', false);
    });
    await page.locator(`${editorSelector} .dm-image-resizable`).first().click();
    await page.waitForSelector('.dm-bubble-menu[data-show]', { timeout: 5000 });

    await expect(page.locator(`${triggerSelector}`)).toHaveCount(0);
    await expect(page.locator('.dm-bubble-menu button[aria-label="More options"]')).toHaveCount(0);
  });

  test('UI: bubble menu stays open while interacting with the picker', async ({ page }) => {
    await selectFirstParagraph(page);
    await page.click(triggerSelector);
    await expect(page.locator(panelSelector)).toBeVisible();

    await page.click(`${panelSelector} .dm-ncp-swatch--text[data-color="brown"]`);
    // Bubble menu must still be visible - its mousedown handler whitelists
    // [data-dm-editor-ui] overlays so picker interactions don't dismiss it.
    await expect(page.locator('.dm-bubble-menu[data-show]')).toBeVisible();
    await expect(page.locator(panelSelector)).toBeVisible();
  });

  test('UI: text + bg applied simultaneously both render as active', async ({ page }) => {
    await setContentAndSelectAll(page, '<p>Hello world</p>');
    await runCommand(page, 'setTextColorToken', 'green');
    await runCommand(page, 'setBackgroundColorToken', 'pink');

    await selectFirstParagraph(page);
    await page.click(triggerSelector);

    await expect(
      page.locator(`${panelSelector} .dm-ncp-swatch--text[data-color="green"].dm-ncp-active`),
    ).toBeVisible();
    await expect(
      page.locator(`${panelSelector} .dm-ncp-swatch--bg[data-color="pink"].dm-ncp-active`),
    ).toBeVisible();
  });

  test('UI: A trigger gains --active class when any color token is applied', async ({ page }) => {
    await setContentAndSelectAll(page, '<p>Hello world</p>');

    let active = await page
      .locator(triggerSelector)
      .evaluate((el) => el.classList.contains('dm-toolbar-button--active'));
    expect(active).toBe(false);

    await runCommand(page, 'setTextColorToken', 'purple');
    await selectFirstParagraph(page);

    active = await page
      .locator(triggerSelector)
      .evaluate((el) => el.classList.contains('dm-toolbar-button--active'));
    expect(active).toBe(true);
  });

  test('UI: underline indicator is transparent when no bg-color token is applied', async ({ page }) => {
    await setContentAndSelectAll(page, '<p>Hello world</p>');
    await selectFirstParagraph(page);

    // Inline style binding is set to null, which produces empty inline style;
    // browser falls back to the CSS default (`background-color: transparent`).
    const bg = await page.evaluate(() => {
      const el = document.querySelector('.dm-bubble-menu .dm-ncp-trigger-underline') as HTMLElement | null;
      return el ? getComputedStyle(el).backgroundColor : null;
    });
    expect(['rgba(0, 0, 0, 0)', 'transparent', '']).toContain(bg);
  });

  test('UI: collapsing the selection while open closes the picker', async ({ page }) => {
    await selectFirstParagraph(page);
    await page.click(triggerSelector);
    await expect(page.locator(panelSelector)).toBeVisible();

    // Clicking inside the editor at a single point collapses to a cursor
    // (empty selection); the picker's selectionUpdate handler should close it.
    await page.locator(`${editorSelector} p`).first().click();
    await expect(page.locator(panelSelector)).not.toBeVisible();
  });

  test('UI: re-selecting after swatch click keeps the applied mark intact', async ({ page }) => {
    await selectFirstParagraph(page);
    await page.click(triggerSelector);
    await page.click(`${panelSelector} .dm-ncp-swatch--text[data-color="yellow"]`);

    // Picker stays open after the pick; the colored span has been written.
    await expect(page.locator(panelSelector)).toBeVisible();
    const html = await getEditorHtml(page);
    expect(html).toContain('data-text-color="yellow"');

    // Close, then reopen and verify active state still highlights yellow.
    await page.keyboard.press('Escape');
    await selectFirstParagraph(page);
    await page.click(triggerSelector);
    await expect(
      page.locator(`${panelSelector} .dm-ncp-swatch--text[data-color="yellow"].dm-ncp-active`),
    ).toBeVisible();
  });

  test('UI: picker follows the trigger when the page scrolls', async ({ page }) => {
    // Need a tall page so there's room to scroll. The notion-demo content is
    // already long; insert a few line breaks below to ensure overflow.
    await page.evaluate(() => {
      const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as {
        setContent: (h: string, emit: boolean) => void;
      };
      ed.setContent(
        '<p>First paragraph for selection.</p>' + '<p>filler</p>'.repeat(40),
        false,
      );
    });
    await selectFirstParagraph(page);
    await page.click(triggerSelector);
    await expect(page.locator(panelSelector)).toBeVisible();

    const beforeY = await page.locator(panelSelector).evaluate((el) => el.getBoundingClientRect().top);

    // Scroll the page a fixed amount; positionFloating tracks via rAF so the
    // panel should follow the anchor downwards by roughly the same delta.
    await page.evaluate(() => window.scrollBy(0, 200));
    // Wait a couple of frames so the rAF tracker fires.
    await page.waitForTimeout(100);

    const afterY = await page.locator(panelSelector).evaluate((el) => el.getBoundingClientRect().top);
    // Panel should move with the anchor. Allow generous tolerance because the
    // anchor itself sits inside the bubble menu, which has its own positioning.
    expect(Math.abs(afterY - beforeY)).toBeGreaterThan(50);
  });

  test('A11y: panel has role=dialog and aria-label', async ({ page }) => {
    await selectFirstParagraph(page);
    await page.click(triggerSelector);

    await expect(page.locator(panelSelector)).toHaveAttribute('role', 'dialog');
    await expect(page.locator(panelSelector)).toHaveAttribute(
      'aria-label',
      'Text and background color',
    );
  });

  test('A11y: focus lands on Default text swatch when picker opens (no active token)', async ({ page }) => {
    await selectFirstParagraph(page);
    await page.click(triggerSelector);
    // Focus management runs on rAF after Angular paints - wait until focus
    // actually lands on a swatch instead of sampling activeElement too early.
    await page.waitForFunction(() => {
      return document.activeElement?.classList.contains('dm-ncp-swatch') ?? false;
    });

    const focusedDataColor = await page.evaluate(() => {
      return document.activeElement?.getAttribute('data-color') ?? null;
    });
    expect(focusedDataColor).toBe('null');
  });

  test('A11y: focus lands on currently active swatch when opening on a colored selection', async ({ page }) => {
    await setContentAndSelectAll(page, '<p>Hello world</p>');
    await runCommand(page, 'setTextColorToken', 'purple');
    await selectFirstParagraph(page);
    await page.click(triggerSelector);
    await page.waitForFunction(() => {
      return document.activeElement?.classList.contains('dm-ncp-swatch') ?? false;
    });

    const focusedDataColor = await page.evaluate(() => {
      return document.activeElement?.getAttribute('data-color') ?? null;
    });
    expect(focusedDataColor).toBe('purple');
  });

  test('A11y: active swatch carries aria-pressed=true', async ({ page }) => {
    await setContentAndSelectAll(page, '<p>Hello world</p>');
    await runCommand(page, 'setTextColorToken', 'red');
    await selectFirstParagraph(page);
    await page.click(triggerSelector);

    const pressed = await page
      .locator(`${panelSelector} .dm-ncp-swatch--text[data-color="red"]`)
      .getAttribute('aria-pressed');
    expect(pressed).toBe('true');
  });

  test('A11y: ArrowRight moves focus to the next swatch', async ({ page }) => {
    await selectFirstParagraph(page);
    await page.click(triggerSelector);
    await page.waitForFunction(() =>
      document.activeElement?.classList.contains('dm-ncp-swatch') ?? false,
    );

    await page.keyboard.press('ArrowRight');
    const focused = await page.evaluate(
      () => document.activeElement?.getAttribute('data-color') ?? null,
    );
    expect(focused).toBe('gray');
  });

  test('A11y: ArrowDown moves focus one row down (5 columns)', async ({ page }) => {
    await selectFirstParagraph(page);
    await page.click(triggerSelector);
    await page.waitForFunction(() =>
      document.activeElement?.classList.contains('dm-ncp-swatch') ?? false,
    );

    // From "null" (idx 0 in the text section) → idx 5 = first bg swatch
    // ("null" in bg section); the grid is fixed at 5 columns.
    await page.keyboard.press('ArrowDown');
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const isBg = el.classList.contains('dm-ncp-swatch--bg');
      return { color: el.getAttribute('data-color'), isBg };
    });
    // 10 text swatches span 2 rows of 5: row 1 = null/gray/brown/orange/yellow,
    // row 2 = green/blue/purple/pink/red. ArrowDown from idx 0 (null) → idx 5
    // (green), still in the text section.
    expect(focused?.isBg).toBe(false);
    expect(focused?.color).toBe('green');
  });

  test('A11y: Enter on focused swatch applies the color and keeps panel open', async ({ page }) => {
    await selectFirstParagraph(page);
    await page.click(triggerSelector);
    await page.waitForFunction(() =>
      document.activeElement?.classList.contains('dm-ncp-swatch') ?? false,
    );

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');

    await expect(page.locator(panelSelector)).toBeVisible();
    const html = await getEditorHtml(page);
    expect(html).toContain('data-text-color="gray"');
  });

  test('UI: trigger paints the underline with the applied bg-color token', async ({ page }) => {
    await setContentAndSelectAll(page, '<p>Hello world</p>');
    await runCommand(page, 'setBackgroundColorToken', 'green');
    await selectFirstParagraph(page);

    // CSS variable expression is applied as inline style; resolve via
    // computed style on the actual underline element.
    const bg = await page.evaluate(() => {
      const el = document.querySelector('.dm-bubble-menu .dm-ncp-trigger-underline') as HTMLElement | null;
      return el ? getComputedStyle(el).backgroundColor : null;
    });
    expect(bg).not.toBeNull();
    expect(bg).not.toBe('');
    expect(bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(bg).not.toBe('transparent');
  });

  test('UI: "More options" button is enabled when selection is within a single block', async ({ page }) => {
    await selectFirstParagraph(page);
    const moreBtn = page.locator('.dm-bubble-menu button[aria-label="More options"]');
    await expect(moreBtn).toBeVisible();
    await expect(moreBtn).toBeEnabled();
  });

  test('UI: "More options" button is disabled when selection spans multiple blocks', async ({ page }) => {
    // Select from inside the first paragraph through the start of the second
    // paragraph - that crosses two top-level blocks, so the trigger has no
    // unambiguous block target and must be disabled.
    await page.click(editorSelector);
    await page.evaluate(() => {
      const paras = document.querySelectorAll<HTMLElement>('.app-notion-demo .ProseMirror > p');
      const first = paras[0];
      const second = paras[1];
      if (!first?.firstChild || !second?.firstChild) return;
      const range = document.createRange();
      range.setStart(first.firstChild, 0);
      range.setEnd(second.firstChild, Math.min(3, second.firstChild.textContent?.length ?? 0));
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
      const editor = document.querySelector('.ProseMirror');
      if (editor instanceof HTMLElement) editor.focus();
    });
    await page.waitForSelector('.dm-bubble-menu[data-show]', { timeout: 5000 });

    const moreBtn = page.locator('.dm-bubble-menu button[aria-label="More options"]');
    await expect(moreBtn).toBeVisible();
    await expect(moreBtn).toBeDisabled();
  });

});
