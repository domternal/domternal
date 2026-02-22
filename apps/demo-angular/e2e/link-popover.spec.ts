import { test, expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const popover = '.dm-link-popover';
const popoverInput = `${popover} .dm-link-popover-input`;
const applyBtn = `${popover} .dm-link-popover-apply`;
const removeBtn = `${popover} .dm-link-popover-remove`;
const toolbarLinkBtn = 'domternal-toolbar button[aria-label="Link"]';

async function setContentAndFocus(page: Page, html: string) {
  const editor = page.locator(editorSelector);
  await editor.evaluate((el, h) => {
    el.innerHTML = h;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, html);
  await editor.focus();
  await page.waitForTimeout(100);
}

async function getEditorHTML(page: Page): Promise<string> {
  return page.locator(editorSelector).innerHTML();
}

async function selectText(page: Page, startOffset: number, endOffset: number, selector = `${editorSelector} p`) {
  await page.evaluate(
    ({ sel, edSel, startOffset, endOffset }) => {
      const el = document.querySelector(sel);
      if (!el || !el.firstChild) return;
      const range = document.createRange();
      range.setStart(el.firstChild, startOffset);
      range.setEnd(el.firstChild, endOffset);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
      const editor = document.querySelector(edSel);
      if (editor instanceof HTMLElement) editor.focus();
    },
    { sel: selector, edSel: editorSelector, startOffset, endOffset },
  );
  await page.waitForTimeout(150);
}

/** Place cursor at a specific offset within a text node. */
async function placeCursor(page: Page, offset: number, selector = `${editorSelector} p`) {
  await selectText(page, offset, offset, selector);
}

/** Place cursor inside a link element. */
async function placeCursorInLink(page: Page) {
  await page.evaluate(
    ({ edSel }) => {
      const link = document.querySelector(edSel + ' a');
      if (!link || !link.firstChild) return;
      const range = document.createRange();
      range.setStart(link.firstChild, 1);
      range.setEnd(link.firstChild, 1);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
      const editor = document.querySelector(edSel);
      if (editor instanceof HTMLElement) editor.focus();
    },
    { edSel: editorSelector },
  );
  await page.waitForTimeout(150);
}

// ─── Opening popover ──────────────────────────────────────────────────

test.describe('Link popover — Opening', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('opens on toolbar Link button click', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);
    await page.locator(toolbarLinkBtn).click();
    await expect(page.locator(popover)).toHaveAttribute('data-show', '');
  });

  test('opens on Ctrl+K / Cmd+K', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);
    await page.keyboard.press(`${modifier}+k`);
    await expect(page.locator(popover)).toHaveAttribute('data-show', '');
  });

  test('input accepts typing when popover opens', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);
    await page.locator(toolbarLinkBtn).click();
    await expect(page.locator(popover)).toHaveAttribute('data-show', '');
    await page.locator(popoverInput).fill('https://test.com');
    await expect(page.locator(popoverInput)).toHaveValue('https://test.com');
  });

  test('input is empty for new link', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);
    await page.locator(toolbarLinkBtn).click();
    await expect(page.locator(popoverInput)).toHaveValue('');
  });

  test('remove button hidden for new link', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);
    await page.locator(toolbarLinkBtn).click();
    await expect(page.locator(removeBtn)).not.toBeVisible();
  });

  test('toolbar link button is not disabled', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);
    await expect(page.locator(toolbarLinkBtn)).toBeEnabled();
  });

  test('toolbar link button is enabled even without selection', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await placeCursor(page, 3);
    await expect(page.locator(toolbarLinkBtn)).toBeEnabled();
  });
});

// ─── Existing link ─────────────────────────────────────────────────────

test.describe('Link popover — Existing link', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('pre-fills URL when cursor is on existing link', async ({ page }) => {
    await setContentAndFocus(page, '<p><a href="https://example.com">click here</a></p>');
    await placeCursorInLink(page);
    await page.keyboard.press(`${modifier}+k`);
    await expect(page.locator(popoverInput)).toHaveValue('https://example.com');
  });

  test('remove button visible for existing link', async ({ page }) => {
    await setContentAndFocus(page, '<p><a href="https://example.com">click here</a></p>');
    await placeCursorInLink(page);
    await page.keyboard.press(`${modifier}+k`);
    await expect(page.locator(removeBtn)).toBeVisible();
  });

  test('pre-fills URL when link text is selected', async ({ page }) => {
    await setContentAndFocus(page, '<p><a href="https://example.com">click here</a></p>');
    await page.evaluate(
      ({ edSel }) => {
        const link = document.querySelector(edSel + ' a');
        if (!link || !link.firstChild) return;
        const range = document.createRange();
        range.setStart(link.firstChild, 0);
        range.setEnd(link.firstChild, 5);
        const s = window.getSelection();
        s?.removeAllRanges();
        s?.addRange(range);
        const editor = document.querySelector(edSel);
        if (editor instanceof HTMLElement) editor.focus();
      },
      { edSel: editorSelector },
    );
    await page.waitForTimeout(150);
    await page.keyboard.press(`${modifier}+k`);
    await expect(page.locator(popoverInput)).toHaveValue('https://example.com');
  });

  test('toolbar link button shows active state on existing link', async ({ page }) => {
    await setContentAndFocus(page, '<p><a href="https://example.com">click here</a></p>');
    await placeCursorInLink(page);
    await expect(page.locator(toolbarLinkBtn)).toHaveClass(/active/);
  });
});

// ─── Applying links ────────────────────────────────────────────────────

test.describe('Link popover — Applying links', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Enter applies link to selected text', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);
    await page.keyboard.press(`${modifier}+k`);
    await page.locator(popoverInput).fill('https://example.com');
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);
    expect(html).toContain('<a');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('>Hello</a>');
  });

  test('apply button applies link', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);
    await page.locator(toolbarLinkBtn).click();
    await page.locator(popoverInput).fill('https://example.com');
    await page.locator(applyBtn).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('href="https://example.com"');
  });

  test('auto-prepends https:// for bare URL', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);
    await page.keyboard.press(`${modifier}+k`);
    await page.locator(popoverInput).fill('example.com');
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);
    expect(html).toContain('href="https://example.com"');
  });

  test('popover closes after applying link', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);
    await page.keyboard.press(`${modifier}+k`);
    await page.locator(popoverInput).fill('https://example.com');
    await page.keyboard.press('Enter');

    await expect(page.locator(popover)).not.toHaveAttribute('data-show');
  });

  test('editor regains focus after applying link', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);
    await page.keyboard.press(`${modifier}+k`);
    await page.locator(popoverInput).fill('https://example.com');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);

    await expect(page.locator(editorSelector)).toBeFocused();
  });

  test('empty input closes popover without creating link', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);
    await page.keyboard.press(`${modifier}+k`);
    await page.waitForTimeout(300); // wait for rAF focus
    await page.locator(popoverInput).press('Enter');

    await expect(page.locator(popover)).not.toHaveAttribute('data-show');
    const html = await getEditorHTML(page);
    expect(html).not.toContain('<a');
  });

  test('updates href on existing link', async ({ page }) => {
    await setContentAndFocus(page, '<p><a href="https://old.com">click here</a></p>');
    await placeCursorInLink(page);
    await page.keyboard.press(`${modifier}+k`);
    await page.locator(popoverInput).fill('https://new.com');
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);
    expect(html).toContain('href="https://new.com"');
    expect(html).not.toContain('https://old.com');
  });
});

// ─── Removing links ────────────────────────────────────────────────────

test.describe('Link popover — Removing links', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('remove button unlinks existing link', async ({ page }) => {
    await setContentAndFocus(page, '<p><a href="https://example.com">click here</a></p>');
    await placeCursorInLink(page);
    await page.keyboard.press(`${modifier}+k`);
    await page.locator(removeBtn).click();

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<a');
    expect(html).toContain('click here');
  });

  test('popover closes after removing link', async ({ page }) => {
    await setContentAndFocus(page, '<p><a href="https://example.com">click here</a></p>');
    await placeCursorInLink(page);
    await page.keyboard.press(`${modifier}+k`);
    await page.locator(removeBtn).click();

    await expect(page.locator(popover)).not.toHaveAttribute('data-show');
  });
});

// ─── Closing popover ───────────────────────────────────────────────────

test.describe('Link popover — Closing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Escape closes popover', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);
    await page.keyboard.press(`${modifier}+k`);
    await expect(page.locator(popover)).toHaveAttribute('data-show', '');
    await page.waitForTimeout(300); // wait for rAF focus

    await page.locator(popoverInput).press('Escape');
    await expect(page.locator(popover)).not.toHaveAttribute('data-show');
  });

  test('editor regains focus after Escape', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);
    await page.keyboard.press(`${modifier}+k`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    await expect(page.locator(editorSelector)).toBeFocused();
  });

  test('click outside closes popover', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);
    await page.keyboard.press(`${modifier}+k`);
    await expect(page.locator(popover)).toHaveAttribute('data-show', '');

    // Click outside (on body)
    await page.mouse.click(10, 10);
    await expect(page.locator(popover)).not.toHaveAttribute('data-show');
  });

  test('toolbar click opens then click outside closes', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);

    await page.locator(toolbarLinkBtn).click();
    await expect(page.locator(popover)).toHaveAttribute('data-show', '');

    // Click outside the popover (on the page body)
    await page.mouse.click(10, 10);
    await page.waitForTimeout(100);
    await expect(page.locator(popover)).not.toHaveAttribute('data-show');
  });

  test('toggle: second Ctrl+K closes popover', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);

    await page.keyboard.press(`${modifier}+k`);
    await expect(page.locator(popover)).toHaveAttribute('data-show', '');

    // Re-focus editor first (popover stole focus)
    await page.locator(editorSelector).focus();
    await page.keyboard.press(`${modifier}+k`);
    await expect(page.locator(popover)).not.toHaveAttribute('data-show');
  });
});

// ─── Positioning ───────────────────────────────────────────────────────

test.describe('Link popover — Positioning', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('popover appears below toolbar button when clicked from toolbar', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);

    const btnBox = await page.locator(toolbarLinkBtn).boundingBox();
    await page.locator(toolbarLinkBtn).click();
    await expect(page.locator(popover)).toHaveAttribute('data-show', '');

    const popBox = await page.locator(popover).boundingBox();
    expect(btnBox).toBeTruthy();
    expect(popBox).toBeTruthy();
    // Popover top should be near the bottom of the button (within 20px)
    expect(popBox!.y).toBeGreaterThanOrEqual(btnBox!.y + btnBox!.height - 2);
    expect(popBox!.y).toBeLessThanOrEqual(btnBox!.y + btnBox!.height + 20);
  });

  test('popover appears below cursor when opened via Ctrl+K', async ({ page }) => {
    await setContentAndFocus(page, '<p>Hello World</p>');
    await selectText(page, 0, 5);

    // Get cursor position (approximate via selection bounding rect)
    const editorBox = await page.locator(editorSelector).boundingBox();
    await page.keyboard.press(`${modifier}+k`);
    await expect(page.locator(popover)).toHaveAttribute('data-show', '');

    const popBox = await page.locator(popover).boundingBox();
    expect(editorBox).toBeTruthy();
    expect(popBox).toBeTruthy();
    // Popover should be within the editor vertical area (not way above)
    expect(popBox!.y).toBeGreaterThanOrEqual(editorBox!.y);
  });
});
