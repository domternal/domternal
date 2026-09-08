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
    // Every invisible format character (Unicode Cf): the joiners and marks, and the soft hyphen, the Arabic and
    // Syriac signs, the Mongolian vowel separator, the deprecated format controls, the interlinear annotation
    // controls, the musical symbol format controls and the tag characters.
    const FORMAT = ['\u061c', '\u200b', '\u200c', '\u200d', '\u200e', '\u200f', '\u2060', '\u2061', '\u2062', '\u2063', '\u2064', '\ufeff',
      '\u00ad', '\u0600', '\u06dd', '\u070f', '\u180e', '\u206a', '\u206f', '\ufff9', '\ufffb', '\u{110bd}', '\u{1d173}', '\u{e0001}', '\u{e0041}', '\u{e007f}'];
    const BIDI_CONTROLS = ['\u202a', '\u202b', '\u202c', '\u202d', '\u202e', '\u2066', '\u2067', '\u2068', '\u2069'];
    const options = { protocols: ['https:', 'mailto:', 'tel:', 'myapp:'], allowRelative: true };
    // A mail or phone address without right-to-left letters may hold the controls that keep it left to right.
    const LEFT_TO_RIGHT_CONTROLS = new Set(['\u200e', '\u202a', '\u202c', '\u2066', '\u2069']);
    const expectedFor = (value: string, char: string): string =>
      LEFT_TO_RIGHT_CONTROLS.has(char) && /^(?:mailto|tel):(?!\/\/)/.test(value) ? 'allowed' : 'unsafe';

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
          expect(checkUrl(value, { ...options, allowNetworkPath: true }).status, JSON.stringify(value)).toBe(expectedFor(value, char));
          expect(checkUrl(value, options).status, JSON.stringify(value)).toBe(expectedFor(value, char));
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

    const encoded = (char: string): string => encodeURIComponent(char);

    it('judges the whole address of a scheme without a host, where a slash means nothing', () => {
      for (const char of FORMAT) {
        for (const value of [`mailto:a/b@ev${char}il.example`, `mailto:a@b/c${char}d`, `tel:+1/${char}234`, `tel:+1\\${char}2`,
          `myapp:a/b${char}c`, `mailto:a@b.example/x${char}?subject=y`]) {
          expect(checkUrl(value, options).status, JSON.stringify(value)).toBe(expectedFor(value, char));
        }
      }
    });

    it('judges that address percent-decoded, as a mail client or dialer reads it', () => {
      for (const char of [...FORMAT, ...BIDI_CONTROLS, '\u0000', '\n', '\u001f', '\u007f', '\u0085', '￾', '￿']) {
        for (const value of [`mailto:${encoded(char)}moc.elgoog@evil.example`, `mailto:a${encoded(char)}b@x.example`,
          `mailto:a@x${encoded(char)}.example`, `tel:${encoded(char)}1234`, `tel:+385${encoded(char).toLowerCase()}1`, `myapp:a${encoded(char)}b`]) {
          expect(checkUrl(value, options).status, JSON.stringify(value)).toBe(expectedFor(value, char));
        }
      }
      // A malformed sequence reads as U+FFFD, which hides nothing; a valid one next to it still counts.
      expect(checkUrl('tel:%FF1', options).status).toBe('allowed');
      expect(checkUrl('tel:+1%E2%80', options).status).toBe('allowed');
      expect(checkUrl('tel:+385%E2%80%AE%80', options).status).toBe('unsafe');
      expect(checkUrl('mailto:a%0D%0ABcc:x@y.example', options).status).toBe('unsafe');
    });

    it('judges the to, cc and bcc fields of a mailto: query, which name recipients too', () => {
      for (const field of ['to', 'cc', 'bcc', 'CC', 'c%63', 'b%63c']) {
        for (const value of [`mailto:a@b.example?${field}=%E2%80%AEmoc.elgoog@evil.example`, `mailto:a@b.example?subject=x&${field}=e‍vil@x.example`,
          `mailto:?${field}=x%00@y.example`]) {
          expect(checkUrl(value, options).status, JSON.stringify(value)).toBe('unsafe');
        }
      }
      // Free text fields and web queries keep what browsers percent-encode.
      for (const value of ['mailto:a@b.example?subject=%E2%80%AE', 'mailto:a@b.example?body=a%0D%0Ab', 'mailto:a@b.example?subject=a‌b',
        'mailto:a@b.example?in-reply-to=%E2%80%8B', 'mailto:a@b.example?cc', 'https://example.com/?cc=%E2%80%AE', 'https://example.com/%E2%80%8B']) {
        expect(checkUrl(value, options).status, JSON.stringify(value)).toBe('allowed');
      }
    });

    it('judges a host percent-decoded, so an encoded character is refused like a written one', () => {
      for (const value of ['https://ex%E2%80%8Bample.com/', 'https://ex%E2%80%AEample.com/', 'myapp://ho%E2%80%8Bst/path', 'https://example.com%00/']) {
        expect(checkUrl(value, options).status, JSON.stringify(value)).toBe('unsafe');
      }
      expect(checkUrl('//cdn%E2%80%8C.example/x.png', { ...options, allowNetworkPath: true }).status).toBe('unsafe');
    });

    it('keeps ordinary encoded addresses', () => {
      for (const value of ['tel:+1%20555%20123', 'mailto:J%C3%B6rg@example.com', 'mailto:a@b.example?subject=Gr%C3%BC%C3%9Fe', 'myapp://my%20host/path',
        'mailto:%61@b.example', 'tel:%2B385']) {
        expect(checkUrl(value, options), JSON.stringify(value)).toEqual({ status: 'allowed', url: value });
      }
    });

    describe('mail, phone and message links written in a right-to-left environment', () => {
      // LRM, LRE, LRI, and the PDF and PDI that end an embedding or isolate: they only keep text left to right.
      const LEFT_TO_RIGHT = ['\u200e', '\u202a', '\u202c', '\u2066', '\u2069'];
      // RLM, ALM, RLE, RLO, LRO, RLI and FSI reorder even a phone number, such as +972 3-123-4567 shown as 3-123-4567 972+.
      const REORDERING = ['\u200f', '\u061c', '\u202b', '\u202e', '\u202d', '\u2067', '\u2068'];
      const addressOptions = { protocols: ['https:', 'mailto:', 'tel:', 'sms:', 'myapp:'] };

      it('allows the controls that keep a phone number or mail address left to right, as they write it', () => {
        for (const value of ['tel:\u202a+972-3-123-4567\u202c', 'tel:\u200e+1 555 123 4567', 'tel:\u2066+1 555 123 4567\u2069', 'mailto:\u200eperson@example.com',
          'mailto:\u202aperson@example.com\u202c?subject=Hi', 'sms:\u202a+385 1 234 5678\u202c', 'tel:%E2%80%8E+1%20555', 'mailto:%E2%80%AAa@b.example%E2%80%AC',
          'mailto:a@b.example?cc=\u200ec@d.example', 'mailto:a@b.example?subject=x\u202ay\u202c', 'tel:+1\u200e;ext=\u200e12']) {
          expect(checkUrl(value, addressOptions), JSON.stringify(value)).toEqual({ status: 'allowed', url: value });
        }
      });

      it('refuses the controls that reorder an address, literal or percent-encoded', () => {
        for (const char of REORDERING) {
          for (const value of [`tel:${char}+972-3-123-4567`, `tel:+972 3${char}-123-4567`, `mailto:${char}person@example.com`,
            `sms:${char}+385`, `tel:${encoded(char)}+1`, `mailto:a@b.example?cc=${encoded(char)}c@d.example`]) {
            expect(checkUrl(value, addressOptions).status, JSON.stringify(value)).toBe('unsafe');
          }
        }
      });

      it('refuses them in a link with right-to-left letters, which a left-to-right control can reorder', () => {
        for (const char of LEFT_TO_RIGHT) {
          for (const value of [`mailto:${char}\u05e9\u05dc\u05d5\u05dd@example.com`, `mailto:\u0633\u0644${char}\u0627\u0645@example.com`,
            `mailto:${char}a@b.example?subject=\u05e9`, `tel:${char}+972%D7%A9`, `mailto:a@b.example?subject=\u05e9${char}`]) {
            const check = checkUrl(value, addressOptions).status;
            // A bidi mark in a query outside the address stays allowed, as in a web address; the embeddings and isolates do not.
            const expected = char === '\u200e' && value.includes('?subject=\u05e9\u200e') ? 'allowed' : 'unsafe';
            expect(check, JSON.stringify(value)).toBe(expected);
          }
        }
      });

      it('keeps refusing them in web addresses, in custom schemes and in a mail address with a host', () => {
        for (const char of LEFT_TO_RIGHT) {
          for (const value of [`https://${char}example.com/`, `https://example.com${char}/`, `myapp:${char}a`, `mailto://${char}ex.example`]) {
            expect(checkUrl(value, addressOptions).status, JSON.stringify(value)).toBe('unsafe');
          }
        }
        for (const char of ['\u202a', '\u202c', '\u2066', '\u2069']) {
          expect(checkUrl(`https://example.com/a${char}b`, addressOptions).status).toBe('unsafe');
        }
      });
    });

    it('stays linear when a long value holds them', () => {
      const start = performance.now();
      checkUrl(`https://example.com/${'\u200c'.repeat(1_000_000)}`, LINK_PROFILE);
      checkUrl(`${'\u200c'.repeat(1_000_000)}:`, LINK_PROFILE);
      checkUrl(`https://${'\u200c'.repeat(1_000_000)}`, LINK_PROFILE);
      expect(performance.now() - start).toBeLessThan(2000);
    });
  });

  describe('credentials', () => {
    it('refuses them in web, mail and phone addresses, where a user reads as the host', () => {
      const protocols = ['http:', 'https:', 'ws:', 'wss:', 'mailto:', 'tel:'];
      for (const value of ['https://google.com@evil.example/', 'http://user:pass@example.com/', 'HTTPS://a:@example.com/',
        'https://:pass@example.com/', 'https:google.com@evil.example', 'ws://a@example.com/', 'wss://a@example.com/',
        'mailto://google.com@evil.example', 'tel://user@host']) {
        expect(checkUrl(value, { protocols }).status, value).toBe('unsafe');
      }
    });

    it('allows a user where it is the standard form of a scheme the options list', () => {
      const protocols = ['ssh:', 'ftp:', 'smb:', 'git+ssh:', 'sftp:', 'rtsp:', 'ldap:'];
      for (const value of ['ssh://git@github.com/org/repo.git', 'ftp://anonymous@ftp.example.com/pub/', 'smb://user@fileserver/share',
        'git+ssh://git@github.com/org/repo.git', 'sftp://user:secret@host.example/dir', 'rtsp://viewer@camera.local/stream',
        'ldap://cn=admin@ldap.example/']) {
        expect(checkUrl(value, { protocols }), value).toEqual({ status: 'allowed', url: value });
      }
      expect(checkUrl('ssh://git@github.com/org/repo.git', { protocols: 'any' }).status).toBe('allowed');
    });

    it('still refuses them in a network path, which reads as a web address', () => {
      expect(checkUrl('//user@cdn.example/x.png', { allowRelative: true, allowNetworkPath: true }).status).toBe('unsafe');
    });
  });

  describe('hosts of schemes without a web host', () => {
    it('keep their percent-encoding, which only a web host never holds once parsed', () => {
      const protocols = ['myapp:', 'smb:', 'https:'];
      expect(checkUrl('myapp://my%20host/path', { protocols })).toEqual({ status: 'allowed', url: 'myapp://my%20host/path' });
      expect(checkUrl('smb://file%2Dserver/share', { protocols }).status).toBe('allowed');
      expect(checkUrl('https://exa%20mple.com/', { protocols }).status).toBe('unsupported');
    });

    it('still refuse an `&`, where a character reference could spell another host or a user', () => {
      expect(checkUrl('myapp://a&#64;b/path', { protocols: ['myapp:'] }).status).toBe('unsupported');
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

    it('refuses a character reference in the first segment, where a browser that decodes it reads a scheme', () => {
      // A numeric reference's `#` ends the segment for the URL parser, not for the HTML decoder.
      for (const value of ['javascript&colon;alert(1)', 'javascript&#58alert(1)', 'javascript&#x3A;alert(1)', 'javascript&#0058;x',
        '&#106;avascript:alert(1)', 'java&#115;cript&#58;x', 'a&amp;b.png', 'x&#35;y']) {
        expect(checkUrl(value, relative).status, value).toBe('unsupported');
        expect(checkUrl(value, { ...relative, allowNetworkPath: true }).status, value).toBe('unsupported');
      }
    });

    it('keeps an & that starts no reference, which stays text wherever HTML is decoded', () => {
      for (const value of ['R&D.png', 'Q&A.png', 'a&b', 'a&b/c:d', '&copy2024.png', 'a&amp.png', 'x&lt.png', '&', '&;', '&#']) {
        const expected = value === '&#' ? 'unsupported' : 'allowed';
        expect(checkUrl(value, relative).status, value).toBe(expected);
      }
      expect(checkUrl('/&x/y', relative)).toEqual({ status: 'allowed', url: '/&x/y' });
      expect(checkUrl('/&#47;evil.example/x', relative).status).toBe('unsupported');
      expect(checkUrl('/&sol;evil.example/x', relative).status).toBe('unsupported');
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

  describe('long data images', () => {
    /** Counts the URL parser's runs while `run` executes. */
    function parses(run: () => void): number {
      const Native = globalThis.URL;
      let count = 0;
      globalThis.URL = class extends Native {
        constructor(...args: ConstructorParameters<typeof URL>) {
          super(...args);
          count++;
        }
      };
      try {
        run();
      } finally {
        globalThis.URL = Native;
      }
      return count;
    }
    const data = `data:image/png;base64,${'A'.repeat(4 * 1024 * 1024)}`;

    it('judges a data image without the URL parser, which can reject none', () => {
      expect(parses(() => {
        expect(checkUrl(data, imageProfile(true))).toEqual({ status: 'allowed', url: data });
        expect(checkUrl(` DATA: Image/PNG;base64,${'A'.repeat(64)}`, imageProfile(true)).status).toBe('allowed');
      })).toBe(0);
      expect(parses(() => { checkUrl('https://example.com/a.png', imageProfile(true)); })).toBe(1);
    });

    it('still refuses a hidden character anywhere in a long data image', () => {
      for (const hidden of ['\u0000', '\u0085', '\u202e', '\u2066', '\ud800', '\udc00', '\uffff']) {
        const middle = data.length / 2;
        const value = `${data.slice(0, middle)}${hidden}${data.slice(middle)}`;
        expect(checkUrl(value, imageProfile(true)).status, JSON.stringify(hidden)).toBe('unsafe');
      }
      expect(checkUrl(`${data}\ud83d\ude00`, imageProfile(true)).status).toBe('allowed');
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
