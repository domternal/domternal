import { describe, it, expect } from 'vitest';
import { parseHTML } from 'linkedom';
import { serializeChildren } from './serializeChildren.js';

/** A container of the given document holding an anchor and an image with these attribute values. */
function build(document: Document, values: Record<string, string>): HTMLElement {
  const container = document.createElement('div');
  const anchor = document.createElement('a');
  for (const [name, value] of Object.entries(values)) anchor.setAttribute(name, value);
  anchor.textContent = 'Tom & Jerry <3';
  const image = document.createElement('img');
  image.setAttribute('alt', values['title'] ?? '');
  container.append(anchor, image);
  return container;
}

/** The attribute values a browser reads from the HTML: parsed by the jsdom test document. */
function received(html: string): { attributes: Record<string, string>; text: string; alt: string | null } {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const anchor = holder.querySelector('a')!;
  return {
    attributes: Object.fromEntries(Array.from(anchor.attributes).map(attribute => [attribute.name, attribute.value])),
    text: anchor.textContent,
    alt: holder.querySelector('img')?.getAttribute('alt') ?? null,
  };
}

const VALUES = {
  href: '/search?q=x&copy;y&amp;z=1&#106;',
  title: 'Tom &amp; "Jerry" &lt;3 &',
  class: 'a&b',
  style: 'font-family: A&amp;B',
  'data-x': '&#59;&semi;&',
};

describe('serializeChildren', () => {
  it('writes every attribute value so a browser reads it as stored, under linkedom', () => {
    const { document: server } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    const html = serializeChildren(build(server, VALUES));
    expect(received(html)).toEqual({ attributes: VALUES, text: 'Tom & Jerry <3', alt: VALUES.title });
  });

  it('returns the browser serialization unchanged and leaves the attributes alone', () => {
    const container = build(document, VALUES);
    const before = container.innerHTML;
    expect(serializeChildren(container)).toBe(before);
    expect(container.querySelector('a')?.getAttribute('href')).toBe(VALUES.href);
    expect(received(before).attributes).toEqual(VALUES);
  });

  it('keeps linkedom output as it was for attribute values without an ampersand', () => {
    const { document: server } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    const container = build(server, { href: 'https://example.com/a?b=c', title: 'say "hi" <b>' });
    const before = container.innerHTML;
    expect(serializeChildren(container)).toBe(before);
  });

  it('checks each document once and still escapes values in later containers', () => {
    const { document: server } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    for (let round = 0; round < 3; round++) {
      expect(received(serializeChildren(build(server, { title: `${String(round)} &amp;` }))).attributes['title']).toBe(`${String(round)} &amp;`);
    }
  });
});
