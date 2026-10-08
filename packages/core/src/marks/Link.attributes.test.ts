/**
 * What an allowed link renders besides its href, and when a click opens it:
 * keyword targets only, a rel that never grants the opened page an opener,
 * string titles and classes, and openOnClick 'whenNotEditable'.
 */
import { describe, it, expect, vi, afterEach, type MockInstance } from 'vitest';
import { Editor } from '../Editor.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { Link, type LinkOptions } from './Link.js';
import { linkClickPluginKey } from './helpers/linkClickPlugin.js';
import { generateHTML } from '../helpers/ssr.js';
import type { JSONAttribute, JSONContent } from '../types/Content.js';
import type { AnyExtension } from '../types/index.js';

const extensions = (options: Partial<LinkOptions> = {}): AnyExtension[] => [Document, Paragraph, Text, Link.configure(options)];
const doc = (attrs: Record<string, JSONAttribute>): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content: [
  { type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'https://example.com/', ...attrs } }] },
] }] });

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; vi.restoreAllMocks(); });

/** The attributes of the first anchor in some HTML. */
function anchorAttributes(html: string): Record<string, string> | null {
  const template = document.createElement('template');
  template.innerHTML = html;
  const anchor = template.content.querySelector('a');
  return anchor ? Object.fromEntries(Array.from(anchor.attributes, ({ name, value }) => [name, value])) : null;
}

/** The rendered anchor's attributes, from the editor, getHTML and generateHTML, which must agree. */
function rendered(attrs: Record<string, JSONAttribute>, options: Partial<LinkOptions> = {}): Record<string, string> {
  editor?.destroy();
  editor = new Editor({ extensions: extensions(options), content: doc(attrs) });
  const found = anchorAttributes(editor.view.dom.innerHTML);
  expect(found).not.toBeNull();
  expect(anchorAttributes(editor.getHTML())).toEqual(found);
  expect(anchorAttributes(generateHTML(doc(attrs), extensions(options)))).toEqual(found);
  return found ?? {};
}

const spyOpen = (): MockInstance<typeof window.open> => vi.spyOn(window, 'open').mockImplementation(() => null);

function click(ed: Editor): boolean {
  const plugin = ed.state.plugins.find(candidate => candidate.spec.key === linkClickPluginKey);
  const event = new MouseEvent('click', { button: 0, bubbles: true });
  const anchor = ed.view.dom.querySelector('a');
  Object.defineProperty(event, 'target', { value: anchor });
  return (plugin?.props.handleClick as (view: unknown, pos: number, event: MouseEvent) => boolean)(ed.view, 0, event);
}

describe('rendered link target', () => {
  it.each([
    ['_blank', '_blank'], ['_BLANK', '_blank'], ['_self', '_self'], ['_Parent', '_parent'], ['_top', '_top'],
  ])('renders the keyword %s as %s', (target, expected) => {
    expect(rendered({ target })['target']).toBe(expected);
  });

  it.each([['preview'], ['_new'], [' _blank'], [['_top']], [42], ['']])('omits the target %j, which is no keyword', (target) => {
    const attributes = rendered({ target });
    expect(attributes).not.toHaveProperty('target');
    expect(attributes).not.toHaveProperty('rel');
  });

  it('applies a target from the HTMLAttributes option like a stored one', () => {
    expect(rendered({}, { HTMLAttributes: { target: '_BLANK' } })).toMatchObject({ target: '_blank', rel: 'noopener noreferrer' });
    expect(rendered({}, { HTMLAttributes: { target: 'frame' } })).not.toHaveProperty('target');
  });
});

describe('rendered link rel (D4)', () => {
  it.each([
    [null, 'noopener noreferrer'],
    ['nofollow', 'nofollow noopener noreferrer'],
    ['opener', 'noopener noreferrer'],
    ['opener nofollow', 'nofollow noopener noreferrer'],
    ['OPENER  NoFollow', 'NoFollow noopener noreferrer'],
    ['noopener', 'noopener noreferrer'],
    ['noreferrer', 'noreferrer noopener'],
    ['NOOPENER NOREFERRER', 'NOOPENER NOREFERRER'],
    [['opener'], 'noopener noreferrer'],
  ])('merges %j into %j for a _blank link', (rel, expected) => {
    expect(rendered({ target: '_blank', rel })['rel']).toBe(expected);
  });

  it('keeps the stored rel of a link that does not open a new tab', () => {
    expect(rendered({ rel: 'opener nofollow' })['rel']).toBe('opener nofollow');
    expect(rendered({ target: '_self', rel: 'nofollow' })['rel']).toBe('nofollow');
    expect(rendered({ rel: ['nofollow'] })).not.toHaveProperty('rel');
  });

  it('keeps the stored rel as it is without addRelNoopener', () => {
    expect(rendered({ target: '_blank', rel: 'opener' }, { addRelNoopener: false })['rel']).toBe('opener');
    expect(rendered({ target: '_blank' }, { addRelNoopener: false })).not.toHaveProperty('rel');
  });

  it('merges a rel from the HTMLAttributes option', () => {
    expect(rendered({ target: '_blank' }, { HTMLAttributes: { rel: 'opener sponsored' } })['rel']).toBe('sponsored noopener noreferrer');
  });
});

describe('rendered link title and class', () => {
  it('renders them only as strings', () => {
    expect(rendered({ title: 'T "q" <b>', class: 'app-link' })).toMatchObject({ title: 'T "q" <b>', class: 'app-link' });
    const attributes = rendered({ title: ['a', 'b'], class: { c: 1 } });
    expect(attributes).not.toHaveProperty('title');
    expect(attributes).not.toHaveProperty('class');
  });

  it('keeps the class of the HTMLAttributes option when the stored one is not a string (D7)', () => {
    expect(rendered({ class: ['x'] }, { HTMLAttributes: { class: 'app-link' } })['class']).toBe('app-link');
    expect(rendered({ class: 'stored' }, { HTMLAttributes: { class: 'app-link' } })['class']).toBe('stored');
  });
});

describe("openOnClick 'whenNotEditable' (D10)", () => {
  it('opens nothing while the editor is editable', () => {
    const open = spyOpen();
    editor = new Editor({ extensions: extensions({ openOnClick: 'whenNotEditable' }), content: doc({}) });
    expect(click(editor)).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('leaves a read-only click to the browser, which follows the rendered anchor', () => {
    const open = spyOpen();
    editor = new Editor({ extensions: extensions({ openOnClick: 'whenNotEditable' }), content: doc({}), editable: false });
    expect(click(editor)).toBe(false);
    expect(editor.view.dom.querySelector('a')?.getAttribute('href')).toBe('https://example.com/');
    expect(open).not.toHaveBeenCalled();
  });

  it('still opens on click with true and never with false', () => {
    const open = spyOpen();
    editor = new Editor({ extensions: extensions({ openOnClick: true }), content: doc({}) });
    expect(click(editor)).toBe(true);
    editor.destroy();
    editor = new Editor({ extensions: extensions({ openOnClick: false }), content: doc({}) });
    expect(click(editor)).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('click target', () => {
  it('follows the rendered target, so a target from the HTMLAttributes option opens as a native click would', () => {
    const open = spyOpen();
    editor = new Editor({ extensions: extensions({ HTMLAttributes: { target: '_SELF' } }), content: doc({}) });
    expect(click(editor)).toBe(true);
    expect(open).toHaveBeenLastCalledWith('https://example.com/', '_self');
    editor.destroy();
    editor = new Editor({ extensions: extensions({ HTMLAttributes: { target: '_self' } }), content: doc({ target: '_blank' }) });
    click(editor);
    expect(open).toHaveBeenLastCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
  });
});
