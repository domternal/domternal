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
