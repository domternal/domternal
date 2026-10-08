import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { TextSelection } from '@domternal/pm/state';
import { Editor } from '../Editor.js';
import { Link, linkUrlPolicy, type LinkOptions } from '../marks/Link.js';
import { LinkPopover, type LinkPopoverOptions } from '../extensions/LinkPopover.js';
import { Document } from '../nodes/Document.js';
import { Paragraph } from '../nodes/Paragraph.js';
import { Text } from '../nodes/Text.js';
import { checkUrl } from './checkUrl.js';
import type { AnyExtension } from '../types/index.js';

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; });

function applyWith(popover: AnyExtension, href: string): string | null {
  editor = new Editor({
    extensions: [Document, Paragraph, Text, Link.configure({ protocols: ['https:', 'ftp:'] }), popover],
    content: '<p>link</p>',
  });
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 5)));
  const anchor = document.createElement('button');
  anchor.getClientRects = () => [] as unknown as DOMRectList;
  editor.emit('linkEdit', { anchorElement: anchor });
  const panel = document.querySelector<HTMLElement>('.dm-link-popover')!;
  panel.querySelector<HTMLInputElement>('input')!.value = href;
  panel.querySelector<HTMLButtonElement>('.dm-link-popover-apply')!.click();
  return editor.state.doc.firstChild?.firstChild?.marks[0]?.attrs['href'] as string | undefined ?? null;
}

describe('protocol option source compatibility', () => {
  it('retains readable runtime arrays without narrowing the published option types', () => {
    expectTypeOf(Link.options.protocols).toEqualTypeOf<LinkOptions['protocols']>();
    expectTypeOf(LinkPopover.options.protocols).toEqualTypeOf<LinkPopoverOptions['protocols']>();
    const linkProtocols = ['https:'];
    const popoverProtocols = ['https:'];
    const links = Link.configure({ protocols: linkProtocols });
    const popover = LinkPopover.configure({ protocols: popoverProtocols });
    linkProtocols.push('ftp:');
    popoverProtocols.push('ftp:');
    expect(links.options.protocols).toEqual(['https:', 'ftp:']);
    expect(popover.options.protocols).toEqual(['https:', 'ftp:']);
    expect(LinkPopover.options.protocols).toEqual(['http:', 'https:', 'mailto:', 'tel:']);
  });

  it('preserves explicit null and readonly object configurations through cloning', () => {
    const protocols = [{ scheme: 'https', optionalSlashes: true }] as const;
    const links = Link.configure({ protocols });
    const popover = LinkPopover.configure({ protocols });
    expect(links.clone().options.protocols).toBe(protocols);
    expect(popover.clone().options.protocols).toBe(protocols);
    const defaultLinks = Link.configure({ protocols: null }).configure({ openOnClick: false });
    const followingPopover = LinkPopover.configure({ protocols: null }).configure({});
    expect(defaultLinks.clone().options.protocols).toBeNull();
    expect(followingPopover.clone().options.protocols).toBeNull();
  });

  it('preserves the 1.3 types for reconfiguration, option writes and extension', () => {
    let links = Link.configure({ protocols: null });
    expect(links.options.protocols).toBeNull();
    links = Link.configure({ protocols: ['https:'] });
    links.options.protocols = [{ scheme: 'ftp' }];
    expect(links.options.protocols).toEqual([{ scheme: 'ftp' }]);
    links.options.protocols = null;
    expect(links.options.protocols).toBeNull();
    let popover = LinkPopover.configure({ protocols: null });
    expect(popover.options.protocols).toBeNull();
    popover = LinkPopover.configure({ protocols: ['https:'] });
    popover.options.protocols = [{ scheme: 'https' }];
    expect(popover.options.protocols).toEqual([{ scheme: 'https' }]);
    popover.options.protocols = null;
    expect(popover.options.protocols).toBeNull();
    const extendedLink: typeof Link = Link.extend({});
    const extendedPopover: typeof LinkPopover = LinkPopover.extend({});
    expect(extendedLink.name).toBe('link');
    expect(extendedPopover.name).toBe('linkPopover');
  });

  it('keeps uncertain partial inputs broad instead of claiming an array', () => {
    function configureLink(options: Partial<LinkOptions>): void {
      const configured = Link.configure(options);
      expectTypeOf(configured.options.protocols).toEqualTypeOf<LinkOptions['protocols']>();
    }
    function configurePopover(options: Partial<LinkPopoverOptions>): void {
      const configured = LinkPopover.configure(options);
      expectTypeOf(configured.options.protocols).toEqualTypeOf<LinkPopoverOptions['protocols']>();
    }
    configureLink({ protocols: null });
    configurePopover({ protocols: null });
  });

  it('retains ownership through configure, clone and extend', () => {
    expect(Link.isOptionExplicit('protocols')).toBe(false);
    expect(Link.configure({ protocols: ['https:'] }).clone().isOptionExplicit('protocols')).toBe(true);
    expect(LinkPopover.clone().isOptionExplicit('protocols')).toBe(false);
    expect(LinkPopover.clone().options.protocols).not.toBe(LinkPopover.options.protocols);
    expect(LinkPopover.configure({}).clone().isOptionExplicit('protocols')).toBe(false);
    expect(LinkPopover.configure({ protocols: null }).clone().isOptionExplicit('protocols')).toBe(true);
    expect(LinkPopover.extend({}).isOptionExplicit('protocols')).toBe(false);
    const extended = LinkPopover.extend({ addOptions: () => ({ protocols: null }) });
    expect(extended.isOptionExplicit('protocols')).toBe(true);
    expect(extended.clone().options.protocols).toBeNull();
    expect(Link.extend({}).configure({ protocols: [{ scheme: 'https' }] }).options.protocols)
      .toEqual([{ scheme: 'https' }]);
  });
});

describe('protocol policy compatibility', () => {
  it.each([
    ['default', () => LinkPopover],
    ['configured without protocols', () => LinkPopover.configure({})],
    ['cloned', () => LinkPopover.clone()],
    ['extended', () => LinkPopover.extend({})],
    ['explicit null', () => LinkPopover.configure({ protocols: null }).clone()],
  ] as const)('follows the Link policy for %s', (_label, create) => {
    expect(applyWith(create(), 'ftp://files.example/document')).toBe('ftp://files.example/document');
  });

  it('honors an explicit list even when it equals the public default', () => {
    const protocols = LinkPopover.options.protocols;
    if (!protocols) throw new Error('The default protocol list must be readable.');
    const popover = LinkPopover.configure({ protocols: [...protocols] }).clone();
    expect(applyWith(popover, 'ftp://files.example/document')).toBeNull();
  });

  it('honors an in-place change to a default list before mounting', () => {
    const popover = LinkPopover.clone().configure({});
    const protocols = popover.options.protocols;
    if (!Array.isArray(protocols)) throw new Error('The default protocol list must be mutable.');
    protocols.splice(0, protocols.length, 'https:');
    expect(popover.isOptionExplicit('protocols')).toBe(false);
    expect(applyWith(popover, 'ftp://files.example/document')).toBeNull();
  });

  it('refreshes cached schemes after list and object mutations', () => {
    const protocols = ['https:'];
    const options = { protocols };
    expect(checkUrl('ftp://files.example/f', linkUrlPolicy(options)!).status).toBe('unsupported');
    protocols.push('ftp:');
    expect(checkUrl('ftp://files.example/f', linkUrlPolicy(options)!).status).toBe('allowed');
    protocols.splice(1, 1);
    expect(checkUrl('ftp://files.example/f', linkUrlPolicy(options)!).status).toBe('unsupported');
    const objectProtocols = [{ scheme: 'https' }];
    expect(checkUrl('https://example.com', linkUrlPolicy({ protocols: objectProtocols })!).status).toBe('allowed');
    objectProtocols[0]!.scheme = 'ftp';
    expect(checkUrl('ftp://files.example/f', linkUrlPolicy({ protocols: objectProtocols })!).status).toBe('allowed');
    expect(checkUrl('https://example.com', linkUrlPolicy({ protocols: objectProtocols })!).status).toBe('unsupported');
    objectProtocols[0]!.scheme = 'javascript';
    expect(() => linkUrlPolicy({ protocols: objectProtocols })).toThrow('cannot allow javascript:');
  });
});
