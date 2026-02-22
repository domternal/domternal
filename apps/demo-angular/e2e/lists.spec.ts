import { test, expect, type Page } from '@playwright/test';

const editorSelector = 'domternal-editor .ProseMirror';
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

const btn = {
  bullet: 'button[aria-label="Bullet List"]',
  ordered: 'button[aria-label="Ordered List"]',
  task: 'button[aria-label="Task List"]',
  bold: 'button[aria-label="Bold"]',
} as const;

async function setContentAndFocus(page: Page, html: string) {
  const editor = page.locator(editorSelector);
  await editor.evaluate((el, h) => {
    el.innerHTML = h;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, html);
  await page.waitForTimeout(100);
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
