/**
 * Emoticon input-rule behavior across all four demos.
 *
 * Regression coverage for a reported bug: typing several emoticons in a row
 * (e.g. "xD xD", ":) :)") left every other emoticon un-converted as literal
 * text, producing an alternating "emoji, raw emoticon, emoji, raw emoticon"
 * result.
 *
 * Two coupled defects caused it (both fixed in packages/extension-emoji):
 *
 *   1. The emoticon rule swallowed the space that triggered it. handleTextInput
 *      returning a transaction suppresses the default space insertion and the
 *      rule replaced only the emoticon glyphs, so "xD " became an emoji glued
 *      to the cursor with no trailing space.
 *
 *   2. The emoticon pattern only allowed start-of-text or whitespace before the
 *      emoticon. In the input-rule textBefore an atom node (emoji/mention/
 *      image/inline-math) is the object-replacement char, which is neither, so
 *      an emoticon typed immediately after an atom never converted.
 *
 * (1) glued the next emoticon to the emoji atom and (2) then blocked it. The
 * fix keeps the trailing space and lets an atom act as a leading boundary.
 *
 * The controls at the end pin behavior that must NOT change (no trailing space
 * -> no conversion, mid-word -> no conversion, code block -> no conversion,
 * shortcodes unaffected).
 */
import { test } from './fixtures.js';
import { expect, type Page } from '@playwright/test';
import { demoTargets, type DemoTarget } from './targets.js';

async function goNotion(page: Page, target: DemoTarget): Promise<void> {
  await page.goto(target.baseURL + '/');
  await page.waitForSelector(target.notionToggle);
  await page.click(target.notionToggle);
  await page.waitForSelector(target.editorSelector);
  await page.waitForFunction(
    () => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']),
    { timeout: 3000 },
  );
}

async function setContent(page: Page, html: string): Promise<void> {
  await page.evaluate((h) => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { setContent: (h: string, emit: boolean) => void; commands: { focus: (pos?: string) => void } }
      | undefined;
    ed?.setContent(h, false);
    ed?.commands.focus('end');
  }, html);
  await page.waitForTimeout(120);
}

async function focusEnd(page: Page): Promise<void> {
  await page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { commands: { focus: (pos?: string) => void } }
      | undefined;
    ed?.commands.focus('end');
  });
}

/** Reset to an empty paragraph, then type char-by-char so each keystroke fires its own input event. */
async function typeFresh(page: Page, target: DemoTarget, text: string): Promise<void> {
  await setContent(page, '<p></p>');
  await page.click(target.editorSelector);
  await focusEnd(page);
  await page.keyboard.type(text, { delay: 25 });
  await page.waitForTimeout(200);
}

/** Flatten the first paragraph into a token stream of emoji names and raw text runs. */
async function firstParaTokens(page: Page): Promise<{ type: string; value: string }[]> {
  return page.evaluate(() => {
    const ed = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as
      | { getJSON: () => { content?: { type: string; content?: Record<string, unknown>[] }[] } }
      | undefined;
    const json = ed?.getJSON();
    const para = json?.content?.find((n) => n.type === 'paragraph');
    return (para?.content ?? []).map((n) => {
      const node = n as { type: string; text?: string; attrs?: { name?: string } };
      if (node.type === 'emoji') return { type: 'emoji', value: node.attrs?.name ?? '' };
      if (node.type === 'text') return { type: 'text', value: node.text ?? '' };
      return { type: node.type, value: '' };
    });
  });
}

function emojiSel(target: DemoTarget): string {
  return `${target.editorSelector} span[data-type="emoji"]`;
}

async function firstParaText(page: Page, target: DemoTarget): Promise<string> {
  return (await page.locator(`${target.editorSelector} p`).first().textContent()) ?? '';
}

for (const target of demoTargets) {
  test.describe(`${target.name} - emoji emoticons`, () => {
    test.beforeEach(async ({ page }) => {
      await goNotion(page, target);
    });

    // ── The fix: sequences and trailing space ────────────────────────────────

    test('a lone emoticon converts and keeps its trailing space', async ({ page }) => {
      await typeFresh(page, target, 'xD ');
      await expect(page.locator(emojiSel(target))).toHaveCount(1);
      await expect(page.locator(emojiSel(target)).first()).toHaveAttribute(
        'data-name',
        'face_with_tears_of_joy',
      );
      const tokens = await firstParaTokens(page);
      expect(tokens.map((t) => t.type)).toEqual(['emoji', 'text']);
      expect(tokens[1]?.value).toBe(' ');
    });

    test('two emoticons in a row both convert', async ({ page }) => {
      await typeFresh(page, target, 'xD xD ');
      await expect(page.locator(emojiSel(target))).toHaveCount(2);
      expect(await firstParaText(page, target)).not.toContain('xD');
    });

    test('three emoticons in a row all convert', async ({ page }) => {
      await typeFresh(page, target, ':) :) :) ');
      await expect(page.locator(emojiSel(target))).toHaveCount(3);
      expect(await firstParaText(page, target)).not.toContain(':)');
    });

    test('a mixed run converts every emoticon and leaves non-emoticon words alone', async ({ page }) => {
      await typeFresh(page, target, 'xD xD lol :) ');
      // xD, xD, :) convert; "lol" is not an emoticon and stays as text.
      await expect(page.locator(emojiSel(target))).toHaveCount(3);
      const text = await firstParaText(page, target);
      expect(text).toContain('lol');
      expect(text).not.toContain('xD');
      expect(text).not.toContain(':)');
    });

    test('an emoticon typed right after an emoji atom converts', async ({ page }) => {
      // Emoji atom set via HTML, cursor placed directly after it (no space).
      await setContent(page, '<p><span data-type="emoji" data-name="red_heart">❤️</span></p>');
      await page.click(target.editorSelector);
      await focusEnd(page);
      await page.keyboard.type('xD ', { delay: 25 });
      await page.waitForTimeout(200);

      await expect(page.locator(emojiSel(target))).toHaveCount(2);
      await expect(page.locator(emojiSel(target)).nth(0)).toHaveAttribute('data-name', 'red_heart');
      await expect(page.locator(emojiSel(target)).nth(1)).toHaveAttribute(
        'data-name',
        'face_with_tears_of_joy',
      );
      expect(await firstParaText(page, target)).not.toContain('xD');
    });

    test('multi-character emoticons convert', async ({ page }) => {
      const cases: [string, string][] = [
        ['>:( ', 'angry_face'],
        [":'( ", 'crying_face'],
        [':-) ', 'slightly_smiling_face'],
      ];
      for (const [typed, name] of cases) {
        await typeFresh(page, target, typed);
        await expect(page.locator(emojiSel(target))).toHaveCount(1);
        await expect(page.locator(emojiSel(target)).first()).toHaveAttribute('data-name', name);
      }
    });

    test('emoticon after text and a space converts', async ({ page }) => {
      await typeFresh(page, target, 'hi :) ');
      await expect(page.locator(emojiSel(target))).toHaveCount(1);
      const text = await firstParaText(page, target);
      expect(text).toContain('hi');
      expect(text).not.toContain(':)');
    });

    test('Backspace right after conversion restores the typed emoticon', async ({ page }) => {
      await typeFresh(page, target, 'xD ');
      await expect(page.locator(emojiSel(target))).toHaveCount(1);
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(150);
      await expect(page.locator(emojiSel(target))).toHaveCount(0);
      expect(await firstParaText(page, target)).toContain('xD');
    });

    // ── Controls: behavior that must NOT change ──────────────────────────────

    test('an emoticon without a trailing space does not convert', async ({ page }) => {
      await typeFresh(page, target, ':)');
      await expect(page.locator(emojiSel(target))).toHaveCount(0);
      expect(await firstParaText(page, target)).toContain(':)');
    });

    test('an emoticon glued to a letter (mid-word) does not convert', async ({ page }) => {
      await typeFresh(page, target, 'haxD ');
      await expect(page.locator(emojiSel(target))).toHaveCount(0);
      expect(await firstParaText(page, target)).toContain('xD');
    });

    test('an emoticon inside a code block stays literal', async ({ page }) => {
      await setContent(page, '<pre><code>x</code></pre>');
      await page.locator(`${target.editorSelector} pre code`).click();
      await page.keyboard.press('End');
      await page.keyboard.type(':) ', { delay: 25 });
      await page.waitForTimeout(200);
      await expect(page.locator(emojiSel(target))).toHaveCount(0);
      expect(await page.locator(`${target.editorSelector} pre code`).textContent()).toContain(':)');
    });

    test('two shortcodes in a row still both convert (no regression)', async ({ page }) => {
      await typeFresh(page, target, ':wave: :wave: ');
      await expect(page.locator(emojiSel(target))).toHaveCount(2);
    });
  });
}
