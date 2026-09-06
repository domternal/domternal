/**
 * generateHTML under linkedom, the documented Node peer, as the browser that
 * receives its output reads it. linkedom writes attribute values of an HTML
 * document without escaping `&`, so every character reference in a stored
 * value reaches that browser decoded.
 */
import { describe, it, expect } from 'vitest';
import { parseHTML } from 'linkedom';
import { generateHTML } from './ssr.js';
import { StarterKit } from '../extensions/StarterKit.js';
import { TextStyle } from '../marks/TextStyle.js';
import { TextColor } from '../extensions/TextColor.js';
import { FontSize } from '../extensions/FontSize.js';
import type { ContentDiagnostic, JSONContent, JSONMark } from '../types/index.js';

const serverDocument = (): Document => parseHTML('<!DOCTYPE html><html><body></body></html>').document;

/** The HTML as a browser reads it: parsed by the jsdom test document. */
function received(html: string): HTMLElement {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  return holder;
}

const paragraph = (text: string, marks: JSONMark[]): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text, marks }] }],
});

describe('generateHTML under linkedom', () => {
  it.each([
    'javascript&colon;alert(1)',
    '&#106;avascript:alert(1)',
    '&#x6A;avascript&#x3A;alert(1)',
    'javascript&#58alert(1)',
    '&Tab;javascript:alert(1)',
    'https://a.example&#64;evil.example/',
    '/&#47;evil.example/x',
  ])('writes no link for the stored href %j, which a browser would decode into a script or another host', (href) => {
    const diagnostics: ContentDiagnostic[] = [];
    const html = generateHTML(paragraph('x', [{ type: 'link', attrs: { href } }]), [StarterKit], {
      document: serverDocument(),
      onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    });
    expect(html).toBe('<p>x</p>');
    expect(received(html).querySelector('a')).toBeNull();
    expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual(['unsupported-url']);
  });

  it.each([
    ['color', 'red&#59position:fixed&#59inset:0'],
    ['color', 'red&#x3bbackground:url&#40http://probe.test/x&#41'],
    ['fontSize', '1px&#59position:fixed'],
  ])('writes no %s for the stored value %j, which a browser would decode into more declarations', (attribute, value) => {
    const html = generateHTML(paragraph('c', [{ type: 'textStyle', attrs: { [attribute]: value } }]), [StarterKit, TextStyle, TextColor, FontSize], {
      document: serverDocument(),
    });
    expect(html).toBe('<p><span>c</span></p>');
    expect((received(html).querySelector('span') as HTMLElement).style.length).toBe(0);
  });

  it('keeps a link whose query holds an ampersand', () => {
    const html = generateHTML(paragraph('q', [{ type: 'link', attrs: { href: '/search?a=1&b=2' } }]), [StarterKit], {
      document: serverDocument(),
    });
    expect(received(html).querySelector('a')?.getAttribute('href')).toBe('/search?a=1&b=2');
  });
});
