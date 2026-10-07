import type { PasteSource } from './types.js';

/**
 * What the markup of clipboard HTML says about the application that wrote it. Only markup counts: start tags with
 * their attribute values as written, the rules of `style` elements, and Office's conditional comments, whose content
 * is Office's markup. Text never does, so a page whose text, title, alt text, link or free comment names an Office
 * class, property or namespace, or Google Docs' copy wrapper, is no copy of that application:
 *
 * - Word (and the other Office applications): an `xmlns:*` declaration of an Office namespace
 *   (`urn:schemas-microsoft-com:office:*`), a class starting `MsoNormal`, an `mso-*` declaration in a style
 *   attribute, a stylesheet whose rules declare an `mso-*` property, style a `MsoNormal` class or name the Office
 *   namespace, any of them in a conditional comment (`<!--[if gte mso 10]>...<![endif]-->`), or an
 *   `xml:namespace` instruction declaring an Office namespace.
 * - Google Docs: an element whose id starts `docs-internal-guid-`, the wrapper Docs puts around its copy.
 * - LibreOffice: a `meta` named `generator` whose content names LibreOffice or OpenOffice.
 *
 * Word comes first, then Google Docs, then LibreOffice.
 */
export interface ClipboardMarkup {
  /** The application whose markup the HTML holds, or plain HTML. */
  readonly source: PasteSource;
}

// Necessary conditions: HTML without any of these words holds no such markup and is not scanned.
const WORD_CANDIDATE = /mso-|msonormal|urn:schemas-microsoft-com:office/i;
const DOCS_CANDIDATE = /docs-internal-guid-/i;
const LIBRE_CANDIDATE = /libreoffice|openoffice/i;

const OFFICE_NAMESPACE = /urn:schemas-microsoft-com:office/i;
// A class token as Word writes its Normal style's paragraphs and tables: MsoNormal, MsoNormalTable.
const WORD_CLASS = /(?:^|[\t\n\f\r ])msonormal/i;
// A declaration of one of Office's own properties, as Word writes them in style attributes.
const OFFICE_DECLARATION = /(?:^|[\t\n\f\r ;])mso-[\w-]*[\t\n\f\r ]*:/i;
// Word's stylesheet: a rule that declares an Office property, styles a MsoNormal class, or the Office namespace.
const WORD_STYLESHEET = /(?:^|[\t\n\f\r ;{])mso-[\w-]*[\t\n\f\r ]*:|\.msonormal|urn:schemas-microsoft-com:office/i;
const XML_NAMESPACE = /^<\?xml:namespace[\t\n\f\r ]/i;
const DOCS_ID = /^docs-internal-guid-/i;
const GENERATOR = /^generator$/i;
const LIBRE_GENERATOR = /libreoffice|openoffice/i;

// Elements whose content is text up to their end tag, never markup. `plaintext` has no end.
const RAW_TEXT = ['style', 'script', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'title', 'textarea'];
const rawTextEnds: ReadonlyMap<string, RegExp> = new Map(RAW_TEXT.map(name => [name, new RegExp(`</${name}[\\t\\n\\f\\r />]`, 'gi')]));
// A conditional comment, as Office writes markup for itself: `<!--[if gte mso 9]>...<![endif]-->`.
const CONDITIONAL = /^\[if[\t\n\f\r ]/i;

const isSpace = (code: number): boolean => code === 32 || code === 9 || code === 10 || code === 12 || code === 13;
const isLetter = (code: number): boolean => (code >= 65 && code <= 90) || (code >= 97 && code <= 122);

type Attribute = readonly [name: string, value: string];

/** What a scan hands over. Each callback returns whether the answer is settled, which stops the scan. */
interface MarkupVisitor {
  /** Whether an attribute of this name is read; the others are skipped. */
  reads(name: string): boolean;
  /** A start tag the tokenizer emits, with the attributes read: the first of each name, each value as written. */
  tag(name: string, attributes: readonly Attribute[]): boolean;
  /** The text of a `style` element. */
  stylesheet(text: string): boolean;
  /** A processing instruction, from `<?` to its `>`. */
  instruction(text: string): boolean;
}

/** A stylesheet without its comments, which declare nothing. An unclosed comment runs to the end. */
function withoutComments(css: string): string {
  let text = '';
  let index = 0;
  for (let open = css.indexOf('/*'); open >= 0; open = css.indexOf('/*', index)) {
    text += css.slice(index, open) + ' ';
    const close = css.indexOf('*/', open + 2);
    if (close < 0) return text;
    index = close + 2;
  }
  return text + css.slice(index);
}

/**
 * Read the markup of `html` as the HTML tokenizer does and hand it to the visitor: each start tag the tokenizer
 * emits (one cut off by the end of the input is none), the text of each `style` element and each processing
 * instruction. A conditional comment's content is read as markup once more; text, other comments, CDATA, end tags
 * and the content of raw text elements are skipped. Returns whether the visitor settled its answer. Every search
 * moves forward from where the last one ended, so the work is linear in the length of the HTML.
 */
function scan(html: string, visitor: MarkupVisitor, nested = false): boolean {
  const end = html.length;
  const seen = new Set<string>();
  // The next `--!>`, which also closes a comment, searched again only once a comment has passed it.
  let bangFrom = -1;
  let bang = -1;
  const nextBang = (from: number): number => {
    if (bangFrom < 0 || (bang >= 0 && bang < from)) { bang = html.indexOf('--!>', from); bangFrom = from; }
    return bang;
  };
  let index = 0;
  while (index < end) {
    const open = html.indexOf('<', index);
    if (open < 0) return false;
    const next = html.charCodeAt(open + 1);
    if (next === 33) {
      if (html.startsWith('<!--', open)) {
        const data = open + 4;
        let dataEnd = data;
        let after: number;
        if (html.charCodeAt(data) === 62) after = data + 1;
        else if (html.startsWith('->', data)) after = data + 2;
        else {
          const close = html.indexOf('-->', data);
          const closeBang = nextBang(data);
          if (close < 0 && closeBang < 0) { dataEnd = end; after = end; }
          else if (closeBang >= 0 && (close < 0 || closeBang < close)) { dataEnd = closeBang; after = closeBang + 4; }
          else { dataEnd = close; after = close + 3; }
        }
        if (!nested && CONDITIONAL.test(html.slice(data, Math.min(dataEnd, data + 4))) && scan(html.slice(data, dataEnd), visitor, true)) return true;
        index = after;
        continue;
      }
      // A doctype, Office's downlevel `<![if !vml]>` and other declarations end at their `>`. CDATA is text in SVG and
      // MathML and no markup anywhere, so it runs to its `]]>`.
      const cdata = html.startsWith('<![CDATA[', open);
      const close = cdata ? html.indexOf(']]>', open + 9) : html.indexOf('>', open + 2);
      if (close < 0) return false;
      index = close + (cdata ? 3 : 1);
      continue;
    }
    if (next === 63) {
      const close = html.indexOf('>', open + 2);
      if (visitor.instruction(html.slice(open, close < 0 ? end : close + 1))) return true;
      if (close < 0) return false;
      index = close + 1;
      continue;
    }
    const closing = next === 47;
    const nameStart = closing ? open + 2 : open + 1;
    if (!isLetter(html.charCodeAt(nameStart))) {
      if (!closing) { index = open + 1; continue; }
      // `</>` is nothing, and `</` before anything but a letter opens a comment to the next `>`.
      const close = html.charCodeAt(nameStart) === 62 ? nameStart : html.indexOf('>', nameStart);
      if (close < 0) return false;
      index = close + 1;
      continue;
    }
    let at = nameStart + 1;
    while (at < end) {
      const code = html.charCodeAt(at);
      if (isSpace(code) || code === 47 || code === 62) break;
      at++;
    }
    const tag = html.slice(nameStart, at).toLowerCase();
    const attributes: Attribute[] = [];
    seen.clear();
    let tagEnd = -1;
    while (at < end) {
      const code = html.charCodeAt(at);
      if (code === 62) { tagEnd = at + 1; break; }
      if (isSpace(code) || code === 47) { at++; continue; }
      // An attribute: its name, whose first character may be `=`, then an optional value.
      const name = at;
      at++;
      while (at < end) {
        const char = html.charCodeAt(at);
        if (isSpace(char) || char === 47 || char === 62 || char === 61) break;
        at++;
      }
      const attribute = html.slice(name, at).toLowerCase();
      while (at < end && isSpace(html.charCodeAt(at))) at++;
      let valueStart = at;
      let valueEnd = at;
      if (html.charCodeAt(at) === 61) {
        at++;
        while (at < end && isSpace(html.charCodeAt(at))) at++;
        const quote = html.charCodeAt(at);
        if (quote === 34 || quote === 39) {
          const close = html.indexOf(quote === 34 ? '"' : "'", at + 1);
          valueStart = at + 1;
          valueEnd = close < 0 ? end : close;
          at = close < 0 ? end : close + 1;
        } else if (quote !== 62) {
          valueStart = at;
          while (at < end) {
            const char = html.charCodeAt(at);
            if (isSpace(char) || char === 62) break;
            at++;
          }
          valueEnd = at;
        }
      }
      // The tokenizer keeps the first attribute of a name and drops the others.
      if (closing || seen.has(attribute)) continue;
      seen.add(attribute);
      if (visitor.reads(attribute)) attributes.push([attribute, html.slice(valueStart, valueEnd)]);
    }
    // A tag the input ends in is no tag.
    if (tagEnd < 0) return false;
    index = tagEnd;
    if (closing) continue;
    if (visitor.tag(tag, attributes)) return true;
    if (tag === 'plaintext') return false;
    const rawEnd = rawTextEnds.get(tag);
    if (rawEnd !== undefined) {
      rawEnd.lastIndex = index;
      const match = rawEnd.exec(html);
      const contentEnd = match === null ? end : match.index;
      if (tag === 'style' && visitor.stylesheet(html.slice(index, contentEnd))) return true;
      index = contentEnd;
    }
  }
  return false;
}

const READ = new Set(['class', 'style', 'id', 'name', 'content', 'xmlns']);

/** The application whose markup the clipboard HTML holds, read from its markup only. */
export function readClipboardMarkup(html: string): ClipboardMarkup {
  const wordCandidate = WORD_CANDIDATE.test(html);
  const docsCandidate = DOCS_CANDIDATE.test(html);
  const libreCandidate = LIBRE_CANDIDATE.test(html);
  if (!wordCandidate && !docsCandidate && !libreCandidate) return { source: 'html' };
  const found = { word: false, docs: false, libre: false };
  // Word outranks the others, so the answer is settled once Word is found, or once nothing above what was found can be.
  const settled = (): boolean => found.word || (!wordCandidate && (found.docs || (!docsCandidate && found.libre)));
  scan(html, {
    reads: name => READ.has(name) || name.startsWith('xmlns:'),
    tag(tag, attributes) {
      let metaName = '';
      let metaContent = '';
      for (const [name, value] of attributes) {
        if (name === 'class') found.word ||= wordCandidate && WORD_CLASS.test(value);
        else if (name === 'style') found.word ||= wordCandidate && OFFICE_DECLARATION.test(value);
        else if (name === 'id') found.docs ||= docsCandidate && DOCS_ID.test(value);
        else if (name === 'name') metaName = value;
        else if (name === 'content') metaContent = value;
        else found.word ||= wordCandidate && OFFICE_NAMESPACE.test(value);
      }
      if (tag === 'meta') found.libre ||= libreCandidate && GENERATOR.test(metaName) && LIBRE_GENERATOR.test(metaContent);
      return settled();
    },
    stylesheet(text) {
      found.word ||= wordCandidate && WORD_STYLESHEET.test(withoutComments(text));
      return settled();
    },
    instruction(text) {
      found.word ||= wordCandidate && XML_NAMESPACE.test(text) && OFFICE_NAMESPACE.test(text);
      return settled();
    },
  });
  return { source: found.word ? 'word' : found.docs ? 'google-docs' : found.libre ? 'libreoffice' : 'html' };
}
