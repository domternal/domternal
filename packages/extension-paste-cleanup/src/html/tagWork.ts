const MAX_ATTRIBUTES = 256;
const MAX_ATTRIBUTE_NAME = 256;

type State = 'name' | 'beforeAttribute' | 'attributeName' | 'afterAttributeName'
  | 'beforeValue' | 'quotedValue' | 'unquotedValue' | 'afterQuotedValue' | 'selfClosing';

/** The lexical work needed to parse a tag exceeds the clipboard resource budget. */
export class TagWorkLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TagWorkLimitError';
  }
}

function isSpace(character: string): boolean {
  return character === ' ' || character === '\t' || character === '\n'
    || character === '\r' || character === '\f';
}

function isLetter(character: string | undefined): boolean {
  if (character === undefined) return false;
  const code = character.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/**
 * A resource guard before parse5, not an HTML parser or sanitizer.
 *
 * Each possible start/end tag is examined independently. This intentionally
 * includes candidates in comments, raw text and attribute values: a speculative
 * tag inside script text must not hide a real tag after the closing script.
 * Such input may be conservatively rejected. A shared linear work allowance
 * bounds overlapping candidates so this guard cannot itself become quadratic.
 * Quoted values, including large data URLs and literal greater-than signs, do
 * not consume the attribute-name budget. Quotes only open after an equals sign.
 */
export function assertTagWork(html: string): void {
  const maximumWork = html.length * 4 + 1024;
  let work = 0;
  const step = (): void => {
    if (++work > maximumWork) throw new TagWorkLimitError('Overlapping tag candidates exceed the scan budget');
  };

  const inspect = (start: number): void => {
    let state: State = 'name';
    let attributes = 0;
    let nameLength = 0;
    let quote = '';
    const beginAttribute = (): 'attributeName' => {
      if (++attributes > MAX_ATTRIBUTES) throw new TagWorkLimitError('A tag contains more than 256 attributes');
      nameLength = 1;
      return 'attributeName';
    };

    for (let index = start; index < html.length; index++) {
      step();
      const character = html[index];
      if (character === undefined) break;
      switch (state) {
        case 'name':
          if (character === '>') return;
          if (character === '/') state = 'selfClosing';
          else if (isSpace(character)) state = 'beforeAttribute';
          break;
        case 'beforeAttribute':
        case 'afterQuotedValue':
        case 'selfClosing':
          if (character === '>') return;
          if (isSpace(character)) state = 'beforeAttribute';
          else if (character === '/') state = 'selfClosing';
          else state = beginAttribute();
          break;
        case 'attributeName':
          if (character === '>') return;
          if (character === '/') state = 'selfClosing';
          else if (character === '=') state = 'beforeValue';
          else if (isSpace(character)) state = 'afterAttributeName';
          else if (++nameLength > MAX_ATTRIBUTE_NAME) {
            throw new TagWorkLimitError('An attribute name exceeds 256 characters');
          }
          break;
        case 'afterAttributeName':
          if (character === '>') return;
          if (character === '=') state = 'beforeValue';
          else if (character === '/') state = 'selfClosing';
          else if (!isSpace(character)) state = beginAttribute();
          break;
        case 'beforeValue':
          if (character === '>') return;
          if (character === '"' || character === "'") {
            quote = character;
            state = 'quotedValue';
          } else if (!isSpace(character)) state = 'unquotedValue';
          break;
        case 'quotedValue':
          if (character === quote) state = 'afterQuotedValue';
          break;
        case 'unquotedValue':
          if (character === '>') return;
          if (isSpace(character)) state = 'beforeAttribute';
          break;
      }
    }
  };

  for (let index = 0; index < html.length; index++) {
    step();
    if (html[index] !== '<') continue;
    const start = html[index + 1] === '/' ? index + 2 : index + 1;
    if (isLetter(html[start])) inspect(start);
  }
}
