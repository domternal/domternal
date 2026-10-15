import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { listItemContent } from './listItemContent.js';

function item(html: string, owner = document): HTMLElement {
  const container = owner.createElement('div');
  container.innerHTML = html;
  const found = container.querySelector<HTMLElement>('li');
  if (!found) throw new Error('Missing fixture list item');
  return found;
}

describe('list item content recovery', () => {
  it.each([document, parseHTML('<html><body></body></html>').document])('uses only the supplied DOM implementation', owner => {
    const original = item('<li><!--before--><ul><li><ol><li>inner</li></ol></li></ul></li>', owner);
    const before = original.outerHTML;
    const recovered = listItemContent(original);
    expect(recovered).not.toBe(original);
    expect(original.outerHTML).toBe(before);
    expect(recovered.ownerDocument).toBe(owner);
    expect(recovered.firstElementChild?.localName).toBe('p');
    expect(recovered.querySelector('ul > li')?.firstElementChild?.localName).toBe('p');
    expect(recovered.textContent).toBe('inner');
    expect(listItemContent(recovered)).toBe(recovered);
  });

  it.each([
    '<ol data-pm-slice="4 4 []"><li><ul><li><p>partial</p></li></ul></li></ol>',
    '<li data-pm-slice="1 1 []"><ul><li>partial</li></ul></li>',
  ])('leaves an open-start item exactly as authored: %s', html => {
    const original = item(html);
    expect(listItemContent(original)).toBe(original);
    expect(original.firstElementChild?.localName).toBe('ul');
  });

  it('does not mistake a later sibling for the native open-start path', () => {
    const root = document.createElement('div');
    root.innerHTML = '<ol data-pm-slice="4 4 []"><li><p>partial</p></li><li><ul><li>whole</li></ul></li></ol>';
    const sibling = root.querySelectorAll<HTMLElement>('ol > li')[1];
    if (!sibling) throw new Error('Missing fixture sibling');
    expect(listItemContent(sibling).firstElementChild?.localName).toBe('p');
    expect(sibling.firstElementChild?.localName).toBe('ul');
  });

  it.each(['<li>label<ul><li>nested</li></ul></li>', '<li><p>label</p><ul><li>nested</li></ul></li>', '<li><p></p></li>'])('keeps valid items on the original parser path: %s', html => {
    const original = item(html);
    expect(listItemContent(original)).toBe(original);
  });

  it('does not recursively clone the same deep malformed subtree', () => {
    const original = item('<li><ul>'.repeat(40) + '<li>kept</li>' + '</ul></li>'.repeat(40));
    const repaired = listItemContent(original);
    expect(repaired.querySelectorAll('p')).toHaveLength(40);
    expect(repaired.querySelectorAll('li')).toHaveLength(40);
    repaired.querySelectorAll<HTMLElement>('li').forEach(child => { expect(listItemContent(child)).toBe(child); });
    expect(original.querySelectorAll('p')).toHaveLength(0);
  });
});
