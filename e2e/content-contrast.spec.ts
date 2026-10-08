/**
 * Every wrapper marks kept backgrounds with their tone in the view, editable or read-only, and the
 * theme draws text without a color of its own on them readable in light and dark: a Word yellow
 * highlight, Word's light gray and dark blue cell shading. getHTML never carries the tone. The full
 * three-engine matrix is e2e/content-contrast.browser.ts in the paste cleanup suite.
 */
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures.js';
import { demoTargets } from './targets.js';

interface DemoEditor {
  setContent: (content: string, emit: boolean) => void;
  setEditable: (editable: boolean) => unknown;
  getHTML: () => string;
  view: { dom: HTMLElement };
}

const HTML = '<p><span style="background-color: yellow">yellow</span> <span style="background-color: #000080">navy</span></p>'
  + '<table><tbody><tr><td data-background="#D9D9D9"><p>gray</p></td><td data-background="#002060"><p>blue</p></td></tr></tbody></table>';

async function load(page: Page, baseURL: string): Promise<void> {
  await page.goto(baseURL);
  await page.waitForFunction(() => Boolean((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__']));
  await page.evaluate((html) => {
    const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as DemoEditor;
    editor.setContent(html, false);
  }, HTML);
}

/** The tone of each probe and its WCAG 2 contrast against the background it sits on. */
function readings(page: Page): Promise<Record<string, [string | null, number]>> {
  return page.evaluate(() => {
    const parse = (value: string): number[] => (/rgba?\(([^)]+)\)/.exec(value)?.[1] ?? '0,0,0,0').split(/[\s,/]+/).filter(Boolean).map(Number);
    const luminance = (rgb: number[]): number => {
      const linear = (channel: number): number => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * linear(rgb[0] ?? 0) + 0.7152 * linear(rgb[1] ?? 0) + 0.0722 * linear(rgb[2] ?? 0);
    };
    const result: Record<string, [string | null, number]> = {};
    const editor = (window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as DemoEditor;
    for (const element of editor.view.dom.querySelectorAll('[data-dm-tone]')) {
      let background = parse(getComputedStyle(element).backgroundColor);
      for (let at = element.parentElement; at && (background[3] ?? 1) === 0; at = at.parentElement) background = parse(getComputedStyle(at).backgroundColor);
      const [a, b] = [luminance(parse(getComputedStyle(element).color)), luminance(background)];
      result[element.textContent.trim()] = [element.getAttribute('data-dm-tone'), Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100];
    }
    return result;
  });
}

for (const target of demoTargets) {
  test(`${target.name}: kept highlights and cell shading are toned in the view and readable in light and dark`, async ({ page }) => {
    await load(page, target.baseURL);
    const light = await readings(page);
    expect(Object.fromEntries(Object.entries(light).map(([text, [tone]]) => [text, tone]))).toEqual({ yellow: 'light', navy: 'dark', gray: 'light', blue: 'dark' });
    for (const [, ratio] of Object.values(light)) expect(ratio).toBeGreaterThanOrEqual(4.5);
    await page.evaluate(() => {
      document.body.classList.add('dm-theme-dark');
      document.querySelectorAll('.dm-editor').forEach((element) => { element.classList.add('dm-theme-dark'); });
    });
    // Past the theme toggle's transition.
    await page.waitForTimeout(300);
    const dark = await readings(page);
    for (const [, ratio] of Object.values(dark)) expect(ratio).toBeGreaterThanOrEqual(4.5);
    const html = await page.evaluate(() => ((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as DemoEditor).getHTML());
    expect(html).not.toContain('data-dm-tone');
  });

  test(`${target.name}: a read-only editor keeps the tones`, async ({ page }) => {
    await load(page, target.baseURL);
    await page.evaluate(() => { ((window as unknown as Record<string, unknown>)['__DEMO_EDITOR__'] as DemoEditor).setEditable(false); });
    await expect(page.locator('.dm-editor .ProseMirror[contenteditable="false"]').first()).toBeAttached();
    expect(Object.keys(await readings(page)).sort()).toEqual(['blue', 'gray', 'navy', 'yellow']);
  });
}
