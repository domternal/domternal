/** Office fixture replays in the demos, including authored English variants; no operating-system clipboard automation. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { Editor, JSONContent } from '@domternal/core';
import type { SemanticExpected } from './native-office-capture/offline.mjs';
import { test } from './fixtures.js';
import { demoTargets, type DemoTarget } from './targets.js';

type Item = { kind: 'string'; type: string; value: string }
  | { kind: 'file'; name: string; type: string; lastModified: number; base64: string };
interface Fixture { id: string; expected: SemanticExpected; items: Item[] }
interface DemoWindow { __DEMO_EDITOR__: Editor; __MULTI_EDITORS__?: Editor[] }
type Mode = 'classic' | 'notion';

const scenarios = [
  'word-default-bullets', 'word-default-numbering', 'word-headings-styles', 'word-alignment-spacing',
  'word-hidden-text', 'word-indentation-loss', 'gdocs-plain-paragraph', 'gdocs-headings-plain',
  'gdocs-default-numbering', 'gdocs-other-list-profiles', 'gdocs-table-text', 'gdocs-links', 'gdocs-croatian-text',
];

function readFixture(scenario: string): Fixture {
  const directory = join(__dirname, 'native-office-capture', 'fixtures', `${scenario}-chrome`);
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as {
    id: string; capture: { path: string }; expected: SemanticExpected;
  };
  const capture = JSON.parse(readFileSync(join(directory, manifest.capture.path), 'utf8')) as { payload: {
    text: Record<string, string>;
    items: { itemIndex: number; kind: string; type: string; file: { name: string; type: string; lastModified: number } | null }[];
    files: { itemIndex: number; base64: string }[];
  } };
  const items = capture.payload.items.flatMap((item): Item[] => {
    if (item.kind === 'string') {
      const value = capture.payload.text[item.type];
      // Private clipboard formats whose bytes were not captured cannot be replayed.
      return value === undefined ? [] : [{ kind: 'string', type: item.type, value }];
    }
    const file = capture.payload.files.find(file => file.itemIndex === item.itemIndex);
    if (item.file === null || file === undefined) throw new Error(`${manifest.id}: missing file ${String(item.itemIndex)}`);
    return [{ kind: 'file', ...item.file, base64: file.base64 }];
  });
  return { id: manifest.id, expected: manifest.expected, items };
}

const captures = scenarios.map(readFixture);
const warningMessages: Readonly<Record<string, string>> = {
  'hidden-text-removed': 'Hidden text from Word was not pasted.',
  'unsupported-formatting': 'Some formatting could not be preserved.',
};

async function open(page: Page, target: DemoTarget, mode: Mode, disabled = false): Promise<void> {
  await page.goto(`${target.baseURL}/${disabled ? '?paste-cleanup=off' : ''}`);
  if (mode === 'notion') {
    await page.locator(target.notionToggle).click();
    await page.locator(target.editorSelector).waitFor();
  }
  await page.waitForFunction(() => Boolean((window as unknown as Partial<DemoWindow>).__DEMO_EDITOR__));
}

async function seed(page: Page): Promise<JSONContent> {
  return page.evaluate(() => {
    const editor = (window as unknown as DemoWindow).__DEMO_EDITOR__;
    editor.setContent('<p></p>', false);
    editor.commands.focus('end');
    return editor.getJSON();
  });
}

async function paste(page: Page, items: Item[]): Promise<void> {
  const transfer = await page.evaluate(entries => {
    const data = new DataTransfer();
    for (const item of entries) {
      if (item.kind === 'string') data.setData(item.type, item.value);
      else data.items.add(new File([Uint8Array.from(atob(item.base64), character => character.charCodeAt(0))], item.name,
        { type: item.type, lastModified: item.lastModified }));
    }
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    if (event.clipboardData !== data) Object.defineProperty(event, 'clipboardData', { value: data });
    (window as unknown as DemoWindow).__DEMO_EDITOR__.view.dom.dispatchEvent(event);
    return { types: [...data.types], files: data.files.length };
  }, items);
  expect(transfer.files).toBe(items.filter(item => item.kind === 'file').length);
  for (const item of items) if (item.kind === 'string') expect(transfer.types).toContain(item.type);
  await page.evaluate(() => new Promise(resolve => { requestAnimationFrame(() => { requestAnimationFrame(resolve); }); }));
}

async function documentJSON(page: Page): Promise<JSONContent> {
  return page.evaluate(() => (window as unknown as DemoWindow).__DEMO_EDITOR__.getJSON());
}

async function checkCapture(page: Page, fixture: Fixture): Promise<void> {
  const [{ blocksFromEditorJSON, compareBlocks }, { semanticSpecification, editorOutcomes }] = await Promise.all([
    import('./native-office-capture/semantics.mjs'), import('./native-office-capture/offline.mjs'),
  ]);
  const result = await page.evaluate(() => {
    const editor = (window as unknown as DemoWindow).__DEMO_EDITOR__;
    return { doc: editor.getJSON(), destination: {
      marks: Object.keys(editor.schema.marks), textStyle: Object.keys(editor.schema.marks['textStyle']?.spec.attrs ?? {}),
    } };
  });
  expect(compareBlocks(semanticSpecification(fixture.expected), fixture.expected.scenario, blocksFromEditorJSON(result.doc),
    { formatting: 'preserve', destination: result.destination })).toEqual([]);
  // Classic and Notion demos include Subscript, Superscript and LineHeight.
  const outcomes = editorOutcomes(fixture.expected.preserve);
  const outcome = outcomes.find(outcome => outcome.schema === 'capability-full') ?? outcomes.find(outcome => outcome.schema === 'default');
  expect(outcome, 'Reviewed demo-schema outcome').toBeDefined();
  const details = (outcome?.warnings ?? []).map(code => {
    const message = warningMessages[code];
    if (message === undefined) throw new Error(`Add the reviewed notice copy for ${code}`);
    return message;
  });
  expect((await page.locator('.dm-paste-feedback li').allTextContents()).sort()).toEqual(details.sort());
  // Chrome's picture of a Word selection is an alternate flavor, not an extra image to insert.
  await expect(page.locator('.ProseMirror img')).toHaveCount(fixture.expected.blocks.filter(block => block.type === 'image').length);
  // Successful Office cleanup is quiet unless there is something the user needs to review.
  if (outcome?.notice === 'visible') {
    await expect(page.locator('.dm-paste-feedback')).toBeVisible();
    await expect(page.locator('.dm-paste-feedback__status')).toHaveText('Review the pasted content.');
  } else await expect(page.locator('.dm-paste-feedback')).toBeHidden();
}

for (const target of demoTargets) {
  test.describe(`${target.name}: Office paste in demos`, () => {
    for (const mode of ['classic', 'notion'] as const) {
      for (const fixture of captures) {
        test(`${mode}: ${fixture.id} preserves its reviewed content and one Undo restores the document`, async ({ page }) => {
          await open(page, target, mode);
          const before = await seed(page);
          await paste(page, fixture.items);
          await checkCapture(page, fixture);
          if (mode === 'notion' && fixture.id === 'gdocs-other-list-profiles-chrome') {
            await expect(page.locator('.ProseMirror ul[data-type="taskList"]')).toHaveCount(1);
            await expect(page.locator('.ProseMirror li[data-type="taskItem"][data-checked="true"]')).toHaveCount(1);
            await expect(page.locator('.ProseMirror li[data-type="taskItem"][data-checked="false"]')).toHaveCount(1);
          }
          expect(await page.evaluate(() => (window as unknown as DemoWindow).__DEMO_EDITOR__.commands.undo())).toBe(true);
          expect(await documentJSON(page)).toEqual(before);
        });
      }

      test(`${mode}: loads Office cleanup and can disable it for core paste`, async ({ page }) => {
        const fixture = captures.find(fixture => fixture.id === 'word-default-bullets-chrome');
        if (fixture === undefined) throw new Error('Missing Word bullets fixture');
        await open(page, target, mode);
        await seed(page);
        await paste(page, fixture.items);
        expect(await page.evaluate(() => (window as unknown as DemoWindow).__DEMO_EDITOR__.extensionManager.extensions
          .some(extension => extension.name === 'pasteCleanup'))).toBe(true);
        await expect(page.locator('.ProseMirror ul').first()).toBeVisible();
        await open(page, target, mode, true);
        await seed(page);
        await paste(page, fixture.items);
        expect(await page.evaluate(() => (window as unknown as DemoWindow).__DEMO_EDITOR__.extensionManager.extensions
          .some(extension => extension.name === 'pasteCleanup'))).toBe(false);
        await expect(page.locator('.ProseMirror ul')).toHaveCount(0);
        await expect(page.locator('.ProseMirror')).toContainText('L02 Prva razina');
        await expect(page.locator('.dm-paste-feedback')).toHaveCount(0);
      });

      test(`${mode}: a visible notice follows the runtime language without changing content`, async ({ page }) => {
        const fixture = captures.find(fixture => fixture.id === 'word-hidden-text-chrome');
        if (fixture === undefined) throw new Error('Missing hidden-text fixture');
        await open(page, target, mode);
        await seed(page);
        await paste(page, fixture.items);
        const before = await documentJSON(page);
        await expect(page.locator('.dm-paste-feedback__status')).toHaveText('Review the pasted content.');
        await page.getByTestId('demo-language').selectOption('de');
        await expect(page.locator('.dm-paste-feedback__status')).toHaveText('Eingefügten Inhalt prüfen.');
        expect(await documentJSON(page)).toEqual(before);
        await page.getByTestId('demo-language').selectOption('en');
        await expect(page.locator('.dm-paste-feedback__status')).toHaveText('Review the pasted content.');
      });
    }

    test('multiple editors: cleanup, feedback, language and Undo stay with the receiving editor', async ({ page }) => {
      const fixture = captures.find(fixture => fixture.id === 'word-hidden-text-chrome');
      if (fixture === undefined) throw new Error('Missing hidden-text fixture');
      await open(page, target, 'classic');
      await page.getByRole('button', { name: 'Multiple editors', exact: true }).click();
      await page.waitForFunction(() => ((window as unknown as DemoWindow).__MULTI_EDITORS__?.length ?? 0) > 1);
      const others = await page.evaluate(() => (window as unknown as DemoWindow).__MULTI_EDITORS__?.slice(1).map(editor => editor.getJSON()));
      const before = await seed(page);
      await paste(page, fixture.items);
      await expect(page.locator('.dm-paste-feedback:visible')).toHaveCount(1);
      await expect(page.locator('.multi-editor-panel').first().locator('.dm-paste-feedback')).toBeVisible();
      await page.getByTestId('demo-language').selectOption('de');
      await expect(page.locator('.dm-paste-feedback:visible .dm-paste-feedback__status')).toHaveText('Eingefügten Inhalt prüfen.');
      expect(await page.evaluate(() => (window as unknown as DemoWindow).__DEMO_EDITOR__.commands.undo())).toBe(true);
      expect(await documentJSON(page)).toEqual(before);
      expect(await page.evaluate(() => (window as unknown as DemoWindow).__MULTI_EDITORS__?.slice(1).map(editor => editor.getJSON()))).toEqual(others);
      await open(page, target, 'classic', true);
      await page.getByRole('button', { name: 'Multiple editors', exact: true }).click();
      await page.waitForFunction(() => ((window as unknown as DemoWindow).__MULTI_EDITORS__?.length ?? 0) > 1);
      expect(await page.evaluate(() => (window as unknown as DemoWindow).__MULTI_EDITORS__?.every(editor =>
        editor.extensionManager.extensions.every(extension => extension.name !== 'pasteCleanup')))).toBe(true);
    });
  });
}
