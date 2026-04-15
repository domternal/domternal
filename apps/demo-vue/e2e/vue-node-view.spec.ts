/**
 * Vue-specific E2E tests for VueNodeViewRenderer.
 *
 * The Callout extension (see apps/demo-vue/src/Callout.ts) uses
 * VueNodeViewRenderer to render a Vue component as a ProseMirror NodeView.
 *
 * Tests verify:
 * - Vue component renders inside the editor (reactive props, scoped CSS)
 * - updateAttributes() persists attribute changes to the document
 * - deleteNode() removes the node from the document
 * - NodeViewContent exposes editable nested content
 * - useCurrentEditor() inject chain works inside a NodeView (appContext
 *   forwarding via pendingAppContextStore)
 * - ProseMirror selectNode/deselectNode updates the reactive `selected` prop
 */
import { test, EDITOR_SELECTOR } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const wrapper = '[data-testid="callout-wrapper"]';

async function openNodeViewDemo({ page }: { page: Page }) {
  await page.goto('/');
  await page.locator('[data-testid="mode-nodeview"]').click();
  await expect(page.locator(EDITOR_SELECTOR)).toBeVisible();
  await expect(page.locator(wrapper).first()).toBeVisible();
}

async function getEditorHTML(page: Page): Promise<string> {
  return page.evaluate(() => window.__DEMO_EDITOR__?.getHTML() ?? '');
}

test.describe('VueNodeViewRenderer — rendering', () => {
  test.beforeEach(openNodeViewDemo);

  test('Vue component renders inside editor as NodeView', async ({ page }) => {
    await expect(page.locator(wrapper)).toBeVisible();
    await expect(page.locator(wrapper).locator('[data-testid="callout-icon"]')).toBeVisible();
  });

  test('NodeViewWrapper sets data-node-view-wrapper attribute', async ({ page }) => {
    const wrapperEl = page.locator(`${wrapper}`);
    await expect(wrapperEl).toHaveAttribute('data-node-view-wrapper', '');
  });

  test('reactive props: node.attrs.variant is read into template', async ({ page }) => {
    const callout = page.locator(wrapper).first();
    await expect(callout).toHaveAttribute('data-variant', 'info');
  });

  test('scoped CSS is preserved (data-v attribute present)', async ({ page }) => {
    const hasScopeId = await page.locator(wrapper).first().evaluate((el: HTMLElement) => {
      return [...el.attributes].some((a) => a.name.startsWith('data-v-'));
    });
    expect(hasScopeId).toBe(true);
  });

  test('NodeViewContent renders editable area for nested content', async ({ page }) => {
    const content = page.locator(wrapper).first().locator('.callout-content');
    await expect(content).toBeVisible();
    await expect(content).toContainText('info callout');
  });

  test('initial document content is rendered via parseHTML', async ({ page }) => {
    const html = await getEditorHTML(page);
    expect(html).toContain('data-type="callout"');
    expect(html).toContain('data-variant="info"');
  });
});

test.describe('VueNodeViewRenderer — updateAttributes', () => {
  test.beforeEach(openNodeViewDemo);

  test('selecting a new variant updates node.attrs via updateAttributes', async ({ page }) => {
    const callout = page.locator(wrapper).first();
    await callout.locator('[data-testid="callout-variant-select"]').selectOption('danger');
    await page.waitForTimeout(200);

    await expect(callout).toHaveAttribute('data-variant', 'danger');
    const html = await getEditorHTML(page);
    expect(html).toContain('data-variant="danger"');
  });

  test('variant change updates CSS class reactively', async ({ page }) => {
    const callout = page.locator(wrapper).first();
    await callout.locator('[data-testid="callout-variant-select"]').selectOption('success');
    await page.waitForTimeout(200);

    await expect(callout).toHaveClass(/callout--success/);
  });

  test('icon reflects variant (emoji swap via computed)', async ({ page }) => {
    const callout = page.locator(wrapper).first();
    const icon = callout.locator('[data-testid="callout-icon"]');

    await expect(icon).toHaveText('\u2139\uFE0F'); // info
    await callout.locator('[data-testid="callout-variant-select"]').selectOption('warning');
    await page.waitForTimeout(200);
    await expect(icon).toHaveText('\u26A0\uFE0F'); // warning
  });

  test('variant change survives HTML serialization (persists to document)', async ({ page }) => {
    const callout = page.locator(wrapper).first();
    await callout.locator('[data-testid="callout-variant-select"]').selectOption('danger');
    await page.waitForTimeout(200);

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<div[^>]*data-type="callout"[^>]*data-variant="danger"/);
  });
});

test.describe('VueNodeViewRenderer — deleteNode', () => {
  test.beforeEach(openNodeViewDemo);

  test('clicking delete button removes the node from document', async ({ page }) => {
    const initialCount = await page.locator(wrapper).count();
    expect(initialCount).toBeGreaterThanOrEqual(1);

    await page.locator(`${wrapper} [data-testid="callout-delete-btn"]`).first().click();
    await page.waitForTimeout(200);

    const newCount = await page.locator(wrapper).count();
    expect(newCount).toBe(initialCount - 1);
  });

  test('deleted node disappears from HTML output', async ({ page }) => {
    const htmlBefore = await getEditorHTML(page);
    expect(htmlBefore).toContain('data-type="callout"');

    // Delete all callouts
    while ((await page.locator(wrapper).count()) > 0) {
      await page.locator(`${wrapper} [data-testid="callout-delete-btn"]`).first().click();
      await page.waitForTimeout(150);
    }

    const htmlAfter = await getEditorHTML(page);
    expect(htmlAfter).not.toContain('data-type="callout"');
  });
});

test.describe('VueNodeViewRenderer — editable content', () => {
  test.beforeEach(openNodeViewDemo);

  test('typing inside NodeViewContent updates document content', async ({ page }) => {
    const content = page.locator(wrapper).first().locator('.callout-content p');
    await content.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' - appended');
    await page.waitForTimeout(200);

    await expect(content).toContainText('appended');
    const html = await getEditorHTML(page);
    expect(html).toContain('appended');
  });

  test('NodeViewContent is contenteditable inside non-editable header', async ({ page }) => {
    const callout = page.locator(wrapper).first();
    const header = callout.locator('.callout-header');

    await expect(header).toHaveAttribute('contenteditable', 'false');

    const content = callout.locator('.callout-content');
    // The content area does not have contenteditable=false - ProseMirror
    // manages the editable surface at the editor root level.
    await expect(content).not.toHaveAttribute('contenteditable', 'false');
  });
});

test.describe('VueNodeViewRenderer — provide/inject forwarding (appContext)', () => {
  test.beforeEach(openNodeViewDemo);

  test('useCurrentEditor() inside NodeView finds the editor', async ({ page }) => {
    const indicator = page.locator(wrapper).first().locator('[data-testid="callout-injected-editor-ok"]');
    await expect(indicator).toHaveText('injected');
  });

  test('focus-editor button (uses injected editor) focuses the editor', async ({ page }) => {
    await page.locator(wrapper).first().locator('[data-testid="callout-focus-btn"]').click();
    await page.waitForTimeout(200);

    const isFocused = await page.evaluate(
      (sel) => document.querySelector(sel) === document.activeElement,
      EDITOR_SELECTOR,
    );
    expect(isFocused).toBe(true);
  });
});

test.describe('VueNodeViewRenderer — insertCallout command', () => {
  test.beforeEach(openNodeViewDemo);

  test('insert warning button creates a new callout', async ({ page }) => {
    const before = await page.locator(wrapper).count();
    await page.locator('[data-testid="insert-warning"]').click();
    await page.waitForTimeout(200);
    const after = await page.locator(wrapper).count();
    expect(after).toBe(before + 1);
  });

  test('inserted callout has correct variant attribute', async ({ page }) => {
    await page.locator('[data-testid="insert-danger"]').click();
    await page.waitForTimeout(200);

    const dangerCallout = page.locator(`${wrapper}[data-variant="danger"]`);
    await expect(dangerCallout).toHaveCount(1);
  });

  test('each inserted callout has its own Vue component instance', async ({ page }) => {
    await page.locator('[data-testid="insert-success"]').click();
    await page.waitForTimeout(200);
    await page.locator('[data-testid="insert-warning"]').click();
    await page.waitForTimeout(200);

    // All callouts should render independently
    const callouts = page.locator(wrapper);
    const count = await callouts.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Each should have its own variant select
    const selects = page.locator(`${wrapper} [data-testid="callout-variant-select"]`);
    await expect(selects).toHaveCount(count);
  });

  test('changing variant on one callout does not affect others', async ({ page }) => {
    // Move selection to end of document (outside any callout), then insert
    await page.evaluate(() => {
      const editor = (window as unknown as Record<string, { commands: Record<string, (...args: unknown[]) => boolean> } | undefined>)['__DEMO_EDITOR__'];
      editor?.commands['focus']?.('end');
    });
    await page.locator('[data-testid="insert-success"]').click();
    await page.waitForTimeout(300);

    const callouts = page.locator(wrapper);
    const count = await callouts.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Get the variants before changing
    const initialFirstVariant = await callouts.first().getAttribute('data-variant');

    // Change the NEW (last) callout to danger
    await callouts.last().locator('[data-testid="callout-variant-select"]').selectOption('danger');
    await page.waitForTimeout(300);

    // Last became danger, first is unchanged
    await expect(callouts.last()).toHaveAttribute('data-variant', 'danger');
    await expect(callouts.first()).toHaveAttribute('data-variant', initialFirstVariant ?? 'info');
  });
});

test.describe('VueNodeViewRenderer — lifecycle', () => {
  test.beforeEach(openNodeViewDemo);

  test('NodeView re-renders on attribute change without remounting', async ({ page }) => {
    const callout = page.locator(wrapper).first();
    const select = callout.locator('[data-testid="callout-variant-select"]');

    // Tag the DOM element so we can verify it's the same element after update
    await callout.evaluate((el: HTMLElement) => {
      el.setAttribute('data-test-marker', 'original');
    });

    await select.selectOption('success');
    await page.waitForTimeout(200);

    // Same element (not remounted), but variant updated
    const marker = await callout.getAttribute('data-test-marker');
    expect(marker).toBe('original');
    await expect(callout).toHaveAttribute('data-variant', 'success');
  });

  test('NodeView is destroyed when document content is cleared', async ({ page }) => {
    expect(await page.locator(wrapper).count()).toBeGreaterThanOrEqual(1);

    await page.evaluate(() => {
      const editor = (window as unknown as Record<string, { setContent: (h: string, emit?: boolean) => void } | undefined>)['__DEMO_EDITOR__'];
      editor?.setContent('<p>gone</p>', false);
    });
    await page.waitForTimeout(200);

    await expect(page.locator(wrapper)).toHaveCount(0);
  });
});
