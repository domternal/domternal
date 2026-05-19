/**
 * E2E coverage for the `icons` override on `DomternalBubbleMenu`.
 *
 * Fixtures: `src/bubble-icons-fixtures.ts`. Activated via URL params
 * `?bubble-icons=full|partial|empty|malformed|html|default` and
 * `?bubble-items=bold,italic,strike`. Runtime swap via
 * `window.__DEMO_SET_BUBBLE_ICONS__('full' | null)`.
 */

import { test } from './fixtures.js';
import { expect, type Locator, type Page } from '@playwright/test';

const editorSelector = '.dm-editor .ProseMirror';
const bubbleMenu = '.dm-bubble-menu';
const modeToggleNotion = 'button:has-text("Notion style")';

async function gotoDefault(page: Page, search = ''): Promise<void> {
  await page.goto('/' + (search ? `?${search}` : ''));
  await page.waitForSelector(editorSelector);
  await page.waitForFunction(() => Boolean((window as unknown as Record<string, unknown>).__DEMO_EDITOR__));
}

async function gotoNotion(page: Page, search = ''): Promise<void> {
  await page.goto('/' + (search ? `?${search}` : ''));
  await page.waitForSelector(modeToggleNotion);
  await page.click(modeToggleNotion);
  await page.waitForSelector(editorSelector);
  await page.waitForFunction(() => Boolean((window as unknown as Record<string, unknown>).__DEMO_EDITOR__));
}

async function setContentAndFocus(page: Page, html: string): Promise<void> {
  await page.evaluate((h) => {
    const editor = (window as unknown as Record<string, { setContent: (h: string, e: boolean) => void; commands: { focus: () => void } }>).__DEMO_EDITOR__;
    if (editor) {
      editor.setContent(h, false);
      editor.commands.focus();
    }
  }, html);
  await page.waitForTimeout(100);
}

async function selectInParagraph(page: Page, startOffset: number, endOffset: number, selector = `${editorSelector} p`): Promise<void> {
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

function bubbleButton(page: Page, ariaLabel: string): Locator {
  return page.locator(`${bubbleMenu} button[aria-label="${ariaLabel}"]`).first();
}

async function expectCustomIcon(page: Page, ariaLabel: string, expectedKey: string): Promise<void> {
  const button = bubbleButton(page, ariaLabel);
  await expect(button).toBeVisible();
  await expect(button.locator(`svg[data-test-icon="custom-${expectedKey}"]`)).toHaveCount(1);
}

async function expectDefaultIcon(page: Page, ariaLabel: string): Promise<void> {
  const button = bubbleButton(page, ariaLabel);
  await expect(button).toBeVisible();
  await expect(button.locator('svg[data-test-icon]')).toHaveCount(0);
  await expect(button.locator('svg')).not.toHaveCount(0);
}

async function openBubble(page: Page, html = '<p>Hello custom icons</p>'): Promise<void> {
  await setContentAndFocus(page, html);
  await selectInParagraph(page, 0, 'Hello'.length);
  await expect(page.locator(bubbleMenu)).toBeVisible();
}

test.describe('BubbleMenu icons - Group A: basic override', () => {
  test('A1: format buttons use custom icons when ?bubble-icons=full', async ({ page }) => {
    await gotoDefault(page, 'bubble-icons=full');
    await openBubble(page);
    await expectCustomIcon(page, 'Bold', 'bold');
    await expectCustomIcon(page, 'Italic', 'italic');
    await expectCustomIcon(page, 'Underline', 'underline');
  });

  test('A2: partial override, unmapped keys fall back to default', async ({ page }) => {
    await gotoDefault(page, 'bubble-icons=partial');
    await openBubble(page);
    await expectCustomIcon(page, 'Bold', 'bold');
    await expectCustomIcon(page, 'Italic', 'italic');
    await expectDefaultIcon(page, 'Underline');
    await expectDefaultIcon(page, 'Strikethrough');
  });

  test('A3: empty IconSet falls back to defaults for every button', async ({ page }) => {
    await gotoDefault(page, 'bubble-icons=empty');
    await openBubble(page);
    await expect(page.locator(`${bubbleMenu} [data-test-icon]`)).toHaveCount(0);
    const buttonCount = await page.locator(`${bubbleMenu} button`).count();
    expect(buttonCount).toBeGreaterThan(0);
  });

  test('A4: no icons prop preserves default Phosphor rendering', async ({ page }) => {
    await gotoDefault(page);
    await openBubble(page);
    await expect(page.locator(`${bubbleMenu} [data-test-icon]`)).toHaveCount(0);
    await expectDefaultIcon(page, 'Bold');
    await expectDefaultIcon(page, 'Italic');
  });

  test('A5: custom SVG attributes are preserved verbatim', async ({ page }) => {
    await gotoDefault(page, 'bubble-icons=full');
    await openBubble(page);
    const bold = bubbleButton(page, 'Bold');
    const svg = bold.locator('svg[data-test-icon="custom-bold"]');
    await expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    await expect(svg).toHaveAttribute('width', '16');
    await expect(svg).toHaveAttribute('height', '16');
    await expect(svg.locator('circle')).toHaveCount(1);
  });
});

test.describe('BubbleMenu icons - Group B: sub-components', () => {
  test('B1: text-align dropdown trigger renders custom icon', async ({ page }) => {
    await gotoDefault(page, 'bubble-icons=full');
    await openBubble(page);
    const dropdownTrigger = page.locator(`${bubbleMenu} button.dm-toolbar-dropdown-trigger`).first();
    const exists = await dropdownTrigger.count();
    test.skip(exists === 0, 'no dropdown in this demo layout');
    await expect(dropdownTrigger.locator('svg[data-test-icon^="custom-textAlign"]')).toHaveCount(1);
  });

  test('B2: text-align dropdown sub-items use custom icons', async ({ page }) => {
    await gotoDefault(page, 'bubble-icons=full');
    await openBubble(page);
    const dropdownTrigger = page.locator(`${bubbleMenu} button.dm-toolbar-dropdown-trigger`).first();
    const exists = await dropdownTrigger.count();
    test.skip(exists === 0, 'no dropdown in this demo layout');
    await dropdownTrigger.click();
    const panel = page.locator(`${bubbleMenu} .dm-toolbar-dropdown-panel`).first();
    await expect(panel).toBeVisible();
    await expect(panel.locator('svg[data-test-icon="custom-textAlignLeft"]')).toHaveCount(1);
    await expect(panel.locator('svg[data-test-icon="custom-textAlignCenter"]')).toHaveCount(1);
    await expect(panel.locator('svg[data-test-icon="custom-textAlignRight"]')).toHaveCount(1);
    await expect(panel.locator('svg[data-test-icon="custom-textAlignJustify"]')).toHaveCount(1);
  });

  test('B3: dropdown trigger reflects active sub-item icon after alignment change', async ({ page }) => {
    await gotoDefault(page, 'bubble-icons=full');
    await openBubble(page);
    const dropdownTrigger = page.locator(`${bubbleMenu} button.dm-toolbar-dropdown-trigger`).first();
    const exists = await dropdownTrigger.count();
    test.skip(exists === 0, 'no dropdown in this demo layout');
    await dropdownTrigger.click();
    const panel = page.locator(`${bubbleMenu} .dm-toolbar-dropdown-panel`).first();
    await panel.locator('svg[data-test-icon="custom-textAlignCenter"]').first().click();
    // Click typically closes the bubble: reopen via re-select.
    await selectInParagraph(page, 0, 'Hello'.length);
    await expect(page.locator(bubbleMenu)).toBeVisible();
    await expect(dropdownTrigger.locator('svg[data-test-icon="custom-textAlignCenter"]')).toHaveCount(1);
  });

  test('B4: Notion mode "..." block-menu trigger uses custom icon', async ({ page }) => {
    await gotoNotion(page, 'bubble-icons=full');
    await openBubble(page);
    const moreOptions = bubbleButton(page, 'More options');
    await expect(moreOptions).toBeVisible();
    await expect(moreOptions.locator('svg[data-test-icon="custom-dotsThree"]')).toHaveCount(1);
  });
});

test.describe('BubbleMenu icons - Group C: reactivity', () => {
  test('C1: setting icons at runtime swaps default to custom', async ({ page }) => {
    await gotoDefault(page);
    await openBubble(page);
    await expectDefaultIcon(page, 'Bold');
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const setter = (window as unknown as Record<string, (k: string) => void>).__DEMO_SET_BUBBLE_ICONS__;
      setter('full');
    });
    await page.waitForTimeout(50);
    await selectInParagraph(page, 0, 'Hello'.length);
    await expect(page.locator(bubbleMenu)).toBeVisible();
    await expectCustomIcon(page, 'Bold', 'bold');
  });

  test('C2: unsetting icons at runtime restores defaults', async ({ page }) => {
    await gotoDefault(page, 'bubble-icons=full');
    await openBubble(page);
    await expectCustomIcon(page, 'Bold', 'bold');
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const setter = (window as unknown as Record<string, (k: string | null) => void>).__DEMO_SET_BUBBLE_ICONS__;
      setter(null);
    });
    await page.waitForTimeout(50);
    await selectInParagraph(page, 0, 'Hello'.length);
    await expect(page.locator(bubbleMenu)).toBeVisible();
    await expectDefaultIcon(page, 'Bold');
  });

  test('C3: rapid toggling does not detach duplicates and final state is correct', async ({ page }) => {
    await gotoDefault(page);
    await openBubble(page);
    await page.evaluate(() => {
      const setter = (window as unknown as Record<string, (k: string | null) => void>).__DEMO_SET_BUBBLE_ICONS__;
      for (let i = 0; i < 5; i++) {
        setter('full');
        setter(null);
      }
      setter('full');
    });
    await page.waitForTimeout(100);
    await selectInParagraph(page, 0, 'Hello'.length);
    await expect(page.locator(bubbleMenu)).toHaveCount(1);
    await expectCustomIcon(page, 'Bold', 'bold');
  });
});

test.describe('BubbleMenu icons - Group D: contexts', () => {
  test('D1: text context (paragraph selection) uses custom icons', async ({ page }) => {
    await gotoDefault(page, 'bubble-icons=full');
    await openBubble(page, '<p>Some text content for selection</p>');
    await expectCustomIcon(page, 'Bold', 'bold');
    await expectCustomIcon(page, 'Italic', 'italic');
  });

  test('D2: heading context uses custom icons', async ({ page }) => {
    await gotoDefault(page, 'bubble-icons=full');
    await setContentAndFocus(page, '<h1>Heading title</h1>');
    await selectInParagraph(page, 0, 'Heading'.length, `${editorSelector} h1`);
    await expect(page.locator(bubbleMenu)).toBeVisible();
    await expectCustomIcon(page, 'Bold', 'bold');
  });

  test('D3: code block context hides bubble or shows custom-icon subset', async ({ page }) => {
    await gotoDefault(page, 'bubble-icons=full');
    await setContentAndFocus(page, '<pre><code>const x = 1;</code></pre>');
    await selectInParagraph(page, 0, 5, `${editorSelector} code`);
    // Bubble may hide inside codeBlock; if visible, no default icon should leak through.
    const isVisible = await page.locator(bubbleMenu).isVisible();
    if (isVisible) {
      const defaultIcons = await page.locator(`${bubbleMenu} svg:not([data-test-icon])`).count();
      expect(defaultIcons).toBe(0);
    }
  });

  test('D4: context switch mid-session keeps custom icons', async ({ page }) => {
    await gotoDefault(page, 'bubble-icons=full');
    await setContentAndFocus(page, '<p>Paragraph text</p><h1>Heading text</h1>');
    await selectInParagraph(page, 0, 'Paragraph'.length, `${editorSelector} p`);
    await expect(page.locator(bubbleMenu)).toBeVisible();
    await expectCustomIcon(page, 'Bold', 'bold');
    await selectInParagraph(page, 0, 'Heading'.length, `${editorSelector} h1`);
    await expect(page.locator(bubbleMenu)).toBeVisible();
    await expectCustomIcon(page, 'Bold', 'bold');
  });
});

test.describe('BubbleMenu icons - Group E: item filtering', () => {
  test('E1: every item in a custom items list uses its custom icon', async ({ page }) => {
    await gotoDefault(page, 'bubble-icons=full&bubble-items=bold,italic,strike');
    await openBubble(page);
    await expectCustomIcon(page, 'Bold', 'bold');
    await expectCustomIcon(page, 'Italic', 'italic');
    await expectCustomIcon(page, 'Strikethrough', 'strike');
  });

  test('E2: item in custom list without override falls back to default', async ({ page }) => {
    await gotoDefault(page, 'bubble-icons=partial&bubble-items=bold,italic,strike');
    await openBubble(page);
    await expectCustomIcon(page, 'Bold', 'bold');
    await expectCustomIcon(page, 'Italic', 'italic');
    await expectDefaultIcon(page, 'Strikethrough');
  });
});

test.describe('BubbleMenu icons - Group F: active state', () => {
  test('F1: bold-active button keeps custom icon', async ({ page }) => {
    await gotoDefault(page, 'bubble-icons=full');
    await setContentAndFocus(page, '<p><strong>Bold text here</strong></p>');
    await selectInParagraph(page, 0, 'Bold'.length, `${editorSelector} strong`);
    await expect(page.locator(bubbleMenu)).toBeVisible();
    const bold = bubbleButton(page, 'Bold');
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
    await expect(bold.locator('svg[data-test-icon="custom-bold"]')).toHaveCount(1);
  });

  test('F2: activating bold via click does not revert icon', async ({ page }) => {
    await gotoDefault(page, 'bubble-icons=full');
    await openBubble(page);
    const bold = bubbleButton(page, 'Bold');
    await bold.click();
    await page.waitForTimeout(100);
    await expect(page.locator(bubbleMenu)).toBeVisible();
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
    await expect(bold.locator('svg[data-test-icon="custom-bold"]')).toHaveCount(1);
  });

  test('F3: aria attributes are preserved despite custom icons', async ({ page }) => {
    await gotoDefault(page, 'bubble-icons=full');
    await openBubble(page);
    await expect(page.locator(bubbleMenu)).toHaveAttribute('role', 'toolbar');
    const bold = bubbleButton(page, 'Bold');
    await expect(bold).toHaveAttribute('aria-label', 'Bold');
    await expect(bold).toHaveAttribute('title', /Bold/);
    // Roving tabindex is optional; assert at most one button has tabindex=0.
    const zeros = await page.locator(`${bubbleMenu} button[tabindex="0"]`).count();
    expect(zeros).toBeLessThanOrEqual(1);
  });
});

test.describe('BubbleMenu icons - Group G: edge cases', () => {
  test('G1: empty SVG string renders empty content, button still works', async ({ page }) => {
    await gotoDefault(page, 'bubble-icons=malformed');
    await openBubble(page);
    const bold = bubbleButton(page, 'Bold');
    await expect(bold).toBeVisible();
    await expect(bold.locator('svg')).toHaveCount(0);
    await bold.click();
    await page.waitForTimeout(50);
    const ed = await page.evaluate(() => {
      const editor = (window as unknown as Record<string, { isActive: (k: string) => boolean }>).__DEMO_EDITOR__;
      return editor.isActive('bold');
    });
    expect(ed).toBe(true);
  });

  test('G2: arbitrary HTML in IconSet renders as HTML', async ({ page }) => {
    await gotoDefault(page, 'bubble-icons=html');
    await openBubble(page);
    const bold = bubbleButton(page, 'Bold');
    await expect(bold.locator('.my-bold-icon')).toHaveText('B');
  });

  test('G3: swapping icons removes the old custom SVG from the DOM', async ({ page }) => {
    await gotoDefault(page, 'bubble-icons=full');
    await openBubble(page);
    await expectCustomIcon(page, 'Bold', 'bold');
    await page.evaluate(() => {
      const setter = (window as unknown as Record<string, (k: string | null) => void>).__DEMO_SET_BUBBLE_ICONS__;
      setter(null);
    });
    await page.waitForTimeout(100);
    await selectInParagraph(page, 0, 'Hello'.length);
    await expect(page.locator(bubbleMenu)).toBeVisible();
    await expect(page.locator(`${bubbleMenu} [data-test-icon]`)).toHaveCount(0);
  });

  test('G4: switching to notion mode reads icons param at mount', async ({ page }) => {
    await page.goto('/?bubble-icons=full');
    await page.waitForSelector(editorSelector);
    await openBubble(page);
    await expectCustomIcon(page, 'Bold', 'bold');
    await page.click(modeToggleNotion);
    await page.waitForSelector(editorSelector);
    await openBubble(page);
    await expectCustomIcon(page, 'Bold', 'bold');
  });

  test('G5: same IconSet content set twice does not detach buttons', async ({ page }) => {
    await gotoDefault(page, 'bubble-icons=full');
    await openBubble(page);
    await page.evaluate(() => {
      const btn = document.querySelector('.dm-bubble-menu button[aria-label="Bold"]');
      if (btn instanceof HTMLElement) btn.dataset.persistMarker = 'yes';
    });
    await page.evaluate(() => {
      const setter = (window as unknown as Record<string, (k: string) => void>).__DEMO_SET_BUBBLE_ICONS__;
      setter('full');
    });
    await page.waitForTimeout(100);
    await expect(bubbleButton(page, 'Bold')).toHaveCount(1);
    await expectCustomIcon(page, 'Bold', 'bold');
  });
});

test.describe('BubbleMenu icons - Group H: keyboard a11y', () => {
  test('H1: keyboard nav across buttons preserves custom icons', async ({ page }) => {
    await gotoDefault(page, 'bubble-icons=full');
    await openBubble(page);
    const bold = bubbleButton(page, 'Bold');
    await bold.focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(50);
    const focused = page.locator(`${bubbleMenu} button:focus`).first();
    const focusedExists = await focused.count();
    if (focusedExists > 0) {
      await expect(focused.locator('svg[data-test-icon]')).toHaveCount(1);
    }
    await expect(bold.locator('svg[data-test-icon="custom-bold"]')).toHaveCount(1);
  });

  test('H2: Escape closes bubble; reopen preserves custom icons', async ({ page }) => {
    await gotoDefault(page, 'bubble-icons=full');
    await openBubble(page);
    await expectCustomIcon(page, 'Bold', 'bold');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
    await selectInParagraph(page, 0, 'Hello'.length);
    await expect(page.locator(bubbleMenu)).toBeVisible();
    await expectCustomIcon(page, 'Bold', 'bold');
  });
});

test.describe('BubbleMenu icons - Group I: theme smoke', () => {
  test('I1: dark mode toggle does not affect custom icon rendering', async ({ page }) => {
    await gotoDefault(page, 'bubble-icons=full');
    const themeBtn = page.locator('.theme-toggle');
    if (await themeBtn.count() > 0) await themeBtn.click();
    await openBubble(page);
    await expectCustomIcon(page, 'Bold', 'bold');
  });
});
