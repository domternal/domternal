/**
 * Link and URL security in Chromium, Firefox and WebKit, against the public
 * core build (e2e/link-security.config.ts).
 */
import { expect, type Locator, type Page } from '@playwright/test';
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
    diagnostics: () => Json[];
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
        // generateHTML loads the JSON, which removes the link and keeps its text.
        expect(await page.evaluate(content => (window as unknown as EditorWindow).__linkSecurity.generateHTML(content), content))
          .toBe('<p>before CLICK</p>');
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

test.describe('link targets and rel in the browser', () => {
  test.beforeEach(async ({ context }) => {
    await context.route(`${LANDING}**`, route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>landing</title><p>landing</p>',
    }));
  });

  test("opens nothing while editable with openOnClick 'whenNotEditable', and the browser follows it read-only (C12)", async ({ page }) => {
    await open(page);
    await setup(page, { content: LAYOUTS['after text']?.(`${LANDING}when-not-editable`), link: { openOnClick: 'whenNotEditable' } });
    const none = nextPopup(page, 800);
    await page.locator('#fixture a').click();
    expect(await none).toBeNull();
    await setup(page, { content: LAYOUTS['after text']?.(`${LANDING}never`), link: { openOnClick: false } });
    const never = nextPopup(page, 800);
    await page.locator('#fixture a').click();
    expect(await never).toBeNull();
    expect(await opens(page)).toEqual([]);
    await setup(page, {
      editable: false,
      link: { openOnClick: 'whenNotEditable' },
      content: docOf(paragraph(text('CLICK', [linkMark(`${LANDING}read-only-native`, { target: '_blank' })]))),
    });
    const popup = nextPopup(page);
    await page.locator('#fixture a').click();
    expect((await popup)?.url()).toBe(`${LANDING}read-only-native`);
  });

  test('renders a new-tab link whose stored rel grants an opener without it, so a native click opens without an opener (F9)', async ({ page }) => {
    await open(page);
    await setup(page, {
      editable: false,
      content: docOf(paragraph(text('CLICK', [linkMark(`${LANDING}rel-opener`, { target: '_BLANK', rel: 'opener nofollow' })]))),
    });
    const anchor = page.locator('#fixture a');
    await expect(anchor).toHaveAttribute('target', '_blank');
    await expect(anchor).toHaveAttribute('rel', 'nofollow noopener noreferrer');
    const popup = nextPopup(page);
    await anchor.click();
    const opened = await popup;
    await opened?.waitForLoadState();
    expect(await opened?.evaluate(() => ({ opener: window.opener === null, referrer: document.referrer })))
      .toEqual({ opener: true, referrer: '' });
  });

  test('drops a named target, so a read-only click stays in the page instead of reusing a named window', async ({ page }) => {
    await open(page);
    await setup(page, {
      editable: false,
      content: docOf(paragraph(text('CLICK', [linkMark(`${LANDING}named`, { target: 'preview' })]))),
    });
    await expect(page.locator('#fixture a')).not.toHaveAttribute('target', /.*/);
    await Promise.all([page.waitForURL(`${LANDING}named`), page.locator('#fixture a').click()]);
  });
});

test.describe('links in loaded JSON in the browser', () => {
  test('removes links with refused hrefs while loading, keeps their text and reports each (B2)', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
    await open(page);
    const content = docOf(paragraph(...UNSAFE_HREFS.map((href, index) => text(`[${String(index)}] `, [linkMark(href)])), text('ok', [linkMark(`${LANDING}ok`)])));
    await setup(page, { content, load: true });
    const editor = page.locator('#fixture .ProseMirror');
    await expect(editor.locator('a')).toHaveCount(1);
    await expect(editor.locator('span')).toHaveCount(0);
    const diagnostics = await page.evaluate(() => (window as unknown as EditorWindow).__linkSecurity.diagnostics());
    expect(diagnostics.map(diagnostic => [diagnostic['code'], diagnostic['markType'], diagnostic['attribute']]))
      .toEqual(UNSAFE_HREFS.map(() => ['unsafe-url', 'link', 'href']));
    for (let index = 0; index < UNSAFE_HREFS.length; index++) {
      await editor.getByText(`[${String(index)}]`).click();
    }
    expect(await opens(page)).toEqual([]);
    await expectNothingRan(page, dialogs);
  });
});

test.describe('relative links and the link popover in the browser', () => {
  test.beforeEach(async ({ context }) => {
    await context.route(`${LANDING}**`, route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>landing</title><p>landing</p>',
    }));
    await context.route(`${BASE_URL}/docs/**`, route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>docs</title><p>docs</p>',
    }));
  });

  /** Selects the first word, Hello, and opens the popover with Mod-K. */
  async function openPopover(page: Page): Promise<Locator> {
    await page.evaluate(() => { (window as unknown as { __linkSecurity: { select: (from: number, to: number) => void } }).__linkSecurity.select(1, 6); });
    await page.keyboard.press('ControlOrMeta+k');
    const popover = page.locator('.dm-link-popover[data-show]');
    await expect(popover).toBeVisible();
    return popover;
  }

  const linkHrefs = (page: Page): Promise<unknown[]> =>
    page.evaluate(() => (window as unknown as { __linkSecurity: { linkHrefs: () => unknown[] } }).__linkSecurity.linkHrefs());

  const inputs: [typed: string, stored: string][] = [
    ['#intro', '#intro'], ['/docs/page#x', '/docs/page#x'], ['example.com', 'https://example.com'], ['a@b.example', 'mailto:a@b.example'],
  ];
  for (const [typed, stored] of inputs) {
    test(`stores ${typed} typed into the popover as ${stored} (E1, E2, E6)`, async ({ page }) => {
      await open(page);
      await setup(page, { content: docOf(paragraph(text('Hello world'))), linkPopover: {} });
      const popover = await openPopover(page);
      await popover.locator('input').fill(typed);
      await page.keyboard.press('Enter');
      await expect(popover).toBeHidden();
      expect(await linkHrefs(page)).toEqual([stored]);
    });
  }

  test('keeps the popover open with a localized reason for a refused address, and clears it on typing (E8, E14)', async ({ page }) => {
    await open(page);
    await setup(page, { content: docOf(paragraph(text('Hello world'))), linkPopover: {} });
    const popover = await openPopover(page);
    const input = popover.locator('input');
    for (const refused of ['javascript:alert(1)', 'data:text/html,x', 'https://google.com@evil.example/']) {
      await input.fill(refused);
      await page.keyboard.press('Enter');
      await expect(popover).toBeVisible();
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(await input.evaluate(element => (element as HTMLInputElement).validationMessage)).toBe('This address cannot be used as a link.');
      await expect(input).toBeFocused();
    }
    await input.pressSequentially('x');
    await expect(input).not.toHaveAttribute('aria-invalid', /.*/);
    expect(await linkHrefs(page)).toEqual([]);
  });

  test('changes only the href of an existing link and keeps its title, target, rel and class (E12)', async ({ page }) => {
    await open(page);
    await setup(page, {
      linkPopover: {},
      content: docOf(paragraph(text('Hello', [linkMark(`${LANDING}old`, { title: 'T', target: '_blank', rel: 'nofollow', class: 'c' })]), text(' world'))),
    });
    const popover = await openPopover(page);
    await popover.locator('input').fill('/docs/new');
    await page.keyboard.press('Enter');
    await expect(popover).toBeHidden();
    await expect(page.locator('#fixture a')).toHaveAttribute('href', '/docs/new');
    await expect(page.locator('#fixture a')).toHaveAttribute('title', 'T');
    await expect(page.locator('#fixture a')).toHaveAttribute('class', 'c');
    await expect(page.locator('#fixture a')).toHaveAttribute('rel', 'nofollow noopener noreferrer');
  });

  test('scrolls to a fragment target in place, without opening a tab or changing the location (C8)', async ({ page }) => {
    await open(page);
    const filler = Array.from({ length: 60 }, (_, index) => paragraph(text(`filler ${String(index)}`)));
    await setup(page, { content: docOf(
      paragraph(text('INSIDE', [linkMark('#far-target')]), text(' '), text('OUTSIDE', [linkMark('#page-target')]), text(' '), text('NOWHERE', [linkMark('#missing')])),
      ...filler,
      { type: 'heading', attrs: { level: 2, id: 'far-target' }, content: [text('Far target')] },
    ) });
    await page.evaluate(() => {
      const target = document.createElement('section');
      target.id = 'page-target';
      target.style.marginTop = '3000px';
      target.textContent = 'Page target';
      document.body.appendChild(target);
    });
    const url = page.url();
    const none = nextPopup(page, 800);
    await page.getByText('INSIDE', { exact: true }).last().click();
    await expect(page.locator('#far-target')).toBeInViewport();
    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('#fixture .ProseMirror')?.scrollTo(0, 0); });
    await page.getByText('OUTSIDE', { exact: true }).last().click();
    await expect(page.locator('#page-target')).toBeInViewport();
    await page.evaluate(() => { window.scrollTo(0, 0); });
    await page.getByText('NOWHERE', { exact: true }).last().click();
    expect(await none).toBeNull();
    expect(page.url()).toBe(url);
    expect(await page.evaluate(() => location.hash)).toBe('');
    expect(await opens(page)).toEqual([]);
  });

  test('scrolls to a fragment target in a read-only editor without changing the location a hash router reads', async ({ page }) => {
    await page.goto(`${BASE_URL}/#/dashboard`);
    await page.waitForFunction(() => (window as unknown as Partial<FixtureWindow>).__linkSecurity?.ready);
    await page.evaluate(decodeScript);
    const filler = Array.from({ length: 60 }, (_, index) => paragraph(text(`filler ${String(index)}`)));
    await setup(page, { editable: false, content: docOf(
      paragraph(text('INTRO', [linkMark('#intro')]), text(' '), text('MISSING', [linkMark('#missing')])),
      ...filler,
      { type: 'heading', attrs: { level: 2, id: 'intro' }, content: [text('Intro')] },
    ) });
    await page.evaluate(() => {
      (window as unknown as { __hashChanges: number }).__hashChanges = 0;
      window.addEventListener('hashchange', () => { (window as unknown as { __hashChanges: number }).__hashChanges++; });
    });
    await expect(page.locator('#fixture a').first()).toHaveAttribute('href', '#intro');
    const none = nextPopup(page, 800);
    await page.getByText('INTRO', { exact: true }).last().click();
    await expect(page.locator('#intro')).toBeInViewport();
    await page.getByText('MISSING', { exact: true }).last().focus();
    await page.keyboard.press('Enter');
    expect(await none).toBeNull();
    expect(await page.evaluate(() => location.hash)).toBe('#/dashboard');
    expect(await page.evaluate(() => (window as unknown as { __hashChanges: number }).__hashChanges)).toBe(0);
  });

  test('opens a relative path resolved against the page in a new tab without an opener (C10)', async ({ page }) => {
    await open(page);
    await setup(page, { content: docOf(paragraph(text('CLICK', [linkMark('/docs/page?x=1')]))) });
    const popup = nextPopup(page);
    await page.getByText('CLICK', { exact: true }).last().click();
    const opened = await popup;
    await opened?.waitForLoadState();
    expect(opened?.url()).toBe(`${BASE_URL}/docs/page?x=1`);
    expect(await opened?.evaluate(() => window.opener === null)).toBe(true);
  });
});

test.describe('stored style values in the browser', () => {
  const PROBE = 'https://probe.test/';
  const OVERLAY = 'red;position:fixed;inset:0;z-index:2147483647;background:rgb(255,0,0)';

  /** Every request to the probe host, which only an injected url() would make. */
  async function probeRequests(page: Page): Promise<string[]> {
    const requests: string[] = [];
    await page.context().route(`${PROBE}**`, route => {
      requests.push(route.request().url());
      return route.fulfill({ status: 204, body: '' });
    });
    return requests;
  }

  const styled = (value: string, attrs: Json): Json => text(value, [{ type: 'textStyle', attrs }]);
  const UNSAFE_STYLES = docOf(
    { type: 'paragraph', attrs: { textAlign: `left;background-image:url(${PROBE}align)` }, content: [
      styled('COLOR', { color: OVERLAY }),
      text(' '),
      styled('HIGHLIGHT', { backgroundColor: `url(${PROBE}highlight)` }),
      text(' '),
      styled('FAMILY', { fontFamily: `x';background-image:url(${PROBE}family);'` }),
      text(' '),
      styled('SIZE', { fontSize: `1px;background-image:url(${PROBE}size)` }),
      text(' '),
      styled('ARRAY', { color: [`red;background-image:url(${PROBE}array)`] }),
    ] },
    { type: 'paragraph', attrs: { lineHeight: `2;background-image:url(${PROBE}line)` }, content: [text('LINE')] },
  );

  interface StyleWindow {
    __linkSecurity: EditorWindow['__linkSecurity'] & { show: (html: string) => void; fixedElements: () => string[] };
  }

  test('writes no declaration an unsafe stored value would add, in the editor, getHTML and generateHTML (G2)', async ({ page }) => {
    const requests = await probeRequests(page);
    await open(page);
    await setup(page, { content: UNSAFE_STYLES });
    const html = await page.evaluate(() => (window as unknown as EditorWindow).__linkSecurity.getHTML());
    const generated = await page.evaluate(content => (window as unknown as EditorWindow).__linkSecurity.generateHTML(content), UNSAFE_STYLES);
    for (const output of [html, generated]) {
      expect(output).not.toContain('probe.test');
      expect(output).not.toContain('position');
      expect(output).not.toContain('style=');
    }
    await page.evaluate(markup => {
      (window as unknown as StyleWindow).__linkSecurity.show(markup);
    }, html + generated);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as unknown as StyleWindow).__linkSecurity.fixedElements())).toEqual([]);
    expect(requests).toEqual([]);
    // The stored values stay for the application to migrate or inspect.
    const stored = await page.evaluate(() => JSON.stringify((window as unknown as EditorWindow).__linkSecurity.getJSON()));
    expect(stored).toContain('position:fixed');
  });

  test('renders safe stored values as they are (G1, G3, G4, G5)', async ({ page }) => {
    await open(page);
    await setup(page, { content: docOf({ type: 'paragraph', attrs: { textAlign: 'center' }, content: [
      styled('SAFE', { color: 'rgb(1, 2, 3)', backgroundColor: 'rgb(4, 5, 6)', fontFamily: 'Times New Roman, serif', fontSize: 'calc(10px + 8px)' }),
    ] }) });
    const safe = page.locator('#fixture').getByText('SAFE', { exact: true });
    const computed = await safe.evaluate(element => {
      const style = getComputedStyle(element);
      return { color: style.color, background: style.backgroundColor, family: style.fontFamily, size: style.fontSize };
    });
    expect(computed).toEqual({ color: 'rgb(1, 2, 3)', background: 'rgb(4, 5, 6)', family: expect.stringMatching(/^"?Times New Roman"?, serif$/) as unknown as string, size: '18px' });
    expect(await page.locator('#fixture p').evaluate(element => getComputedStyle(element).textAlign)).toBe('center');
  });

  test('renders arithmetic grouped in parentheses, which the browser applies (G4)', async ({ page }) => {
    await open(page);
    const content = docOf(paragraph(styled('FLUID', { fontSize: 'calc(1rem + (2vw - 1rem) * 0.5)' })));
    await setup(page, { content });
    // Browsers may simplify the expression when they serialize it, so the check reads the size it gives.
    const html = await page.evaluate(() => (window as unknown as EditorWindow).__linkSecurity.getHTML());
    const generated = await page.evaluate(json => (window as unknown as EditorWindow).__linkSecurity.generateHTML(json), content);
    for (const output of [html, generated]) expect(output).toMatch(/font-size: calc\(/);
    const size = await page.locator('#fixture').getByText('FLUID', { exact: true }).evaluate(element => getComputedStyle(element).fontSize);
    // Half a rem plus one viewport width percent: never the 16px a dropped declaration would leave.
    expect(Number.parseFloat(size)).toBeCloseTo(8 + page.viewportSize()!.width / 100, 0);
  });
});

test.describe('stored table cell backgrounds in the browser', () => {
  const PROBE = 'https://probe.test/';

  test('writes no declaration an unsafe cell background would add, and renders a safe one (G6)', async ({ page }) => {
    const requests: string[] = [];
    await page.context().route(`${PROBE}**`, route => {
      requests.push(route.request().url());
      return route.fulfill({ status: 204, body: '' });
    });
    await open(page);
    const cell = (background: unknown, value: string): Json => ({ type: 'tableCell', attrs: { background }, content: [paragraph(text(value))] });
    const content = docOf({ type: 'table', content: [{ type: 'tableRow', content: [
      cell(`red;background-image:url(${PROBE}cell)`, 'UNSAFE'),
      cell('red;position:fixed;inset:0;z-index:2147483647', 'OVERLAY'),
      cell([`url(${PROBE}array)`], 'ARRAY'),
      cell('rgb(1, 2, 3)', 'SAFE'),
    ] }] });
    await setup(page, { content });
    const html = await page.evaluate(() => (window as unknown as EditorWindow).__linkSecurity.getHTML());
    const generated = await page.evaluate(json => (window as unknown as EditorWindow).__linkSecurity.generateHTML(json), content);
    for (const output of [html, generated]) {
      expect(output).not.toContain('probe.test');
      expect(output).not.toContain('position');
      expect(output).toContain('data-background="rgb(1, 2, 3)"');
      expect(output).toMatch(/<td data-background="rgb\(1, 2, 3\)" style="background-color: [^"]+"><p>SAFE/);
    }
    await page.evaluate(markup => {
      (window as unknown as { __linkSecurity: { show: (html: string) => void } }).__linkSecurity.show(markup);
    }, html + generated);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as unknown as { __linkSecurity: { fixedElements: () => string[] } }).__linkSecurity.fixedElements())).toEqual([]);
    expect(requests).toEqual([]);
    const safe = page.locator('#fixture td').filter({ hasText: /^SAFE$/ });
    expect(await safe.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(1, 2, 3)');
  });

  test('writes no declaration an unsafe cell alignment would add to styled HTML and inlineStyles output', async ({ page }) => {
    const requests: string[] = [];
    await page.context().route(`${PROBE}**`, route => {
      requests.push(route.request().url());
      return route.fulfill({ status: 204, body: '' });
    });
    await open(page);
    const overlay = `left; position: fixed; inset: 0; z-index: 2147483647; background: url(${PROBE}align)`;
    const cell = (attrs: Json, value: string, type = 'tableCell'): Json => ({ type, attrs, content: [paragraph(text(value))] });
    const content = docOf({ type: 'table', content: [{ type: 'tableRow', content: [
      cell({ textAlign: overlay }, 'TEXT'),
      cell({ verticalAlign: `top;background-image:url(${PROBE}vertical)` }, 'VERTICAL'),
      cell({ textAlign: overlay, verticalAlign: overlay }, 'HEADER', 'tableHeader'),
      cell({ textAlign: 'center', verticalAlign: 'bottom' }, 'SAFE'),
    ] }] });
    await setup(page, { content });
    interface StyledWindow { __linkSecurity: { getStyledHTML: () => string; inlineStyles: (html: string) => string; generateHTML: (json: Json) => string; show: (html: string) => void; fixedElements: () => string[] } }
    const outputs = await page.evaluate(json => {
      const probe = (window as unknown as StyledWindow).__linkSecurity;
      return [probe.getStyledHTML(), probe.inlineStyles(probe.generateHTML(json))];
    }, content);
    for (const output of outputs) {
      expect(output).not.toContain('probe.test');
      expect(output).not.toContain('position');
    }
    await page.evaluate(markup => { (window as unknown as StyledWindow).__linkSecurity.show(markup); }, outputs.join(''));
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as unknown as StyledWindow).__linkSecurity.fixedElements())).toEqual([]);
    expect(requests).toEqual([]);
    const safe = page.locator('#sink td').filter({ hasText: /^SAFE$/ }).first();
    expect(await safe.evaluate(element => [getComputedStyle(element).textAlign, getComputedStyle(element).verticalAlign])).toEqual(['center', 'bottom']);
  });
});

test.describe('image sources in the browser', () => {
  const PROBE = 'https://probe.test/';
  // A valid 1x1 PNG, so a source the browser loaded reports a natural width.
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
  const image = (src: unknown): Json => ({ type: 'image', attrs: { src, alt: 'img' } });

  test('loads no refused source in the node view, getHTML or generateHTML (F2)', async ({ page }) => {
    const requests: string[] = [];
    await page.context().route(/^https?:\/\/probe\.test\//, route => {
      requests.push(route.request().url());
      return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG.slice(PNG.indexOf(',') + 1), 'base64') });
    });
    await open(page);
    const refused = [` ${PNG}`, `da\nta:${PNG.slice(5)}`, `\u0001${PNG}`, `https://user:pass@${PROBE.slice(8)}credentials.png`, ` javascript:alert(1)`];
    const content = docOf(paragraph(...refused.map(image)));
    await setup(page, { content, image: { allowBase64: false } });
    const loaded = await page.locator('#fixture img[alt="img"]').evaluateAll(images => images.map(img => ({
      src: img.getAttribute('src'), width: (img as HTMLImageElement).naturalWidth,
    })));
    expect(loaded).toEqual(refused.map(() => ({ src: null, width: 0 })));
    const html = await page.evaluate(() => (window as unknown as EditorWindow).__linkSecurity.getHTML());
    const generated = await page.evaluate(json => (window as unknown as EditorWindow).__linkSecurity.generateHTML(json, { image: { allowBase64: false } }), content);
    for (const output of [html, generated]) expect(output).not.toMatch(/data:|javascript:|probe\.test/);
    await page.evaluate(markup => {
      (window as unknown as { __linkSecurity: { show: (html: string) => void } }).__linkSecurity.show(markup);
    }, html + generated);
    await page.waitForTimeout(300);
    expect(await page.locator('#sink img').evaluateAll(images => images.map(img => (img as HTMLImageElement).naturalWidth))).toEqual(refused.flatMap(() => [0, 0]));
    expect(requests).toEqual([]);
  });

  test('loads an allowed source in its cleaned spelling (F1, F3)', async ({ page }) => {
    await page.context().route(/^https?:\/\/probe\.test\//, route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(PNG.slice(PNG.indexOf(',') + 1), 'base64') }));
    await open(page);
    await setup(page, { content: docOf(paragraph(image(` ${PROBE}a.png`), image(PNG), image(`//${PROBE.slice(8)}b.png`))) });
    const img = page.locator('#fixture img[alt="img"]');
    await expect(img).toHaveCount(3);
    await expect.poll(() => img.evaluateAll(images => images.map(element => (element as HTMLImageElement).naturalWidth))).toEqual([1, 1, 1]);
    expect(await img.evaluateAll(images => images.map(element => element.getAttribute('src')))).toEqual([`${PROBE}a.png`, PNG, `//${PROBE.slice(8)}b.png`]);
  });
});
