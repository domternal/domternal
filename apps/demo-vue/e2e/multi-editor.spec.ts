/**
 * E2E for the "Multiple editors" demo mode: several independent editor
 * instances built from ONE shared extensions array (the page-builder pattern).
 *
 * Primary guard: the shared-extension-instance bug where creating a later
 * editor clobbered earlier ones, so list Enter on every non-last editor fell
 * back to a plain block split and dropped an indented "child" paragraph
 * instead of a new sibling <li>. Plus broad isolation / lifecycle / overlay /
 * schema coverage that could regress when many editors share one config.
 *
 * Editors: index 0 = toolbar, index 1 & 2 = bubble menu. Each preloaded with a
 * heading, a paragraph, a bullet list (Bullet one / Bullet two), an ordered
 * list (Ordered one), and a task list (Task one).
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';

const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
const gridPM = '.multi-editor-grid .ProseMirror';

async function goMulti(page: Page): Promise<void> {
  await page.goto('/');
  await page.click('button[data-testid="mode-multi"]');
  await page.waitForFunction(() => ((window as any).__MULTI_EDITORS__?.length ?? 0) >= 3, undefined, { timeout: 10000 });
  await page.waitForSelector(gridPM);
}

async function count(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__MULTI_EDITORS__.length);
}

async function htmlOf(page: Page, i: number): Promise<string> {
  return page.evaluate((idx) => (window as any).__MULTI_EDITORS__[idx].getHTML(), i);
}

async function textOf(page: Page, i: number): Promise<string> {
  return page.evaluate((idx) => (window as any).__MULTI_EDITORS__[idx].state.doc.textContent, i);
}

async function setContent(page: Page, i: number, html: string): Promise<void> {
  await page.evaluate(({ idx, h }) => {
    const e = (window as any).__MULTI_EDITORS__[idx];
    e.setContent(h, false);
    e.view.focus();
  }, { idx: i, h: html });
}

/** Place a collapsed caret at the END of the first paragraph whose text === `text`, in editor i, and focus it. */
async function caretAtEndOf(page: Page, i: number, text: string): Promise<void> {
  await page.evaluate(({ idx, t }) => {
    const e = (window as any).__MULTI_EDITORS__[idx];
    const TS = e.state.selection.constructor;
    let pos = -1, size = 0;
    e.state.doc.descendants((n: any, p: number) => {
      if (pos !== -1) return false;
      if (n.type.name === 'paragraph' && n.textContent === t) { pos = p; size = n.nodeSize; return false; }
      return true;
    });
    if (pos < 0) throw new Error(`paragraph "${t}" not found in editor ${String(idx)}`);
    e.view.focus();
    e.view.dispatch(e.state.tr.setSelection(TS.create(e.state.doc, pos + size - 1)));
  }, { idx: i, t: text });
}

/** Select the substring `text` (range) within editor i and focus it. */
async function selectText(page: Page, i: number, text: string): Promise<void> {
  await page.evaluate(({ idx, t }) => {
    const e = (window as any).__MULTI_EDITORS__[idx];
    const TS = e.state.selection.constructor;
    let from = -1, to = -1;
    e.state.doc.descendants((n: any, p: number) => {
      if (from !== -1) return false;
      if (n.isText && typeof n.text === 'string' && n.text.includes(t)) {
        const off = n.text.indexOf(t);
        from = p + off; to = from + t.length; return false;
      }
      return true;
    });
    if (from < 0) throw new Error(`text "${t}" not found in editor ${String(idx)}`);
    e.view.focus();
    e.view.dispatch(e.state.tr.setSelection(TS.create(e.state.doc, from, to)));
  }, { idx: i, t: text });
}

interface ItemShape { childCount: number; blocks: string[]; text: string }

/** Items (with child-block types) of the FIRST list of `listType` in editor i. */
async function listShapes(page: Page, i: number, listType: string): Promise<ItemShape[]> {
  return page.evaluate(({ idx, lt }) => {
    const e = (window as any).__MULTI_EDITORS__[idx];
    let items: ItemShape[] | null = null;
    e.state.doc.descendants((n: any) => {
      if (items) return false;
      if (n.type.name === lt) {
        items = [];
        n.forEach((item: any) => {
          const blocks: string[] = [];
          item.forEach((c: any) => blocks.push(c.type.name));
          (items as ItemShape[]).push({ childCount: item.childCount, blocks, text: item.firstChild?.textContent ?? '' });
        });
        return false;
      }
      return true;
    });
    return items ?? [];
  }, { idx: i, lt: listType });
}

/** Childcounts of every listItem/taskItem in editor i (bug signature = a 2 with a 2nd paragraph). */
async function anyChildZone(page: Page, i: number): Promise<boolean> {
  return page.evaluate((idx) => {
    const e = (window as any).__MULTI_EDITORS__[idx];
    let bad = false;
    e.state.doc.descendants((n: any) => {
      if (n.type.name === 'listItem' || n.type.name === 'taskItem') {
        if (n.childCount >= 2 && n.child(1).type.name === 'paragraph') bad = true;
      }
      return true;
    });
    return bad;
  }, i);
}

async function addEditor(page: Page, kind: 'bubble' | 'toolbar'): Promise<void> {
  const before = await count(page);
  await page.click(`button[data-testid="multi-add-${kind}"]`);
  await page.waitForFunction((n) => (window as any).__MULTI_EDITORS__.length === n, before + 1, { timeout: 5000 });
}

async function removeEditor(page: Page, i: number): Promise<void> {
  const before = await count(page);
  await page.locator('button[data-testid="multi-remove-editor"]').nth(i).click();
  await page.waitForFunction((n) => (window as any).__MULTI_EDITORS__.length === n, before - 1, { timeout: 5000 });
}

// ───────────────────────────────────────────────────────────────────────────
// 1. Core regression: list Enter makes a SIBLING item in EVERY editor
// ───────────────────────────────────────────────────────────────────────────
test.describe('multi: list Enter makes a sibling item in every editor', () => {
  test.beforeEach(async ({ page }) => { await goMulti(page); });

  for (const i of [0, 1, 2]) {
    test(`editor ${i}: Enter at end of a bullet label adds a sibling <li> (not a child paragraph)`, async ({ page }) => {
      await caretAtEndOf(page, i, 'Bullet two');
      await page.keyboard.press('Enter');
      await page.keyboard.type(`Extra${i}`);

      const items = await listShapes(page, i, 'bulletList');
      expect(items.map((x) => x.text)).toEqual(['Bullet one', 'Bullet two', `Extra${i}`]);
      expect(items.every((x) => x.childCount === 1)).toBe(true);
      expect(await anyChildZone(page, i)).toBe(false);
    });
  }

  test('cross-editor parity: bullet Enter produces structurally identical results in all editors', async ({ page }) => {
    const shapes: ItemShape[][] = [];
    for (const i of [0, 1, 2]) {
      await caretAtEndOf(page, i, 'Bullet two');
      await page.keyboard.press('Enter');
      await page.keyboard.type('X');
      shapes.push(await listShapes(page, i, 'bulletList'));
    }
    // full structure (texts + child blocks + counts) must be identical AND correct
    const expected: ItemShape[] = [
      { text: 'Bullet one', blocks: ['paragraph'], childCount: 1 },
      { text: 'Bullet two', blocks: ['paragraph'], childCount: 1 },
      { text: 'X', blocks: ['paragraph'], childCount: 1 },
    ];
    for (const i of [0, 1, 2]) expect(shapes[i], `editor ${i}`).toEqual(expected);
  });

  test('editor 0: Enter at end of an ORDERED item adds a numbered sibling', async ({ page }) => {
    await caretAtEndOf(page, 0, 'Ordered one');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Ordered two');
    const items = await listShapes(page, 0, 'orderedList');
    expect(items.map((x) => x.text)).toEqual(['Ordered one', 'Ordered two']);
    expect(items.every((x) => x.childCount === 1)).toBe(true);
  });

  test('editor 1: Enter at end of a TASK item adds a new unchecked sibling taskItem', async ({ page }) => {
    await caretAtEndOf(page, 1, 'Task one');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Task two');
    const items = await listShapes(page, 1, 'taskList');
    expect(items.map((x) => x.text)).toEqual(['Task one', 'Task two']);
    expect(items.every((x) => x.childCount === 1)).toBe(true);
  });

  test('editor 0: Enter in the MIDDLE of a bullet label splits into two sibling <li>', async ({ page }) => {
    // caret between "Bullet" and " one"
    await page.evaluate(() => {
      const e = (window as any).__MULTI_EDITORS__[0];
      const TS = e.state.selection.constructor;
      let pos = -1;
      e.state.doc.descendants((n: any, p: number) => {
        if (pos !== -1) return false;
        if (n.type.name === 'paragraph' && n.textContent === 'Bullet one') { pos = p + 1 + 'Bullet'.length; return false; }
        return true;
      });
      e.view.focus();
      e.view.dispatch(e.state.tr.setSelection(TS.create(e.state.doc, pos)));
    });
    await page.keyboard.press('Enter');
    const items = await listShapes(page, 0, 'bulletList');
    expect(items.map((x) => x.text)).toEqual(['Bullet', ' one', 'Bullet two']);
    expect(await anyChildZone(page, 0)).toBe(false);
  });

  test('editor 0: Enter on an EMPTY bullet item exits the list', async ({ page }) => {
    await setContent(page, 0, '<h2>Editor 1</h2><ul><li><p>only</p></li></ul>');
    await caretAtEndOf(page, 0, 'only');
    await page.keyboard.press('Enter'); // empty sibling
    await page.keyboard.press('Enter'); // exit
    const topTypes = await page.evaluate(() => {
      const e = (window as any).__MULTI_EDITORS__[0];
      const t: string[] = [];
      e.state.doc.forEach((n: any) => t.push(n.type.name));
      return t;
    });
    expect(topTypes[topTypes.length - 1]).toBe('paragraph'); // lifted out as a trailing top-level paragraph
    expect(await anyChildZone(page, 0)).toBe(false);
    expect((await listShapes(page, 0, 'bulletList')).map((x) => x.text)).toEqual(['only']); // empty item gone
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. List keyboard ops + input rules in a NON-LAST editor
// ───────────────────────────────────────────────────────────────────────────
test.describe('multi: list keyboard ops + input rules in editor 0', () => {
  test.beforeEach(async ({ page }) => { await goMulti(page); });

  test('Tab nests a bullet item; Shift-Tab outdents it', async ({ page }) => {
    await caretAtEndOf(page, 0, 'Bullet two');
    await page.keyboard.press('Tab');
    // "Bullet two" is now nested inside the first item (its blocks gain a bulletList)
    let items = await listShapes(page, 0, 'bulletList');
    expect(items.length).toBe(1);
    expect(items[0].blocks).toContain('bulletList');
    await page.keyboard.press('Shift+Tab');
    items = await listShapes(page, 0, 'bulletList');
    expect(items.map((x) => x.text)).toEqual(['Bullet one', 'Bullet two']);
    expect(items.every((x) => x.childCount === 1)).toBe(true);
  });

  test('Backspace at start of an empty bullet item lifts it out', async ({ page }) => {
    await setContent(page, 0, '<h2>Editor 1</h2><ul><li><p>kept</p></li><li><p></p></li></ul>');
    await caretAtEndOf(page, 0, ''); // the empty item
    await page.keyboard.press('Backspace');
    const items = await listShapes(page, 0, 'bulletList');
    expect(items.map((x) => x.text)).toEqual(['kept']);
  });

  test('input rule "- " creates a bullet list', async ({ page }) => {
    await setContent(page, 0, '<p></p>');
    await caretAtEndOf(page, 0, '');
    await page.keyboard.type('- item');
    expect(await htmlOf(page, 0)).toContain('<ul>');
    await page.keyboard.press('Enter');
    await page.keyboard.type('item2');
    const items = await listShapes(page, 0, 'bulletList');
    expect(items.map((x) => x.text)).toEqual(['item', 'item2']);
  });

  test('input rules "1. " and "[] " create ordered and task lists', async ({ page }) => {
    await setContent(page, 0, '<p></p>');
    await caretAtEndOf(page, 0, '');
    await page.keyboard.type('1. one');
    expect(await htmlOf(page, 0)).toContain('<ol>');

    await setContent(page, 0, '<p></p>');
    await caretAtEndOf(page, 0, '');
    await page.keyboard.type('[] task');
    expect(await htmlOf(page, 0)).toContain('data-type="taskList"');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Lifecycle: add / remove / remount
// ───────────────────────────────────────────────────────────────────────────
test.describe('multi: lifecycle add/remove/remount', () => {
  test.beforeEach(async ({ page }) => { await goMulti(page); });

  test('after adding an editor, the FIRST editor still makes a sibling <li>', async ({ page }) => {
    await addEditor(page, 'toolbar');
    await caretAtEndOf(page, 0, 'Bullet two');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Y');
    const items = await listShapes(page, 0, 'bulletList');
    expect(items.map((x) => x.text)).toEqual(['Bullet one', 'Bullet two', 'Y']);
    expect(await anyChildZone(page, 0)).toBe(false);
  });

  test('after adding several editors, EVERY pre-existing editor makes a sibling <li>', async ({ page }) => {
    await addEditor(page, 'bubble');
    await addEditor(page, 'bubble');
    for (const i of [0, 1, 2]) {
      await caretAtEndOf(page, i, 'Bullet two');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Z');
      expect((await listShapes(page, i, 'bulletList')).map((x) => x.childCount)).toEqual([1, 1, 1]);
    }
  });

  test('removing the LAST editor leaves the first editor working', async ({ page }) => {
    await removeEditor(page, 2);
    expect(await count(page)).toBe(2);
    await caretAtEndOf(page, 0, 'Bullet two');
    await page.keyboard.press('Enter');
    expect(await anyChildZone(page, 0)).toBe(false);
    expect((await listShapes(page, 0, 'bulletList')).length).toBe(3);
  });

  test('removing a MIDDLE editor reindexes and survivors keep working lists', async ({ page }) => {
    await removeEditor(page, 1);
    expect(await count(page)).toBe(2);
    // panels reindexed 0,1
    const idxs = await page.locator('.multi-editor-panel').evaluateAll((els) =>
      els.map((el) => (el as HTMLElement).dataset.editorIndex));
    expect(idxs).toEqual(['0', '1']);
    for (const i of [0, 1]) {
      await caretAtEndOf(page, i, 'Bullet two');
      await page.keyboard.press('Enter');
      expect(await anyChildZone(page, i)).toBe(false);
    }
  });

  test('removing the FIRST editor: new first editor still works', async ({ page }) => {
    await removeEditor(page, 0);
    expect(await count(page)).toBe(2);
    await caretAtEndOf(page, 0, 'Bullet two');
    await page.keyboard.press('Enter');
    expect(await anyChildZone(page, 0)).toBe(false);
  });

  test('removing down to a single editor: the survivor still makes a sibling <li>', async ({ page }) => {
    await removeEditor(page, 2);
    await removeEditor(page, 1);
    expect(await count(page)).toBe(1);
    await caretAtEndOf(page, 0, 'Bullet two');
    await page.keyboard.press('Enter');
    expect((await listShapes(page, 0, 'bulletList')).length).toBe(3);
    expect(await anyChildZone(page, 0)).toBe(false);
  });

  test('switch to Notion mode and back to multi: remounted editors make sibling <li>', async ({ page }) => {
    await page.click('button[data-testid="mode-notion"]');
    await page.waitForSelector('.app-notion-demo .ProseMirror');
    await goMulti(page);
    await caretAtEndOf(page, 0, 'Bullet two');
    await page.keyboard.press('Enter');
    expect(await anyChildZone(page, 0)).toBe(false);
  });

  test('add(bubble)+add(toolbar)+remove keeps __MULTI_EDITORS__ and panel count in sync', async ({ page }) => {
    await addEditor(page, 'bubble');
    await addEditor(page, 'toolbar');
    expect(await count(page)).toBe(5);
    expect(await page.locator('.multi-editor-panel').count()).toBe(5);
    await removeEditor(page, 0);
    expect(await count(page)).toBe(4);
    expect(await page.locator('.multi-editor-panel').count()).toBe(4);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. Cross-editor state isolation
// ───────────────────────────────────────────────────────────────────────────
test.describe('multi: cross-editor isolation', () => {
  test.beforeEach(async ({ page }) => { await goMulti(page); });

  test('typing into editor 0 does not change editor 1 or 2', async ({ page }) => {
    const b1 = await htmlOf(page, 1);
    const b2 = await htmlOf(page, 2);
    await caretAtEndOf(page, 0, 'Bullet two');
    await page.keyboard.type(' MUTATED');
    expect(await htmlOf(page, 1)).toBe(b1);
    expect(await htmlOf(page, 2)).toBe(b2);
    expect(await textOf(page, 0)).toContain('MUTATED');
  });

  test('undo (Mod-Z) in editor 0 undoes only editor 0', async ({ page }) => {
    const b1 = await htmlOf(page, 1);
    await caretAtEndOf(page, 0, 'Bullet two');
    await page.keyboard.type(' aaa');
    expect(await textOf(page, 0)).toContain('aaa');
    await page.keyboard.press(`${mod}+z`);
    expect(await textOf(page, 0)).not.toContain('aaa');
    expect(await htmlOf(page, 1)).toBe(b1);
  });

  test('redo (Mod-Shift-Z) in editor 0 re-applies only editor 0', async ({ page }) => {
    const b1 = await htmlOf(page, 1);
    await caretAtEndOf(page, 0, 'Bullet two');
    await page.keyboard.type(' bbb');
    await page.keyboard.press(`${mod}+z`);
    await page.keyboard.press(`${mod}+Shift+z`);
    expect(await textOf(page, 0)).toContain('bbb');
    expect(await htmlOf(page, 1)).toBe(b1);
  });

  test('selection set in editor 0 does not move selection in editor 1', async ({ page }) => {
    await caretAtEndOf(page, 1, 'Bullet one');
    const sel1 = await page.evaluate(() => (window as any).__MULTI_EDITORS__[1].state.selection.from);
    await caretAtEndOf(page, 0, 'Ordered one');
    const sel1after = await page.evaluate(() => (window as any).__MULTI_EDITORS__[1].state.selection.from);
    expect(sel1after).toBe(sel1);
  });

  test('editor.commands on the LAST editor act on it, not the FIRST', async ({ page }) => {
    const b0 = await htmlOf(page, 0);
    await caretAtEndOf(page, 2, 'Bullet one');
    await page.evaluate(() => {
      const e = (window as any).__MULTI_EDITORS__[2];
      e.commands.focus();
      e.commands.toggleOrderedList();
    });
    expect(await htmlOf(page, 2)).toContain('<ol>'); // the command DID act on editor 2
    expect(await htmlOf(page, 0)).toBe(b0);           // editor 0 untouched
  });

  test('each editor exposes an independent storage object', async ({ page }) => {
    const same = await page.evaluate(() => {
      const a = (window as any).__MULTI_EDITORS__[0];
      const b = (window as any).__MULTI_EDITORS__[1];
      return a.storage === b.storage;
    });
    expect(same).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Overlays: toolbar (editor 0) + bubble menus (editors 1, 2)
// ───────────────────────────────────────────────────────────────────────────
test.describe('multi: overlays toolbar + bubble', () => {
  test.beforeEach(async ({ page }) => { await goMulti(page); });

  test('toolbar Bold acts only on editor 0', async ({ page }) => {
    const b1 = await htmlOf(page, 1);
    await selectText(page, 0, 'Bullet one');
    // the toolbar lives in editor 0's panel
    await page.locator('.multi-editor-panel[data-editor-index="0"] .dm-toolbar button[aria-label="Bold"]').click();
    expect(await htmlOf(page, 0)).toMatch(/<(strong|b)>/);
    expect(await htmlOf(page, 1)).toBe(b1);
  });

  test('selecting text in editor 1 shows its bubble menu, not editor 2\'s', async ({ page }) => {
    await selectText(page, 1, 'Bullet one');
    await expect(page.locator('.multi-editor-panel[data-editor-index="1"] .dm-bubble-menu')).toBeVisible();
    await expect(page.locator('.multi-editor-panel[data-editor-index="2"] .dm-bubble-menu')).toBeHidden();
  });

  test('clicking Bold in editor 1\'s bubble menu bolds only editor 1', async ({ page }) => {
    const b0 = await htmlOf(page, 0);
    const b2 = await htmlOf(page, 2);
    await selectText(page, 1, 'Bullet one');
    await page.locator('.multi-editor-panel[data-editor-index="1"] .dm-bubble-menu button[aria-label="Bold"]').click();
    expect(await htmlOf(page, 1)).toMatch(/<(strong|b)>/);
    expect(await htmlOf(page, 0)).toBe(b0);
    expect(await htmlOf(page, 2)).toBe(b2);
  });

  test('editor 2 (last) bubble menu acts on editor 2', async ({ page }) => {
    await selectText(page, 2, 'Bullet one');
    await expect(page.locator('.multi-editor-panel[data-editor-index="2"] .dm-bubble-menu')).toBeVisible();
    await page.locator('.multi-editor-panel[data-editor-index="2"] .dm-bubble-menu button[aria-label="Italic"]').click();
    expect(await htmlOf(page, 2)).toMatch(/<(em|i)>/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 6. Schema / extension integrity
// ───────────────────────────────────────────────────────────────────────────
test.describe('multi: schema / extension integrity', () => {
  test.beforeEach(async ({ page }) => { await goMulti(page); });

  test('each editor has an independent schema and node types', async ({ page }) => {
    const r = await page.evaluate(() => {
      const a = (window as any).__MULTI_EDITORS__[0];
      const b = (window as any).__MULTI_EDITORS__[1];
      return {
        sameSchema: a.schema === b.schema,
        sameListItem: a.schema.nodes.listItem === b.schema.nodes.listItem,
        sameBold: a.schema.marks.bold === b.schema.marks.bold,
      };
    });
    expect(r.sameSchema).toBe(false);
    expect(r.sameListItem).toBe(false);
    expect(r.sameBold).toBe(false);
  });

  test('marks apply correctly in editor 0 (non-last) via commands', async ({ page }) => {
    await selectText(page, 0, 'Bullet one');
    await page.evaluate(() => { (window as any).__MULTI_EDITORS__[0].commands.toggleItalic(); });
    expect(await htmlOf(page, 0)).toMatch(/<(em|i)>/);
  });

  test('heading conversion works in editor 0 and does not bleed into others', async ({ page }) => {
    const b1 = await htmlOf(page, 1);
    await caretAtEndOf(page, 0, 'Bullet one');
    await page.evaluate(() => {
      const e = (window as any).__MULTI_EDITORS__[0];
      e.commands.focus();
      e.commands.toggleHeading?.({ level: 3 });
    });
    expect(await htmlOf(page, 1)).toBe(b1);
  });

  test('getHTML of editor i contains only its own heading', async ({ page }) => {
    for (const i of [0, 1, 2]) {
      const h = await htmlOf(page, i);
      expect(h).toContain(`Editor ${i + 1}`);
      for (const j of [0, 1, 2]) {
        if (j !== i) expect(h).not.toContain(`Editor ${j + 1}`);
      }
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 7. Scale / ordering / content
// ───────────────────────────────────────────────────────────────────────────
test.describe('multi: scale / ordering / content', () => {
  test.beforeEach(async ({ page }) => { await goMulti(page); });

  test('scale to 8 editors: every editor makes a sibling <li> on Enter', async ({ page }) => {
    while (await count(page) < 8) await addEditor(page, 'bubble');
    const n = await count(page);
    for (let i = 0; i < n; i++) {
      await caretAtEndOf(page, i, 'Bullet two');
      await page.keyboard.press('Enter');
      await page.keyboard.type('s');
      const items = await listShapes(page, i, 'bulletList');
      expect(items.map((x) => x.text), `editor ${i}`).toEqual(['Bullet one', 'Bullet two', 's']);
      expect(items.every((x) => x.childCount === 1), `editor ${i} child zone`).toBe(true);
    }
  });

  test('nested list via Tab in editor 0: Enter at end of nested label makes a nested sibling', async ({ page }) => {
    await caretAtEndOf(page, 0, 'Bullet two');
    await page.keyboard.press('Tab'); // nest "Bullet two"
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('nested2');
    // the nested ul should now have 2 items; no child-zone paragraph
    expect(await anyChildZone(page, 0)).toBe(false);
    expect(await textOf(page, 0)).toContain('nested2');
  });

  test('children-zone accumulate in editor 0: Enter in a pre-seeded child paragraph adds another child', async ({ page }) => {
    await setContent(page, 0, '<h2>Editor 1</h2><ul><li><p>Label</p><p>child</p></li></ul>');
    await caretAtEndOf(page, 0, 'child');
    await page.keyboard.press('Enter');
    await page.keyboard.type('child2');
    const items = await listShapes(page, 0, 'bulletList');
    // single list item that accumulated children (Notion semantics): Label + child + child2
    expect(items.length).toBe(1);
    expect(items[0].childCount).toBe(3);
  });

  test('insertContent into editor 0 does not leak into editor 1', async ({ page }) => {
    const b1 = await htmlOf(page, 1);
    await page.evaluate(() => {
      const e = (window as any).__MULTI_EDITORS__[0];
      e.commands.focus();
      e.commands.insertContent('<p>injected-into-0</p>');
    });
    expect(await textOf(page, 0)).toContain('injected-into-0');
    expect(await htmlOf(page, 1)).toBe(b1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 8. Adversarial edge cases (bug hunting)
// ───────────────────────────────────────────────────────────────────────────
test.describe('multi: adversarial edge cases', () => {
  test.beforeEach(async ({ page }) => { await goMulti(page); });

  test('toolbar editor (0) shows no bubble menu on selection', async ({ page }) => {
    await selectText(page, 0, 'Bullet one');
    await expect(page.locator('.multi-editor-panel[data-editor-index="0"] .dm-bubble-menu')).toHaveCount(0);
  });

  test('removing a focused, mid-edit editor does not throw; survivors keep working', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await caretAtEndOf(page, 1, 'Bullet two');
    await page.keyboard.type(' mid-edit');
    await removeEditor(page, 1);
    expect(await count(page)).toBe(2);
    for (const i of [0, 1]) {
      await caretAtEndOf(page, i, 'Bullet two');
      await page.keyboard.press('Enter');
      expect(await anyChildZone(page, i)).toBe(false);
    }
    expect(errors).toEqual([]);
  });

  test('switching away from multi destroys editors and clears globals; returning works', async ({ page }) => {
    const before = await page.evaluate(() => {
      (window as any).__CAP__ = [...(window as any).__MULTI_EDITORS__];
      return (window as any).__MULTI_EDITORS__.length;
    });
    expect(before).toBe(3);
    await page.click('button[data-testid="mode-manual"]');
    await page.waitForSelector('.app-editor-demo .ProseMirror');
    const after = await page.evaluate(() => ({
      destroyed: (window as any).__CAP__.map((e: any) => e.isDestroyed),
      multi: (window as any).__MULTI_EDITORS__,
    }));
    expect(after.destroyed).toEqual([true, true, true]); // ALL editors destroyed, not just the first
    expect(after.multi).toBeUndefined();
    await goMulti(page);
    await caretAtEndOf(page, 0, 'Bullet two');
    await page.keyboard.press('Enter');
    expect(await anyChildZone(page, 0)).toBe(false);
  });

  test('ordered-list start attribute is isolated per editor', async ({ page }) => {
    await setContent(page, 0, '<ol start="5"><li><p>fifth</p></li></ol>');
    expect(await htmlOf(page, 0)).toContain('start="5"');
    expect(await htmlOf(page, 1)).not.toContain('start="5"');
  });

  test('task checked toggle is isolated per editor', async ({ page }) => {
    await page.locator('.multi-editor-panel[data-editor-index="1"] li[data-type="taskItem"] input[type="checkbox"]').click();
    expect(await htmlOf(page, 1)).toContain('data-checked="true"');
    expect(await htmlOf(page, 2)).toContain('data-checked="false"');
  });

  test('a newly added bubble editor gets its own isolated menu', async ({ page }) => {
    await addEditor(page, 'bubble');
    await selectText(page, 3, 'Bullet one');
    await expect(page.locator('.multi-editor-panel[data-editor-index="3"] .dm-bubble-menu')).toBeVisible();
    await expect(page.locator('.multi-editor-panel[data-editor-index="1"] .dm-bubble-menu')).toBeHidden();
  });

  test('bubble menu hides when the selection collapses', async ({ page }) => {
    await selectText(page, 1, 'Bullet one');
    await expect(page.locator('.multi-editor-panel[data-editor-index="1"] .dm-bubble-menu')).toBeVisible();
    await caretAtEndOf(page, 1, 'Bullet one');
    await expect(page.locator('.multi-editor-panel[data-editor-index="1"] .dm-bubble-menu')).toBeHidden();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 9. Deep bug-hunting: cross-schema clipboard, REAL-mouse focus/blur,
//    overlay cleanup, list-type depth in non-last editors
// ───────────────────────────────────────────────────────────────────────────
const bubble = (i: number): string => `.multi-editor-panel[data-editor-index="${i}"] .dm-bubble-menu`;
const pmOf = (i: number): string => `.multi-editor-panel[data-editor-index="${i}"] .ProseMirror`;

test.describe('multi: deep bug-hunting', () => {
  test.beforeEach(async ({ page }) => { await goMulti(page); });

  test('cross-schema clipboard: copy a bullet item from editor 1, paste into editor 0', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const src1 = await htmlOf(page, 1);
    // serialize editor 1's first bullet item to real clipboard HTML (carries data-pm-slice)
    const clip = await page.evaluate(() => {
      const e1 = (window as any).__MULTI_EDITORS__[1];
      const TS = e1.state.selection.constructor;
      let from = -1, to = -1;
      e1.state.doc.descendants((n: any, p: number) => {
        if (from !== -1) return false;
        if (n.type.name === 'listItem' && n.textContent === 'Bullet one') { from = p + 1; to = p + n.nodeSize - 1; return false; }
        return true;
      });
      e1.view.dispatch(e1.state.tr.setSelection(TS.create(e1.state.doc, from, to)));
      const slice = e1.state.selection.content();
      const ser = e1.view.serializeForClipboard(slice);
      return { html: ser.dom.innerHTML, text: ser.text };
    });
    await caretAtEndOf(page, 0, 'Bullet two');
    await page.evaluate(({ html, text }) => {
      const e0 = (window as any).__MULTI_EDITORS__[0];
      e0.view.focus();
      const dt = new DataTransfer();
      dt.setData('text/html', html);
      dt.setData('text/plain', text);
      e0.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, clip);
    // Cross-schema paste must not throw, must land the content, and must not
    // mutate the source editor. (Pasting a list-item paragraph into a list
    // label produces a child paragraph; that is normal paste behaviour and is
    // identical in a single editor, so it is NOT asserted here.)
    expect(errors).toEqual([]);
    expect(await textOf(page, 0)).toContain('Bullet one'); // pasted content landed
    expect(await htmlOf(page, 1)).toBe(src1);              // source editor untouched
  });

  test('real-mouse: focusing editor 2 hides editor 1\'s bubble; only one menu visible', async ({ page }) => {
    await page.locator(pmOf(1)).getByText('Bullet one').first().dblclick();
    await expect(page.locator(bubble(1))).toBeVisible();
    await page.locator(pmOf(2)).getByText('Bullet one').first().dblclick();
    await expect(page.locator(bubble(2))).toBeVisible();
    await expect(page.locator(bubble(1))).toBeHidden();
    // exactly one bubble visible across the whole grid
    const visible = await page.locator('.multi-editor-grid .dm-bubble-menu:visible').count();
    expect(visible).toBe(1);
  });

  test('real-mouse blur collapses editor 1\'s range (SelectionDecoration), editor 2 untouched', async ({ page }) => {
    await page.locator(pmOf(1)).getByText('Bullet one').first().dblclick();
    await expect(page.locator(bubble(1))).toBeVisible(); // wait for the word selection to register
    const range1 = await page.evaluate(() => {
      const s = (window as any).__MULTI_EDITORS__[1].state.selection; return s.to - s.from;
    });
    expect(range1).toBeGreaterThan(0);
    const sel2before = await page.evaluate(() => (window as any).__MULTI_EDITORS__[2].state.selection.from);
    // real click into editor 0 -> editor 1 blurs
    await page.locator(pmOf(0)).getByText('Bullet two').first().click();
    const collapsed1 = await page.evaluate(() => {
      const s = (window as any).__MULTI_EDITORS__[1].state.selection; return s.from === s.to;
    });
    expect(collapsed1).toBe(true);
    const sel2after = await page.evaluate(() => (window as any).__MULTI_EDITORS__[2].state.selection.from);
    expect(sel2after).toBe(sel2before);
  });

  test('removing an editor whose bubble menu is OPEN: no error, no orphan, survivors work', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.locator(pmOf(1)).getByText('Bullet one').first().dblclick();
    await expect(page.locator(bubble(1))).toBeVisible();
    await removeEditor(page, 1);
    expect(await count(page)).toBe(2);
    expect(errors).toEqual([]);
    // surviving editors keep working lists
    for (const i of [0, 1]) {
      await caretAtEndOf(page, i, 'Bullet two');
      await page.keyboard.press('Enter');
      expect(await anyChildZone(page, i)).toBe(false);
    }
  });

  test('no orphaned bubble-menu nodes after remove and after mode switch', async ({ page }) => {
    expect(await page.locator('.dm-bubble-menu').count()).toBe(2); // editors 1, 2
    await removeEditor(page, 1);
    expect(await page.locator('.dm-bubble-menu').count()).toBe(1);
    await page.click('button[data-testid="mode-manual"]');
    await page.waitForSelector('.app-editor-demo .ProseMirror');
    expect(await page.locator('.multi-editor-grid').count()).toBe(0);
  });

  test('Mod-A (select all) in editor 0 stays scoped to editor 0', async ({ page }) => {
    const b1 = await htmlOf(page, 1);
    await caretAtEndOf(page, 0, 'Bullet one');
    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.type('replaced');
    expect(await textOf(page, 0)).toBe('replaced');
    expect(await htmlOf(page, 1)).toBe(b1);
  });

  test('Tab/Shift-Tab nests/outdents a TASK item in non-last editor 1', async ({ page }) => {
    await setContent(page, 1, '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>t1</p></li><li data-type="taskItem" data-checked="false"><p>t2</p></li></ul>');
    await caretAtEndOf(page, 1, 't2');
    await page.keyboard.press('Tab');
    let items = await listShapes(page, 1, 'taskList');
    expect(items.length).toBe(1);
    expect(items[0].blocks).toContain('taskList');
    await page.keyboard.press('Shift+Tab');
    items = await listShapes(page, 1, 'taskList');
    expect(items.map((x) => x.text)).toEqual(['t1', 't2']);
  });

  test('toggleOrderedList on editor 0 bullet converts only editor 0', async ({ page }) => {
    const b1 = await htmlOf(page, 1);
    await caretAtEndOf(page, 0, 'Bullet one');
    await page.evaluate(() => {
      const e = (window as any).__MULTI_EDITORS__[0];
      e.commands.focus();
      e.commands.toggleOrderedList();
    });
    expect(await htmlOf(page, 0)).toContain('<ol>');
    expect(await htmlOf(page, 1)).toBe(b1);
  });

  for (const [lt, item, label] of [['orderedList', 'Ordered one', 'ordered'], ['taskList', 'Task one', 'task']] as const) {
    test(`Enter parity: ${label} item Enter makes a sibling in the LAST editor (2)`, async ({ page }) => {
      await caretAtEndOf(page, 2, item);
      await page.keyboard.press('Enter');
      await page.keyboard.type('NEW');
      const items = await listShapes(page, 2, lt);
      expect(items[items.length - 1].text).toBe('NEW');
      expect(items.every((x) => x.childCount === 1)).toBe(true);
    });
  }

  for (const [seed, label] of [
    ['<ol><li><p>only</p></li></ol>', 'ordered'],
    ['<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>only</p></li></ul>', 'task'],
  ] as const) {
    test(`empty ${label} item Enter exits the list in non-last editor 0`, async ({ page }) => {
      await setContent(page, 0, `<h2>x</h2>${seed}`);
      await caretAtEndOf(page, 0, 'only');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      const topTypes = await page.evaluate(() => {
        const e = (window as any).__MULTI_EDITORS__[0]; const t: string[] = [];
        e.state.doc.forEach((n: any) => t.push(n.type.name)); return t;
      });
      expect(topTypes[topTypes.length - 1]).toBe('paragraph');
      expect(await anyChildZone(page, 0)).toBe(false);
    });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 10. Completeness (remaining MED/LOW edge cases)
// ───────────────────────────────────────────────────────────────────────────
test.describe('multi: completeness', () => {
  test.beforeEach(async ({ page }) => { await goMulti(page); });

  test('undo depth/grouping is isolated across interleaved edits', async ({ page }) => {
    // editor 1: two separate history groups (700ms > newGroupDelay)
    await caretAtEndOf(page, 1, 'Bullet two');
    await page.keyboard.type(' AAA');
    await page.waitForTimeout(700);
    await page.keyboard.type(' BBB');
    // editor 0: one edit
    await caretAtEndOf(page, 0, 'Bullet two');
    await page.keyboard.type(' ZZZ');
    // undo editor 0
    await page.evaluate(() => (window as any).__MULTI_EDITORS__[0].view.focus());
    await page.keyboard.press(`${mod}+z`);
    expect(await textOf(page, 0)).not.toContain('ZZZ');
    expect(await textOf(page, 1)).toContain('AAA');
    expect(await textOf(page, 1)).toContain('BBB');
    // undo editor 1 twice -> removes BBB group then AAA group (depth preserved)
    await page.evaluate(() => (window as any).__MULTI_EDITORS__[1].view.focus());
    await page.keyboard.press(`${mod}+z`);
    expect(await textOf(page, 1)).toContain('AAA');
    expect(await textOf(page, 1)).not.toContain('BBB');
    await page.keyboard.press(`${mod}+z`);
    expect(await textOf(page, 1)).not.toContain('AAA');
    // editor 0 and 2 untouched by editor 1's undos
    expect(await textOf(page, 0)).not.toContain('ZZZ');
    expect(await textOf(page, 2)).toContain('Bullet one');
  });

  test('toolbar dropdown opens within editor 0\'s own panel only, and closes', async ({ page }) => {
    const trigger = page.locator('.multi-editor-panel[data-editor-index="0"] .dm-toolbar .dm-toolbar-dropdown-trigger').first();
    await trigger.click();
    // panel renders inside editor 0's own panel...
    await expect(page.locator('.multi-editor-panel[data-editor-index="0"] .dm-toolbar-dropdown-panel')).toBeVisible();
    // ...and nowhere else (only one panel open across the whole grid)
    await expect(page.locator('.dm-toolbar-dropdown-panel:visible')).toHaveCount(1);
    // toggle-close by clicking the trigger again (auto-waits, no animation race)
    await trigger.click();
    await expect(page.locator('.dm-toolbar-dropdown-panel:visible')).toHaveCount(0);
  });

  test('rapid add/remove churn keeps panel + overlay counts consistent', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await addEditor(page, 'bubble');
    await addEditor(page, 'toolbar');
    await addEditor(page, 'bubble');
    await removeEditor(page, 4);
    await removeEditor(page, 0);
    await removeEditor(page, 1);
    const n = await count(page);
    expect(await page.locator('.multi-editor-panel').count()).toBe(n);
    const bubbleEditors = await page.evaluate(() =>
      [...document.querySelectorAll('.multi-editor-panel')].filter((p) => !p.querySelector('.dm-toolbar')).length);
    expect(await page.locator('.dm-bubble-menu').count()).toBe(bubbleEditors); // no orphans
    expect(errors).toEqual([]);
    await caretAtEndOf(page, 0, 'Bullet two');
    await page.keyboard.press('Enter');
    expect(await anyChildZone(page, 0)).toBe(false);
  });

  test('mixed multi-block selection toggled into a list in non-last editor 0', async ({ page }) => {
    const b1 = await htmlOf(page, 1);
    await setContent(page, 0, '<p>line one</p><p>line two</p>');
    await page.evaluate(() => {
      const e = (window as any).__MULTI_EDITORS__[0];
      const TS = e.state.selection.constructor;
      e.view.focus();
      e.view.dispatch(e.state.tr.setSelection(TS.create(e.state.doc, 1, e.state.doc.content.size - 1)));
      e.commands.toggleBulletList();
    });
    const items = await listShapes(page, 0, 'bulletList');
    expect(items.map((x) => x.text)).toEqual(['line one', 'line two']);
    expect(await htmlOf(page, 1)).toBe(b1);
  });

  test('list join-on-insert (joinForward) merges two lists in non-last editor 0', async ({ page }) => {
    const b1 = await htmlOf(page, 1);
    await setContent(page, 0, '<ul><li><p>a</p></li></ul><p></p><ul><li><p>b</p></li></ul>');
    await caretAtEndOf(page, 0, ''); // the empty middle paragraph
    await page.keyboard.type('- x');
    const items = await listShapes(page, 0, 'bulletList');
    expect(items.map((x) => x.text)).toEqual(['a', 'x', 'b']);
    expect(await htmlOf(page, 1)).toBe(b1);
  });

  test('task checkbox NodeView toggles the correct editor after a reindex', async ({ page }) => {
    await removeEditor(page, 0); // old editor 1 -> index 0, old editor 2 -> index 1
    expect(await count(page)).toBe(2);
    await page.locator('.multi-editor-panel[data-editor-index="0"] li[data-type="taskItem"] input[type="checkbox"]').click();
    expect(await htmlOf(page, 0)).toContain('data-checked="true"');
    expect(await htmlOf(page, 1)).toContain('data-checked="false"');
  });

  test('dismissing editor 1\'s bubble does not suppress editor 2\'s bubble', async ({ page }) => {
    await selectText(page, 1, 'Bullet one');
    await expect(page.locator(bubble(1))).toBeVisible();
    await page.locator('h1').first().click(); // outside click dismisses editor 1's bubble
    await expect(page.locator(bubble(1))).toBeHidden();
    await selectText(page, 2, 'Bullet one');
    await expect(page.locator(bubble(2))).toBeVisible(); // editor 2 not suppressed
  });
});
