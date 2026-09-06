import { describe, it, expect } from 'vitest';
import { checkUrl, normalizeUrlProtocol, type UrlPolicyOptions } from './checkUrl.js';
import {
  ABSOLUTE_LINK_PROFILE,
  LINK_PROFILE,
  URL_CORPUS,
  fuzzUrls,
  imageProfile,
  type UrlCorpusRow,
  type UrlStatus,
} from './urlPolicy.corpus.js';

const label = (value: unknown): string => value === undefined ? 'undefined' : JSON.stringify(value);

function expectStatus(row: UrlCorpusRow, options: UrlPolicyOptions, status: UrlStatus): void {
  const check = checkUrl(row.value, options);
  expect(check.status, `${row.id} ${label(row.value)}`).toBe(status);
  if (check.status === 'allowed') expect(check.url, `${row.id} ${label(row.value)}`).toBe(row.url ?? row.value);
}

describe('checkUrl', () => {
  describe('the shared corpus', () => {
    it.each(URL_CORPUS.map(row => [row.id, label(row.value), row] as const))('%s %s: default Link profile', (_id, _value, row) => {
      expectStatus(row, LINK_PROFILE, row.link);
    });

    it.each(URL_CORPUS.map(row => [row.id, label(row.value), row] as const))('%s %s: Link profile without relative references', (_id, _value, row) => {
      expectStatus(row, ABSOLUTE_LINK_PROFILE, row.absolute ?? row.link);
    });

    it.each(URL_CORPUS.map(row => [row.id, label(row.value), row] as const))('%s %s: image profile', (_id, _value, row) => {
      expectStatus(row, imageProfile(true), row.image[0]);
      expectStatus(row, imageProfile(false), row.image[1]);
    });

    it('covers every row of the edge-case matrix that judges a single value', () => {
      const ids = new Set(URL_CORPUS.map(row => row.id));
      for (const id of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11', 'A12', 'A13', 'A14',
        'A16', 'A17', 'A18', 'A19', 'A20', 'A21', 'A22', 'A23', 'A24', 'A30', 'A31']) {
        expect(ids.has(id), id).toBe(true);
      }
    });
  });

  describe('values that are not strings', () => {
    it('reports null and undefined as unsupported, and every other type as unsafe', () => {
      expect(checkUrl(null).status).toBe('unsupported');
      expect(checkUrl(undefined).status).toBe('unsupported');
      expect(checkUrl(new String('https://example.com/') as unknown).status).toBe('unsafe');
      expect(checkUrl(Symbol('x')).status).toBe('unsafe');
      expect(checkUrl(1n).status).toBe('unsafe');
      expect(checkUrl(() => 'https://example.com/').status).toBe('unsafe');
      expect(checkUrl(new URL('https://example.com/')).status).toBe('unsafe');
    });
  });

  describe('protocols', () => {
    it('defaults to http and https, absolute only', () => {
      expect(checkUrl('https://example.com/').status).toBe('allowed');
      expect(checkUrl('http://example.com/').status).toBe('allowed');
      expect(checkUrl('mailto:a@b.example').status).toBe('unsupported');
      expect(checkUrl('/path').status).toBe('unsupported');
      expect(checkUrl('#section').status).toBe('unsupported');
    });

    it('compares entries in lower case, with or without the colon (A26)', () => {
      for (const protocols of [['HTTPS'], ['https'], ['https:'], ['HtTpS:']]) {
        expect(checkUrl('https://example.com/', { protocols }).status, protocols[0]).toBe('allowed');
        expect(checkUrl('http://example.com/', { protocols }).status, protocols[0]).toBe('unsupported');
      }
      expect(checkUrl('FTP://files.example/', { protocols: ['ftp'] }).status).toBe('allowed');
    });

    it('never allows a script scheme or a data address through the list', () => {
      const protocols = ['javascript:', 'vbscript', 'DATA:', 'https:'];
      expect(checkUrl('javascript:alert(1)', { protocols }).status).toBe('unsafe');
      expect(checkUrl('vbscript:msgbox(1)', { protocols }).status).toBe('unsafe');
      expect(checkUrl('data:text/html,x', { protocols }).status).toBe('unsafe');
      expect(checkUrl('data:image/png;base64,AAAA', { protocols }).status).toBe('unsafe');
      expect(checkUrl('javascript:alert(1)', { protocols: 'any' }).status).toBe('unsafe');
    });

    it('allows only relative references with an empty list (A27)', () => {
      const options = { protocols: [], allowRelative: true };
      expect(checkUrl('https://example.com/', options).status).toBe('unsupported');
      expect(checkUrl('/path', options)).toEqual({ status: 'allowed', url: '/path' });
      expect(checkUrl('#id', options)).toEqual({ status: 'allowed', url: '#id' });
    });

    it('allows every other scheme with any, except file', () => {
      expect(checkUrl('myapp://open/x', { protocols: 'any' }).status).toBe('allowed');
      expect(checkUrl('blob:https://example.com/0', { protocols: 'any' }).status).toBe('allowed');
      expect(checkUrl('file:///etc/passwd', { protocols: 'any' }).status).toBe('unsupported');
      expect(checkUrl(' FiLe:///etc/passwd', { protocols: 'any' }).status).toBe('unsupported');
    });

    it('ignores entries that are not strings', () => {
      const protocols = [42, null, 'https:'] as unknown as string[];
      expect(checkUrl('https://example.com/', { protocols }).status).toBe('allowed');
      expect(checkUrl('http://example.com/', { protocols }).status).toBe('unsupported');
    });
  });

  describe('format characters', () => {
    const FORMAT = ['\u061c', '\u200b', '\u200c', '\u200d', '\u200e', '\u200f', '\u2060', '\u2061', '\u2062', '\u2063', '\u2064', '\ufeff'];
    const BIDI_CONTROLS = ['\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2066', '\u2067', '\u2068', '\u2069'];
    const options = { protocols: ['https:', 'mailto:', 'tel:', 'myapp:'], allowRelative: true };

    it('allows each joiner and mark in a path, query or fragment, where browsers percent-encode it', () => {
      for (const char of FORMAT) {
        for (const value of [`https://example.com/a${char}b`, `https://example.com/?q=a${char}b`, `https://example.com/#a${char}b`,
          `mailto:a@b.example?subject=a${char}b`, `myapp://host/a${char}b`, `/a${char}b`, `./a${char}b`,
          `a${char}b.html`, `a${char}b/c`, `?a${char}b`, `#a${char}b`]) {
          expect(checkUrl(value, options), JSON.stringify(value)).toEqual({ status: 'allowed', url: value });
        }
      }
    });

    it('refuses each one in a scheme, a host, a port, or the address of a scheme without a host', () => {
      for (const char of FORMAT) {
        for (const value of [`ht${char}tps://example.com/`, `https${char}://example.com/`, `https:${char}//example.com/`,
          `https:/${char}/example.com/`, `https://${char}example.com/`, `https://exa${char}mple.com/`, `https://example.com${char}/`,
          `https://example.com${char}?q`, `https://example.com${char}#f`, `https://example.com:443${char}/`, `https:exa${char}mple.com`,
          `mailto:a${char}@b.example`, `mailto:a@b.example${char}?subject=x`, `tel:+385${char}123`, `myapp://ho${char}st/path`,
          `myapp:a${char}b`, `//exa${char}mple.com/x`, `/\\exa${char}mple.com/x`, `ja${char}vascript:alert(1)`, `a${char}b:c`]) {
          expect(checkUrl(value, { ...options, allowNetworkPath: true }).status, JSON.stringify(value)).toBe('unsafe');
          expect(checkUrl(value, options).status, JSON.stringify(value)).toBe('unsafe');
        }
      }
    });

    it('refuses bidi embeddings, overrides and isolates anywhere, as they reorder how the rest reads', () => {
      for (const char of BIDI_CONTROLS) {
        for (const value of [`https://example.com/a${char}b`, `https://example.com/?q=${char}`, `https://example.com/#${char}`,
          `/a${char}b`, `?${char}`, `#${char}`, `https://exa${char}mple.com/`]) {
          expect(checkUrl(value, options).status, JSON.stringify(value)).toBe('unsafe');
        }
      }
    });

    it('stays linear when a long value holds them', () => {
      const start = performance.now();
      checkUrl(`https://example.com/${'\u200c'.repeat(1_000_000)}`, LINK_PROFILE);
      checkUrl(`${'\u200c'.repeat(1_000_000)}:`, LINK_PROFILE);
      checkUrl(`https://${'\u200c'.repeat(1_000_000)}`, LINK_PROFILE);
      expect(performance.now() - start).toBeLessThan(2000);
    });
  });

  describe('data images', () => {
    it('allows only image media types, compared without case and outer spaces', () => {
      const options = { protocols: 'any' as const, allowDataImages: true };
      expect(checkUrl('data:image/gif;base64,R0lGOD==', options).status).toBe('allowed');
      expect(checkUrl('data: Image/WebP,xx', options).status).toBe('allowed');
      expect(checkUrl('data:image/svg+xml;utf8,<svg/>', options).status).toBe('allowed');
      expect(checkUrl('data:text/plain,image/png', options).status).toBe('unsafe');
      expect(checkUrl('data:imagex/png,xx', options).status).toBe('unsafe');
      expect(checkUrl('data:application/octet-stream;image/png,xx', options).status).toBe('unsafe');
      expect(checkUrl('data:', options).status).toBe('unsafe');
    });

    it('still needs the data scheme in no list: allowDataImages alone decides', () => {
      expect(checkUrl('data:image/png;base64,AAAA', { protocols: ['https:'], allowDataImages: true }).status).toBe('allowed');
    });
  });

  describe('relative references', () => {
    const relative = { allowRelative: true };

    it('refuses a colon in the first segment, which some consumers read as a scheme', () => {
      // Not schemes: the first character is not a letter, or a character before the colon cannot be in a scheme.
      expect(checkUrl('1a:b', relative).status).toBe('unsupported');
      expect(checkUrl('a_b:c/x', relative).status).toBe('unsupported');
      expect(checkUrl('\u00e4:b', relative).status).toBe('unsupported');
      expect(checkUrl('./a:b', relative).status).toBe('allowed');
      expect(checkUrl('?a:b', relative).status).toBe('allowed');
      expect(checkUrl('#a:b', relative).status).toBe('allowed');
      expect(checkUrl('a/b:c', relative).status).toBe('allowed');
    });

    it('refuses network paths and backslashes unless allowNetworkPath is set', () => {
      expect(checkUrl('//cdn.example/x', relative).status).toBe('unsupported');
      expect(checkUrl('\\/cdn.example/x', relative).status).toBe('unsupported');
      expect(checkUrl('a\\b', relative).status).toBe('unsupported');
      expect(checkUrl('/a?b\\c', relative).status).toBe('allowed');
      const network = { ...relative, allowNetworkPath: true };
      expect(checkUrl('//cdn.example/x', network)).toEqual({ status: 'allowed', url: '//cdn.example/x' });
      expect(checkUrl('a\\b', network)).toEqual({ status: 'allowed', url: 'a\\b' });
    });

    it('allows a relative reference only with allowRelative', () => {
      expect(checkUrl('/docs/page').status).toBe('unsupported');
      expect(checkUrl('/docs/page', relative)).toEqual({ status: 'allowed', url: '/docs/page' });
      expect(checkUrl(' /docs/page\n', relative)).toEqual({ status: 'allowed', url: '/docs/page' });
    });

    it('refuses what the URL parser rejects', () => {
      expect(checkUrl('http://[::1', relative).status).toBe('unsupported');
      expect(checkUrl('/%', relative).status).toBe('allowed');
    });
  });

  describe('backslashes', () => {
    it('refuses them before the query in web addresses, where browsers read them as slashes', () => {
      expect(checkUrl('https://x.example\\@evil.example/').status).toBe('unsupported');
      expect(checkUrl('HTTP:\\\\x.example').status).toBe('unsupported');
      expect(checkUrl('https://x.example/a\\b').status).toBe('unsupported');
      expect(checkUrl('ws://x.example\\a', { protocols: ['ws:'] }).status).toBe('unsupported');
    });

    it('keeps them in the query, the fragment and schemes that do not read them as slashes', () => {
      expect(checkUrl('https://x.example/?a=\\').status).toBe('allowed');
      expect(checkUrl('https://x.example/#\\').status).toBe('allowed');
      expect(checkUrl('mailto:a\\b@x.example', { protocols: ['mailto:'] }).status).toBe('allowed');
      expect(checkUrl('myapp:\\\\x', { protocols: ['myapp:'] }).status).toBe('allowed');
    });
  });

  describe('parsers that tolerate an invalid host', () => {
    it('refuses a host that stays percent-encoded, as Chromium keeps one that other parsers reject', () => {
      const Native = globalThis.URL;
      class Tolerant extends Native {
        override get hostname(): string {
          return this.href.includes('tolerant') ? 'tole%20rant.example' : super.hostname;
        }
      }
      globalThis.URL = Tolerant;
      try {
        expect(checkUrl('https://tolerant.example/').status).toBe('unsupported');
        expect(checkUrl('/tolerant', { allowRelative: true }).status).toBe('unsupported');
        expect(checkUrl('https://example.org/').status).toBe('allowed');
      } finally {
        globalThis.URL = Native;
      }
    });
  });

  describe('results', () => {
    it('returns frozen refusals and the cleaned spelling when allowed', () => {
      expect(Object.isFrozen(checkUrl('javascript:x'))).toBe(true);
      expect(Object.isFrozen(checkUrl('ftp://x.example/'))).toBe(true);
      expect(checkUrl('\thttps://example.com/\n')).toEqual({ status: 'allowed', url: 'https://example.com/' });
      // The spelling is kept: no canonical form is written back.
      expect(checkUrl('HTTPS://Example.COM')).toEqual({ status: 'allowed', url: 'HTTPS://Example.COM' });
    });

    it('stays linear on long input', () => {
      const long = `https://example.com/${'a:/\\?#'.repeat(200_000)}`;
      const start = performance.now();
      checkUrl(long, LINK_PROFILE);
      checkUrl(`${' '.repeat(500_000)}${'a'.repeat(500_000)}:`, LINK_PROFILE);
      checkUrl('\u200b'.repeat(1_000_000), imageProfile(true));
      expect(performance.now() - start).toBeLessThan(2000);
    });
  });

  describe('normalizeUrlProtocol', () => {
    it('writes a scheme as the URL parser reports it', () => {
      expect(normalizeUrlProtocol('HTTPS')).toBe('https:');
      expect(normalizeUrlProtocol('mailto:')).toBe('mailto:');
      expect(normalizeUrlProtocol('Tel:')).toBe('tel:');
    });
  });

  describe('fuzz invariants (A29)', () => {
    const base = 'https://page.example/dir/';
    const resolve = (value: string): URL | null => {
      try {
        return new URL(value, base);
      } catch {
        return null;
      }
    };
    const values = [...fuzzUrls(20260929, 20_000), ...URL_CORPUS.map(row => row.value).filter((value): value is string => typeof value === 'string')];

    it('allows a link only where the parser resolves the same address to an allowed scheme, on the page origin when relative', () => {
      const problems: string[] = [];
      const counts = { allowed: 0, unsupported: 0, unsafe: 0 };
      for (const value of values) {
        const check = checkUrl(value, LINK_PROFILE);
        counts[check.status]++;
        if (check.status !== 'allowed') continue;
        const resolved = resolve(value);
        const cleaned = resolve(check.url);
        if (!resolved || !cleaned) { problems.push(`unparsable ${label(value)}`); continue; }
        if (resolved.href !== cleaned.href) problems.push(`cleaning changed ${label(value)}`);
        if (!['http:', 'https:', 'mailto:', 'tel:'].includes(resolved.protocol)) problems.push(`scheme ${resolved.protocol} ${label(value)}`);
        if (resolved.username !== '' || resolved.password !== '') problems.push(`credentials ${label(value)}`);
        if (!/^[a-z][a-z0-9+.-]*:/i.test(check.url) && resolved.origin !== 'https://page.example') problems.push(`origin ${label(value)}`);
      }
      expect(problems).toEqual([]);
      // The fuzzer reaches every outcome, so the invariants are not met vacuously.
      for (const count of Object.values(counts)) expect(count).toBeGreaterThan(1000);
    });

    it('allows an image source only where the parser never resolves it to a script, file or non-image data address', () => {
      const problems: string[] = [];
      for (const allowDataImages of [true, false]) {
        for (const value of values) {
          const check = checkUrl(value, imageProfile(allowDataImages));
          if (check.status !== 'allowed') continue;
          const resolved = resolve(value);
          if (!resolved) { problems.push(`unparsable ${label(value)}`); continue; }
          if (resolved.href !== resolve(check.url)?.href) problems.push(`cleaning changed ${label(value)}`);
          if (['javascript:', 'vbscript:', 'file:'].includes(resolved.protocol)) problems.push(`scheme ${resolved.protocol} ${label(value)}`);
          if (resolved.protocol === 'data:' && (!allowDataImages || !/^\s*image\//i.test(resolved.pathname))) problems.push(`data ${label(value)}`);
        }
      }
      expect(problems).toEqual([]);
    });

    it('allows nothing that reads as another scheme, origin or host once a browser decodes its character references', () => {
      // HTML that leaves `&` unescaped in an attribute, as linkedom writes it, reaches the browser
      // that reads it with every character reference decoded.
      const decoded = (value: string): string => {
        const holder = document.createElement('div');
        holder.innerHTML = `<a href="${value.replace(/"/g, '&quot;')}"></a>`;
        return holder.querySelector('a')?.getAttribute('href') ?? '';
      };
      const problems: string[] = [];
      let references = 0;
      for (const value of values) {
        const link = checkUrl(value, LINK_PROFILE);
        if (link.status === 'allowed') {
          const read = decoded(link.url);
          if (read !== link.url) references++;
          const resolved = resolve(read);
          if (!resolved) problems.push(`link unparsable ${label(value)}`);
          else {
            if (!['http:', 'https:', 'mailto:', 'tel:'].includes(resolved.protocol)) problems.push(`link scheme ${resolved.protocol} ${label(value)}`);
            if (resolved.username !== '' || resolved.password !== '') problems.push(`link credentials ${label(value)}`);
            if (!/^[a-z][a-z0-9+.-]*:/i.test(link.url) && resolved.origin !== 'https://page.example') problems.push(`link origin ${label(value)}`);
            if (/^[a-z][a-z0-9+.-]*:/i.test(link.url) && resolved.hostname !== resolve(link.url)?.hostname) problems.push(`link host ${label(value)}`);
          }
        }
        for (const allowDataImages of [true, false]) {
          const image = checkUrl(value, imageProfile(allowDataImages));
          if (image.status !== 'allowed') continue;
          const resolved = resolve(decoded(image.url));
          if (resolved && ['javascript:', 'vbscript:', 'file:'].includes(resolved.protocol)) problems.push(`image scheme ${resolved.protocol} ${label(value)}`);
          if (resolved?.protocol === 'data:' && !allowDataImages) problems.push(`image data ${label(value)}`);
        }
      }
      expect(problems).toEqual([]);
      // Allowed addresses that hold a character reference exist, so the check is not met vacuously.
      expect(references).toBeGreaterThan(100);
    });

    it('refuses every value the parser resolves to a script scheme, whatever the options', () => {
      const problems: string[] = [];
      const everything = [LINK_PROFILE, imageProfile(true), { protocols: 'any' as const, allowRelative: true, allowNetworkPath: true, allowDataImages: true }];
      for (const value of values) {
        const protocol = resolve(value)?.protocol;
        if (protocol !== 'javascript:' && protocol !== 'vbscript:') continue;
        for (const options of everything) if (checkUrl(value, options).status !== 'unsafe') problems.push(label(value));
      }
      expect(problems).toEqual([]);
    });
  });
});
