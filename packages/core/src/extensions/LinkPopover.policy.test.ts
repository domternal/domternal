/**
 * LinkPopover against the Link's URL policy: which address a typed value
 * stands for, what is refused with a reason, and what an edit keeps.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { LinkPopover, type LinkPopoverOptions } from './LinkPopover.js';
import { Link, type LinkOptions } from '../marks/Link.js';
import { Document } from '../nodes/Document.js';
import { Text } from '../nodes/Text.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Editor } from '../Editor.js';
import { deMessages } from '../locales/de.js';

// floating-ui measures client rects, which jsdom does not lay out.
Element.prototype.getClientRects = function () {
  return [] as unknown as DOMRectList;
};

let editor: Editor | undefined;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => {
  if (editor && !editor.isDestroyed) editor.destroy();
  editor = undefined;
  host.remove();
  document.querySelectorAll('.dm-link-popover').forEach((element) => { element.remove(); });
});

interface Setup { link?: Partial<LinkOptions>; popover?: Partial<LinkPopoverOptions>; content?: string; locale?: string }

function mount({ link = {}, popover = {}, content = '<p>Hello world</p>', locale }: Setup = {}): Editor {
  editor = new Editor({
    element: host,
    extensions: [Document, Text, Paragraph, Link.configure(link), LinkPopover.configure(popover)],
    content,
    ...(locale === 'de' && { i18n: { locale: 'de', messages: deMessages } }),
  });
  return editor;
}

const popover = (): HTMLElement => document.querySelector<HTMLElement>('.dm-link-popover')!;
const input = (): HTMLInputElement => popover().querySelector<HTMLInputElement>('.dm-link-popover-input')!;

function select(from: number, to = from): void {
  editor!.view.dispatch(editor!.state.tr.setSelection(TextSelection.create(editor!.state.doc, from, to)));
}

function openPopover(): void {
  const anchor = document.createElement('button');
  host.appendChild(anchor);
  editor!.emit('linkEdit', { anchorElement: anchor });
}

function apply(value: string): void {
  input().value = value;
  popover().querySelector<HTMLButtonElement>('.dm-link-popover-apply')!.click();
}

const hrefs = (): unknown[] => {
  const found: unknown[] = [];
  editor!.state.doc.descendants(node => { for (const mark of node.marks) if (mark.type.name === 'link') found.push(mark.attrs['href']); });
  return found;
};

const isOpen = (): boolean => popover().hasAttribute('data-show');

describe('LinkPopover input rules', () => {
  it.each([
    ['example.com', 'https://example.com'],
    ['#section', '#section'],
    ['/path#section', '/path#section'],
    ['./p', './p'],
    ['../p', '../p'],
    ['?q=1', '?q=1'],
    ['page.html#x', 'https://page.html#x'],
    ['localhost:3000', 'https://localhost:3000'],
    ['example.com:8080/x', 'https://example.com:8080/x'],
    ['//cdn.example/x', 'https://cdn.example/x'],
    ['a@b.example', 'mailto:a@b.example'],
    ['mailto:a@b.example', 'mailto:a@b.example'],
    ['tel:+1', 'tel:+1'],
    ['  https://spaced.example/  ', 'https://spaced.example/'],
  ])('stores %j as %j (E1 to E7)', (typed, stored) => {
    mount();
    select(1, 6);
    openPopover();
    apply(typed);
    expect(hrefs()).toEqual([stored]);
    expect(isOpen()).toBe(false);
  });

  it("uses the Link's defaultProtocol for a bare host and a network path", () => {
    mount({ link: { defaultProtocol: 'http' } });
    select(1, 6);
    openPopover();
    apply('example.com');
    expect(hrefs()).toEqual(['http://example.com']);
  });

  it('closes without a change for an empty or blank value (E11)', () => {
    for (const value of ['', '   ']) {
      mount();
      select(1, 6);
      openPopover();
      apply(value);
      expect(isOpen()).toBe(false);
      expect(hrefs()).toEqual([]);
      editor!.destroy();
    }
  });
});

describe('LinkPopover refusals', () => {
  it.each([
    ['javascript:alert(1)'],
    [' javascript:alert(1)'],
    ['JaVaScRiPt:alert(1)'],
    ['data:text/html,x'],
    ['vbscript:msgbox(1)'],
    ['https://google.com@evil.example/'],
    ['ftp://files.example/'],
  ])('keeps %j out, and the popover open with the reason (E8)', (typed) => {
    mount();
    select(1, 6);
    openPopover();
    apply(typed);
    expect(hrefs()).toEqual([]);
    expect(isOpen()).toBe(true);
    expect(input().getAttribute('aria-invalid')).toBe('true');
    expect(input().validationMessage).toBe('This address cannot be used as a link.');
    // A URL input drops outer spaces from its value.
    expect(input().value).toBe(typed.trim());
    expect(document.activeElement).toBe(input());
  });

  it('refuses a bare email when the Link does not allow mailto (E6)', () => {
    mount({ link: { protocols: ['https:'] } });
    select(1, 6);
    openPopover();
    apply('a@b.example');
    expect(hrefs()).toEqual([]);
    expect(input().getAttribute('aria-invalid')).toBe('true');
  });

  it('follows the Link protocols and narrows them with its own list (E9)', () => {
    mount({ link: { protocols: ['https:', 'ftp:'] } });
    select(1, 6);
    openPopover();
    apply('ftp://files.example/f');
    expect(hrefs()).toEqual(['ftp://files.example/f']);
    editor!.destroy();
    mount({ link: { protocols: ['https:', 'ftp:'] }, popover: { protocols: ['HTTPS'] } });
    select(1, 6);
    openPopover();
    apply('ftp://files.example/f');
    expect(hrefs()).toEqual([]);
    expect(input().getAttribute('aria-invalid')).toBe('true');
    apply('#still-relative');
    expect(hrefs()).toEqual(['#still-relative']);
  });

  it('refuses a fragment when the Link refuses relative links (E10)', () => {
    mount({ link: { allowRelative: false } });
    select(1, 6);
    openPopover();
    apply('#id');
    expect(hrefs()).toEqual([]);
    expect(input().getAttribute('aria-invalid')).toBe('true');
  });

  it('clears the refusal as soon as the value changes (E14)', () => {
    mount();
    select(1, 6);
    openPopover();
    apply('javascript:alert(1)');
    input().value = 'https://ok.example/';
    input().dispatchEvent(new Event('input', { bubbles: true }));
    expect(input().hasAttribute('aria-invalid')).toBe(false);
    expect(input().validationMessage).toBe('');
    popover().querySelector<HTMLButtonElement>('.dm-link-popover-apply')!.click();
    expect(hrefs()).toEqual(['https://ok.example/']);
  });

  it('explains the refusal in German (E15)', () => {
    mount({ locale: 'de' });
    select(1, 6);
    openPopover();
    apply('javascript:alert(1)');
    expect(input().validationMessage).toBe('Diese Adresse kann nicht als Link verwendet werden.');
  });

  it('opens on a stored refused href with the value shown and marked invalid, refuses Apply and still removes it (E13)', () => {
    mount();
    editor!.view.dispatch(editor!.state.tr.addMark(1, 6, editor!.schema.marks['link']!.create({ href: 'javascript:alert(1)' })));
    select(3);
    openPopover();
    expect(input().value).toBe('javascript:alert(1)');
    expect(input().getAttribute('aria-invalid')).toBe('true');
    popover().querySelector<HTMLButtonElement>('.dm-link-popover-apply')!.click();
    expect(hrefs()).toEqual(['javascript:alert(1)']);
    expect(isOpen()).toBe(true);
    popover().querySelector<HTMLButtonElement>('.dm-link-popover-remove')!.click();
    expect(hrefs()).toEqual([]);
  });

  it('opens on a stored href that is not a string with an empty invalid value', () => {
    mount();
    editor!.view.dispatch(editor!.state.tr.addMark(1, 6, editor!.schema.marks['link']!.create({ href: ['javascript:alert(1)'] })));
    select(3);
    openPopover();
    expect(input().value).toBe('');
    expect(input().getAttribute('aria-invalid')).toBe('true');
  });

  it('opens on an allowed link without marking it', () => {
    mount({ content: '<p><a href="#intro">link</a></p>' });
    select(2);
    openPopover();
    expect(input().value).toBe('#intro');
    expect(input().hasAttribute('aria-invalid')).toBe(false);
  });
});

describe('LinkPopover edits of an existing link (E12)', () => {
  const content = '<p><a href="https://old.example/" title="T" target="_blank" rel="nofollow" class="c">linked</a> tail</p>';
  const attrs = (): Record<string, unknown> | undefined => editor!.state.doc.firstChild?.firstChild?.marks[0]?.attrs;

  it('changes only the href with the cursor in the link', () => {
    mount({ content });
    select(3);
    openPopover();
    apply('https://new.example/');
    expect(attrs()).toEqual({ href: 'https://new.example/', title: 'T', target: '_blank', rel: 'nofollow', class: 'c' });
    expect(editor!.state.doc.firstChild?.firstChild?.text).toBe('linked');
  });

  it('changes only the href with the link selected', () => {
    mount({ content });
    select(1, 7);
    openPopover();
    apply('#section');
    expect(attrs()).toEqual({ href: '#section', title: 'T', target: '_blank', rel: 'nofollow', class: 'c' });
  });

  it('edits the link beside the cursor, never an adjacent one', () => {
    mount({ content: '<p><a href="https://one.example/">one</a><a href="https://two.example/" title="two">two</a></p>' });
    select(5);
    openPopover();
    expect(input().value).toBe('https://two.example/');
    apply('https://second.example/');
    expect(editor!.state.doc.firstChild?.content.content.map(node => [node.text, node.marks[0]?.attrs['href'], node.marks[0]?.attrs['title']]))
      .toEqual([['one', 'https://one.example/', null], ['two', 'https://second.example/', 'two']]);
  });
});

describe('LinkPopover options', () => {
  it('defaults protocols to null, so the Link decides', () => {
    expect(LinkPopover.options.protocols).toBeNull();
    expect(LinkPopover.configure({ protocols: ['https:'] }).options.protocols).toEqual(['https:']);
  });
});
