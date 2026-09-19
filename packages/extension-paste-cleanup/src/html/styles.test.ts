// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { plainDeclarations, readSafeStyles } from './styles.js';
import { normalizePasteHTML } from './index.js';
import type { NormalizePasteHTMLOptions, NormalizePasteHTMLResult } from './index.js';
import { normalizeClipboardHTML } from './normalize.js';

// A verified own copy: the anchor carries a nonce that the private verifier confirms.
const OWN_NONCE = 'OwnCopyNonceOwnCopy_-A';
function ownCopy(html: string, options: NormalizePasteHTMLOptions = {}): NormalizePasteHTMLResult {
  return normalizeClipboardHTML(html.replace('data-pm-slice', `data-domternal-copy="v1.${OWN_NONCE}" data-pm-slice`),
    options, undefined, undefined, undefined, nonce => nonce === OWN_NONCE).result;
}

const inheritedNames = ['constructor', '__proto__', 'CONSTRUCTOR', '__PROTO__'];

describe('safe CSS rule lookup', () => {
  it.each(inheritedNames)('removes a %s declaration without discarding its valid sibling', name => {
    expect(readSafeStyles(`${name}:x;color:red`)).toEqual({ styles: new Map([['color', 'red']]), removed: true });
    expect(readSafeStyles(`${name}:auto;float:LEFT`, true)).toEqual({ styles: new Map([['float', 'left']]), removed: true });
  });

  it.each(['preserve', 'adapt'] as const)('keeps a %s paste whose pasted style names inherited object keys', formatting => {
    const html = '<p><span style="constructor:1;__proto__:2;font-weight:bold;color:#123456">Text</span></p>';
    const result = normalizePasteHTML(html, { formatting });
    expect(result.status).toBe('cleaned');
    expect(result.html).toContain('<strong>Text</strong>');
    expect(result.html.includes('#123456')).toBe(formatting === 'preserve');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'unsupported-formatting', severity: 'warning' }));
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ severity: 'error' }));
  });

  it('keeps an own-copy slice whose pasted style names an inherited object key', () => {
    const result = ownCopy('<p data-pm-slice="1 1 []"><span style="constructor:1;color:red">Text</span></p>');
    expect(result.status).toBe('cleaned');
    expect(result.html).toBe('<p data-pm-slice="1 1 []"><span style="color:red">Text</span></p>');
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'unsupported-formatting', severity: 'warning' })]);
  });
});

describe('safe CSS rule lookup through metadata colors and image placement', () => {
  it.each(['constructor', '__proto__'])('drops a %s color suffix from cell and slice backgrounds without rejecting the paste', name => {
    const cell = normalizePasteHTML(`<table><tr><td data-background="red;${name}:1">x</td></tr></table>`);
    expect(cell.status).toBe('cleaned');
    expect(cell.html).toBe('<table><tbody><tr><td>x</td></tr></tbody></table>');
    expect(cell.diagnostics).not.toContainEqual(expect.objectContaining({ severity: 'error' }));
    const context = JSON.stringify(['table', {}, 'tableRow', {}, 'tableCell', { background: `red;${name}:1` }]);
    const slice = normalizePasteHTML(`<p data-pm-slice='0 0 ${context}'>x</p>`);
    expect(slice.status).toBe('cleaned');
    expect(slice.html).toBe(`<p data-pm-slice="0 0 ${JSON.stringify(['table', {}, 'tableRow', {}, 'tableCell', {}]).replaceAll('"', '&#x22;')}">x</p>`);
  });

  it('keeps a lowercased image placement next to an inherited object key through the public entry', () => {
    const result = normalizePasteHTML('<p><img src="https://example.com/a.png" style="constructor:auto;FLOAT:LEFT;__proto__:0"></p>', { allowRemoteImages: true });
    expect(result.status).toBe('cleaned');
    expect(result.html).toBe('<p><img style="float:left" src="https://example.com/a.png"></p>');
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'unsupported-formatting', severity: 'warning' })]);
  });
});

describe('plain declarations', () => {
  it('reads lowercased names and values trimmed of CSS white space only', () => {
    expect(plainDeclarations(' Color : Red ;\t;\nLIST-STYLE-TYPE:\fdisc\r')).toEqual([['color', 'Red'], ['list-style-type', 'disc']]);
    // CSS does not treat a no-break space as white space, so it stays part of the name or value.
    expect(plainDeclarations('\u00a0width:1px;height:\u00a02px')).toEqual([['\u00a0width', '1px'], ['height', '\u00a02px']]);
    expect(plainDeclarations(undefined)).toEqual([]);
  });

  it('reads strings and brackets that hold no semicolon', () => {
    expect(plainDeclarations(`font-family:'Times New Roman',"Arial";transform:rotate(0.00rad) translateZ(calc(1px + 2px));grid-area:[a]`))
      .toEqual([['font-family', `'Times New Roman',"Arial"`], ['transform', 'rotate(0.00rad) translateZ(calc(1px + 2px))'], ['grid-area', '[a]']]);
  });

  it.each([
    ['a comment', 'a:b/*;c:d*/'],
    ['an escape', 'a:\\;b:c'],
    ['an important declaration, which outranks a later one', 'a:b !important;a:c'],
    ['a string holding a semicolon', 'a:"b;c"'],
    ['a string holding a line break', "a:'b\nc'"],
    ['an unclosed string', 'a:"b'],
    ['a bracket holding a semicolon', 'a:f(b;c:d)'],
    ['mismatched brackets', 'a:(];b:c)'],
    ['a closing bracket without its opening one', 'a:b)'],
    ['a declaration without a colon', 'a:b;c'],
  ])('refuses %s', (_name, style) => {
    expect(plainDeclarations(style)).toBeUndefined();
  });
});
