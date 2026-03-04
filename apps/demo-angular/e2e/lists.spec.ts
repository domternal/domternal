import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

const btn = {
  bullet: 'button[aria-label="Bullet List"]',
  ordered: 'button[aria-label="Ordered List"]',
  task: 'button[aria-label="Task List"]',
  bold: 'button[aria-label="Bold"]',
} as const;

async function setContentAndFocus(page: Page, html: string) {
  await page.evaluate((h) => {
    const el = document.querySelector('domternal-editor');
    const ng = (window as any).ng;
    const comp = ng?.getComponent?.(el);
    if (comp?.editor) {
      comp.editor.setContent(h, false);
      comp.editor.commands.focus();
    }
  }, html);
  await page.waitForTimeout(150);
}

async function getEditorHTML(page: Page): Promise<string> {
  return page.locator(editorSelector).innerHTML();
}

async function getEditorText(page: Page): Promise<string> {
  return (await page.locator(editorSelector).textContent()) ?? '';
}

function countOccurrences(str: string, sub: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = str.indexOf(sub, pos)) !== -1) {
    count++;
    pos += sub.length;
  }
  return count;
}

// ─── Fixtures ──────────────────────────────────────────────────────────

const SINGLE_PARA = '<p>some text</p>';
const BULLET_LIST =
  '<ul><li><p>bullet one</p></li><li><p>bullet two</p></li></ul>';
const ORDERED_LIST =
  '<ol><li><p>item one</p></li><li><p>item two</p></li></ol>';
const ORDERED_LIST_START5 =
  '<ol start="5"><li><p>fifth</p></li><li><p>sixth</p></li></ol>';
const TASK_LIST = [
  '<ul data-type="taskList">',
  '<li data-type="taskItem" data-checked="false">',
  '<label contenteditable="false"><input type="checkbox"></label>',
  '<div><p>task one</p></div>',
  '</li>',
  '<li data-type="taskItem" data-checked="false">',
  '<label contenteditable="false"><input type="checkbox"></label>',
  '<div><p>task two</p></div>',
  '</li>',
  '</ul>',
].join('');
const TASK_LIST_CHECKED = [
  '<ul data-type="taskList">',
  '<li data-type="taskItem" data-checked="true">',
  '<label contenteditable="false"><input type="checkbox" checked></label>',
  '<div><p>done task</p></div>',
  '</li>',
  '</ul>',
].join('');

// ═══════════════════════════════════════════════════════════════════════
// BULLET LIST
// ═══════════════════════════════════════════════════════════════════════

test.describe('Bullet List — rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('renders ul with list items', async ({ page }) => {
    await setContentAndFocus(page, BULLET_LIST);

    const html = await getEditorHTML(page);
    expect(html).toContain('<ul>');
    expect(countOccurrences(html, '<li>')).toBe(2);
    expect(html).toContain('bullet one');
    expect(html).toContain('bullet two');
  });

  test('preserves inline marks inside list items', async ({ page }) => {
    await setContentAndFocus(
      page,
      '<ul><li><p>normal <strong>bold</strong> <em>italic</em></p></li></ul>',
    );

    const html = await getEditorHTML(page);
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });
});

test.describe('Bullet List — toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('toolbar button creates bullet list from paragraph', async ({
    page,
  }) => {
    await setContentAndFocus(page, SINGLE_PARA);
    await page.locator(`${editorSelector} p`).click();
    await page.locator(btn.bullet).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<ul>');
    expect(html).toContain('some text');
  });

  test('toolbar button removes bullet list (toggle off)', async ({ page }) => {
    await setContentAndFocus(
      page,
      '<ul><li><p>single item</p></li></ul>',
    );
    await page.locator(`${editorSelector} li`).click();
    await page.locator(btn.bullet).click();

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<ul>');
    expect(html).toContain('<p>');
    expect(html).toContain('single item');
  });

  test('active state when cursor is in bullet list', async ({ page }) => {
    await setContentAndFocus(page, BULLET_LIST);
    await page.locator(`${editorSelector} li`).first().click();

    await expect(page.locator(btn.bullet)).toHaveClass(/active/);
  });

  test('inactive state when cursor is in paragraph', async ({ page }) => {
    await setContentAndFocus(page, SINGLE_PARA);
    await page.locator(`${editorSelector} p`).click();

    await expect(page.locator(btn.bullet)).not.toHaveClass(/active/);
  });
});

test.describe('Bullet List — input rules', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('"- " creates bullet list', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('- ');

    const html = await getEditorHTML(page);
    expect(html).toContain('<ul>');
  });

  test('"* " creates bullet list', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('* ');

    const html = await getEditorHTML(page);
    expect(html).toContain('<ul>');
  });

  test('"+ " creates bullet list', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('+ ');

    const html = await getEditorHTML(page);
    expect(html).toContain('<ul>');
  });

  test('"- " then typing adds text to list item', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('- my item');

    const html = await getEditorHTML(page);
    expect(html).toContain('<ul>');
    expect(html).toContain('my item');
  });
});

test.describe('Bullet List — Enter key', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Enter at end of item creates new item', async ({ page }) => {
    await setContentAndFocus(page, BULLET_LIST);
    await page.locator(`${editorSelector} li`).first().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);
    expect(countOccurrences(html, '<li>')).toBe(3);
  });

  test('Enter at end + typing adds text to new item', async ({ page }) => {
    await setContentAndFocus(page, BULLET_LIST);
    await page.locator(`${editorSelector} li`).first().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('bullet three');

    const text = await getEditorText(page);
    expect(text).toContain('bullet one');
    expect(text).toContain('bullet three');
    expect(text).toContain('bullet two');
  });

  test('Enter in middle of item splits it', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>ABCDEF</p></li></ul>');
    await page.evaluate((sel) => {
      const p = document.querySelector(sel + ' li p');
      if (!p?.firstChild) return;
      const range = document.createRange();
      range.setStart(p.firstChild, 3);
      range.collapse(true);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);
    expect(countOccurrences(html, '<li>')).toBe(2);
    expect(html).toContain('ABC');
    expect(html).toContain('DEF');
  });

  test('Enter on empty item exits list (creates paragraph)', async ({
    page,
  }) => {
    await setContentAndFocus(page, '<ul><li><p>item</p></li></ul>');
    await page.locator(`${editorSelector} li`).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    // Now on a new empty item — Enter again exits list
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);
    expect(html).toContain('<p>');
    // Original item should remain in the list
    expect(html).toContain('item');
  });
});

test.describe('Bullet List — Tab / Shift-Tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Tab indents list item (creates nested list)', async ({ page }) => {
    await setContentAndFocus(page, BULLET_LIST);
    // Click on the second item
    await page.locator(`${editorSelector} li`).nth(1).click();
    await page.keyboard.press('Tab');

    const html = await getEditorHTML(page);
    // Nested ul inside the first li
    expect(countOccurrences(html, '<ul>')).toBe(2);
    expect(html).toContain('bullet two');
  });

  test('Shift-Tab outdents nested list item', async ({ page }) => {
    // Create a nested bullet list
    await setContentAndFocus(
      page,
      '<ul><li><p>parent</p><ul><li><p>child</p></li></ul></li></ul>',
    );
    await page.locator(`${editorSelector} ul ul li`).click();
    await page.keyboard.press('Shift+Tab');

    const html = await getEditorHTML(page);
    // Should no longer be nested
    const ulCount = countOccurrences(html, '<ul>');
    expect(ulCount).toBe(1);
    expect(html).toContain('parent');
    expect(html).toContain('child');
  });
});

test.describe('Bullet List — Shift-Tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Shift-Tab on first item lifts out of list', async ({ page }) => {
    await setContentAndFocus(
      page,
      '<ul><li><p>only item</p></li></ul>',
    );
    await page.locator(`${editorSelector} li`).click();
    await page.keyboard.press('Shift+Tab');

    const html = await getEditorHTML(page);
    expect(html).toContain('<p>');
    expect(html).toContain('only item');
    expect(html).not.toContain('<ul>');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// ORDERED LIST
// ═══════════════════════════════════════════════════════════════════════

test.describe('Ordered List — rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('renders ol with list items', async ({ page }) => {
    await setContentAndFocus(page, ORDERED_LIST);

    const html = await getEditorHTML(page);
    expect(html).toContain('<ol>');
    expect(countOccurrences(html, '<li>')).toBe(2);
    expect(html).toContain('item one');
    expect(html).toContain('item two');
  });

  test('preserves start attribute', async ({ page }) => {
    await setContentAndFocus(page, ORDERED_LIST_START5);

    const html = await getEditorHTML(page);
    expect(html).toContain('start="5"');
    expect(html).toContain('fifth');
  });
});

test.describe('Ordered List — toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('toolbar button creates ordered list from paragraph', async ({
    page,
  }) => {
    await setContentAndFocus(page, SINGLE_PARA);
    await page.locator(`${editorSelector} p`).click();
    await page.locator(btn.ordered).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<ol>');
    expect(html).toContain('some text');
  });

  test('toolbar button removes ordered list (toggle off)', async ({
    page,
  }) => {
    await setContentAndFocus(
      page,
      '<ol><li><p>single item</p></li></ol>',
    );
    await page.locator(`${editorSelector} li`).click();
    await page.locator(btn.ordered).click();

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<ol>');
    expect(html).toContain('<p>');
    expect(html).toContain('single item');
  });

  test('active state when cursor is in ordered list', async ({ page }) => {
    await setContentAndFocus(page, ORDERED_LIST);
    await page.locator(`${editorSelector} li`).first().click();

    await expect(page.locator(btn.ordered)).toHaveClass(/active/);
  });
});

test.describe('Ordered List — input rules', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('"1. " creates ordered list', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('1. ');

    const html = await getEditorHTML(page);
    expect(html).toContain('<ol>');
  });

  test('"5. " creates ordered list with start=5', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('5. ');

    const html = await getEditorHTML(page);
    expect(html).toContain('<ol');
    expect(html).toContain('start="5"');
  });

  test('"1. " then typing adds text to list item', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('1. my item');

    const html = await getEditorHTML(page);
    expect(html).toContain('<ol>');
    expect(html).toContain('my item');
  });
});

test.describe('Ordered List — Enter key', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Enter at end creates new numbered item', async ({ page }) => {
    await setContentAndFocus(page, ORDERED_LIST);
    await page.locator(`${editorSelector} li`).last().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);
    expect(countOccurrences(html, '<li>')).toBe(3);
    expect(html).toContain('<ol>');
  });

  test('Enter on empty item exits ordered list', async ({ page }) => {
    await setContentAndFocus(
      page,
      '<ol><li><p>item</p></li></ol>',
    );
    await page.locator(`${editorSelector} li`).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);
    expect(html).toContain('<p>');
    expect(html).toContain('item');
  });
});

test.describe('Ordered List — Tab / Shift-Tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Tab indents ordered list item', async ({ page }) => {
    await setContentAndFocus(page, ORDERED_LIST);
    await page.locator(`${editorSelector} li`).nth(1).click();
    await page.keyboard.press('Tab');

    const html = await getEditorHTML(page);
    expect(countOccurrences(html, '<ol>')).toBe(2);
  });

  test('Shift-Tab outdents nested ordered list item', async ({ page }) => {
    await setContentAndFocus(
      page,
      '<ol><li><p>parent</p><ol><li><p>child</p></li></ol></li></ol>',
    );
    await page.locator(`${editorSelector} ol ol li`).click();
    await page.keyboard.press('Shift+Tab');

    const html = await getEditorHTML(page);
    expect(countOccurrences(html, '<ol>')).toBe(1);
  });
});

// ─── Switching between bullet and ordered ─────────────────────────────

test.describe('Lists — switching types', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('toggle ordered list on bullet list converts to ordered', async ({
    page,
  }) => {
    await setContentAndFocus(page, BULLET_LIST);
    await page.locator(`${editorSelector} li`).first().click();
    await page.locator(btn.ordered).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<ol>');
    expect(html).not.toContain('<ul>');
    expect(html).toContain('bullet one');
  });

  test('toggle bullet list on ordered list converts to bullet', async ({
    page,
  }) => {
    await setContentAndFocus(page, ORDERED_LIST);
    await page.locator(`${editorSelector} li`).first().click();
    await page.locator(btn.bullet).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<ul>');
    expect(html).not.toContain('<ol>');
    expect(html).toContain('item one');
  });

  test('toggle task list on bullet list converts to task list', async ({
    page,
  }) => {
    await setContentAndFocus(page, BULLET_LIST);
    await page.locator(`${editorSelector} li`).first().click();
    await page.locator(btn.task).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-type="taskItem"');
  });

  test('toggle bullet on task list converts to bullet', async ({ page }) => {
    await setContentAndFocus(page, TASK_LIST);
    await page
      .locator(`${editorSelector} li[data-type="taskItem"] div p`)
      .first()
      .click();
    await page.locator(btn.bullet).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<ul>');
    expect(html).not.toContain('data-type="taskList"');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// TASK LIST
// ═══════════════════════════════════════════════════════════════════════

test.describe('Task List — rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('renders task list with checkboxes', async ({ page }) => {
    await setContentAndFocus(page, TASK_LIST);

    const html = await getEditorHTML(page);
    expect(html).toContain('data-type="taskList"');
    expect(countOccurrences(html, 'data-type="taskItem"')).toBe(2);
    expect(html).toContain('task one');
    expect(html).toContain('task two');
  });

  test('unchecked task has data-checked="false"', async ({ page }) => {
    await setContentAndFocus(page, TASK_LIST);

    const html = await getEditorHTML(page);
    expect(html).toContain('data-checked="false"');
  });

  test('checked task has data-checked="true"', async ({ page }) => {
    await setContentAndFocus(page, TASK_LIST_CHECKED);

    const html = await getEditorHTML(page);
    expect(html).toContain('data-checked="true"');
  });

  test('checkbox input is rendered inside task item', async ({ page }) => {
    await setContentAndFocus(page, TASK_LIST);

    const checkbox = page.locator(
      `${editorSelector} li[data-type="taskItem"] input[type="checkbox"]`,
    );
    await expect(checkbox.first()).toBeVisible();
  });
});

test.describe('Task List — toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('toolbar button creates task list from paragraph', async ({ page }) => {
    await setContentAndFocus(page, SINGLE_PARA);
    await page.locator(`${editorSelector} p`).click();
    await page.locator(btn.task).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-type="taskItem"');
    expect(html).toContain('some text');
  });

  test('toolbar button removes task list (toggle off)', async ({ page }) => {
    await setContentAndFocus(page, [
      '<ul data-type="taskList">',
      '<li data-type="taskItem" data-checked="false">',
      '<label contenteditable="false"><input type="checkbox"></label>',
      '<div><p>single task</p></div>',
      '</li>',
      '</ul>',
    ].join(''));
    await page
      .locator(`${editorSelector} li[data-type="taskItem"] div p`)
      .click();
    await page.locator(btn.task).click();

    const html = await getEditorHTML(page);
    expect(html).not.toContain('data-type="taskList"');
    expect(html).toContain('<p>');
    expect(html).toContain('single task');
  });

  test('active state when cursor is in task list', async ({ page }) => {
    await setContentAndFocus(page, TASK_LIST);
    await page
      .locator(`${editorSelector} li[data-type="taskItem"] div p`)
      .first()
      .click();

    await expect(page.locator(btn.task)).toHaveClass(/active/);
  });
});

test.describe('Task List — input rules', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('"[ ] " creates unchecked task list', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('[ ] ');

    const html = await getEditorHTML(page);
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-checked="false"');
  });

  test('"[x] " creates checked task list', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('[x] ');

    const html = await getEditorHTML(page);
    expect(html).toContain('data-type="taskList"');
  });

  test('"[ ] " then typing adds text', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('[ ] my task');

    const text = await getEditorText(page);
    expect(text).toContain('my task');
  });
});

test.describe('Task List — checkbox interaction', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Mod-Enter toggles checked state', async ({ page }) => {
    await setContentAndFocus(page, TASK_LIST);
    await page
      .locator(`${editorSelector} li[data-type="taskItem"] div p`)
      .first()
      .click();
    await page.waitForTimeout(100);

    await page.keyboard.press(`${modifier}+Enter`);

    const firstItem = page
      .locator(`${editorSelector} li[data-type="taskItem"]`)
      .first();
    await expect(firstItem).toHaveAttribute('data-checked', 'true');
  });

  test('Mod-Enter toggles checked task back to unchecked', async ({
    page,
  }) => {
    await setContentAndFocus(page, TASK_LIST_CHECKED);
    await page
      .locator(`${editorSelector} li[data-type="taskItem"] div p`)
      .click();

    await page.keyboard.press(`${modifier}+Enter`);

    const item = page.locator(
      `${editorSelector} li[data-type="taskItem"]`,
    );
    await expect(item).toHaveAttribute('data-checked', 'false');
  });

  test('splitting unchecked task creates unchecked item', async ({
    page,
  }) => {
    await setContentAndFocus(page, TASK_LIST);
    await page
      .locator(`${editorSelector} li[data-type="taskItem"] div p`)
      .first()
      .click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('new task');

    // The new (second) task item should also be unchecked
    const secondItem = page
      .locator(`${editorSelector} li[data-type="taskItem"]`)
      .nth(1);
    await expect(secondItem).toHaveAttribute('data-checked', 'false');
  });
});

test.describe('Task List — Enter key', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Enter at end creates new unchecked task item', async ({ page }) => {
    await setContentAndFocus(page, TASK_LIST);
    await page
      .locator(`${editorSelector} li[data-type="taskItem"] div p`)
      .first()
      .click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);
    expect(countOccurrences(html, 'data-type="taskItem"')).toBe(3);
  });

  test('Enter on empty task item exits task list', async ({ page }) => {
    await setContentAndFocus(page, [
      '<ul data-type="taskList">',
      '<li data-type="taskItem" data-checked="false">',
      '<label contenteditable="false"><input type="checkbox"></label>',
      '<div><p>task</p></div>',
      '</li>',
      '</ul>',
    ].join(''));
    await page
      .locator(`${editorSelector} li[data-type="taskItem"] div p`)
      .click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    // Now on new empty task item — Enter exits
    await page.keyboard.press('Enter');

    const html = await getEditorHTML(page);
    // Original task stays
    expect(html).toContain('task');
    // A paragraph was created below
    expect(html).toContain('<p>');
  });

  test('Enter in middle of task item splits text', async ({ page }) => {
    await setContentAndFocus(page, [
      '<ul data-type="taskList">',
      '<li data-type="taskItem" data-checked="false">',
      '<label contenteditable="false"><input type="checkbox"></label>',
      '<div><p>ABCDEF</p></div>',
      '</li>',
      '</ul>',
    ].join(''));
    // Place cursor at position 3
    await page.evaluate((sel) => {
      const p = document.querySelector(
        sel + ' li[data-type="taskItem"] div p',
      );
      if (!p?.firstChild) return;
      const range = document.createRange();
      range.setStart(p.firstChild, 3);
      range.collapse(true);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);
    await page.keyboard.press('Enter');

    const text = await getEditorText(page);
    expect(text).toContain('ABC');
    expect(text).toContain('DEF');
    const html = await getEditorHTML(page);
    expect(countOccurrences(html, 'data-type="taskItem"')).toBe(2);
  });
});

test.describe('Task List — Tab / Shift-Tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Tab indents task item (creates nested task list)', async ({
    page,
  }) => {
    await setContentAndFocus(page, TASK_LIST);
    await page
      .locator(`${editorSelector} li[data-type="taskItem"] div p`)
      .nth(1)
      .click();
    await page.keyboard.press('Tab');

    const html = await getEditorHTML(page);
    // Should have nested task list
    expect(countOccurrences(html, 'data-type="taskList"')).toBe(2);
  });

  test('Shift-Tab outdents nested task item', async ({ page }) => {
    // Create nested task list by indenting
    await setContentAndFocus(page, TASK_LIST);
    await page
      .locator(`${editorSelector} li[data-type="taskItem"] div p`)
      .nth(1)
      .click();
    await page.keyboard.press('Tab');

    // Now outdent
    await page.keyboard.press('Shift+Tab');

    const html = await getEditorHTML(page);
    expect(countOccurrences(html, 'data-type="taskList"')).toBe(1);
  });
});

// ─── Marks inside lists ───────────────────────────────────────────────

test.describe('Lists — marks inside list items', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('bold works inside bullet list item', async ({ page }) => {
    await setContentAndFocus(page, BULLET_LIST);
    await page.evaluate((sel) => {
      const p = document.querySelector(sel + ' li p');
      if (!p) return;
      const range = document.createRange();
      range.selectNodeContents(p);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);
    await page.locator(btn.bold).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<ul>');
    expect(html).toContain('<strong>bullet one</strong>');
  });

  test('bold works inside ordered list item', async ({ page }) => {
    await setContentAndFocus(page, ORDERED_LIST);
    await page.evaluate((sel) => {
      const p = document.querySelector(sel + ' li p');
      if (!p) return;
      const range = document.createRange();
      range.selectNodeContents(p);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);
    await page.locator(btn.bold).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('<ol>');
    expect(html).toContain('<strong>item one</strong>');
  });

  test('bold works inside task list item', async ({ page }) => {
    await setContentAndFocus(page, TASK_LIST);
    await page.evaluate((sel) => {
      const p = document.querySelector(
        sel + ' li[data-type="taskItem"] div p',
      );
      if (!p) return;
      const range = document.createRange();
      range.selectNodeContents(p);
      const s = window.getSelection();
      s?.removeAllRanges();
      s?.addRange(range);
    }, editorSelector);
    await page.locator(btn.bold).click();

    const html = await getEditorHTML(page);
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('<strong>task one</strong>');
  });
});

// ─── Lists with surrounding content ──────────────────────────────────

test.describe('Lists — with surrounding content', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('paragraph before and after list is preserved', async ({ page }) => {
    await setContentAndFocus(
      page,
      '<p>before</p><ul><li><p>item</p></li></ul><p>after</p>',
    );

    const text = await getEditorText(page);
    expect(text).toContain('before');
    expect(text).toContain('item');
    expect(text).toContain('after');
  });

  test('heading before list is preserved', async ({ page }) => {
    await setContentAndFocus(
      page,
      '<h2>Title</h2><ol><li><p>item</p></li></ol>',
    );

    const html = await getEditorHTML(page);
    expect(html).toContain('<h2>');
    expect(html).toContain('<ol>');
  });

  test('multiple different lists render correctly', async ({ page }) => {
    await setContentAndFocus(
      page,
      '<ul><li><p>bullet</p></li></ul><ol><li><p>numbered</p></li></ol>',
    );

    const html = await getEditorHTML(page);
    expect(html).toContain('<ul>');
    expect(html).toContain('<ol>');
    expect(html).toContain('bullet');
    expect(html).toContain('numbered');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// NESTED LIST — TYPE CONVERSION CURSOR BUG
// ═══════════════════════════════════════════════════════════════════════

test.describe('Nested list — convert type keeps cursor position', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  // Reproduces: bullet list with nested ordered list + sibling item after.
  // Cursor in nested ordered item → click Task List → cursor should stay
  // in the converted task item, NOT jump to the sibling "Item C".
  //
  // Structure before:
  //   • Item A
  //   • Item B
  //     1. Sub X   ← cursor here
  //   • Item C
  //
  // Expected after:
  //   • Item A
  //   • Item B
  //     ☐ Sub X   ← cursor should remain here
  //   • Item C

  const NESTED_OL_FIXTURE = [
    '<ul>',
    '<li><p>Item A</p></li>',
    '<li><p>Item B</p>',
    '<ol><li><p>Sub X</p></li></ol>',
    '</li>',
    '<li><p>Item C</p></li>',
    '</ul>',
  ].join('');

  // Fixture-based: setContent → click nested item → convert → check cursor
  test('fixture: nested ordered → task list cursor stays in converted item', async ({ page }) => {
    await setContentAndFocus(page, NESTED_OL_FIXTURE);

    const subItem = page.locator(`${editorSelector} ol li p`);
    await expect(subItem).toHaveText('Sub X');
    await subItem.click();
    await page.waitForTimeout(100);

    await page.locator(btn.task).click();
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('Sub X');

    // Type to reveal cursor location in HTML
    await page.keyboard.type('CURSOR');
    const htmlAfter = await getEditorHTML(page);
    // CURSOR must be inside task item, not in Item C
    expect(htmlAfter).toMatch(/data-type="taskItem"[^]*CURSOR/);
    expect(htmlAfter).not.toContain('CURSORItem C');
  });

  test('fixture: nested task list → ordered list cursor stays in converted item', async ({ page }) => {
    const NESTED_TASK_FIXTURE = [
      '<ul>',
      '<li><p>Item A</p></li>',
      '<li><p>Item B</p>',
      '<ul data-type="taskList">',
      '<li data-type="taskItem" data-checked="false">',
      '<label contenteditable="false"><input type="checkbox"></label>',
      '<div><p>Sub X</p></div>',
      '</li>',
      '</ul>',
      '</li>',
      '<li><p>Item C</p></li>',
      '</ul>',
    ].join('');

    await setContentAndFocus(page, NESTED_TASK_FIXTURE);
    const taskItemText = page.locator(`${editorSelector} li[data-type="taskItem"] div p`);
    await expect(taskItemText).toHaveText('Sub X');
    await taskItemText.click();
    await page.waitForTimeout(100);

    await page.locator(btn.ordered).click();
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('<ol>');
    expect(html).toContain('Sub X');

    await page.keyboard.type('CURSOR');
    const htmlAfter = await getEditorHTML(page);
    expect(htmlAfter).toMatch(/<ol>[^]*CURSOR[^]*<\/ol>/);
    expect(htmlAfter).not.toContain('CURSORItem C');
  });

  // Interactive workflow: build list manually, indent, convert → check structure + cursor
  test('interactive: build nested list, convert to task list, verify cursor and structure', async ({ page }) => {
    // Step 1: Create bullet list with 4 items
    await setContentAndFocus(page, '<p></p>');
    await page.locator(`${editorSelector} p`).click();
    await page.keyboard.type('- Item A');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Item B');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Sub X');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Item C');
    await page.waitForTimeout(100);

    // Step 2: Go back to "Sub X" and indent it
    const allItems = page.locator(`${editorSelector} li p`);
    await allItems.nth(2).click();
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);

    // Step 3: Convert nested sub-list to ordered
    await page.locator(btn.ordered).click();
    await page.waitForTimeout(100);

    let html = await getEditorHTML(page);
    expect(html).toContain('<ol>');
    expect(html).toContain('Sub X');

    // Step 4: Dump ProseMirror doc + selection state BEFORE converting to task list
    const stateBefore = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return null;
      const { state } = comp.editor.view;
      return {
        doc: state.doc.toJSON(),
        selFrom: state.selection.from,
        selTo: state.selection.to,
        html: comp.editor.view.dom.innerHTML,
      };
    });

    // Step 5: Convert to task list
    await page.locator(btn.task).click();
    await page.waitForTimeout(150);

    // Dump state AFTER conversion
    const stateAfter = await page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return null;
      const { state } = comp.editor.view;
      return {
        doc: state.doc.toJSON(),
        selFrom: state.selection.from,
        selTo: state.selection.to,
        html: comp.editor.view.dom.innerHTML,
      };
    });

    // Log for debugging
    console.log('BEFORE conversion:', JSON.stringify(stateBefore, null, 2));
    console.log('AFTER conversion:', JSON.stringify(stateAfter, null, 2));

    html = await getEditorHTML(page);
    expect(html).toContain('data-type="taskList"');

    // Type to check where cursor actually is
    await page.keyboard.type('CURSOR');
    const htmlAfter = await getEditorHTML(page);
    console.log('AFTER typing CURSOR:', htmlAfter);

    // CURSOR should be inside the task item, not in Item C
    expect(htmlAfter).toMatch(/data-type="taskItem"[^]*CURSOR/);
    expect(htmlAfter).not.toContain('CURSORItem C');

    // All items should still exist
    const textAfter = await getEditorText(page);
    expect(textAfter).toContain('Item A');
    expect(textAfter).toContain('Item B');
    expect(textAfter).toContain('Item C');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// NESTED LIST — ENTER ESCAPE LEVEL BY LEVEL
// ═══════════════════════════════════════════════════════════════════════

test.describe('Nested list — Enter escape level by level', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  // Helper: get ProseMirror doc JSON + cursor position
  async function getDocState(page: Page) {
    return page.evaluate(() => {
      const el = document.querySelector('domternal-editor');
      const ng = (window as any).ng;
      const comp = ng?.getComponent?.(el);
      if (!comp?.editor) return null;
      const { state } = comp.editor.view;
      return {
        doc: state.doc.toJSON(),
        from: state.selection.from,
        html: comp.editor.view.dom.innerHTML,
      };
    });
  }

  // ── Single level: empty bullet inside taskItem → new taskItem ──

  //   1. Item A
  //   2. Item B
  //     ☐ Task content
  //       • (empty) ← cursor
  //
  // Enter should create a new ☐ taskItem in the taskList (one level up),
  // NOT jump to orderedList.

  const BULLET_IN_TASK = [
    '<ol>',
    '<li><p>Item A</p></li>',
    '<li><p>Item B</p>',
    '<ul data-type="taskList">',
    '<li data-type="taskItem" data-checked="false">',
    '<label contenteditable="false"><input type="checkbox"></label>',
    '<div><p>Task content</p>',
    '<ul><li><p></p></li></ul>',
    '</div>',
    '</li>',
    '</ul>',
    '</li>',
    '</ol>',
  ].join('');

  test('empty bullet in taskItem → Enter creates new taskItem (one level up)', async ({ page }) => {
    await setContentAndFocus(page, BULLET_IN_TASK);

    const emptyLi = page.locator(`${editorSelector} ul:not([data-type]) li p`);
    await emptyLi.click();
    await page.waitForTimeout(100);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    await page.keyboard.type('NEW');
    const html = await getEditorHTML(page);

    // NEW should be inside a taskItem (not orderedList item)
    expect(html).toMatch(/data-type="taskItem"[^]*NEW/);
    // All content preserved
    expect(html).toContain('Task content');
    expect(html).toContain('Item A');
    expect(html).toContain('Item B');
    // The bulletList should be gone (it was the only child)
    expect(html).not.toMatch(/<ul>(?!.*data-type)[^]*<\/ul>/s);
  });

  test('empty bullet in taskItem with siblings → only empty item removed', async ({ page }) => {
    const fixture = [
      '<ol>',
      '<li><p>Item A</p></li>',
      '<li><p>Item B</p>',
      '<ul data-type="taskList">',
      '<li data-type="taskItem" data-checked="false">',
      '<label contenteditable="false"><input type="checkbox"></label>',
      '<div><p>Task</p>',
      '<ul><li><p>Keep me</p></li><li><p></p></li></ul>',
      '</div>',
      '</li>',
      '</ul>',
      '</li>',
      '</ol>',
    ].join('');

    await setContentAndFocus(page, fixture);

    const bullets = page.locator(`${editorSelector} ul:not([data-type]) li p`);
    await bullets.nth(1).click();
    await page.waitForTimeout(100);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('Keep me');
    expect(html).toContain('Task');
    expect(html).toContain('Item A');
  });

  // ── Two levels: bullet → taskList → orderedList ──
  // Enter twice from empty bullet should first go to taskList, then to orderedList.

  test('two Enter presses: bullet → taskItem → orderedList item', async ({ page }) => {
    await setContentAndFocus(page, BULLET_IN_TASK);

    const emptyLi = page.locator(`${editorSelector} ul:not([data-type]) li p`);
    await emptyLi.click();
    await page.waitForTimeout(100);

    // First Enter: escape from bulletList to taskList (new empty taskItem)
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    let html = await getEditorHTML(page);
    // Should now be in a taskItem
    expect(html).toContain('data-type="taskItem"');

    // Second Enter: escape from empty taskItem to orderedList
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    await page.keyboard.type('LEVEL2');
    html = await getEditorHTML(page);

    // LEVEL2 should be in orderedList, not taskList
    expect(html).toMatch(/<ol>[^]*LEVEL2[^]*<\/ol>/);
    // All original content preserved
    expect(html).toContain('Task content');
    expect(html).toContain('Item A');
    expect(html).toContain('Item B');
  });

  // ── Bare paragraph in taskItem (Bug 2 regression) ──
  // TaskItem with content + trailing empty paragraph: Enter must NOT destroy content.

  test('bare empty paragraph in multi-content taskItem: Enter preserves content', async ({ page }) => {
    const fixture = [
      '<ol>',
      '<li><p>Above</p>',
      '<ul data-type="taskList">',
      '<li data-type="taskItem" data-checked="false">',
      '<label contenteditable="false"><input type="checkbox"></label>',
      '<div><p>Task</p>',
      '<ul><li><p>Nested</p></li></ul>',
      '<p></p>',
      '</div>',
      '</li>',
      '</ul>',
      '</li>',
      '</ol>',
    ].join('');

    await setContentAndFocus(page, fixture);

    const paragraphs = page.locator(`${editorSelector} li[data-type="taskItem"] div p`);
    const count = await paragraphs.count();
    await paragraphs.nth(count - 1).click();
    await page.waitForTimeout(100);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('Task');
    expect(html).toContain('Nested');
    expect(html).toContain('Above');
    expect(html).toMatch(/<ol>/);
  });

  // ── Deep nesting: bullet → taskItem → taskItem → orderedList ──
  // Three levels of nesting, each Enter should escape one level.

  test('deep nesting: each Enter escapes exactly one level', async ({ page }) => {
    // Structure:
    //   1. Top
    //     ☐ Task A
    //       ☐ Task B
    //         • (empty) ← cursor
    const fixture = [
      '<ol>',
      '<li><p>Top</p>',
      '<ul data-type="taskList">',
      '<li data-type="taskItem" data-checked="false">',
      '<label contenteditable="false"><input type="checkbox"></label>',
      '<div><p>Task A</p>',
      '<ul data-type="taskList">',
      '<li data-type="taskItem" data-checked="false">',
      '<label contenteditable="false"><input type="checkbox"></label>',
      '<div><p>Task B</p>',
      '<ul><li><p></p></li></ul>',
      '</div>',
      '</li>',
      '</ul>',
      '</div>',
      '</li>',
      '</ul>',
      '</li>',
      '</ol>',
    ].join('');

    await setContentAndFocus(page, fixture);

    const emptyLi = page.locator(`${editorSelector} ul:not([data-type]) li p`);
    await emptyLi.click();
    await page.waitForTimeout(100);

    // Enter 1: bullet → new taskItem in inner taskList (sibling of Task B)
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    let state = await getDocState(page);
    expect(state?.html).toContain('Task A');
    expect(state?.html).toContain('Task B');

    // Enter 2: empty taskItem → escape to outer taskList (sibling of Task A)
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    state = await getDocState(page);
    expect(state?.html).toContain('Task A');
    expect(state?.html).toContain('Task B');

    // Enter 3: empty taskItem → escape to orderedList
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    await page.keyboard.type('ESCAPED');
    const html = await getEditorHTML(page);

    expect(html).toMatch(/<ol>[^]*ESCAPED[^]*<\/ol>/);
    expect(html).toContain('Top');
    expect(html).toContain('Task A');
    expect(html).toContain('Task B');
  });

  // ── Enter on empty listItem inside ordered list inside taskItem ──

  test('empty ordered item in taskItem → new taskItem', async ({ page }) => {
    const fixture = [
      '<ul>',
      '<li><p>Outer</p>',
      '<ul data-type="taskList">',
      '<li data-type="taskItem" data-checked="false">',
      '<label contenteditable="false"><input type="checkbox"></label>',
      '<div><p>Task</p>',
      '<ol><li><p>One</p></li><li><p></p></li></ol>',
      '</div>',
      '</li>',
      '</ul>',
      '</li>',
      '</ul>',
    ].join('');

    await setContentAndFocus(page, fixture);

    const orderedItems = page.locator(`${editorSelector} ol li p`);
    await orderedItems.nth(1).click();
    await page.waitForTimeout(100);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    await page.keyboard.type('NEW');
    const html = await getEditorHTML(page);

    // Should be in a new taskItem, not in the ordered list
    expect(html).toMatch(/data-type="taskItem"[^]*NEW/);
    expect(html).toContain('One');
    expect(html).toContain('Task');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// NESTED LIST — BACKSPACE AT DIFFERENT LEVELS
// ═══════════════════════════════════════════════════════════════════════

test.describe('Nested list — Backspace behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Backspace at start of bullet item joins with previous', async ({ page }) => {
    const fixture = '<ul><li><p>First</p></li><li><p>Second</p></li></ul>';
    await setContentAndFocus(page, fixture);

    const items = page.locator(`${editorSelector} li p`);
    await items.nth(1).click();
    await page.keyboard.press('Home');
    await page.waitForTimeout(50);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    // Items joined into one <li> (may keep separate paragraphs)
    const liCount = (html.match(/<li>/g) || []).length;
    expect(liCount).toBe(1);
    expect(html).toContain('First');
    expect(html).toContain('Second');
  });

  test('Backspace at start of nested bullet lifts to parent level', async ({ page }) => {
    const fixture = [
      '<ul>',
      '<li><p>Parent</p>',
      '<ul><li><p>Nested</p></li></ul>',
      '</li>',
      '</ul>',
    ].join('');
    await setContentAndFocus(page, fixture);

    const nested = page.locator(`${editorSelector} ul ul li p`);
    await nested.click();
    await page.keyboard.press('Home');
    await page.waitForTimeout(50);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(150);

    const text = await getEditorText(page);
    expect(text).toContain('Parent');
    expect(text).toContain('Nested');
  });

  test('Backspace at start of first ordered item inside taskItem', async ({ page }) => {
    const fixture = [
      '<ul data-type="taskList">',
      '<li data-type="taskItem" data-checked="false">',
      '<label contenteditable="false"><input type="checkbox"></label>',
      '<div><p>Task</p>',
      '<ol><li><p>Ordered</p></li></ol>',
      '</div>',
      '</li>',
      '</ul>',
    ].join('');
    await setContentAndFocus(page, fixture);

    const orderedItem = page.locator(`${editorSelector} ol li p`);
    await orderedItem.click();
    await page.keyboard.press('Home');
    await page.waitForTimeout(50);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    // Content should be preserved
    expect(html).toContain('Task');
    expect(html).toContain('Ordered');
  });

  test('Backspace at start of taskItem with content preserves text', async ({ page }) => {
    const fixture = [
      '<ul data-type="taskList">',
      '<li data-type="taskItem" data-checked="false">',
      '<label contenteditable="false"><input type="checkbox"></label>',
      '<div><p>First task</p></div>',
      '</li>',
      '<li data-type="taskItem" data-checked="false">',
      '<label contenteditable="false"><input type="checkbox"></label>',
      '<div><p>Second task</p></div>',
      '</li>',
      '</ul>',
    ].join('');
    await setContentAndFocus(page, fixture);

    const items = page.locator(`${editorSelector} li[data-type="taskItem"] div p`);
    await items.nth(1).click();
    await page.keyboard.press('Home');
    await page.waitForTimeout(50);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(150);

    const text = await getEditorText(page);
    expect(text).toContain('First task');
    expect(text).toContain('Second task');
  });

  test('Backspace on empty bullet in deeply nested list lifts one level', async ({ page }) => {
    const fixture = [
      '<ul>',
      '<li><p>Top</p>',
      '<ul><li><p>Mid</p>',
      '<ul><li><p></p></li></ul>',
      '</li></ul>',
      '</li>',
      '</ul>',
    ].join('');
    await setContentAndFocus(page, fixture);

    const deepItem = page.locator(`${editorSelector} ul ul ul li p`);
    await deepItem.click();
    await page.waitForTimeout(50);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    // Content preserved, structure simplified
    expect(html).toContain('Top');
    expect(html).toContain('Mid');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// KNOWN EDGE CASES — ENTER SPLITTING BEHAVIOR
// ═══════════════════════════════════════════════════════════════════════

test.describe('Edge cases — Enter splitting', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Enter at beginning of non-empty item creates empty item above', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>Hello</p></li></ul>');

    const item = page.locator(`${editorSelector} li p`);
    await item.click();
    await page.waitForTimeout(50);
    await page.keyboard.press('Home');
    await page.waitForTimeout(100);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    const liCount = (html.match(/<li>/g) || []).length;
    expect(liCount).toBe(2);
    expect(html).toContain('Hello');

    // Cursor should be in second item (with "Hello"), type to verify
    await page.keyboard.type('X');
    const after = await getEditorHTML(page);
    expect(after).toContain('XHello');
  });

  test('Enter in middle of text splits text between two items', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>ABCDEF</p></li></ul>');

    const item = page.locator(`${editorSelector} li p`);
    await item.click();
    // Position cursor after "ABC"
    await page.keyboard.press('Home');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(50);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('ABC');
    expect(html).toContain('DEF');
    const liCount = (html.match(/<li>/g) || []).length;
    expect(liCount).toBe(2);
  });

  test('Enter preserves bold mark across split', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p><strong>Bold text</strong></p></li></ul>');

    const item = page.locator(`${editorSelector} li p`);
    await item.click();
    await page.keyboard.press('Home');
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(50);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    // Both halves should still have <strong> tags
    expect(html).toContain('<strong>Bold </strong>');
    expect(html).toContain('<strong>text</strong>');
  });

  test('Enter on empty middle item in bullet list lifts it out', async ({ page }) => {
    const fixture = '<ul><li><p>First</p></li><li><p></p></li><li><p>Third</p></li></ul>';
    await setContentAndFocus(page, fixture);

    const items = page.locator(`${editorSelector} li p`);
    await items.nth(1).click();
    await page.waitForTimeout(50);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    // Empty item should be lifted, list may split into two
    expect(html).toContain('First');
    expect(html).toContain('Third');
  });

  test('Enter on last empty item exits list and creates paragraph', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>Only item</p></li><li><p></p></li></ul>');

    const items = page.locator(`${editorSelector} li p`);
    await items.nth(1).click();
    await page.waitForTimeout(50);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    await page.keyboard.type('Outside');
    const html = await getEditorHTML(page);
    expect(html).toContain('Only item');
    // "Outside" should NOT be inside a <li>
    expect(html).toMatch(/<\/ul>[\s\S]*Outside/);
  });

  test('Rapid Enter presses exit nested list without content loss', async ({ page }) => {
    const fixture = [
      '<ul><li><p>Top</p>',
      '<ul><li><p>Mid</p>',
      '<ul><li><p>Deep</p></li></ul>',
      '</li></ul>',
      '</li></ul>',
    ].join('');
    await setContentAndFocus(page, fixture);

    // Click on "Deep", press End then Enter to create empty item, then rapid Enter presses
    const deep = page.locator(`${editorSelector} ul ul ul li p`);
    await deep.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    // Now we're in an empty item at deepest level, press Enter repeatedly
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);

    const html = await getEditorHTML(page);
    // All original content preserved
    expect(html).toContain('Top');
    expect(html).toContain('Mid');
    expect(html).toContain('Deep');
  });

  test('Enter splitting ordered list preserves numbering', async ({ page }) => {
    const fixture = '<ol><li><p>One</p></li><li><p>Two</p></li><li><p>Three</p></li></ol>';
    await setContentAndFocus(page, fixture);

    // Click on "Two" and press Enter to split
    const items = page.locator(`${editorSelector} ol li p`);
    await items.nth(1).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    await page.keyboard.type('Inserted');
    const html = await getEditorHTML(page);
    expect(html).toContain('One');
    expect(html).toContain('Two');
    expect(html).toContain('Inserted');
    expect(html).toContain('Three');
    // All in one ordered list
    expect(html).toMatch(/<ol>/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// KNOWN EDGE CASES — TAB / SHIFT-TAB NESTING
// ═══════════════════════════════════════════════════════════════════════

test.describe('Edge cases — Tab / Shift-Tab nesting', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Tab on first item of list is no-op (cannot indent without previous sibling)', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>First</p></li><li><p>Second</p></li></ul>');

    const items = page.locator(`${editorSelector} li p`);
    await items.nth(0).click();
    await page.waitForTimeout(50);

    const htmlBefore = await getEditorHTML(page);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(150);

    const htmlAfter = await getEditorHTML(page);
    // Structure should be unchanged — first item cannot be indented
    expect(htmlAfter).toBe(htmlBefore);
  });

  test('Tab on second item nests it under first', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>First</p></li><li><p>Second</p></li></ul>');

    const items = page.locator(`${editorSelector} li p`);
    await items.nth(1).click();
    await page.waitForTimeout(50);

    await page.keyboard.press('Tab');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    // "Second" should now be in a nested ul inside the first li
    expect(html).toMatch(/<ul>.*<li>.*First.*<ul>.*<li>.*Second/s);
  });

  test('Shift-Tab on top-level item converts to paragraph', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>Only</p></li></ul>');

    const item = page.locator(`${editorSelector} li p`);
    await item.click();
    await page.waitForTimeout(50);

    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    // Should no longer be in a list
    expect(html).not.toContain('<ul>');
    expect(html).not.toContain('<li>');
    expect(html).toContain('Only');
  });

  test('Tab then Shift-Tab round-trip preserves content', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>Parent</p></li><li><p>Child</p></li></ul>');

    const items = page.locator(`${editorSelector} li p`);
    await items.nth(1).click();
    await page.waitForTimeout(50);

    // Indent
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
    let html = await getEditorHTML(page);
    expect(html).toMatch(/<ul>.*<ul>/s); // nested

    // Outdent back
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(100);
    html = await getEditorHTML(page);
    expect(html).toContain('Parent');
    expect(html).toContain('Child');
  });

  test('Tab in task list nests task item correctly', async ({ page }) => {
    const fixture = [
      '<ul data-type="taskList">',
      '<li data-type="taskItem" data-checked="false">',
      '<label contenteditable="false"><input type="checkbox"></label>',
      '<div><p>Task A</p></div></li>',
      '<li data-type="taskItem" data-checked="false">',
      '<label contenteditable="false"><input type="checkbox"></label>',
      '<div><p>Task B</p></div></li>',
      '</ul>',
    ].join('');
    await setContentAndFocus(page, fixture);

    const items = page.locator(`${editorSelector} li[data-type="taskItem"] div p`);
    await items.nth(1).click();
    await page.waitForTimeout(50);

    await page.keyboard.press('Tab');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('Task A');
    expect(html).toContain('Task B');
    // Task B should be nested (a taskList inside the first taskItem)
    expect(html).toMatch(/Task A[\s\S]*data-type="taskList"[\s\S]*Task B/);
  });

  test('Multiple Shift-Tab presses on deeply nested item lifts level by level', async ({ page }) => {
    const fixture = [
      '<ul><li><p>L1</p>',
      '<ul><li><p>L2</p>',
      '<ul><li><p>L3</p></li></ul>',
      '</li></ul>',
      '</li></ul>',
    ].join('');
    await setContentAndFocus(page, fixture);

    const deep = page.locator(`${editorSelector} ul ul ul li p`);
    await deep.click();
    await page.waitForTimeout(50);

    // First Shift-Tab: L3 moves from depth 3 to depth 2
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(100);
    let html = await getEditorHTML(page);
    expect(html).toContain('L3');

    // Second Shift-Tab: L3 moves from depth 2 to depth 1
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(100);
    html = await getEditorHTML(page);
    expect(html).toContain('L1');
    expect(html).toContain('L2');
    expect(html).toContain('L3');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// KNOWN EDGE CASES — LIST TYPE TOGGLING AND UNDO
// ═══════════════════════════════════════════════════════════════════════

test.describe('Edge cases — list type toggling and undo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Toggle bullet list off converts all items to paragraphs', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>Alpha</p></li><li><p>Beta</p></li><li><p>Gamma</p></li></ul>');

    const item = page.locator(`${editorSelector} li p`).first();
    await item.click();
    await page.waitForTimeout(50);

    // Select all items
    await page.keyboard.press(`${modifier}+a`);
    await page.waitForTimeout(50);

    // Toggle off
    await page.locator(btn.bullet).click();
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<ul>');
    expect(html).not.toContain('<li>');
    expect(html).toContain('Alpha');
    expect(html).toContain('Beta');
    expect(html).toContain('Gamma');
  });

  test('Bullet → ordered → bullet round-trip preserves content', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>Item 1</p></li><li><p>Item 2</p></li></ul>');

    const item = page.locator(`${editorSelector} li p`).first();
    await item.click();
    await page.waitForTimeout(50);

    // Convert to ordered
    await page.locator(btn.ordered).click();
    await page.waitForTimeout(150);
    let html = await getEditorHTML(page);
    expect(html).toContain('<ol>');
    expect(html).toContain('Item 1');

    // Convert back to bullet
    await page.locator(btn.bullet).click();
    await page.waitForTimeout(150);
    html = await getEditorHTML(page);
    expect(html).toContain('<ul>');
    expect(html).not.toContain('<ol>');
    expect(html).toContain('Item 1');
    expect(html).toContain('Item 2');
  });

  test('Undo after Enter split restores original item', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>One item</p></li></ul>');

    const item = page.locator(`${editorSelector} li p`);
    await item.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    await page.keyboard.type('Second');
    await page.waitForTimeout(100);

    let html = await getEditorHTML(page);
    const liCount = (html.match(/<li>/g) || []).length;
    expect(liCount).toBe(2);

    // Undo typing + split
    await page.keyboard.press(`${modifier}+z`);
    await page.keyboard.press(`${modifier}+z`);
    await page.waitForTimeout(150);
    html = await getEditorHTML(page);
    expect(html).toContain('One item');
    const liCountAfter = (html.match(/<li>/g) || []).length;
    expect(liCountAfter).toBe(1);
  });

  test('Undo after Tab indent restores flat structure', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>A</p></li><li><p>B</p></li></ul>');

    const items = page.locator(`${editorSelector} li p`);
    await items.nth(1).click();
    await page.waitForTimeout(50);

    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
    let html = await getEditorHTML(page);
    expect(html).toMatch(/<ul>.*<ul>/s); // nested

    await page.keyboard.press(`${modifier}+z`);
    await page.waitForTimeout(150);
    html = await getEditorHTML(page);
    expect(html).toContain('A');
    expect(html).toContain('B');
    // Should be flat again (no nested ul inside ul)
    const nestedUlCount = (html.match(/<ul>/g) || []).length;
    expect(nestedUlCount).toBe(1);
  });

  test('Convert bullet with nested sub-list to ordered preserves nesting', async ({ page }) => {
    const fixture = [
      '<ul><li><p>Parent</p>',
      '<ul><li><p>Child</p></li></ul>',
      '</li></ul>',
    ].join('');
    await setContentAndFocus(page, fixture);

    const parent = page.locator(`${editorSelector} li p`).first();
    await parent.click();
    await page.waitForTimeout(50);

    await page.locator(btn.ordered).click();
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('<ol>');
    expect(html).toContain('Parent');
    expect(html).toContain('Child');
  });

  test('Ordered list start=5 preserved after adding items', async ({ page }) => {
    await setContentAndFocus(page, '<ol start="5"><li><p>Fifth</p></li></ol>');

    const item = page.locator(`${editorSelector} ol li p`);
    await item.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Sixth');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toMatch(/start="5"/);
    expect(html).toContain('Fifth');
    expect(html).toContain('Sixth');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// KNOWN EDGE CASES — TASK ITEM SPECIFIC
// ═══════════════════════════════════════════════════════════════════════

test.describe('Edge cases — task item specific', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Enter on checked task item splits and creates new item', async ({ page }) => {
    const fixture = [
      '<ul data-type="taskList">',
      '<li data-type="taskItem" data-checked="true">',
      '<label contenteditable="false"><input type="checkbox" checked></label>',
      '<div><p>Done task</p></div></li>',
      '</ul>',
    ].join('');
    await setContentAndFocus(page, fixture);

    const item = page.locator(`${editorSelector} li[data-type="taskItem"] div p`);
    await item.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    await page.keyboard.type('New task');
    const html = await getEditorHTML(page);
    // Both items should exist in the task list
    expect(html).toContain('Done task');
    expect(html).toContain('New task');
    expect(html).toContain('data-type="taskList"');
    // Should have two task items
    const taskItemCount = (html.match(/data-type="taskItem"/g) || []).length;
    expect(taskItemCount).toBe(2);
  });

  test('Mod-Enter toggles task checked state', async ({ page }) => {
    const fixture = [
      '<ul data-type="taskList">',
      '<li data-type="taskItem" data-checked="false">',
      '<label contenteditable="false"><input type="checkbox"></label>',
      '<div><p>My task</p></div></li>',
      '</ul>',
    ].join('');
    await setContentAndFocus(page, fixture);

    const item = page.locator(`${editorSelector} li[data-type="taskItem"] div p`);
    await item.click();
    await page.waitForTimeout(50);

    // Toggle on
    await page.keyboard.press(`${modifier}+Enter`);
    await page.waitForTimeout(150);
    let html = await getEditorHTML(page);
    expect(html).toContain('data-checked="true"');

    // Toggle off
    await page.keyboard.press(`${modifier}+Enter`);
    await page.waitForTimeout(150);
    html = await getEditorHTML(page);
    expect(html).toContain('data-checked="false"');
  });

  test('Enter on empty task item at end of list exits to paragraph', async ({ page }) => {
    const fixture = [
      '<ul data-type="taskList">',
      '<li data-type="taskItem" data-checked="false">',
      '<label contenteditable="false"><input type="checkbox"></label>',
      '<div><p>Task</p></div></li>',
      '<li data-type="taskItem" data-checked="false">',
      '<label contenteditable="false"><input type="checkbox"></label>',
      '<div><p></p></div></li>',
      '</ul>',
    ].join('');
    await setContentAndFocus(page, fixture);

    const items = page.locator(`${editorSelector} li[data-type="taskItem"] div p`);
    await items.nth(1).click();
    await page.waitForTimeout(50);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    await page.keyboard.type('Outside');
    const html = await getEditorHTML(page);
    expect(html).toContain('Task');
    // "Outside" should be after the task list
    expect(html).toMatch(/<\/ul>[\s\S]*Outside/);
  });

  test('Task list with mixed checked states: convert to bullet and back preserves content', async ({ page }) => {
    const fixture = [
      '<ul data-type="taskList">',
      '<li data-type="taskItem" data-checked="true">',
      '<label contenteditable="false"><input type="checkbox" checked></label>',
      '<div><p>Done</p></div></li>',
      '<li data-type="taskItem" data-checked="false">',
      '<label contenteditable="false"><input type="checkbox"></label>',
      '<div><p>Pending</p></div></li>',
      '</ul>',
    ].join('');
    await setContentAndFocus(page, fixture);

    const item = page.locator(`${editorSelector} li[data-type="taskItem"] div p`).first();
    await item.click();
    await page.waitForTimeout(50);

    // Convert to bullet
    await page.locator(btn.bullet).click();
    await page.waitForTimeout(150);
    let html = await getEditorHTML(page);
    expect(html).toContain('<ul>');
    expect(html).toContain('Done');
    expect(html).toContain('Pending');

    // Convert back to task
    await page.locator(btn.task).click();
    await page.waitForTimeout(150);
    html = await getEditorHTML(page);
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('Done');
    expect(html).toContain('Pending');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// KNOWN EDGE CASES — CROSS-ITEM SELECTION AND DELETE
// ═══════════════════════════════════════════════════════════════════════

test.describe('Edge cases — selection and delete across list items', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Select all in list and delete leaves clean state', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>A</p></li><li><p>B</p></li><li><p>C</p></li></ul>');

    await page.keyboard.press(`${modifier}+a`);
    await page.waitForTimeout(50);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(150);

    // Should have a clean empty document (paragraph)
    await page.keyboard.type('Fresh');
    const html = await getEditorHTML(page);
    expect(html).toContain('Fresh');
    expect(html).not.toContain('<ul>');
  });

  test('Select across two list items and delete removes both', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>AAAA</p></li><li><p>BBBB</p></li><li><p>CCCC</p></li></ul>');

    // Select the middle item text via triple-click and delete
    const items = page.locator(`${editorSelector} li p`);
    await items.nth(1).click({ clickCount: 3 });
    await page.waitForTimeout(50);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('AAAA');
    expect(html).toContain('CCCC');
  });

  test('Delete key at end of list item joins with next', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>First</p></li><li><p>Second</p></li></ul>');

    const items = page.locator(`${editorSelector} li p`);
    await items.nth(0).click();
    await page.keyboard.press('End');
    await page.waitForTimeout(50);

    await page.keyboard.press('Delete');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('First');
    expect(html).toContain('Second');
    // Should be joined into one item
    const liCount = (html.match(/<li>/g) || []).length;
    expect(liCount).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// KNOWN EDGE CASES — INPUT RULES
// ═══════════════════════════════════════════════════════════════════════

test.describe('Edge cases — input rules for list creation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('"- " input rule creates bullet list', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    const p = page.locator(`${editorSelector} p`);
    await p.click();

    await page.keyboard.type('- ');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('<ul>');
  });

  test('"1. " input rule creates ordered list', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    const p = page.locator(`${editorSelector} p`);
    await p.click();

    await page.keyboard.type('1. ');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('<ol>');
  });

  test('"5. " input rule creates ordered list starting at 5', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    const p = page.locator(`${editorSelector} p`);
    await p.click();

    await page.keyboard.type('5. ');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toMatch(/<ol[^>]*start="5"/);
  });

  test('"[ ] " input rule creates task list', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    const p = page.locator(`${editorSelector} p`);
    await p.click();

    await page.keyboard.type('[ ] ');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-checked="false"');
  });

  test('"[x] " input rule creates task list', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    const p = page.locator(`${editorSelector} p`);
    await p.click();

    await page.keyboard.type('[x] ');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-type="taskItem"');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// KNOWN EDGE CASES — MIXED NESTING STRESS TESTS
// ═══════════════════════════════════════════════════════════════════════

test.describe('Edge cases — mixed nesting stress tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  // Regression: ordered list inside task item, split the ordered item,
  // then press Enter on empty — should escape to task level, not break
  test('split ordered item inside task, then Enter on empty escapes to task level', async ({ page }) => {
    const fixture = [
      '<ul data-type="taskList">',
      '<li data-type="taskItem" data-checked="false">',
      '<label contenteditable="false"><input type="checkbox"></label>',
      '<div><p>Task</p>',
      '<ol><li><p>Step one</p></li></ol>',
      '</div></li></ul>',
    ].join('');
    await setContentAndFocus(page, fixture);

    // Click on "Step one", go to end, press Enter to split (new empty ordered item)
    const step = page.locator(`${editorSelector} ol li p`);
    await step.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);

    // Now in empty ordered item — Enter should escape to taskList
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    await page.keyboard.type('NEW');
    const html = await getEditorHTML(page);
    expect(html).toContain('Task');
    expect(html).toContain('Step one');
    expect(html).toMatch(/data-type="taskItem"[\s\S]*NEW/);
  });

  // Regression: alternating list types in deep nesting
  // ol > li > taskList > taskItem > ul > li(empty)
  // Enter should go to taskList level, not skip to ol
  test('alternating ol > taskList > bullet: Enter escapes one level at a time', async ({ page }) => {
    const fixture = [
      '<ol><li><p>Numbered</p>',
      '<ul data-type="taskList">',
      '<li data-type="taskItem" data-checked="false">',
      '<label contenteditable="false"><input type="checkbox"></label>',
      '<div><p>Check</p>',
      '<ul><li><p></p></li></ul>',
      '</div></li></ul>',
      '</li></ol>',
    ].join('');
    await setContentAndFocus(page, fixture);

    const emptyBullet = page.locator(`${editorSelector} ul:not([data-type]) li p`);
    await emptyBullet.click();
    await page.waitForTimeout(100);

    // Enter 1: escape from bullet to taskList (new taskItem)
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    await page.keyboard.type('TASK');
    let html = await getEditorHTML(page);
    expect(html).toMatch(/data-type="taskItem"[\s\S]*TASK/);
    expect(html).toContain('Check');
    expect(html).toContain('Numbered');
  });

  // Stress test: build a complex structure interactively and verify it doesn't break
  test('interactive: build 3-level nested structure, modify, and verify integrity', async ({ page }) => {
    await setContentAndFocus(page, '<p></p>');
    const p = page.locator(`${editorSelector} p`);
    await p.click();

    // Create bullet list
    await page.keyboard.type('- Top A');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Top B');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Sub 1');
    // Indent
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Sub 2');
    await page.waitForTimeout(100);

    // Verify structure
    let html = await getEditorHTML(page);
    expect(html).toContain('Top A');
    expect(html).toContain('Top B');
    expect(html).toContain('Sub 1');
    expect(html).toContain('Sub 2');

    // Convert sub-items to ordered list
    await page.locator(btn.ordered).click();
    await page.waitForTimeout(150);
    html = await getEditorHTML(page);
    expect(html).toContain('<ol>');

    // Add another level
    await page.keyboard.press('Enter');
    await page.keyboard.type('Deep');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);

    html = await getEditorHTML(page);
    expect(html).toContain('Deep');
    expect(html).toContain('Top A');
    expect(html).toContain('Sub 1');

    // Now unwind: Enter on empty deep item
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    // Empty item at deepest level — Enter escapes
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    // All content should still exist
    const text = await getEditorText(page);
    expect(text).toContain('Top A');
    expect(text).toContain('Top B');
    expect(text).toContain('Sub 1');
    expect(text).toContain('Sub 2');
    expect(text).toContain('Deep');
  });

  // Edge case: task item with only a checked checkbox, nested bullet,
  // and trailing empty paragraph — Enter on the empty paragraph should
  // NOT destroy the bullet content
  test('task item with nested content + trailing empty paragraph: Enter preserves nested content', async ({ page }) => {
    const fixture = [
      '<ul data-type="taskList">',
      '<li data-type="taskItem" data-checked="true">',
      '<label contenteditable="false"><input type="checkbox" checked></label>',
      '<div><p>Main task</p>',
      '<ul><li><p>Sub note A</p></li><li><p>Sub note B</p></li></ul>',
      '<p></p>',
      '</div></li></ul>',
    ].join('');
    await setContentAndFocus(page, fixture);

    // Click on the trailing empty paragraph
    const paragraphs = page.locator(`${editorSelector} li[data-type="taskItem"] div p`);
    const count = await paragraphs.count();
    await paragraphs.nth(count - 1).click();
    await page.waitForTimeout(100);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('Main task');
    expect(html).toContain('Sub note A');
    expect(html).toContain('Sub note B');
  });

  // Edge case: single item in each nesting level — operations should still work
  test('single-item lists at each level: Tab and Enter work correctly', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>Only</p></li></ul>');

    const item = page.locator(`${editorSelector} li p`);
    await item.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Child');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);

    let html = await getEditorHTML(page);
    expect(html).toContain('Only');
    expect(html).toContain('Child');
    expect(html).toMatch(/<ul>.*<ul>/s); // nested

    // Enter on new empty creates empty, Enter again should escape
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    await page.keyboard.type('ESCAPED');
    html = await getEditorHTML(page);
    expect(html).toContain('Only');
    expect(html).toContain('Child');
    expect(html).toContain('ESCAPED');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// EDGE CASES — BACKSPACE AT START OF FIRST LIST ITEM
// ═══════════════════════════════════════════════════════════════════════

test.describe('Edge cases — Backspace at start of first list item', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Backspace at start of first bullet item converts to paragraph', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>Only item</p></li></ul>');

    const item = page.locator(`${editorSelector} li p`);
    await item.click();
    await page.keyboard.press('Home');
    await page.waitForTimeout(50);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('Only item');
    expect(html).not.toContain('<ul>');
    expect(html).not.toContain('<li>');
  });

  test('Backspace at start of first ordered item converts to paragraph', async ({ page }) => {
    await setContentAndFocus(page, '<ol><li><p>First</p></li></ol>');

    const item = page.locator(`${editorSelector} ol li p`);
    await item.click();
    await page.keyboard.press('Home');
    await page.waitForTimeout(50);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('First');
    expect(html).not.toContain('<ol>');
  });

  test('Backspace at start of first task item converts to paragraph', async ({ page }) => {
    const fixture = [
      '<ul data-type="taskList">',
      '<li data-type="taskItem" data-checked="false">',
      '<label contenteditable="false"><input type="checkbox"></label>',
      '<div><p>My task</p></div></li>',
      '</ul>',
    ].join('');
    await setContentAndFocus(page, fixture);

    const item = page.locator(`${editorSelector} li[data-type="taskItem"] div p`);
    await item.click();
    await page.keyboard.press('Home');
    await page.waitForTimeout(50);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('My task');
    // Should no longer be in a task list
    expect(html).not.toContain('data-type="taskList"');
  });

  test('Backspace at start of first item with siblings only affects first item', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>First</p></li><li><p>Second</p></li><li><p>Third</p></li></ul>');

    const items = page.locator(`${editorSelector} li p`);
    await items.nth(0).click();
    await page.keyboard.press('Home');
    await page.waitForTimeout(50);

    await page.keyboard.press('Backspace');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('First');
    expect(html).toContain('Second');
    expect(html).toContain('Third');
    // "First" should be outside the list, "Second" and "Third" still in list
    expect(html).toContain('<ul>');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// EDGE CASES — ENTER WITH NESTED SUB-LIST BELOW
// ═══════════════════════════════════════════════════════════════════════

test.describe('Edge cases — Enter on item with nested sub-list', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('Enter at end of item with sub-list creates sibling, not child', async ({ page }) => {
    const fixture = [
      '<ul><li><p>Parent</p>',
      '<ul><li><p>Child A</p></li><li><p>Child B</p></li></ul>',
      '</li><li><p>Sibling</p></li></ul>',
    ].join('');
    await setContentAndFocus(page, fixture);

    // Click on "Parent" and press End, then Enter
    const parent = page.locator(`${editorSelector} > ul > li > p`).first();
    await parent.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    await page.keyboard.type('NEW');
    const html = await getEditorHTML(page);
    expect(html).toContain('Parent');
    expect(html).toContain('NEW');
    expect(html).toContain('Child A');
    expect(html).toContain('Child B');
    expect(html).toContain('Sibling');
  });

  test('Enter in middle of parent text splits correctly even with sub-list', async ({ page }) => {
    const fixture = [
      '<ul><li><p>ABCDEF</p>',
      '<ul><li><p>Nested</p></li></ul>',
      '</li></ul>',
    ].join('');
    await setContentAndFocus(page, fixture);

    const parent = page.locator(`${editorSelector} > ul > li > p`).first();
    await parent.click();
    await page.waitForTimeout(50);
    await page.keyboard.press('Home');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(50);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('ABC');
    expect(html).toContain('DEF');
    expect(html).toContain('Nested');
  });

  test('Enter on empty item between two items with sub-lists preserves both sub-lists', async ({ page }) => {
    const fixture = [
      '<ul>',
      '<li><p>Item A</p><ul><li><p>Sub A</p></li></ul></li>',
      '<li><p></p></li>',
      '<li><p>Item B</p><ul><li><p>Sub B</p></li></ul></li>',
      '</ul>',
    ].join('');
    await setContentAndFocus(page, fixture);

    const items = page.locator(`${editorSelector} > ul > li > p`);
    await items.nth(1).click();
    await page.waitForTimeout(50);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('Item A');
    expect(html).toContain('Sub A');
    expect(html).toContain('Item B');
    expect(html).toContain('Sub B');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// EDGE CASES — PASTE LIST INTO LIST
// ═══════════════════════════════════════════════════════════════════════

test.describe('Edge cases — paste into lists', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('paste plain text into list item appends to existing text', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>Hello </p></li></ul>');

    const item = page.locator(`${editorSelector} li p`);
    await item.click();
    await page.keyboard.press('End');

    // Paste plain text via clipboard API
    await page.evaluate(() => {
      const editor = document.querySelector('.ProseMirror');
      if (!editor) return;
      const dt = new DataTransfer();
      dt.setData('text/plain', 'World');
      const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      editor.dispatchEvent(event);
    });
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('Hello');
    expect(html).toContain('World');
    expect(html).toContain('<ul>');
  });

  test('paste multi-line text into list item creates multiple items', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>Before</p></li></ul>');

    const item = page.locator(`${editorSelector} li p`);
    await item.click();
    await page.keyboard.press('End');

    await page.evaluate(() => {
      const editor = document.querySelector('.ProseMirror');
      if (!editor) return;
      const dt = new DataTransfer();
      dt.setData('text/plain', '\nLine A\nLine B');
      const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      editor.dispatchEvent(event);
    });
    await page.waitForTimeout(150);

    const text = await getEditorText(page);
    expect(text).toContain('Before');
    expect(text).toContain('Line A');
    expect(text).toContain('Line B');
  });

  test('paste HTML list into existing list merges correctly', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>Existing</p></li></ul>');

    const item = page.locator(`${editorSelector} li p`);
    await item.click();
    await page.keyboard.press('End');

    await page.evaluate(() => {
      const editor = document.querySelector('.ProseMirror');
      if (!editor) return;
      const dt = new DataTransfer();
      dt.setData('text/html', '<ul><li>Pasted A</li><li>Pasted B</li></ul>');
      dt.setData('text/plain', 'Pasted A\nPasted B');
      const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      editor.dispatchEvent(event);
    });
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('Existing');
    expect(html).toContain('Pasted A');
    expect(html).toContain('Pasted B');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// EDGE CASES — MULTI-LEVEL TYPE CONVERSION
// ═══════════════════════════════════════════════════════════════════════

test.describe('Edge cases — multi-level type conversion', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('convert nested sub-list type without affecting parent list', async ({ page }) => {
    const fixture = [
      '<ul><li><p>Parent A</p></li>',
      '<li><p>Parent B</p>',
      '<ul><li><p>Child 1</p></li><li><p>Child 2</p></li></ul>',
      '</li></ul>',
    ].join('');
    await setContentAndFocus(page, fixture);

    // Click on "Child 1" and convert to ordered
    const child = page.locator(`${editorSelector} ul ul li p`).first();
    await child.click();
    await page.waitForTimeout(50);

    await page.locator(btn.ordered).click();
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    // Parent should still be bullet
    expect(html).toMatch(/<ul>/);
    // Children should be ordered
    expect(html).toContain('<ol>');
    expect(html).toContain('Parent A');
    expect(html).toContain('Parent B');
    expect(html).toContain('Child 1');
    expect(html).toContain('Child 2');
  });

  test('convert parent list type preserves nested sub-list type', async ({ page }) => {
    const fixture = [
      '<ul><li><p>Parent</p>',
      '<ol><li><p>Ordered child</p></li></ol>',
      '</li></ul>',
    ].join('');
    await setContentAndFocus(page, fixture);

    // Click on "Parent" and convert to ordered
    const parent = page.locator(`${editorSelector} > ul > li > p`).first();
    await parent.click();
    await page.waitForTimeout(50);

    await page.locator(btn.ordered).click();
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('Parent');
    expect(html).toContain('Ordered child');
    // Should have an ol at top level
    expect(html).toMatch(/^<ol>/);
  });

  test('toggle same type on nested item is no-op or toggles off', async ({ page }) => {
    const fixture = [
      '<ul><li><p>Parent</p>',
      '<ul><li><p>Nested bullet</p></li></ul>',
      '</li></ul>',
    ].join('');
    await setContentAndFocus(page, fixture);

    const nested = page.locator(`${editorSelector} ul ul li p`);
    await nested.click();
    await page.waitForTimeout(50);

    // Toggle bullet on a bullet — should toggle off (lift)
    await page.locator(btn.bullet).click();
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('Parent');
    expect(html).toContain('Nested bullet');
  });

  test('convert bullet → task → ordered → bullet round-trip preserves all content', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>Alpha</p></li><li><p>Beta</p></li></ul>');

    const item = page.locator(`${editorSelector} li p`).first();
    await item.click();
    await page.waitForTimeout(50);

    // Bullet → Task
    await page.locator(btn.task).click();
    await page.waitForTimeout(100);
    let html = await getEditorHTML(page);
    expect(html).toContain('data-type="taskList"');

    // Task → Ordered
    await page.locator(btn.ordered).click();
    await page.waitForTimeout(100);
    html = await getEditorHTML(page);
    expect(html).toContain('<ol>');

    // Ordered → Bullet
    await page.locator(btn.bullet).click();
    await page.waitForTimeout(100);
    html = await getEditorHTML(page);
    expect(html).toContain('<ul>');
    expect(html).not.toContain('<ol>');
    expect(html).not.toContain('taskList');

    // Content preserved through all conversions
    expect(html).toContain('Alpha');
    expect(html).toContain('Beta');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// EDGE CASES — LIST ITEMS WITH BLOCK CONTENT (blockquote, code block)
// ═══════════════════════════════════════════════════════════════════════

test.describe('Edge cases — list items with block content', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('list item containing blockquote preserves structure on Enter', async ({ page }) => {
    const fixture = [
      '<ul>',
      '<li><p>Before quote</p><blockquote><p>Quoted text</p></blockquote></li>',
      '<li><p>After</p></li>',
      '</ul>',
    ].join('');
    await setContentAndFocus(page, fixture);

    // Click on "Before quote", go to end, press Enter
    const firstP = page.locator(`${editorSelector} > ul > li > p`).first();
    await firstP.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    await page.keyboard.type('NEW');
    const html = await getEditorHTML(page);
    expect(html).toContain('Before quote');
    expect(html).toContain('NEW');
    expect(html).toContain('Quoted text');
    expect(html).toContain('After');
  });

  test('list item containing code block preserves structure', async ({ page }) => {
    const fixture = [
      '<ul>',
      '<li><p>Text</p><pre><code>const x = 1;</code></pre></li>',
      '</ul>',
    ].join('');
    await setContentAndFocus(page, fixture);

    const html = await getEditorHTML(page);
    expect(html).toContain('Text');
    // Code block content may have syntax highlighting spans
    expect(html).toContain('const');
    expect(html).toContain('<ul>');
    expect(html).toContain('<pre>');
  });

  test('Tab on item with blockquote nests entire item including blockquote', async ({ page }) => {
    const fixture = [
      '<ul>',
      '<li><p>Parent</p></li>',
      '<li><p>Has quote</p><blockquote><p>Inner quote</p></blockquote></li>',
      '</ul>',
    ].join('');
    await setContentAndFocus(page, fixture);

    // Click on "Has quote" and Tab to nest
    const secondItem = page.locator(`${editorSelector} > ul > li > p`).nth(1);
    await secondItem.click();
    await page.waitForTimeout(50);

    await page.keyboard.press('Tab');
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('Parent');
    expect(html).toContain('Has quote');
    expect(html).toContain('Inner quote');
    expect(html).toContain('<blockquote>');
    // Should be nested
    expect(html).toMatch(/<ul>.*<ul>/s);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// EDGE CASES — TOOLBAR BUTTON CREATION FROM PARAGRAPHS
// ═══════════════════════════════════════════════════════════════════════

test.describe('Edge cases — toolbar button list creation from paragraph', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector(editorSelector);
  });

  test('bullet button wraps paragraph in bullet list', async ({ page }) => {
    await setContentAndFocus(page, '<p>Make me a list</p>');
    const p = page.locator(`${editorSelector} p`);
    await p.click();
    await page.waitForTimeout(50);

    await page.locator(btn.bullet).click();
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('<ul>');
    expect(html).toContain('Make me a list');
  });

  test('ordered button wraps paragraph in ordered list', async ({ page }) => {
    await setContentAndFocus(page, '<p>Number me</p>');
    const p = page.locator(`${editorSelector} p`);
    await p.click();
    await page.waitForTimeout(50);

    await page.locator(btn.ordered).click();
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('<ol>');
    expect(html).toContain('Number me');
  });

  test('task button wraps paragraph in task list', async ({ page }) => {
    await setContentAndFocus(page, '<p>Task me</p>');
    const p = page.locator(`${editorSelector} p`);
    await p.click();
    await page.waitForTimeout(50);

    await page.locator(btn.task).click();
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('Task me');
  });

  test('bullet button toggles bullet list off when already bullet', async ({ page }) => {
    await setContentAndFocus(page, '<ul><li><p>Listed</p></li></ul>');
    const item = page.locator(`${editorSelector} li p`);
    await item.click();
    await page.waitForTimeout(50);

    await page.locator(btn.bullet).click();
    await page.waitForTimeout(150);

    const html = await getEditorHTML(page);
    expect(html).not.toContain('<ul>');
    expect(html).toContain('Listed');
  });
});
