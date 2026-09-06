/**
 * Link and URL security in Chromium, Firefox and WebKit, against the public
 * core build (e2e/link-security.config.ts).
 */
import { expect, type Page } from '@playwright/test';
import type { UrlCheck, UrlPolicyOptions } from '@domternal/core';
import { test } from './fixtures.js';
import { checkUrl } from '../packages/core/src/helpers/checkUrl.js';
import {
  ABSOLUTE_LINK_PROFILE,
  LINK_PROFILE,
  URL_CORPUS,
  fuzzUrls,
  imageProfile,
  type UrlStatus,
} from '../packages/core/src/helpers/urlPolicy.corpus.js';

const BASE_URL = 'http://127.0.0.1:5896';

interface Resolution {
  href: string;
  protocol: string;
  origin: string | null;
  username: string;
  password: string;
  parsed: string | null;
}
interface FixtureWindow {
  __linkSecurity: {
    ready: boolean;
    checkUrl: (value: unknown, options?: UrlPolicyOptions) => UrlCheck;
    resolve: (value: string) => Resolution;
  };
}

async function open(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/`);
  await page.waitForFunction(() => (window as unknown as Partial<FixtureWindow>).__linkSecurity?.ready);
  await page.evaluate(decodeScript);
}

interface Decoding { __decode: (item: Encoded) => unknown }

/** Values Playwright can hand to the page: every corpus value except objects that carry functions. */
const serializable = (value: unknown): boolean =>
  typeof value !== 'object' || value === null || Object.values(value).every(item => typeof item !== 'function');

/**
 * Strings cross into the page as UTF-16 code units, so an unpaired surrogate
 * arrives as written instead of as a replacement character.
 */
type Encoded = { codes: number[] } | { raw: unknown };
const encode = (value: unknown): Encoded => typeof value === 'string'
  ? { codes: Array.from({ length: value.length }, (_, index) => value.charCodeAt(index)) }
  : { raw: value };
const decodeScript = 'globalThis.__decode = item => "codes" in item ? String.fromCharCode(...item.codes) : item.raw;';

const PROFILES: Record<string, UrlPolicyOptions> = {
  link: LINK_PROFILE,
  absolute: ABSOLUTE_LINK_PROFILE,
  imageWithData: imageProfile(true),
  imageWithoutData: imageProfile(false),
};

test.describe('the URL policy in the browser', () => {
  test('judges the shared corpus as the unit tests do in Node', async ({ page }) => {
    await open(page);
    const rows = URL_CORPUS.filter(row => serializable(row.value));
    const results = await page.evaluate(({ values, profiles }) => values.map(item => Object.fromEntries(
      // An allowed spelling never holds an unpaired surrogate, so it returns intact.
      Object.entries(profiles).map(([name, options]) => [
        name, (window as unknown as FixtureWindow).__linkSecurity.checkUrl((globalThis as unknown as Decoding).__decode(item), options),
      ]),
    )), { values: rows.map(row => encode(row.value)), profiles: PROFILES });
    rows.forEach((row, index) => {
      const expected: Record<string, UrlStatus> = {
        link: row.link,
        absolute: row.absolute ?? row.link,
        imageWithData: row.image[0],
        imageWithoutData: row.image[1],
      };
      for (const [name, status] of Object.entries(expected)) {
        const check = results[index]?.[name];
        expect(check?.status, `${row.id} ${JSON.stringify(row.value)} ${name}`).toBe(status);
        if (check?.status === 'allowed') expect(check.url, `${row.id} ${JSON.stringify(row.value)} ${name}`).toBe(row.url ?? row.value);
      }
    });
  });

  test('allows only addresses the browser reads as the cleaned spelling with an allowed scheme', async ({ page }) => {
    await open(page);
    const values = [...fuzzUrls(20260929, 3000), ...URL_CORPUS.map(row => row.value).filter((value): value is string => typeof value === 'string')];
    const problems = await page.evaluate(({ encoded, link, images }) => {
      const probe = (window as unknown as FixtureWindow).__linkSecurity;
      const found: string[] = [];
      const origin = location.origin;
      for (const value of encoded.map(item => (globalThis as unknown as Decoding).__decode(item) as string)) {
        const raw = probe.resolve(value);
        const check = probe.checkUrl(value, link);
        // Sinks render and open the cleaned spelling, so it must read as an allowed address. Where the
        // browser also reads the stored spelling, cleaning must not change its scheme or origin.
        // (Firefox keeps a trailing control in a fragment and rejects a line break inside a scheme.)
        if (check.status === 'allowed') {
          const cleaned = probe.resolve(check.url);
          if (cleaned.parsed === null) found.push(`link unreadable: ${JSON.stringify(value)}`);
          if (!['http:', 'https:', 'mailto:', 'tel:'].includes(cleaned.protocol)) found.push(`link scheme ${cleaned.protocol}: ${JSON.stringify(value)}`);
          if (cleaned.username !== '' || cleaned.password !== '') found.push(`link credentials: ${JSON.stringify(value)}`);
          if (!/^[a-z][a-z0-9+.-]*:/i.test(check.url) && cleaned.origin !== origin) found.push(`relative link leaves the page origin: ${JSON.stringify(value)}`);
          if (raw.parsed !== null && (raw.protocol !== cleaned.protocol || raw.origin !== cleaned.origin)) found.push(`link reads differently: ${JSON.stringify(value)}`);
        }
        for (const [allowData, options] of images) {
          const image = probe.checkUrl(value, options);
          if (image.status !== 'allowed') continue;
          const cleaned = probe.resolve(image.url);
          if (['javascript:', 'vbscript:', 'file:'].includes(cleaned.protocol)) found.push(`image scheme ${cleaned.protocol}: ${JSON.stringify(value)}`);
          if (cleaned.protocol === 'data:' && (!allowData || !/^data:\s*image\//i.test(cleaned.href))) found.push(`image data: ${JSON.stringify(value)}`);
          if (raw.parsed !== null && raw.protocol !== cleaned.protocol) found.push(`image reads differently: ${JSON.stringify(value)}`);
        }
      }
      return found;
    }, { encoded: values.map(encode), link: LINK_PROFILE, images: [[true, imageProfile(true)], [false, imageProfile(false)]] as [boolean, UrlPolicyOptions][] });
    expect(problems).toEqual([]);
  });

  test('refuses as unsafe every spelling the browser reads as a script address', async ({ page }) => {
    await open(page);
    const values = [...URL_CORPUS.filter(row => row.script).map(row => row.value as string), ...fuzzUrls(7, 3000)];
    const found = await page.evaluate(({ encoded, profiles }) => {
      const probe = (window as unknown as FixtureWindow).__linkSecurity;
      const values = encoded.map(item => (globalThis as unknown as Decoding).__decode(item) as string);
      const script = values.filter(value => ['javascript:', 'vbscript:'].includes(probe.resolve(value).protocol)
        || /^data:\s*text\/html/i.test(probe.resolve(value).href));
      return {
        script: script.length,
        notUnsafe: script.filter(value => profiles.some(options => probe.checkUrl(value, options).status !== 'unsafe')),
      };
    }, { encoded: values.map(encode), profiles: Object.values(PROFILES) });
    // The corpus rows alone give ten script spellings; the check is not met vacuously.
    expect(found.script).toBeGreaterThanOrEqual(10);
    expect(found.notUnsafe).toEqual([]);
  });

  test('decides every fuzzed value as Node does, whatever the engine\'s URL parser tolerates', async ({ page }) => {
    await open(page);
    const values = [...fuzzUrls(424242, 4000), ...URL_CORPUS.map(row => row.value).filter((value): value is string => typeof value === 'string')];
    const browser = await page.evaluate(({ encoded, profiles }) => encoded.map(item => {
      const value = (globalThis as unknown as Decoding).__decode(item);
      return profiles.map(options => (window as unknown as FixtureWindow).__linkSecurity.checkUrl(value, options).status);
    }), { encoded: values.map(encode), profiles: Object.values(PROFILES) });
    const differences = values.flatMap((value, index) => {
      const node = Object.values(PROFILES).map(options => checkUrl(value, options).status);
      return node.join() === browser[index]?.join() ? [] : [`${JSON.stringify(value)} node ${node.join()} browser ${String(browser[index]?.join())}`];
    });
    expect(differences).toEqual([]);
  });
});

/** A payload that marks the page it runs in, and alerts, if it ever runs. */
const FLAG = 'void((window.opener||window).__pwned=document.domain,alert(1))';
const UNSAFE_HREFS: unknown[] = [
  `javascript:${FLAG}`,
  `JaVaScRiPt:${FLAG}`,
  ` javascript:${FLAG}`,
  `\u0001javascript:${FLAG}`,
  `java\tscr\nipt:${FLAG}`,
  `java\rscript:${FLAG}`,
  'javascript://%0aalert(1)',
  'vbscript:msgbox(1)',
  'data:text/html,<script>alert(1)</script>',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  [`javascript:${FLAG}`],
  [[`javascript:${FLAG}`]],
  42,
  { href: `javascript:${FLAG}` },
];
const LANDING = 'https://landing.test/';

type Json = Record<string, unknown>;
const text = (value: string, marks: Json[] = []): Json => ({ type: 'text', text: value, ...(marks.length > 0 && { marks }) });
const linkMark = (href: unknown, attrs: Json = {}): Json => ({ type: 'link', attrs: { href, ...attrs } });
const paragraph = (...content: Json[]): Json => ({ type: 'paragraph', content });
const docOf = (...content: Json[]): Json => ({ type: 'doc', content });

/** Where a link sits: each layout has one clicked link, `#target`, marked by the text CLICK. */
const LAYOUTS: Record<string, (href: unknown) => Json> = {
  'block start': href => docOf(paragraph(text('CLICK', [linkMark(href)]), text(' tail'))),
  'after text': href => docOf(paragraph(text('before '), text('CLICK', [linkMark(href)]))),
  'after bold': href => docOf(paragraph(text('bold', [{ type: 'bold' }]), text('CLICK', [linkMark(href)]))),
  'after a hard break': href => docOf(paragraph(text('line'), { type: 'hardBreak' }, text('CLICK', [linkMark(href)]))),
  'bold inside the link': href => docOf(paragraph(text('CLICK', [linkMark(href), { type: 'bold' }]))),
  'after another link': href => docOf(paragraph(text('safe', [linkMark(`${LANDING}safe`)]), text('CLICK', [linkMark(href)]))),
  heading: href => docOf({ type: 'heading', attrs: { level: 2 }, content: [text('CLICK', [linkMark(href)])] }),
  'list item': href => docOf({ type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text('CLICK', [linkMark(href)]))] }] }),
  blockquote: href => docOf({ type: 'blockquote', content: [paragraph(text('CLICK', [linkMark(href)]))] }),
  'table cell': href => docOf({ type: 'table', content: [{ type: 'tableRow', content: [
    { type: 'tableCell', content: [paragraph(text('CLICK', [linkMark(href)]))] },
    { type: 'tableCell', content: [paragraph(text('other'))] },
  ] }] }),
};

interface EditorWindow {
  __linkSecurity: FixtureWindow['__linkSecurity'] & {
    create: (options: Json) => string;
    opens: () => string[][];
    getHTML: () => string;
    getJSON: () => unknown;
    generateHTML: (content: unknown, options?: Json) => string;
  };
  __pwned?: string;
}

async function setup(page: Page, options: Json): Promise<void> {
  await page.evaluate(options => (window as unknown as EditorWindow).__linkSecurity.create(options), options);
}

/** Resolves when the context opens a page, or with null after `timeout`. */
const nextPopup = (page: Page, timeout = 3000): Promise<Page | null> =>
  page.context().waitForEvent('page', { timeout }).catch(() => null);

async function opens(page: Page): Promise<string[][]> {
  return page.evaluate(() => (window as unknown as EditorWindow).__linkSecurity.opens());
}

/** Nothing ran: no dialog, no flag in the page and no navigation away. */
async function expectNothingRan(page: Page, dialogs: string[]): Promise<void> {
  await page.waitForTimeout(150);
  expect(dialogs).toEqual([]);
  expect(await page.evaluate(() => (window as unknown as EditorWindow).__pwned ?? null)).toBeNull();
  expect(page.url().startsWith(BASE_URL)).toBe(true);
}

test.describe('link sinks in the browser', () => {
  test.beforeEach(async ({ context }) => {
    await context.route(`${LANDING}**`, route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>landing</title><p>landing</p>',
    }));
  });

  test('renders a refused href as text in the editor, read-only too, and in getHTML and generateHTML (F1)', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
    await open(page);
    for (const href of UNSAFE_HREFS) {
      for (const editable of [true, false]) {
        const content = LAYOUTS['after text']?.(href);
        await setup(page, { content, editable });
        const editor = page.locator('#fixture .ProseMirror');
        await expect(editor.locator('a')).toHaveCount(0);
        await expect(editor.locator('span', { hasText: 'CLICK' })).toHaveCount(1);
        await editor.locator('span', { hasText: 'CLICK' }).click();
        const html = await page.evaluate(() => (window as unknown as EditorWindow).__linkSecurity.getHTML());
        expect(html, JSON.stringify(href)).toBe('<p>before <span>CLICK</span></p>');
        expect(await page.evaluate(content => (window as unknown as EditorWindow).__linkSecurity.generateHTML(content), content))
          .toBe('<p>before <span>CLICK</span></p>');
      }
      expect(await opens(page)).toEqual([]);
    }
    // getHTML placed on a consumer page and clicked runs nothing either (D3).
    await setup(page, { content: docOf(paragraph(...UNSAFE_HREFS.map((href, index) => text(`[${String(index)}] `, [linkMark(href)])))) });
    await page.evaluate(() => {
      const target = document.createElement('div');
      target.id = 'consumer';
      target.innerHTML = (window as unknown as EditorWindow).__linkSecurity.getHTML();
      document.body.appendChild(target);
    });
    for (let index = 0; index < UNSAFE_HREFS.length; index++) {
      await page.locator('#consumer span', { hasText: `[${String(index)}]` }).click();
    }
    await expect(page.locator('#consumer a')).toHaveCount(0);
    await expectNothingRan(page, dialogs);
  });

  for (const [layout, build] of Object.entries(LAYOUTS)) {
    test(`opens nothing for a refused href clicked in the layout: ${layout} (F2, F3)`, async ({ page }) => {
      const dialogs: string[] = [];
      page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
      await open(page);
      for (const href of UNSAFE_HREFS) {
        await setup(page, { content: build(href) });
        const popup = nextPopup(page, 300);
        await page.locator('#fixture .ProseMirror').getByText('CLICK', { exact: true }).last().click();
        expect(await popup, JSON.stringify(href)).toBeNull();
        expect(await opens(page), JSON.stringify(href)).toEqual([]);
      }
      await expectNothingRan(page, dialogs);
    });

    test(`opens the clicked link's own href in a new tab without an opener in the layout: ${layout}`, async ({ page }) => {
      await open(page);
      const href = `${LANDING}${encodeURIComponent(layout)}`;
      await setup(page, { content: build(href) });
      const popup = nextPopup(page);
      await page.locator('#fixture .ProseMirror').getByText('CLICK', { exact: true }).last().click();
      const opened = await popup;
      expect(opened).not.toBeNull();
      await opened?.waitForLoadState();
      expect(opened?.url()).toBe(href);
      expect(await opened?.evaluate(() => window.opener === null)).toBe(true);
      expect(await opens(page)).toEqual([[href, '_blank', 'noopener,noreferrer']]);
    });
  }

  test('opens the safe link placed after a refused one, and nothing for the refused one after a safe one (F3)', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
    await open(page);
    const safe = `${LANDING}after-unsafe`;
    await setup(page, { content: docOf(paragraph(text('BAD', [linkMark(`javascript:${FLAG}`)]), text('GOOD', [linkMark(safe)]))) });
    const popup = nextPopup(page);
    await page.getByText('GOOD', { exact: true }).last().click();
    expect((await popup)?.url()).toBe(safe);
    await setup(page, { content: docOf(paragraph(text('GOOD', [linkMark(safe)]), text('BAD', [linkMark([`javascript:${FLAG}`])]))) });
    const none = nextPopup(page, 500);
    await page.getByText('BAD', { exact: true }).last().click();
    expect(await none).toBeNull();
    expect(await opens(page)).toEqual([]);
    await expectNothingRan(page, dialogs);
  });

  test('opens a normal tab without opener or referrer for a left, Cmd and Ctrl click (F6, C4)', async ({ page, browserName }) => {
    await open(page);
    const modifiers: ('Meta' | 'Control' | null)[] = [null, 'Meta', ...(browserName === 'webkit' ? [] : ['Control' as const])];
    for (const modifier of modifiers) {
      const href = `${LANDING}click-${modifier ?? 'plain'}`;
      await setup(page, { content: LAYOUTS['after text']?.(href) });
      const popup = nextPopup(page);
      await page.locator('#fixture a').click({ modifiers: modifier ? [modifier] : [] });
      const opened = await popup;
      expect(opened, String(modifier)).not.toBeNull();
      await opened?.waitForLoadState();
      expect(await opened?.evaluate(() => ({
        opener: window.opener === null,
        referrer: document.referrer,
        toolbar: window.locationbar.visible,
      }))).toEqual({ opener: true, referrer: '', toolbar: true });
      await opened?.close();
    }
  });

  test('keeps the referrer but never the opener when addRelNoopener is off (C16)', async ({ page }) => {
    await open(page);
    await setup(page, { content: LAYOUTS['after text']?.(`${LANDING}referrer`), link: { addRelNoopener: false } });
    const popup = nextPopup(page);
    await page.locator('#fixture a').click();
    const opened = await popup;
    await opened?.waitForLoadState();
    expect(await opened?.evaluate(() => window.opener === null)).toBe(true);
    expect(await opened?.evaluate(() => document.referrer)).not.toBe('');
    expect(await opens(page)).toEqual([[`${LANDING}referrer`, '_blank', 'noopener']]);
  });

  test('does not open a link on a Shift click, a middle click or Enter (C5)', async ({ page }) => {
    await open(page);
    await setup(page, { content: LAYOUTS['after text']?.(`${LANDING}no`) });
    const anchor = page.locator('#fixture a');
    await anchor.click({ modifiers: ['Shift'] });
    await anchor.click({ button: 'middle' });
    await anchor.click({ button: 'right' });
    await page.keyboard.press('Escape');
    await setup(page, { content: LAYOUTS['after text']?.(`${LANDING}no`) });
    await page.evaluate(() => {
      const editor = (window as unknown as { __linkSecurity: { editor: () => { commands: { focus: (at: number) => void } } } }).__linkSecurity.editor();
      editor.commands.focus(10);
    });
    await page.keyboard.press('Enter');
    expect(await opens(page)).toEqual([]);
  });

  test('honors _self and _top, and opens _BLANK, a named target and an array target in a new tab (C6)', async ({ page }) => {
    await open(page);
    for (const target of ['_BLANK', 'preview', ['_top']]) {
      await setup(page, { content: docOf(paragraph(text('CLICK', [linkMark(`${LANDING}new`, { target })]))) });
      const popup = nextPopup(page);
      await page.getByText('CLICK', { exact: true }).last().click();
      const opened = await popup;
      await opened?.waitForLoadState();
      expect(await opened?.evaluate(() => window.opener === null), JSON.stringify(target)).toBe(true);
      await opened?.close();
    }
    for (const target of ['_self', '_TOP']) {
      await open(page);
      await setup(page, { content: docOf(paragraph(text('CLICK', [linkMark(`${LANDING}${target}`, { target })]))) });
      await Promise.all([page.waitForURL(`${LANDING}${target}`), page.getByText('CLICK', { exact: true }).last().click()]);
    }
  });

  test('navigates the top page from an editor in a same-origin frame with _top, and runs nothing for a refused href (C7)', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
    await open(page);
    const frameFor = async (href: unknown): Promise<void> => {
      await page.evaluate(() => {
        document.querySelector('iframe')?.remove();
        const frame = document.createElement('iframe');
        frame.src = '/?frame';
        frame.style.width = '600px';
        frame.style.height = '200px';
        document.body.appendChild(frame);
      });
      const handle = await (await page.waitForSelector('iframe')).contentFrame();
      await handle?.waitForFunction(() => (window as unknown as Partial<FixtureWindow>).__linkSecurity?.ready);
      await handle?.evaluate(content => (window as unknown as EditorWindow).__linkSecurity.create({ content }),
        docOf(paragraph(text('CLICK', [linkMark(href, { target: '_top' })]))));
    };
    await frameFor([`javascript:${FLAG}`]);
    await page.frameLocator('iframe').getByText('CLICK', { exact: true }).last().click();
    await frameFor(`javascript:${FLAG}`);
    await page.frameLocator('iframe').getByText('CLICK', { exact: true }).last().click();
    await expectNothingRan(page, dialogs);
    expect(await page.frames().find(candidate => candidate.url().includes('?frame'))
      ?.evaluate(() => (window as unknown as EditorWindow).__pwned ?? null)).toBeNull();
    await frameFor(`${LANDING}top`);
    await Promise.all([page.waitForURL(`${LANDING}top`), page.frameLocator('iframe').getByText('CLICK', { exact: true }).last().click()]);
  });

  test('leaves read-only clicks to the browser, which follows only an allowed href (C13)', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
    await open(page);
    await setup(page, { editable: false, content: docOf(paragraph(
      text('SAFE', [linkMark(`${LANDING}read-only`, { target: '_blank' })]),
      text(' '),
      text('BAD', [linkMark(`javascript:${FLAG}`, { target: '_blank' })]),
    )) });
    await expect(page.locator('#fixture a')).toHaveAttribute('href', `${LANDING}read-only`);
    await page.getByText('BAD', { exact: true }).last().click();
    const popup = nextPopup(page);
    await page.getByText('SAFE', { exact: true }).last().click();
    const opened = await popup;
    await opened?.waitForLoadState();
    expect(opened?.url()).toBe(`${LANDING}read-only`);
    expect(await opened?.evaluate(() => window.opener === null)).toBe(true);
    expect(await opens(page)).toEqual([]);
    await expectNothingRan(page, dialogs);
  });
});
