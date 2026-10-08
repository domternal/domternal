/** The references a DOM serializer writes in text, decoded once each. */
const NAMED_REFERENCES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

/** Decodes the character references of serialized text in one pass, so `&amp;lt;` stays `&lt;`. */
export function decodeText(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]+));/g, (reference, decimal?: string, hex?: string, name?: string) => {
    if (name !== undefined) return NAMED_REFERENCES[name] ?? reference;
    const code = decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex ?? '', 16);
    return code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : reference;
  });
}

/** Elements whose content a DOM serializer writes as raw text, never as markup. */
const RAW_TEXT_ELEMENTS = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext']);

/** The index just after the tag that starts at `start`, skipping `>` inside quoted attribute values. */
function tagEnd(html: string, start: number): number {
  let quote = '';
  for (let index = start + 1; index < html.length; index++) {
    const char = html[index];
    if (quote !== '') {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return index + 1;
    }
  }
  return html.length;
}

const CODE_OPEN = /<code(?:\s+class="language-([^"]*)")?>/y;
const CODE_CLOSE = '</code></pre>';

/**
 * Rewrites the content of every real code block in serialized HTML with
 * `highlight(text, language)`, where `text` is the serialized code text and
 * `language` the code element's language class. A null result keeps the text.
 */
export function highlightCodeBlocks(
  html: string,
  highlight: (text: string, language: string | undefined) => string | null,
): string {
  // Serialized HTML holds elements, attributes and text only. In text, `<`
  // always starts a tag, since text escapes it; a tag is copied whole, so a
  // `<pre>` inside an attribute value is never read as a code block.
  let output = '';
  let index = 0;
  while (index < html.length) {
    const open = html.indexOf('<', index);
    if (open < 0) {
      output += html.slice(index);
      break;
    }
    output += html.slice(index, open);
    if (html.startsWith('<!--', open)) {
      const close = html.indexOf('-->', open + 4);
      const end = close < 0 ? html.length : close + 3;
      output += html.slice(open, end);
      index = end;
      continue;
    }
    const end = tagEnd(html, open);
    const tag = html.slice(open, end);
    index = end;
    const name = /^<([a-zA-Z][^\s/>]*)/.exec(tag)?.[1]?.toLowerCase();
    if (name === 'pre') {
      CODE_OPEN.lastIndex = end;
      const code = CODE_OPEN.exec(html);
      const contentStart = end + (code?.[0].length ?? 0);
      const close = code === null ? -1 : html.indexOf(CODE_CLOSE, contentStart);
      const text = close < 0 ? '' : html.slice(contentStart, close);
      // A code block holds text only; anything else is left as it is.
      if (code !== null && close >= 0 && !text.includes('<')) {
        const highlighted = highlight(text, code[1]);
        output += `${tag}${code[0]}${highlighted ?? text}${CODE_CLOSE}`;
        index = close + CODE_CLOSE.length;
        continue;
      }
    }
    output += tag;
    if (name !== undefined && RAW_TEXT_ELEMENTS.has(name)) {
      const close = html.toLowerCase().indexOf(`</${name}`, index);
      const stop = close < 0 ? html.length : close;
      output += html.slice(index, stop);
      index = stop;
    }
  }
  return output;
}
