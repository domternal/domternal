import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = '.dm-editor .ProseMirror';
const imageBtn = 'button[aria-label="Insert Image"]';

// 1x1 red pixel PNG as base64 for test fixtures
const BASE64_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
const REMOTE_IMG = 'https://via.placeholder.com/200x100.png';

/**
 * Sets editor content using the Editor API (via window.__DEMO_EDITOR__).
 * This properly goes through ProseMirror's content pipeline and creates NodeViews.
 * Direct innerHTML does NOT trigger NodeView creation for image nodes.
 */
async function setEditorContent(page: Page, html: string) {
  await page.evaluate((h) => {
    // Access editor exposed by demo app
    
    const editor = (window as any).__DEMO_EDITOR__;
    if (editor) {
      // emitUpdate=false → addToHistory=false so setContent doesn't pollute undo stack
      editor.setContent(h, false);
      editor.commands.focus();
    }
  }, html);
  await page.waitForTimeout(150);
}

async function getEditorText(page: Page): Promise<string> {
  return (await page.locator(editorSelector).textContent()) ?? '';
}

// ─── Fixtures ──────────────────────────────────────────────────────────

const IMG_BASIC = `<img src="${BASE64_1PX}">`;
const IMG_ALT = `<img src="${BASE64_1PX}" alt="Red pixel">`;
const IMG_ALL_ATTRS = `<img src="${BASE64_1PX}" alt="Pixel" title="A pixel" width="200">`;
const IMG_BETWEEN_PARAS = `<p>Before</p><img src="${BASE64_1PX}"><p>After</p>`;
const TWO_IMAGES = `<img src="${BASE64_1PX}" alt="First"><img src="${BASE64_1PX}" alt="Second">`;
const IMG_FLOAT_LEFT = `<img src="${BASE64_1PX}" style="float: left; margin: 0 1em 1em 0;">`;
const IMG_FLOAT_RIGHT = `<img src="${BASE64_1PX}" style="float: right; margin: 0 0 1em 1em;">`;
const IMG_FLOAT_CENTER = `<img src="${BASE64_1PX}" style="display: block; margin-left: auto; margin-right: auto;">`;
const IMG_WITH_WIDTH = `<img src="${BASE64_1PX}" width="300">`;
const PARA_ONLY = '<p>Some text here</p>';
const IMG_ALIGN_LEFT = `<img src="${BASE64_1PX}" align="left">`;
const IMG_ALIGN_RIGHT = `<img src="${BASE64_1PX}" align="right">`;
const IMG_ALIGN_CENTER = `<img src="${BASE64_1PX}" align="center">`;
const IMG_ALIGN_MIDDLE = `<img src="${BASE64_1PX}" align="middle">`;
const IMG_NO_SRC = '<img alt="no source">';
const CODE_BLOCK_CONTENT = '<pre><code>console.log("hello")</code></pre>';
const IMG_IN_PARA = `<p>text <img src="${BASE64_1PX}" alt="inline"> more</p>`;

// ═══════════════════════════════════════════════════════════════════════
// RENDERING
// ═══════════════════════════════════════════════════════════════════════

test.describe('Image — rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('renders image inside NodeView wrapper (.dm-image-resizable)', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`);
    await expect(wrapper.first()).toBeVisible();
    const img = wrapper.first().locator('img');
    await expect(img).toBeAttached();
  });

  test('img element has correct src attribute', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);

    const img = page.locator(`${editorSelector} .dm-image-resizable img`).first();
    await expect(img).toHaveAttribute('src', BASE64_1PX);
  });

  test('renders alt attribute', async ({ page }) => {
    await setEditorContent(page, IMG_ALT);

    const img = page.locator(`${editorSelector} .dm-image-resizable img`).first();
    await expect(img).toHaveAttribute('alt', 'Red pixel');
  });

  test('renders title attribute', async ({ page }) => {
    await setEditorContent(page, IMG_ALL_ATTRS);

    const img = page.locator(`${editorSelector} .dm-image-resizable img`).first();
    await expect(img).toHaveAttribute('title', 'A pixel');
  });

  test('renders width via inline style', async ({ page }) => {
    await setEditorContent(page, IMG_WITH_WIDTH);

    const img = page.locator(`${editorSelector} .dm-image-resizable img`).first();
    const style = await img.getAttribute('style');
    expect(style).toContain('width');
    expect(style).toContain('300px');
  });

  test('image between paragraphs preserves surrounding text', async ({ page }) => {
    await setEditorContent(page, IMG_BETWEEN_PARAS);

    const text = await getEditorText(page);
    expect(text).toContain('Before');
    expect(text).toContain('After');
    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`);
    await expect(wrapper.first()).toBeVisible();
  });

  test('renders multiple images', async ({ page }) => {
    await setEditorContent(page, TWO_IMAGES);

    const wrappers = page.locator(`${editorSelector} .dm-image-resizable`);
    await expect(wrappers).toHaveCount(2);
  });

  test('wrapper has draggable attribute', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await expect(wrapper).toHaveAttribute('draggable', 'true');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// RESIZE HANDLES
// ═══════════════════════════════════════════════════════════════════════

test.describe('Image — resize handles', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('image has 4 resize handles (nw, ne, sw, se)', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    const handles = wrapper.locator('.dm-image-handle');
    await expect(handles).toHaveCount(4);

    await expect(wrapper.locator('.dm-image-handle-nw')).toBeAttached();
    await expect(wrapper.locator('.dm-image-handle-ne')).toBeAttached();
    await expect(wrapper.locator('.dm-image-handle-sw')).toBeAttached();
    await expect(wrapper.locator('.dm-image-handle-se')).toBeAttached();
  });

  test('resize handles are hidden by default', async ({ page }) => {
    await setEditorContent(page, IMG_BETWEEN_PARAS);

    // Click paragraph so image is NOT selected
    await page.locator(`${editorSelector} > p`).first().click();
    await page.waitForTimeout(100);

    const handle = page.locator(`${editorSelector} .dm-image-handle-nw`).first();
    const display = await handle.evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe('none');
  });

  test('resize handles are visible when image is selected', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(100);

    const display = await wrapper.locator('.dm-image-handle-nw').evaluate(
      (el) => getComputedStyle(el).display,
    );
    expect(display).toBe('block');
  });

  test('selected image gets ProseMirror-selectednode class', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(100);

    await expect(wrapper).toHaveClass(/ProseMirror-selectednode/);
  });

  test('deselecting image removes ProseMirror-selectednode class', async ({ page }) => {
    await setEditorContent(page, IMG_BETWEEN_PARAS);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(100);
    await expect(wrapper).toHaveClass(/ProseMirror-selectednode/);

    // Click paragraph to deselect
    await page.locator(`${editorSelector} > p`).first().click();
    await page.waitForTimeout(100);
    await expect(wrapper).not.toHaveClass(/ProseMirror-selectednode/);
  });

  test('dragging resize handle changes image width', async ({ page }) => {
    await setEditorContent(page, IMG_WITH_WIDTH);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(100);

    const img = wrapper.locator('img');
    const initialWidth = await img.evaluate((el) => el.offsetWidth);

    // Drag the SE handle to make it wider
    const seHandle = wrapper.locator('.dm-image-handle-se');
    const handleBox = await seHandle.boundingBox();
    if (handleBox) {
      await page.mouse.move(handleBox.x + 4, handleBox.y + 4);
      await page.mouse.down();
      await page.mouse.move(handleBox.x + 104, handleBox.y + 4, { steps: 5 });
      await page.mouse.up();
    }

    const newWidth = await img.evaluate((el) => el.offsetWidth);
    expect(newWidth).toBeGreaterThan(initialWidth);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// FLOAT ATTRIBUTES
// ═══════════════════════════════════════════════════════════════════════

test.describe('Image — float', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('float left image has data-float="left" on wrapper', async ({ page }) => {
    await setEditorContent(page, IMG_FLOAT_LEFT);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await expect(wrapper).toHaveAttribute('data-float', 'left');
  });

  test('float right image has data-float="right" on wrapper', async ({ page }) => {
    await setEditorContent(page, IMG_FLOAT_RIGHT);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await expect(wrapper).toHaveAttribute('data-float', 'right');
  });

  test('center image has data-float="center" on wrapper', async ({ page }) => {
    await setEditorContent(page, IMG_FLOAT_CENTER);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await expect(wrapper).toHaveAttribute('data-float', 'center');
  });

  test('non-floated image has no data-float attribute', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await expect(wrapper).not.toHaveAttribute('data-float');
  });

  test('float left wrapper has CSS float: left', async ({ page }) => {
    await setEditorContent(page, IMG_FLOAT_LEFT);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    const float = await wrapper.evaluate((el) => getComputedStyle(el).cssFloat);
    expect(float).toBe('left');
  });

  test('float right wrapper has CSS float: right', async ({ page }) => {
    await setEditorContent(page, IMG_FLOAT_RIGHT);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    const float = await wrapper.evaluate((el) => getComputedStyle(el).cssFloat);
    expect(float).toBe('right');
  });

  test('center wrapper has display block', async ({ page }) => {
    await setEditorContent(page, IMG_FLOAT_CENTER);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    const display = await wrapper.evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe('block');
  });

  test('floated images max-width is 60%', async ({ page }) => {
    await setEditorContent(page, IMG_FLOAT_LEFT);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    const maxWidth = await wrapper.evaluate((el) => getComputedStyle(el).maxWidth);
    expect(maxWidth).toBe('60%');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// TOOLBAR BUTTON & IMAGE POPOVER
// ═══════════════════════════════════════════════════════════════════════

test.describe('Image — toolbar button & popover', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('toolbar has "Insert Image" button', async ({ page }) => {
    const btn = page.locator(imageBtn);
    await expect(btn).toBeVisible();
  });

  test('clicking toolbar button opens image popover', async ({ page }) => {
    await setEditorContent(page, '<p>Hello World</p>');
    await page.locator(imageBtn).click();

    const popover = page.locator('.dm-image-popover[data-show]');
    await expect(popover).toBeVisible();
  });

  test('popover has URL input, apply button, and browse button', async ({ page }) => {
    await setEditorContent(page, '<p>Hello World</p>');
    await page.locator(imageBtn).click();

    const input = page.locator('.dm-image-popover-input');
    await expect(input).toBeVisible();
    const applyBtn = page.locator('.dm-image-popover-apply');
    await expect(applyBtn).toBeAttached();
    const browseBtn = page.locator('.dm-image-popover-browse');
    await expect(browseBtn).toBeAttached();
  });

  test('URL input is focusable when popover opens', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    await page.locator(imageBtn).click();
    await expect(page.locator('.dm-image-popover[data-show]')).toBeVisible();

    // Click input to ensure focus (focus() may have timing issues with CSS transitions)
    const input = page.locator('.dm-image-popover-input');
    await input.click();
    await expect(input).toBeFocused();
  });

  test('clicking toolbar button again closes popover (toggle)', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    await page.locator(imageBtn).click();

    const popover = page.locator('.dm-image-popover[data-show]');
    await expect(popover).toBeVisible();

    await page.locator(imageBtn).click();
    await page.waitForTimeout(200);

    await expect(page.locator('.dm-image-popover[data-show]')).toHaveCount(0);
  });

  test('Escape closes the popover', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    await page.locator(imageBtn).click();

    await expect(page.locator('.dm-image-popover[data-show]')).toBeVisible();

    // Ensure input is focused so Escape handler fires
    await page.locator('.dm-image-popover-input').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    await expect(page.locator('.dm-image-popover[data-show]')).toHaveCount(0);
  });

  test('typing URL and pressing Enter inserts image', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    await page.locator(`${editorSelector} p`).click();
    await page.locator(imageBtn).click();
    await expect(page.locator('.dm-image-popover[data-show]')).toBeVisible();

    const input = page.locator('.dm-image-popover-input');
    await input.click();
    await input.fill(REMOTE_IMG);
    await page.keyboard.press('Enter');

    // Popover should close
    await page.waitForTimeout(200);
    await expect(page.locator('.dm-image-popover[data-show]')).toHaveCount(0);

    // Image should be inserted
    const img = page.locator(`${editorSelector} .dm-image-resizable img`).first();
    await expect(img).toHaveAttribute('src', REMOTE_IMG);
  });

  test('clicking apply button inserts image from URL', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    await page.locator(`${editorSelector} p`).click();
    await page.locator(imageBtn).click();
    await expect(page.locator('.dm-image-popover[data-show]')).toBeVisible();

    const input = page.locator('.dm-image-popover-input');
    await input.click();
    await input.fill(REMOTE_IMG);
    await page.locator('.dm-image-popover-apply').click();
    await page.waitForTimeout(200);

    const img = page.locator(`${editorSelector} .dm-image-resizable img`).first();
    await expect(img).toHaveAttribute('src', REMOTE_IMG);
  });

  test('empty URL does not insert image', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    await page.locator(`${editorSelector} p`).click();

    const imgCountBefore = await page.locator(`${editorSelector} .dm-image-resizable`).count();
    await page.locator(imageBtn).click();
    await expect(page.locator('.dm-image-popover[data-show]')).toBeVisible();
    await page.locator('.dm-image-popover-input').click();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    const imgCountAfter = await page.locator(`${editorSelector} .dm-image-resizable`).count();
    expect(imgCountAfter).toBe(imgCountBefore);
  });

  test('popover is appended to body (not inside editor)', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    await page.locator(imageBtn).click();

    const isBodyChild = await page.evaluate(() => {
      const popover = document.querySelector('.dm-image-popover');
      return popover?.parentElement === document.body;
    });
    expect(isBodyChild).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// POPOVER KEYBOARD NAVIGATION
// ═══════════════════════════════════════════════════════════════════════

test.describe('Image — popover keyboard navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Tab from input moves focus to apply button', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    await page.locator(imageBtn).click();
    await expect(page.locator('.dm-image-popover[data-show]')).toBeVisible();

    await page.locator('.dm-image-popover-input').click();
    await page.keyboard.press('Tab');

    const applyBtn = page.locator('.dm-image-popover-apply');
    await expect(applyBtn).toBeFocused();
  });

  test('Tab from apply button moves to browse button', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    await page.locator(imageBtn).click();
    await expect(page.locator('.dm-image-popover[data-show]')).toBeVisible();

    await page.locator('.dm-image-popover-input').click();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    const browseBtn = page.locator('.dm-image-popover-browse');
    await expect(browseBtn).toBeFocused();
  });

  test('Tab from browse button cycles back to input', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    await page.locator(imageBtn).click();
    await expect(page.locator('.dm-image-popover[data-show]')).toBeVisible();

    await page.locator('.dm-image-popover-input').click();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    const input = page.locator('.dm-image-popover-input');
    await expect(input).toBeFocused();
  });

  test('Shift+Tab from apply button moves back to input', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    await page.locator(imageBtn).click();
    await expect(page.locator('.dm-image-popover[data-show]')).toBeVisible();

    await page.locator('.dm-image-popover-input').click();
    // Tab to apply
    await page.keyboard.press('Tab');
    // Shift+Tab back to input
    await page.keyboard.press('Shift+Tab');

    const input = page.locator('.dm-image-popover-input');
    await expect(input).toBeFocused();
  });

  test('Escape on apply button closes popover', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    await page.locator(imageBtn).click();
    await expect(page.locator('.dm-image-popover[data-show]')).toBeVisible();

    await page.locator('.dm-image-popover-input').click();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    await expect(page.locator('.dm-image-popover[data-show]')).toHaveCount(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// INPUT RULE (Markdown ![alt](src))
// ═══════════════════════════════════════════════════════════════════════

test.describe('Image — input rule (markdown syntax)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('typing ![alt](url) inserts an image', async ({ page }) => {
    await setEditorContent(page, '<p></p>');
    await page.locator(`${editorSelector} p`).first().click();

    await page.keyboard.type(`![Test image](${REMOTE_IMG})`);
    await page.waitForTimeout(200);

    const img = page.locator(`${editorSelector} .dm-image-resizable img`).first();
    await expect(img).toHaveAttribute('src', REMOTE_IMG);
  });

  test('input rule sets alt attribute', async ({ page }) => {
    await setEditorContent(page, '<p></p>');
    await page.locator(`${editorSelector} p`).first().click();

    await page.keyboard.type(`![My alt text](${REMOTE_IMG})`);
    await page.waitForTimeout(200);

    const img = page.locator(`${editorSelector} .dm-image-resizable img`).first();
    await expect(img).toHaveAttribute('alt', 'My alt text');
  });

  test('input rule with title sets title attribute', async ({ page }) => {
    await setEditorContent(page, '<p></p>');
    await page.locator(`${editorSelector} p`).first().click();

    await page.keyboard.type(`![alt](${REMOTE_IMG} "My title")`);
    await page.waitForTimeout(200);

    const img = page.locator(`${editorSelector} .dm-image-resizable img`).first();
    await expect(img).toHaveAttribute('title', 'My title');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// BUBBLE MENU (image context)
// ═══════════════════════════════════════════════════════════════════════

test.describe('Image — bubble menu', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('selecting image shows bubble menu with float controls', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(300);

    const bubbleMenu = page.locator('.dm-bubble-menu');
    await expect(bubbleMenu).toBeVisible();
    // Should have float buttons
    const buttons = bubbleMenu.locator('button');
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(4); // at least float-none, left, center, right
  });

  test('bubble menu has delete button', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(300);

    const deleteBtn = page.locator('.dm-bubble-menu button[title="Delete"]');
    await expect(deleteBtn).toBeVisible();
  });

  test('clicking delete button removes image', async ({ page }) => {
    await setEditorContent(page, IMG_BETWEEN_PARAS);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(300);

    const deleteBtn = page.locator('.dm-bubble-menu button[title="Delete"]');
    await deleteBtn.click();
    await page.waitForTimeout(200);

    const images = page.locator(`${editorSelector} .dm-image-resizable`);
    await expect(images).toHaveCount(0);
    const text = await getEditorText(page);
    expect(text).toContain('Before');
    expect(text).toContain('After');
  });

  test('clicking "Float left" changes image float', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(300);

    const floatLeftBtn = page.locator('.dm-bubble-menu button[title="Float left"]');
    await floatLeftBtn.click();
    await page.waitForTimeout(200);

    await expect(wrapper).toHaveAttribute('data-float', 'left');
  });

  test('clicking "Float right" changes image float', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(300);

    const floatRightBtn = page.locator('.dm-bubble-menu button[title="Float right"]');
    await floatRightBtn.click();
    await page.waitForTimeout(200);

    await expect(wrapper).toHaveAttribute('data-float', 'right');
  });

  test('clicking "Center" changes image float to center', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(300);

    const centerBtn = page.locator('.dm-bubble-menu button[title="Center"]');
    await centerBtn.click();
    await page.waitForTimeout(200);

    await expect(wrapper).toHaveAttribute('data-float', 'center');
  });

  test('clicking "Inline" resets float to none', async ({ page }) => {
    await setEditorContent(page, IMG_FLOAT_LEFT);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(300);

    const inlineBtn = page.locator('.dm-bubble-menu button[title="Inline"]');
    await inlineBtn.click();
    await page.waitForTimeout(200);

    await expect(wrapper).not.toHaveAttribute('data-float');
  });

  test('clicking Float left then Float right updates data-float', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(300);

    const bubbleMenu = page.locator('.dm-bubble-menu');
    await expect(bubbleMenu).toBeVisible();

    // Set float left
    await bubbleMenu.locator('button[title="Float left"]').click();
    await page.waitForTimeout(200);
    await expect(wrapper).toHaveAttribute('data-float', 'left');

    // Change to float right
    await wrapper.click();
    await page.waitForTimeout(300);
    await bubbleMenu.locator('button[title="Float right"]').click();
    await page.waitForTimeout(200);
    await expect(wrapper).toHaveAttribute('data-float', 'right');
  });

  test('bubble menu repositions when float changes from none to right', async ({ page }) => {
    await setEditorContent(page, `<p>Some text before the image</p>${IMG_BASIC}<p>Some text after</p>`);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(300);

    const bubbleMenu = page.locator('.dm-bubble-menu');
    await expect(bubbleMenu).toHaveAttribute('data-show', '');

    // Record initial bubble menu position
    const initialBox = await bubbleMenu.boundingBox();
    expect(initialBox).toBeTruthy();

    // Click "Float right" — image moves to the right side
    await bubbleMenu.locator('button[title="Float right"]').click();
    await page.waitForTimeout(300);

    // Bubble menu should still be visible and repositioned
    await expect(bubbleMenu).toHaveAttribute('data-show', '');
    const newBox = await bubbleMenu.boundingBox();
    expect(newBox).toBeTruthy();

    // Menu should have moved to the right (x increased) to follow the image
    expect(newBox!.x).toBeGreaterThan(initialBox!.x);
  });

  test('bubble menu repositions when float changes from right to left', async ({ page }) => {
    await setEditorContent(page, `<p>Some text</p>${IMG_FLOAT_RIGHT}<p>More text</p>`);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(300);

    const bubbleMenu = page.locator('.dm-bubble-menu');
    await expect(bubbleMenu).toHaveAttribute('data-show', '');

    const initialBox = await bubbleMenu.boundingBox();
    expect(initialBox).toBeTruthy();

    // Click "Float left" — image moves to the left side
    await bubbleMenu.locator('button[title="Float left"]').click();
    await page.waitForTimeout(300);

    await expect(bubbleMenu).toHaveAttribute('data-show', '');
    const newBox = await bubbleMenu.boundingBox();
    expect(newBox).toBeTruthy();

    // Menu should have moved to the left (x decreased) to follow the image
    expect(newBox!.x).toBeLessThan(initialBox!.x);
  });

  test('bubble menu repositions when float changes from left to center', async ({ page }) => {
    await setEditorContent(page, `<p>Some text</p>${IMG_FLOAT_LEFT}<p>More text</p>`);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(300);

    const bubbleMenu = page.locator('.dm-bubble-menu');
    await expect(bubbleMenu).toHaveAttribute('data-show', '');

    const initialBox = await bubbleMenu.boundingBox();
    expect(initialBox).toBeTruthy();

    // Click "Center" — image moves to center
    await bubbleMenu.locator('button[title="Center"]').click();
    await page.waitForTimeout(300);

    await expect(bubbleMenu).toHaveAttribute('data-show', '');
    const newBox = await bubbleMenu.boundingBox();
    expect(newBox).toBeTruthy();

    // Menu should have moved to follow centered image (x increased from left-floated position)
    expect(newBox!.x).toBeGreaterThan(initialBox!.x);
  });

  test('bubble menu stays visible through multiple float changes', async ({ page }) => {
    await setEditorContent(page, `<p>Text</p>${IMG_BASIC}<p>More</p>`);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(300);

    const bubbleMenu = page.locator('.dm-bubble-menu');

    // Float left
    await bubbleMenu.locator('button[title="Float left"]').click();
    await page.waitForTimeout(200);
    await expect(bubbleMenu).toHaveAttribute('data-show', '');
    await expect(wrapper).toHaveAttribute('data-float', 'left');

    // Float right
    await bubbleMenu.locator('button[title="Float right"]').click();
    await page.waitForTimeout(200);
    await expect(bubbleMenu).toHaveAttribute('data-show', '');
    await expect(wrapper).toHaveAttribute('data-float', 'right');

    // Center
    await bubbleMenu.locator('button[title="Center"]').click();
    await page.waitForTimeout(200);
    await expect(bubbleMenu).toHaveAttribute('data-show', '');
    await expect(wrapper).toHaveAttribute('data-float', 'center');

    // Back to inline
    await bubbleMenu.locator('button[title="Inline"]').click();
    await page.waitForTimeout(200);
    await expect(bubbleMenu).toHaveAttribute('data-show', '');
  });

  test('clicking floated-right image after text selection selects the image', async ({ page }) => {
    // Regression: float-right pulls image out of flow; posAtCoords resolved
    // clicks to the text behind the float instead of the image NodeView.
    const content = `<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p><img src="${BASE64_1PX}" style="float: right; margin: 0 0 1em 1em;" width="120"><p>Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>`;
    await setEditorContent(page, content);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    const para = page.locator(`${editorSelector} > p`).first();

    // Select text in the paragraph a couple of times (simulates user behaviour)
    await para.click();
    await page.waitForTimeout(50);
    await para.click({ clickCount: 2 }); // double-click selects a word
    await page.waitForTimeout(50);
    await para.click(); // single click to collapse
    await page.waitForTimeout(50);

    // Now click the floated image — should select it
    await wrapper.click();
    await page.waitForTimeout(150);

    await expect(wrapper).toHaveClass(/ProseMirror-selectednode/);
  });

  test('clicking floated-left image after text selection selects the image', async ({ page }) => {
    const content = `<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p><img src="${BASE64_1PX}" style="float: left; margin: 0 1em 1em 0;" width="120"><p>Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.</p>`;
    await setEditorContent(page, content);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    const para = page.locator(`${editorSelector} > p`).last();

    // Select text next to the float
    await para.click({ clickCount: 2 });
    await page.waitForTimeout(50);
    await para.click();
    await page.waitForTimeout(50);

    // Click the floated image
    await wrapper.click();
    await page.waitForTimeout(150);

    await expect(wrapper).toHaveClass(/ProseMirror-selectednode/);
  });

  test('bubble menu hides when clicking away from image', async ({ page }) => {
    await setEditorContent(page, IMG_BETWEEN_PARAS);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(300);
    await expect(page.locator('.dm-bubble-menu')).toBeVisible();

    // Click paragraph to deselect image
    await page.locator(`${editorSelector} > p`).first().click();
    await page.waitForTimeout(300);

    // Bubble menu should be hidden
    const bubbleMenu = page.locator('.dm-bubble-menu');
    const isVisible = await bubbleMenu.evaluate((el) => {
      const style = getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
    });
    expect(isVisible).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// HTML OUTPUT
// ═══════════════════════════════════════════════════════════════════════

test.describe('Image — HTML output', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('outputs <img> with src attribute', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);

    const output = page.locator('pre.output');
    const html = await output.textContent() ?? '';
    expect(html).toContain('<img');
    expect(html).toContain(`src="${BASE64_1PX}"`);
  });

  test('outputs alt attribute in HTML', async ({ page }) => {
    await setEditorContent(page, IMG_ALT);

    const output = page.locator('pre.output');
    const html = await output.textContent() ?? '';
    expect(html).toContain('alt="Red pixel"');
  });

  test('outputs title attribute in HTML', async ({ page }) => {
    await setEditorContent(page, IMG_ALL_ATTRS);

    const output = page.locator('pre.output');
    const html = await output.textContent() ?? '';
    expect(html).toContain('title="A pixel"');
  });

  test('outputs width attribute in HTML', async ({ page }) => {
    await setEditorContent(page, IMG_WITH_WIDTH);

    const output = page.locator('pre.output');
    const html = await output.textContent() ?? '';
    expect(html).toContain('width="');
  });

  test('outputs float style in HTML for floated images', async ({ page }) => {
    await setEditorContent(page, IMG_FLOAT_LEFT);

    const output = page.locator('pre.output');
    const html = await output.textContent() ?? '';
    expect(html).toContain('float: left');
  });

  test('outputs center style in HTML for centered images', async ({ page }) => {
    await setEditorContent(page, IMG_FLOAT_CENTER);

    const output = page.locator('pre.output');
    const html = await output.textContent() ?? '';
    expect(html).toContain('margin-left: auto');
    expect(html).toContain('margin-right: auto');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// KEYBOARD: DELETE / BACKSPACE
// ═══════════════════════════════════════════════════════════════════════

test.describe('Image — keyboard delete', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Delete key removes selected image', async ({ page }) => {
    await setEditorContent(page, IMG_BETWEEN_PARAS);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(100);

    await page.keyboard.press('Delete');

    const images = page.locator(`${editorSelector} .dm-image-resizable`);
    await expect(images).toHaveCount(0);
  });

  test('Backspace removes selected image', async ({ page }) => {
    await setEditorContent(page, IMG_BETWEEN_PARAS);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(100);

    await page.keyboard.press('Backspace');

    const images = page.locator(`${editorSelector} .dm-image-resizable`);
    await expect(images).toHaveCount(0);
  });

  test('surrounding content preserved after deleting image', async ({ page }) => {
    await setEditorContent(page, IMG_BETWEEN_PARAS);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(100);

    await page.keyboard.press('Delete');

    const text = await getEditorText(page);
    expect(text).toContain('Before');
    expect(text).toContain('After');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// CSS STYLING
// ═══════════════════════════════════════════════════════════════════════

test.describe('Image — CSS styling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('image wrapper has inline-block display', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    const display = await wrapper.evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe('inline-block');
  });

  test('image wrapper has relative positioning', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    const position = await wrapper.evaluate((el) => getComputedStyle(el).position);
    expect(position).toBe('relative');
  });

  test('image has max-width 100%', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);

    const img = page.locator(`${editorSelector} .dm-image-resizable img`).first();
    const maxWidth = await img.evaluate((el) => getComputedStyle(el).maxWidth);
    expect(maxWidth).toBe('100%');
  });

  test('selected image has accent outline', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(100);

    const outlineStyle = await wrapper.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outlineStyle).toBe('solid');
  });

  test('popover has correct initial visibility (hidden)', async ({ page }) => {
    const popover = page.locator('.dm-image-popover');
    if (await popover.count() > 0) {
      const visibility = await popover.evaluate((el) => getComputedStyle(el).visibility);
      expect(visibility).toBe('hidden');
    }
  });

  test('popover becomes visible with data-show attribute', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    await page.locator(imageBtn).click();

    // Wait for the CSS transition to complete
    const popover = page.locator('.dm-image-popover[data-show]');
    await expect(popover).toBeVisible();
    const visibility = await popover.evaluate((el) => getComputedStyle(el).visibility);
    expect(visibility).toBe('visible');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// UNDO / REDO
// ═══════════════════════════════════════════════════════════════════════

test.describe('Image — undo / redo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('undo after inserting image via popover removes it', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    await page.locator(`${editorSelector} p`).click();
    await page.locator(imageBtn).click();
    await expect(page.locator('.dm-image-popover[data-show]')).toBeVisible();

    const input = page.locator('.dm-image-popover-input');
    await input.click();
    await input.fill(BASE64_1PX);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    await expect(page.locator(`${editorSelector} .dm-image-resizable`).first()).toBeVisible();

    // Popover closes and returns focus to editor, so Cmd+Z should work
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);

    const images = page.locator(`${editorSelector} .dm-image-resizable`);
    await expect(images).toHaveCount(0);
  });

  test('undo after deleting image restores it', async ({ page }) => {
    await setEditorContent(page, IMG_BETWEEN_PARAS);

    const wrapper = page.locator(`${editorSelector} .dm-image-resizable`).first();
    await wrapper.click();
    await page.waitForTimeout(100);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(100);

    await expect(page.locator(`${editorSelector} .dm-image-resizable`)).toHaveCount(0);

    // Editor should still be focused after Delete
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(300);

    await expect(page.locator(`${editorSelector} .dm-image-resizable`).first()).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// EDGE CASES
// ═══════════════════════════════════════════════════════════════════════

test.describe('Image — edge cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('image at very start of document', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);

    const firstChild = page.locator(`${editorSelector} > *`).first();
    const className = await firstChild.getAttribute('class');
    expect(className).toContain('dm-image-resizable');
  });

  test('image at very end of document', async ({ page }) => {
    await setEditorContent(page, `<p>Before</p>${IMG_BASIC}`);

    const lastChild = page.locator(`${editorSelector} > *`).last();
    const className = await lastChild.getAttribute('class');
    expect(className).toContain('dm-image-resizable');
  });

  test('multiple images in sequence', async ({ page }) => {
    await setEditorContent(page, TWO_IMAGES);

    const images = page.locator(`${editorSelector} .dm-image-resizable`);
    await expect(images).toHaveCount(2);
    await expect(images.first().locator('img')).toHaveAttribute('alt', 'First');
    await expect(images.nth(1).locator('img')).toHaveAttribute('alt', 'Second');
  });

  test('clicking outside popover closes it', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    await page.locator(imageBtn).click();
    await expect(page.locator('.dm-image-popover[data-show]')).toBeVisible();

    // Click on the editor (outside popover)
    await page.locator(`${editorSelector}`).click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(300);

    await expect(page.locator('.dm-image-popover[data-show]')).toHaveCount(0);
  });

  test('image with all attributes renders them all', async ({ page }) => {
    await setEditorContent(page, IMG_ALL_ATTRS);

    const img = page.locator(`${editorSelector} .dm-image-resizable img`).first();
    await expect(img).toHaveAttribute('src', BASE64_1PX);
    await expect(img).toHaveAttribute('alt', 'Pixel');
    await expect(img).toHaveAttribute('title', 'A pixel');
    const style = await img.getAttribute('style');
    expect(style).toContain('200px');
  });

  test('XSS: javascript: URL is blocked', async ({ page }) => {
    await setEditorContent(page, '<img src="javascript:alert(1)">');

    // The image should not have the javascript URL
    const img = page.locator(`${editorSelector} .dm-image-resizable img`).first();
    if (await img.count() > 0) {
      const src = await img.getAttribute('src');
      expect(src).not.toContain('javascript:');
    }
  });

  test('XSS: vbscript: URL is blocked', async ({ page }) => {
    await setEditorContent(page, '<img src="vbscript:msgbox(1)">');

    const img = page.locator(`${editorSelector} .dm-image-resizable img`).first();
    if (await img.count() > 0) {
      const src = await img.getAttribute('src');
      expect(src).not.toContain('vbscript:');
    }
  });

  test('XSS: data:text/html is blocked', async ({ page }) => {
    await setEditorContent(page, '<img src="data:text/html,<script>alert(1)</script>">');

    const img = page.locator(`${editorSelector} .dm-image-resizable img`).first();
    if (await img.count() > 0) {
      const src = await img.getAttribute('src');
      expect(src).not.toContain('data:text/html');
    }
  });

  test('base64 data:image/ URL is allowed', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);

    const img = page.locator(`${editorSelector} .dm-image-resizable img`).first();
    await expect(img).toHaveAttribute('src', BASE64_1PX);
  });

  test('image can be inserted via popover with base64 URL', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    await page.locator(`${editorSelector} p`).click();
    await page.locator(imageBtn).click();
    await expect(page.locator('.dm-image-popover[data-show]')).toBeVisible();

    const input = page.locator('.dm-image-popover-input');
    await input.click();
    await input.fill(BASE64_1PX);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    const img = page.locator(`${editorSelector} .dm-image-resizable img`).first();
    await expect(img).toHaveAttribute('src', BASE64_1PX);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// DRAG & DROP OVERLAY
// ═══════════════════════════════════════════════════════════════════════

test.describe('Image — drag overlay', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('editor does not have dm-dragover class initially', async ({ page }) => {
    const editor = page.locator('.dm-editor');
    await expect(editor).not.toHaveClass(/dm-dragover/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// POPOVER CSS STYLING
// ═══════════════════════════════════════════════════════════════════════

test.describe('Image — popover styling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('popover has flex display', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    await page.locator(imageBtn).click();

    const popover = page.locator('.dm-image-popover');
    const display = await popover.evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe('flex');
  });

  test('popover has border-radius', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    await page.locator(imageBtn).click();

    const popover = page.locator('.dm-image-popover');
    const radius = await popover.evaluate((el) => getComputedStyle(el).borderRadius);
    expect(radius).not.toBe('0px');
  });

  test('popover has box-shadow', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    await page.locator(imageBtn).click();

    const popover = page.locator('.dm-image-popover');
    const shadow = await popover.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow).not.toBe('none');
  });

  test('URL input has min-width', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    await page.locator(imageBtn).click();

    const input = page.locator('.dm-image-popover-input');
    const minWidth = await input.evaluate((el) => getComputedStyle(el).minWidth);
    expect(minWidth).not.toBe('0px');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// DOCS VERIFICATION — additional tests for documented behavior
// ═══════════════════════════════════════════════════════════════════════

test.describe('Image — docs verification: parseHTML', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('img without src attribute is NOT parsed as image node', async ({ page }) => {
    await setEditorContent(page, IMG_NO_SRC);
    const images = page.locator('.dm-image-resizable');
    await expect(images).toHaveCount(0);
  });

  test('float parsed from style="float: left"', async ({ page }) => {
    await setEditorContent(page, IMG_FLOAT_LEFT);
    const wrapper = page.locator('.dm-image-resizable');
    await expect(wrapper).toHaveAttribute('data-float', 'left');
  });

  test('float parsed from style="float: right"', async ({ page }) => {
    await setEditorContent(page, IMG_FLOAT_RIGHT);
    const wrapper = page.locator('.dm-image-resizable');
    await expect(wrapper).toHaveAttribute('data-float', 'right');
  });

  test('float parsed from style margin-left/right auto (center)', async ({ page }) => {
    await setEditorContent(page, IMG_FLOAT_CENTER);
    const wrapper = page.locator('.dm-image-resizable');
    await expect(wrapper).toHaveAttribute('data-float', 'center');
  });

  test('float parsed from align="left"', async ({ page }) => {
    await setEditorContent(page, IMG_ALIGN_LEFT);
    const wrapper = page.locator('.dm-image-resizable');
    await expect(wrapper).toHaveAttribute('data-float', 'left');
  });

  test('float parsed from align="right"', async ({ page }) => {
    await setEditorContent(page, IMG_ALIGN_RIGHT);
    const wrapper = page.locator('.dm-image-resizable');
    await expect(wrapper).toHaveAttribute('data-float', 'right');
  });

  test('float parsed from align="center"', async ({ page }) => {
    await setEditorContent(page, IMG_ALIGN_CENTER);
    const wrapper = page.locator('.dm-image-resizable');
    await expect(wrapper).toHaveAttribute('data-float', 'center');
  });

  test('float parsed from align="middle" (mapped to center)', async ({ page }) => {
    await setEditorContent(page, IMG_ALIGN_MIDDLE);
    const wrapper = page.locator('.dm-image-resizable');
    await expect(wrapper).toHaveAttribute('data-float', 'center');
  });
});

test.describe('Image — docs verification: commands', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('setImage returns false inside a code block', async ({ page }) => {
    await setEditorContent(page, CODE_BLOCK_CONTENT);
    // Place cursor inside code block
    await page.locator(editorSelector + ' pre').click();
    const result = await page.evaluate(() => {
      // Access editor exposed by demo app
      const editor = (window as any).__DEMO_EDITOR__;
      return editor?.commands.setImage({ src: 'https://example.com/img.png' });
    });
    expect(result).toBe(false);
  });

  test('setImageFloat returns false for invalid value', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);
    // Select the image
    await page.locator('.dm-image-resizable').click();
    const result = await page.evaluate(() => {
      // Access editor exposed by demo app
      const editor = (window as any).__DEMO_EDITOR__;
      return editor?.commands.setImageFloat('invalid-value');
    });
    expect(result).toBe(false);
  });

  test('setImageFloat returns false when no image is selected', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    await page.locator(editorSelector).click();
    const result = await page.evaluate(() => {
      // Access editor exposed by demo app
      const editor = (window as any).__DEMO_EDITOR__;
      return editor?.commands.setImageFloat('left');
    });
    expect(result).toBe(false);
  });

  test('setImage replaces existing selected image (NodeSelection)', async ({ page }) => {
    await setEditorContent(page, IMG_ALT);
    // Select the existing image
    await page.locator('.dm-image-resizable').click();
    await page.waitForTimeout(100);
    // Replace with new image via setImage
    await page.evaluate(() => {
      // Access editor exposed by demo app
      const editor = (window as any).__DEMO_EDITOR__;
      editor?.commands.setImage({ src: 'https://example.com/replaced.png', alt: 'Replaced' });
    });
    await page.waitForTimeout(100);
    // Should still have exactly one image, with the new alt
    const images = page.locator('.dm-image-resizable');
    await expect(images).toHaveCount(1);
    const alt = await page.locator('.dm-image-resizable img').getAttribute('alt');
    expect(alt).toBe('Replaced');
  });

  test('deleteImage always returns true even without image selected', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    await page.locator(editorSelector).click();
    const result = await page.evaluate(() => {
      // Access editor exposed by demo app
      const editor = (window as any).__DEMO_EDITOR__;
      return editor?.commands.deleteImage();
    });
    expect(result).toBe(true);
  });
});

test.describe('Image — docs verification: input rules', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('input rule with single-quoted title', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    const editor = page.locator(editorSelector);
    await editor.click();
    // Select all and delete to start fresh
    await page.keyboard.press('Meta+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.type("![photo](https://example.com/img.png 'My Title')", { delay: 10 });
    await page.waitForTimeout(200);
    const img = page.locator('.dm-image-resizable img');
    await expect(img).toHaveCount(1);
    const title = await img.getAttribute('title');
    expect(title).toBe('My Title');
  });

  test('input rule blocks javascript: URL', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    const editor = page.locator(editorSelector);
    await editor.click();
    await page.keyboard.press('Meta+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('![xss](javascript:alert(1))', { delay: 10 });
    await page.waitForTimeout(200);
    const images = page.locator('.dm-image-resizable');
    await expect(images).toHaveCount(0);
  });
});

test.describe('Image — docs verification: leafText', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('getText() returns alt attribute as text representation', async ({ page }) => {
    await setEditorContent(page, IMG_ALT);
    const text = await page.evaluate(() => {
      // Access editor exposed by demo app
      const editor = (window as any).__DEMO_EDITOR__;
      return editor?.getText();
    });
    expect(text).toContain('Red pixel');
  });
});

test.describe('Image — docs verification: float rendering HTML output', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('float left outputs correct inline style', async ({ page }) => {
    await setEditorContent(page, IMG_FLOAT_LEFT);
    const html: string = await page.evaluate(() => {
      // Access editor exposed by demo app
      const editor = (window as any).__DEMO_EDITOR__;
      return editor?.getHTML() ?? '';
    });
    expect(html).toContain('float: left');
    // Browser normalizes `0` to `0px` in computed margin values
    expect(html).toMatch(/margin:\s*0(px)?\s+1em\s+1em\s+0(px)?/);
  });

  test('float right outputs correct inline style', async ({ page }) => {
    await setEditorContent(page, IMG_FLOAT_RIGHT);
    const html: string = await page.evaluate(() => {
      // Access editor exposed by demo app
      const editor = (window as any).__DEMO_EDITOR__;
      return editor?.getHTML() ?? '';
    });
    expect(html).toContain('float: right');
    // Browser normalizes `0` to `0px` in computed margin values
    expect(html).toMatch(/margin:\s*0(px)?\s+0(px)?\s+1em\s+1em/);
  });

  test('center outputs correct inline style', async ({ page }) => {
    await setEditorContent(page, IMG_FLOAT_CENTER);
    const html: string = await page.evaluate(() => {
      // Access editor exposed by demo app
      const editor = (window as any).__DEMO_EDITOR__;
      return editor?.getHTML() ?? '';
    });
    expect(html).toContain('display: block');
    expect(html).toContain('margin-left: auto');
    expect(html).toContain('margin-right: auto');
  });

  test('float none outputs no style attribute', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);
    const html: string = await page.evaluate(() => {
      // Access editor exposed by demo app
      const editor = (window as any).__DEMO_EDITOR__;
      return editor?.getHTML() ?? '';
    });
    // Non-floated image should have no style attribute
    expect(html).toMatch(/<img[^>]*src=/);
    expect(html).not.toMatch(/<img[^>]*style=/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// DOCS VERIFICATION 2 — additional edge cases
// ═══════════════════════════════════════════════════════════════════════

test.describe('Image — docs verification: allowBase64 option', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('with allowBase64: true (default), data:image/ URL is accepted by setImage', async ({ page }) => {
    const result = await page.evaluate((b64) => {
      // Access editor exposed by demo app
      const editor = (window as any).__DEMO_EDITOR__;
      return editor?.commands.setImage({ src: b64 });
    }, BASE64_1PX);
    expect(result).toBe(true);
  });

  test('setImage blocks data:text/html regardless of allowBase64', async ({ page }) => {
    const result = await page.evaluate(() => {
      // Access editor exposed by demo app
      const editor = (window as any).__DEMO_EDITOR__;
      return editor?.commands.setImage({ src: 'data:text/html,<script>alert(1)</script>' });
    });
    expect(result).toBe(false);
  });

  test('setImage accepts relative path URLs', async ({ page }) => {
    const result = await page.evaluate(() => {
      // Access editor exposed by demo app
      const editor = (window as any).__DEMO_EDITOR__;
      return editor?.commands.setImage({ src: './images/photo.jpg' });
    });
    expect(result).toBe(true);
  });

  test('setImage accepts absolute path URLs', async ({ page }) => {
    const result = await page.evaluate(() => {
      // Access editor exposed by demo app
      const editor = (window as any).__DEMO_EDITOR__;
      return editor?.commands.setImage({ src: '/uploads/photo.jpg' });
    });
    expect(result).toBe(true);
  });

  test('setImage accepts protocol-relative URLs', async ({ page }) => {
    const result = await page.evaluate(() => {
      // Access editor exposed by demo app
      const editor = (window as any).__DEMO_EDITOR__;
      return editor?.commands.setImage({ src: '//cdn.example.com/img.png' });
    });
    expect(result).toBe(true);
  });

  test('setImage blocks file: protocol', async ({ page }) => {
    const result = await page.evaluate(() => {
      // Access editor exposed by demo app
      const editor = (window as any).__DEMO_EDITOR__;
      return editor?.commands.setImage({ src: 'file:///etc/passwd' });
    });
    expect(result).toBe(false);
  });
});

test.describe('Image — docs verification: setImage attributes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('setImage with all attributes renders them in HTML', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    await page.evaluate(() => {
      // Access editor exposed by demo app
      const editor = (window as any).__DEMO_EDITOR__;
      editor?.commands.setImage({
        src: 'https://example.com/photo.jpg',
        alt: 'Test alt',
        title: 'Test title',
        width: 400,
        loading: 'lazy',
        float: 'left',
      });
    });
    await page.waitForTimeout(100);
    const html: string = await page.evaluate(() => {
      // Access editor exposed by demo app
      const editor = (window as any).__DEMO_EDITOR__;
      return editor?.getHTML() ?? '';
    });
    expect(html).toContain('src="https://example.com/photo.jpg"');
    expect(html).toContain('alt="Test alt"');
    expect(html).toContain('title="Test title"');
    expect(html).toContain('width="400"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('float: left');
  });

  test('setImage with crossorigin renders in HTML', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    await page.evaluate(() => {
      // Access editor exposed by demo app
      const editor = (window as any).__DEMO_EDITOR__;
      editor?.commands.setImage({
        src: 'https://example.com/photo.jpg',
        crossorigin: 'anonymous',
      });
    });
    await page.waitForTimeout(100);
    const html: string = await page.evaluate(() => {
      // Access editor exposed by demo app
      const editor = (window as any).__DEMO_EDITOR__;
      return editor?.getHTML() ?? '';
    });
    expect(html).toContain('crossorigin="anonymous"');
  });

  test('null attributes are omitted from rendered HTML', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    await page.evaluate(() => {
      // Access editor exposed by demo app
      const editor = (window as any).__DEMO_EDITOR__;
      editor?.commands.setImage({ src: 'https://example.com/photo.jpg' });
    });
    await page.waitForTimeout(100);
    const html: string = await page.evaluate(() => {
      // Access editor exposed by demo app
      const editor = (window as any).__DEMO_EDITOR__;
      return editor?.getHTML() ?? '';
    });
    expect(html).toContain('src="https://example.com/photo.jpg"');
    expect(html).not.toContain('alt=');
    expect(html).not.toContain('title=');
    expect(html).not.toContain('width=');
    expect(html).not.toContain('height=');
    expect(html).not.toContain('loading=');
    expect(html).not.toContain('crossorigin=');
    expect(html).not.toContain('style=');
  });
});

test.describe('Image — docs verification: input rule edge cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('input rule with double-quoted title', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    const editor = page.locator(editorSelector);
    await editor.click();
    await page.keyboard.press('Meta+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('![alt](https://example.com/img.png "Double Title")', { delay: 10 });
    await page.waitForTimeout(200);
    const img = page.locator('.dm-image-resizable img');
    await expect(img).toHaveCount(1);
    expect(await img.getAttribute('title')).toBe('Double Title');
  });

  test('input rule without title (only alt and src)', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    const editor = page.locator(editorSelector);
    await editor.click();
    await page.keyboard.press('Meta+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('![my alt](https://example.com/img.png)', { delay: 10 });
    await page.waitForTimeout(200);
    const img = page.locator('.dm-image-resizable img');
    await expect(img).toHaveCount(1);
    expect(await img.getAttribute('alt')).toBe('my alt');
    // Title should not be set
    const title = await img.getAttribute('title');
    expect(title === null || title === '').toBeTruthy();
  });

  test('input rule can appear after text on the same line', async ({ page }) => {
    await setEditorContent(page, PARA_ONLY);
    const editor = page.locator(editorSelector);
    await editor.click();
    await page.keyboard.press('Meta+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('check this ![pic](https://example.com/img.png)', { delay: 10 });
    await page.waitForTimeout(200);
    const img = page.locator('.dm-image-resizable img');
    await expect(img).toHaveCount(1);
  });
});

test.describe('Image — docs verification: bubble menu active state', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Float left button has active class when image is floated left', async ({ page }) => {
    await setEditorContent(page, IMG_FLOAT_LEFT);
    await page.locator('.dm-image-resizable').click();
    await page.waitForTimeout(200);
    const floatLeftBtn = page.locator('.dm-bubble-menu button[aria-label="Float left"]');
    await expect(floatLeftBtn).toHaveClass(/dm-toolbar-button--active/);
  });

  test('Inline button has active class for non-floated image', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);
    await page.locator('.dm-image-resizable').click();
    await page.waitForTimeout(200);
    const inlineBtn = page.locator('.dm-bubble-menu button[aria-label="Inline"]');
    await expect(inlineBtn).toHaveClass(/dm-toolbar-button--active/);
  });

  test('Center button has active class when image is centered', async ({ page }) => {
    await setEditorContent(page, IMG_FLOAT_CENTER);
    await page.locator('.dm-image-resizable').click();
    await page.waitForTimeout(200);
    const centerBtn = page.locator('.dm-bubble-menu button[aria-label="Center"]');
    await expect(centerBtn).toHaveClass(/dm-toolbar-button--active/);
  });

  test('active state updates when float changes', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);
    await page.locator('.dm-image-resizable').click();
    await page.waitForTimeout(200);
    // Initially inline
    const inlineBtn = page.locator('.dm-bubble-menu button[aria-label="Inline"]');
    await expect(inlineBtn).toHaveClass(/dm-toolbar-button--active/);
    // Click Float right
    const rightBtn = page.locator('.dm-bubble-menu button[aria-label="Float right"]');
    await rightBtn.click();
    await page.waitForTimeout(200);
    // Now Float right should be active, Inline should not
    await expect(rightBtn).toHaveClass(/dm-toolbar-button--active/);
    await expect(inlineBtn).not.toHaveClass(/dm-toolbar-button--active/);
  });
});

test.describe('Image — docs verification: JSON representation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('getJSON() contains all image attributes with defaults', async ({ page }) => {
    await setEditorContent(page, IMG_BASIC);
    const json = await page.evaluate(() => {
      // Access editor exposed by demo app
      const editor = (window as any).__DEMO_EDITOR__;
      return editor?.getJSON();
    });
    // Find the image node in the JSON
    const imageNode = json?.content?.find((n: any) => n.type === 'image');
    expect(imageNode).toBeTruthy();
    expect(imageNode.attrs.src).toContain('data:image/png');
    expect(imageNode.attrs.alt).toBeNull();
    expect(imageNode.attrs.title).toBeNull();
    expect(imageNode.attrs.width).toBeNull();
    expect(imageNode.attrs.height).toBeNull();
    expect(imageNode.attrs.loading).toBeNull();
    expect(imageNode.attrs.crossorigin).toBeNull();
    expect(imageNode.attrs.float).toBe('none');
  });

  test('getJSON() includes set attributes', async ({ page }) => {
    await setEditorContent(page, IMG_ALL_ATTRS);
    const json = await page.evaluate(() => {
      // Access editor exposed by demo app
      const editor = (window as any).__DEMO_EDITOR__;
      return editor?.getJSON();
    });
    const imageNode = json?.content?.find((n: any) => n.type === 'image');
    expect(imageNode).toBeTruthy();
    expect(imageNode.attrs.alt).toBe('Pixel');
    expect(imageNode.attrs.title).toBe('A pixel');
    expect(imageNode.attrs.width).toBe('200');
  });
});
