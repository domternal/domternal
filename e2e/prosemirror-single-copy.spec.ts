/**
 * ProseMirror compares by identity, so a second copy of prosemirror-model,
 * prosemirror-state or prosemirror-view turns ordinary editing into
 * "Can not convert <> to a Fragment" and "Adding different instances of a
 * keyed plugin". Nothing warns at install time and nothing warns at build
 * time, so `@domternal/core` registers the copy it is using when an editor is
 * built and warns when that disagrees with one already on the page.
 *
 * Two things are pinned here. First, that a normal boot of each demo has ONE
 * of everything: this is the regression guard, and it fails the moment the
 * app's resolution splits. Second, that the warning is actually reachable and
 * says something a developer can act on, driven by poisoning the registry
 * before the page's own scripts run.
 *
 * The registry lives on `globalThis` under `Symbol.for` on purpose, so that a
 * SECOND copy of core can see the first. That is also what makes it reachable
 * from a test without exporting anything for the occasion.
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

const REGISTRY_KEY = 'domternal.prosemirror.copies';
/** What `@domternal/core` registers from its own constructor. */
const CORE_MODULES = [
  'prosemirror-model',
  'prosemirror-state',
  'prosemirror-view',
  'prosemirror-transform',
];

interface RegistrySnapshot {
  present: boolean;
  consumers: Record<string, string>;
}

async function openDemo(page: Page, target: DemoTarget): Promise<void> {
  await page.goto(target.baseURL + '/');
  await page.waitForSelector('.ProseMirror');
  await page.waitForFunction(
    () => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']),
    { timeout: 5000 }
  );
}

async function readRegistry(page: Page): Promise<RegistrySnapshot> {
  return page.evaluate((key) => {
    const store = (globalThis as Record<symbol, unknown>)[Symbol.for(key)];
    if (!(store instanceof Map)) return { present: false, consumers: {} };
    const consumers: Record<string, string> = {};
    for (const [module, entry] of store.entries()) {
      consumers[module as string] = (entry as { consumer: string }).consumer;
    }
    return { present: true, consumers };
  }, REGISTRY_KEY);
}

/**
 * Puts a foreign copy of `module` into the registry before any application
 * script runs, which is exactly the state a nested install produces: somebody
 * else got there first with a different class.
 */
async function poisonBeforeLoad(page: Page, module: string, consumer: string): Promise<void> {
  await page.addInitScript(
    ([key, name, who]) => {
      const slot = Symbol.for(key);
      /* Merge rather than replace: a test that poisons two modules would
         otherwise have the second call wipe the first, and silently assert
         half of what it claims to. */
      const existing = (globalThis as Record<symbol, unknown>)[slot];
      const store = existing instanceof Map ? existing : new Map();
      store.set(name, { copy: { pretendClass: 'ForeignFragment' }, consumer: who });
      (globalThis as Record<symbol, unknown>)[slot] = store;
    },
    [REGISTRY_KEY, module, consumer] as const
  );
}

/** Every console warning the page emitted, collected from before navigation. */
function collectWarnings(page: Page): string[] {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  return warnings;
}

for (const target of demoTargets) {
  test(`${target.name}: a normal boot registers one copy of each identity-compared module`, async ({
    page,
  }) => {
    const warnings = collectWarnings(page);
    await openDemo(page, target);

    const registry = await readRegistry(page);
    expect(registry.present).toBe(true);
    for (const module of CORE_MODULES) {
      expect(registry.consumers[module]).toBe('@domternal/core');
    }
    // The regression guard: if this app ever resolves two copies, the warning
    // fires here rather than as an unexplained crash in a customer's app.
    expect(warnings.filter((text) => text.includes('Two different copies'))).toHaveLength(0);
  });

  test(`${target.name}: a second copy of prosemirror-model is reported with both packages and the fix`, async ({
    page,
  }) => {
    const warnings = collectWarnings(page);
    await poisonBeforeLoad(page, 'prosemirror-model', 'some-other-library');
    await openDemo(page, target);

    const conflicts = warnings.filter((text) => text.includes('Two different copies'));
    expect(conflicts).toHaveLength(1);
    const message = conflicts[0] ?? '';
    expect(message).toContain('prosemirror-model');
    // Both sides, which is precisely what ProseMirror's own error cannot say.
    expect(message).toContain('some-other-library');
    expect(message).toContain('@domternal/core');
    // And an actionable fix rather than a diagnosis.
    for (const manager of ['pnpm', 'npm', 'yarn', 'Vite', 'webpack']) {
      expect(message).toContain(manager);
    }
    expect(message).toContain('https://domternal.dev/v1/guides/single-prosemirror-copy/');
  });

  test(`${target.name}: the warning names whichever module actually split`, async ({ page }) => {
    const warnings = collectWarnings(page);
    await poisonBeforeLoad(page, 'prosemirror-state', 'some-other-library');
    await openDemo(page, target);

    const message = warnings.find((text) => text.includes('Two different copies')) ?? '';
    expect(message).toContain('"prosemirror-state"');
    expect(message).toContain("resolve.dedupe: ['prosemirror-state']");
    // prosemirror-model was never split, so it must not be implicated.
    expect(message).not.toContain('"prosemirror-model"');
  });

  test(`${target.name}: the conflict is reported once however many editors the page builds`, async ({
    page,
  }) => {
    const warnings = collectWarnings(page);
    await poisonBeforeLoad(page, 'prosemirror-model', 'some-other-library');
    await openDemo(page, target);

    // Switching demo modes tears the editor down and builds another one, so
    // core registers again. A per-editor warning would drown the console in an
    // app that mounts editors in a list.
    await page.click(target.notionToggle);
    await page.waitForSelector(target.editorSelector);
    await page.waitForTimeout(200);

    expect(warnings.filter((text) => text.includes('Two different copies'))).toHaveLength(1);
  });

  test(`${target.name}: a duplicate is a warning, not a crash, so the editor still types`, async ({
    page,
  }) => {
    await poisonBeforeLoad(page, 'prosemirror-model', 'some-other-library');
    await openDemo(page, target);

    /* Deliberate: two copies only break once an object crosses between them,
       and an app running isolated editors in separate bundles is not wrong
       yet. Collaboration raises the same conflict to an error, because there
       it is fatal from the first document. */
    const editor = page.locator('.ProseMirror').first();
    await editor.click();
    await page.keyboard.type('still alive');
    await expect(editor).toContainText('still alive');
  });

  test(`${target.name}: the registry survives the editor it was registered by`, async ({
    page,
  }) => {
    await openDemo(page, target);
    await page.evaluate(() => {
      const editor = (window as unknown as Record<string, { destroy?: () => void }>)[
        '__DEMO_EDITOR__'
      ];
      editor?.destroy?.();
    });

    // Which copies a page loaded is a fact about the page, not about any one
    // editor, so tearing an editor down must not reset it.
    const registry = await readRegistry(page);
    expect(registry.consumers['prosemirror-model']).toBe('@domternal/core');
  });

  test(`${target.name}: extension-table registers prosemirror-tables, which core cannot`, async ({
    page,
  }) => {
    await openDemo(page, target);
    // Core never imports prosemirror-tables, so nothing in core can register
    // it. Without the extension doing it, the module the table commands
    // compare with `instanceof CellSelection` would go unwatched entirely.
    const registry = await readRegistry(page);
    expect(registry.consumers['prosemirror-tables']).toBe('@domternal/extension-table');
  });

  test(`${target.name}: several split modules are each reported, none swallowed`, async ({
    page,
  }) => {
    const warnings = collectWarnings(page);
    await poisonBeforeLoad(page, 'prosemirror-model', 'lib-a');
    await poisonBeforeLoad(page, 'prosemirror-state', 'lib-b');
    await openDemo(page, target);

    const conflicts = warnings.filter((text) => text.includes('Two different copies'));
    // Once per module, not once in total: a reader fixing one duplicate must
    // still be told about the other.
    expect(conflicts).toHaveLength(2);
    expect(conflicts.some((text) => text.includes('"prosemirror-model"'))).toBe(true);
    expect(conflicts.some((text) => text.includes('"prosemirror-state"'))).toBe(true);
  });

  test(`${target.name}: a foreign value on the shared symbol does not break the editor`, async ({
    page,
  }) => {
    /* `Symbol.for` is a shared global namespace, so an unrelated library, or a
       future version of this registry with a different shape, can already own
       the slot. Reading it as a Map would throw from inside `new Editor(...)`
       and break the editor over a diagnostic, which is worse than the problem
       being diagnosed. */
    await page.addInitScript((key) => {
      (globalThis as Record<symbol, unknown>)[Symbol.for(key)] = 'not a map at all';
    }, REGISTRY_KEY);
    await openDemo(page, target);

    const editor = page.locator('.ProseMirror').first();
    await editor.click();
    await page.keyboard.type('unbroken');
    await expect(editor).toContainText('unbroken');
    // And the registry recovered rather than staying poisoned.
    const registry = await readRegistry(page);
    expect(registry.present).toBe(true);
    expect(registry.consumers['prosemirror-model']).toBe('@domternal/core');
  });

  test(`${target.name}: a rebuilt editor re-registers the same copies, silently`, async ({
    page,
  }) => {
    const warnings = collectWarnings(page);
    await openDemo(page, target);
    // Switching modes tears the editor down and builds another. An app that
    // mounts editors in a list does this constantly, so re-registering the
    // same copy must stay silent forever rather than only the first time.
    await page.click(target.notionToggle);
    await page.waitForSelector(target.editorSelector);
    await page.waitForTimeout(200);

    expect(warnings.filter((text) => text.includes('Two different copies'))).toHaveLength(0);
    const registry = await readRegistry(page);
    expect(registry.consumers['prosemirror-model']).toBe('@domternal/core');
  });
}
