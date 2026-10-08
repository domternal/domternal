/**
 * The heading adaptation an applied paste reports follows what reached the document. A pasted
 * heading whose text ProseMirror merges into the caret block leaves no heading, so onPasteResult
 * and the notice leave out its warning, while onResult keeps describing the cleanup. Every case is
 * checked against the same paste into an editor with all six levels, where nothing adapts: the
 * warning must stay exactly when that editor keeps the pasted heading as a heading at its own
 * level, because only then did adapting its level change the document.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Blockquote, BulletList, Document, Editor, Extension, Heading, History, Link, ListItem, Paragraph, Text, UniqueID } from '@domternal/core';
import type { AnyExtension } from '@domternal/core';
import { Fragment, Slice } from '@domternal/pm/model';
import { Plugin, TextSelection } from '@domternal/pm/state';
import { SmartPaste } from '../../extension-block-controls/dist/index.js';
import { Image } from '../../extension-image/dist/index.js';
import { Table, TableCell, TableHeader, TableRow } from '../../extension-table/dist/index.js';
import { PasteCleanup } from './index.js';
import type { ClipboardImageMatchContext, PasteCleanupOptions, PasteDiagnostic, PasteOperationResult } from './index.js';

const editors: Editor[] = [];
const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors) if (!editor.isDestroyed) editor.destroy();
  for (const host of hosts) host.remove();
  editors.length = 0; hosts.length = 0;
});

const ADAPTED = 'destination-heading-level-adapted';
const HEADING_NOTICE = 'Some headings were changed to a heading level this editor supports.';
const ALL_LEVELS = [1, 2, 3, 4, 5, 6];

interface Fixture {
  editor: Editor;
  host: HTMLElement;
  normalized: Mock<NonNullable<PasteCleanupOptions['onResult']>>;
  completed: Mock<(result: PasteOperationResult) => void>;
}

interface Setup {
  levels?: number[];
  smartPaste?: boolean;
  uniqueID?: boolean;
  extensions?: AnyExtension[];
  options?: PasteCleanupOptions;
}

function mount({ levels = [1, 2, 3, 4], smartPaste = false, uniqueID = false, extensions = [], options = {} }: Setup = {}): Fixture {
  const normalized = vi.fn<NonNullable<PasteCleanupOptions['onResult']>>();
  const completed = vi.fn<(result: PasteOperationResult) => void>();
  const host = document.createElement('div'); document.body.append(host); hosts.push(host);
  const editor = new Editor({ element: host, content: '<p></p>',
    extensions: [Document, Paragraph, Text, History, BulletList, ListItem, Blockquote, Link, Table, TableRow, TableCell, TableHeader,
      Heading.configure({ levels }), ...(smartPaste ? [SmartPaste] : []), ...(uniqueID ? [UniqueID] : []), ...extensions,
      PasteCleanup.configure({ ...options, onResult: normalized, onPasteResult: completed })] });
  editors.push(editor);
  editor.view.setProps({ handleScrollToSelection: () => true });
  return { editor, host, normalized, completed };
}

/**
 * Caret seeds. `|` marks the caret and `[` `]` a selected range, and both are removed before the
 * paste; a seed without a mark selects the whole document. `hL` is the level pasted headings adapt
 * to, so a seed heading at that level can share their markup.
 */
const SEEDS: Readonly<Record<string, string>> = {
  'an empty paragraph': '<p>|</p>',
  'the start of a paragraph': '<p>|Hello world</p>',
  'the middle of a paragraph': '<p>Hello |world</p>',
  'the end of a paragraph': '<p>Hello world|</p>',
  'the start of a level 2 heading': '<h2>|Hello world</h2>',
  'the middle of a level 2 heading': '<h2>Hello |world</h2>',
  'an empty level 2 heading': '<h2>|</h2>',
  'an empty heading at the adapted level': '<hL>|</hL>',
  'a wholly selected heading at the adapted level': '<hL>[Hello world]</hL>',
  'the start of a heading at the adapted level': '<hL>|Hello world</hL>',
  'the middle of a heading at the adapted level': '<hL>Hello |world</hL>',
  'the end of a heading at the adapted level': '<hL>Hello world|</hL>',
  'an empty list item label': '<ul><li><p>|</p></li></ul>',
  'the start of a list item label': '<ul><li><p>|Hello world</p></li></ul>',
  'the middle of a list item label': '<ul><li><p>Hello |world</p></li></ul>',
  'the middle of a heading at the adapted level in a list item': '<ul><li><p>Label</p><hL>Hello |world</hL></li></ul>',
  'the middle of a level 2 heading in a list item': '<ul><li><p>Label</p><h2>Hello |world</h2></li></ul>',
  'the middle of a quoted paragraph': '<blockquote><p>Hello |world</p></blockquote>',
  'the middle of a table cell': '<table><tr><td><p>Hello |world</p></td></tr></table>',
  'a range across two paragraphs': '<p>Hel[lo world</p><p>Second] line</p>',
  'a range from a heading at the adapted level into a paragraph': '<hL>Hel[lo world</hL><p>Second] line</p>',
  'a range from the start of a heading at the adapted level into a paragraph': '<hL>[Hello world</hL><p>Second] line</p>',
  'a range over a heading at the adapted level and a whole paragraph': '<hL>[Hello world</hL><p>Second line]</p>',
  'a range over a later heading at the adapted level and a whole paragraph': '<p>Intro</p><hL>[Hello world</hL><p>Second line]</p>',
  'a range over a quoted heading at the adapted level and a whole quoted paragraph': '<blockquote><hL>[Hello world</hL><p>Second line]</p></blockquote>',
  'a whole document selection': '<p>Hello world</p>',
};

/** Each pasted heading has its own word, so a document shows where it went. */
const CLIPBOARDS = [
  '<h5>Five</h5>', '<h6>Six</h6>', '<h5>Five</h5><h6>Six</h6>', '<p>Lead</p><h5>Five</h5>', '<h5>Five</h5><p>Tail</p>',
  '<h2>Two</h2><h5>Five</h5>', '<h5>Alpha</h5><h2>Beta</h2>', '<h5>Alpha</h5><p>Mid</p><h6>Omega</h6>', '<h5>Five</h5><h5>Again</h5>',
  '<blockquote><h5>Quoted</h5></blockquote>', '<blockquote><h5>Quoted</h5></blockquote><p>After</p>',
  '<ul><li><p>Item</p><h5>Nested</h5></li></ul>', '<h5>Linked <a href="javascript:alert(1)">here</a></h5>',
  '<h4>Four</h4><h5>Five</h5>',
] as const;
/** Levels 2 and 3 adapt a level 1 heading up and levels 4 to 6 down. */
const NARROW_CLIPBOARDS = [
  '<h1>One</h1>', '<h5>Five</h5>', '<h1>One</h1><h5>Five</h5>', '<h4>Four</h4><p>Tail</p>', '<p>Lead</p><h6>Six</h6>',
  '<h2>Two</h2><h1>One</h1>', '<h5>Five</h5><h1>One</h1>', '<h1>One</h1><h1>Again</h1>',
] as const;

function seed({ editor }: Fixture, html: string, adaptedLevel: number): void {
  if (!editor.setContent(html.replaceAll('hL>', `h${String(adaptedLevel)}>`), false)) throw new Error('Could not seed the editor');
  const marks: { char: string; pos: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    const text = node.text ?? '';
    for (let index = 0; index < text.length; index++) if ('|[]'.includes(text.charAt(index))) marks.push({ char: text.charAt(index), pos: pos + index });
  });
  const transaction = editor.state.tr;
  for (const mark of [...marks].reverse()) transaction.delete(mark.pos, mark.pos + 1);
  editor.view.dispatch(transaction);
  // A mark's position once the marks before it are gone.
  const at = (char: string): number | undefined => {
    const index = marks.findIndex(mark => mark.char === char);
    return index < 0 ? undefined : (marks[index]?.pos ?? 0) - index;
  };
  const caret = at('|');
  const from = at('[');
  const to = at(']');
  if (caret !== undefined) editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, caret)));
  else if (from !== undefined && to !== undefined) editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
  else editor.commands.selectAll();
}

function paste(editor: Editor, html: string, files: File[] = []): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    items: [{ kind: 'string', type: 'text/html', getAsFile: () => null }, ...files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file }))],
    files, getData: (type: string) => type === 'text/html' ? html : '',
  } });
  editor.view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
}

interface Outcome {
  result: PasteOperationResult;
  normalized: readonly PasteDiagnostic[];
  blocks: string[];
  /** The rows the notice lists, or null while it is hidden. */
  notice: string[] | null;
}

async function outcome(fixture: Fixture): Promise<Outcome> {
  await vi.waitFor(() => { expect(fixture.completed).toHaveBeenCalledOnce(); }, { interval: 1 });
  const result = fixture.completed.mock.calls[0]?.[0];
  const normalized = fixture.normalized.mock.calls.at(-1)?.[0];
  if (!result || !normalized) throw new Error('Expected a paste result');
  expect(() => { fixture.editor.state.doc.check(); }).not.toThrow();
  const blocks: string[] = [];
  fixture.editor.state.doc.descendants(node => {
    if (node.isTextblock) blocks.push(`${node.type.name === 'heading' ? `h${String(node.attrs['level'])}` : node.type.name}:${node.textContent}`);
  });
  const notice = fixture.host.querySelector<HTMLElement>('.dm-paste-feedback');
  return { result, normalized: normalized.diagnostics, blocks,
    notice: notice === null || notice.hidden ? null : Array.from(notice.querySelectorAll('li'), row => row.textContent) };
}

/** Seeds the fixture, or a new one for a setup, and pastes into it. */
async function pasteAt(target: Fixture | Setup, seedHTML: string, html: string, adaptedLevel: number): Promise<Outcome> {
  const fixture = 'editor' in target ? target : mount(target);
  seed(fixture, seedHTML, adaptedLevel);
  fixture.normalized.mockClear();
  fixture.completed.mockClear();
  paste(fixture.editor, html);
  return outcome(fixture);
}

/** The pasted heading a source offset points at, as its tag level and the text before its first element. */
function pastedHeadingAt(html: string, offset: number | undefined): string {
  const match = offset === undefined ? null : /^<h([1-6])>([^<]*)/.exec(html.slice(offset));
  return match === null ? '?' : `h${match[1] ?? ''}:${match[2] ?? ''}`;
}
const headingLabels = (html: string, diagnostics: readonly PasteDiagnostic[]): string[] =>
  diagnostics.filter(item => item.code === ADAPTED).map(item => pastedHeadingAt(html, item.offset));
const nearestLevel = (level: number, levels: readonly number[]): number =>
  levels.filter(candidate => candidate >= level).sort((a, b) => a - b)[0] ?? Math.max(...levels);

/** Checks one paste against the same paste into an editor with all six levels. */
function expectFollowsFullLevels(html: string, adapted: Outcome, full: Outcome, levels: readonly number[]): { removed: number; kept: number } {
  const pasted = [...html.matchAll(/<h([1-6])>([^<]*)/g)]
    .filter(match => !levels.includes(Number(match[1]))).map(match => `h${match[1] ?? ''}:${match[2] ?? ''}`);
  const landed = pasted.filter(label => full.blocks.some(block => block.startsWith(label)));
  expect([adapted.result.status, full.result.status]).toEqual(['applied', 'applied']);
  expect(full.result.diagnostics.filter(item => item.code === ADAPTED)).toEqual([]);
  // onResult describes the cleanup: every adapted heading, whatever happened to it.
  expect(headingLabels(html, adapted.normalized)).toEqual(pasted);
  expect(headingLabels(html, adapted.result.diagnostics)).toEqual(landed);
  expect(adapted.result.diagnostics.filter(item => item.code !== ADAPTED)).toEqual(adapted.normalized.filter(item => item.code !== ADAPTED));
  expect(adapted.result.diagnosticsTruncated).toBe(false);
  expect(adapted.notice === null ? null : adapted.notice.includes(HEADING_NOTICE))
    .toBe(adapted.result.diagnostics.length === 0 ? null : landed.length > 0);
  // Adapting a heading changes its level and nothing else in the document.
  expect(adapted.blocks).toEqual(full.blocks.map(block => block.replace(/^h([1-6]):/, (_, level: string) => `h${String(nearestLevel(Number(level), levels))}:`)));
  return { removed: pasted.length - landed.length, kept: landed.length };
}

describe.each([
  { smartPaste: false, uniqueID: false }, { smartPaste: false, uniqueID: true },
  { smartPaste: true, uniqueID: false }, { smartPaste: true, uniqueID: true },
])('the heading notice with SmartPaste $smartPaste and block ids $uniqueID', ({ smartPaste, uniqueID }) => {
  for (const [name, seedHTML] of Object.entries(SEEDS)) {
    it(`follows the full-level outcome of every clipboard pasted at ${name}`, async () => {
      const adapted = mount({ smartPaste, uniqueID });
      const full = mount({ smartPaste, uniqueID, levels: ALL_LEVELS });
      let removed = 0;
      let kept = 0;
      for (const html of CLIPBOARDS) {
        const counted = expectFollowsFullLevels(html, await pasteAt(adapted, seedHTML, html, 4), await pasteAt(full, seedHTML, html, 4), [1, 2, 3, 4]);
        removed += counted.removed;
        kept += counted.kept;
      }
      // Every seed lands some pasted heading, such as the second of two.
      expect(kept).toBeGreaterThan(0);
      if (name.includes('middle') && !smartPaste) expect(removed).toBeGreaterThan(0);
    });

    it(`follows the full-level outcome with levels 2 and 3, for headings adapted up and down, at ${name}`, async () => {
      const adapted = mount({ smartPaste, uniqueID, levels: [2, 3] });
      const full = mount({ smartPaste, uniqueID, levels: ALL_LEVELS });
      let kept = 0;
      for (const html of NARROW_CLIPBOARDS) {
        kept += expectFollowsFullLevels(html, await pasteAt(adapted, seedHTML, html, 3), await pasteAt(full, seedHTML, html, 3), [2, 3]).kept;
      }
      expect(kept).toBeGreaterThan(0);
    });
  }
});

describe('the heading notice in the cases ProseMirror merges', () => {
  it('drops the warning of a heading merged into the middle of a paragraph and hides the notice', async () => {
    const { result, normalized, blocks, notice } = await pasteAt({}, SEEDS['the middle of a paragraph'] ?? '', '<h5>Five</h5>', 4);
    expect(blocks).toEqual(['paragraph:Hello Fiveworld']);
    expect(normalized).toEqual([{ code: ADAPTED, severity: 'warning', offset: 0 }]);
    expect(result).toMatchObject({ status: 'applied', diagnostics: [], diagnosticsTruncated: false });
    expect(Object.isFrozen(result.diagnostics)).toBe(true);
    expect(notice).toBeNull();
  });

  it('keeps the warning of the second heading when the first merges', async () => {
    const html = '<h5>Five</h5><h6>Six</h6>';
    const { result, blocks, notice } = await pasteAt({}, SEEDS['the middle of a paragraph'] ?? '', html, 4);
    expect(blocks).toEqual(['paragraph:Hello Five', 'h4:Sixworld']);
    expect(result.diagnostics).toEqual([{ code: ADAPTED, severity: 'warning', offset: html.indexOf('<h6') }]);
    expect(notice).toEqual([HEADING_NOTICE]);
  });

  it('keeps the warning of a heading that lands in an empty paragraph or at the start of one', async () => {
    for (const [seedHTML, expected] of [['<p>|</p>', ['h4:Five']], ['<p>|Hello</p>', ['h4:FiveHello']]] as const) {
      const { result, blocks } = await pasteAt({}, seedHTML, '<h5>Five</h5>', 4);
      expect(blocks).toEqual(expected);
      expect(result.diagnostics).toEqual([{ code: ADAPTED, severity: 'warning', offset: 0 }]);
    }
  });

  it('keeps the warning of a heading that fills an empty or wholly selected heading of its own markup, which ProseMirror keeps', async () => {
    for (const seedHTML of ['<h4>|</h4>', '<h4>[Hello world]</h4>']) {
      const fixture = mount();
      seed(fixture, seedHTML, 4);
      const node = fixture.editor.state.doc.firstChild;
      paste(fixture.editor, '<h5>Five</h5>');
      const { result, blocks } = await outcome(fixture);
      expect(blocks).toEqual(['h4:Five']);
      // The same heading node, now holding the pasted text.
      expect(fixture.editor.state.doc.firstChild?.sameMarkup(node ?? fixture.editor.state.doc)).toBe(true);
      expect(result.diagnostics.map(item => item.code)).toEqual([ADAPTED]);
    }
  });

  it('drops the warning of a heading merged into a heading of its own markup that keeps other text', async () => {
    for (const seedHTML of ['<h4>|Hello</h4>', '<h4>Hello |world</h4>', '<h4>Hello|</h4>', '<h4>[Hel]lo</h4>']) {
      const { result, blocks } = await pasteAt({}, seedHTML, '<h5>Five</h5>', 4);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatch(/^h4:.*Five/);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it('keeps other findings when it drops a merged heading', async () => {
    const { result, normalized, notice } = await pasteAt({}, SEEDS['the middle of a paragraph'] ?? '',
      '<h5>Five <a href="javascript:alert(1)">link</a></h5>', 4);
    expect(normalized.map(item => item.code)).toEqual(['link-removed', ADAPTED]);
    expect(result.diagnostics.map(item => item.code)).toEqual(['link-removed']);
    expect(notice).not.toBeNull();
    expect(notice).not.toContain(HEADING_NOTICE);
  });

  it('follows the heading levels 2 and 3', async () => {
    const html = '<h1>One</h1><h5>Five</h5>';
    const { result, blocks } = await pasteAt({ levels: [2, 3] }, SEEDS['the middle of a paragraph'] ?? '', html, 3);
    expect(blocks).toEqual(['paragraph:Hello One', 'h3:Fiveworld']);
    expect(result.diagnostics).toEqual([{ code: ADAPTED, severity: 'warning', offset: html.indexOf('<h5') }]);
  });

  it('keeps every warning when a truncated allowance hides which heading a finding belongs to', async () => {
    const { result, normalized } = await pasteAt({ options: { limits: { maxDiagnostics: 1 } } },
      SEEDS['the middle of a paragraph'] ?? '', '<h5>Five</h5><h6>Six</h6>', 4);
    expect(normalized).toEqual([{ code: ADAPTED, severity: 'warning', offset: 0 }]);
    expect(result.diagnosticsTruncated).toBe(true);
    expect(result.diagnostics).toEqual(normalized);
  });

  it('follows the inserted headings for a programmatic pasteHTML as for a paste event', async () => {
    for (const [seedHTML, kept] of [['<p>Hello |world</p>', false], ['<p>|</p>', true]] as const) {
      const fixture = mount();
      seed(fixture, seedHTML, 4);
      const event = new Event('paste', { cancelable: true }) as ClipboardEvent;
      expect(fixture.editor.view.pasteHTML('<h5>Five</h5>', event)).toBe(true);
      const { result, normalized } = await outcome(fixture);
      expect(result.status).toBe('applied');
      expect(normalized.map(item => item.code)).toEqual([ADAPTED]);
      expect(result.diagnostics.map(item => item.code)).toEqual(kept ? [ADAPTED] : []);
    }
  });

  it('keeps every warning when the parsed slice holds other headings than the cleaned HTML', async () => {
    // A plugin that adds a heading to the parsed slice leaves the pasted headings unknown.
    const Extra = Extension.create({ name: 'extraHeading', addProseMirrorPlugins() {
      return [new Plugin({ props: { transformPasted: (slice, view) => {
        const { schema } = view.state;
        const heading = schema.nodes['heading'];
        if (heading === undefined) return slice;
        return new Slice(slice.content.append(Fragment.from(heading.create({ level: 2 }, schema.text('Extra')))), slice.openStart, 0);
      } } })];
    } });
    const { result, normalized, blocks } = await pasteAt({ extensions: [Extra] }, SEEDS['the middle of a paragraph'] ?? '', '<h5>Five</h5>', 4);
    expect(blocks).toContain('h2:Extra');
    expect(normalized.map(item => item.code)).toEqual([ADAPTED]);
    expect(result.diagnostics).toEqual(normalized);
  });

  it.each([
    ['text inside the heading, which merges', 'text', ['paragraph:Hello Fiveworld'], false],
    ['the whole heading, which lands as a block', 'all', ['paragraph:Hello ', 'h4:Five', 'paragraph:world'], true],
  ] as const)('follows an own copy of %s from an editor with six levels', async (_, selection, expected, kept) => {
    const sourceHost = document.createElement('div'); document.body.append(sourceHost); hosts.push(sourceHost);
    const source = new Editor({ element: sourceHost, content: '<h5>Five</h5>',
      extensions: [Document, Paragraph, Text, Heading.configure({ levels: ALL_LEVELS }), PasteCleanup] });
    editors.push(source);
    if (selection === 'all') source.commands.selectAll();
    else source.view.dispatch(source.state.tr.setSelection(TextSelection.create(source.state.doc, 1, 5)));
    const copied = source.view.serializeForClipboard(source.state.selection.content()).dom.innerHTML;
    expect(copied).toContain('data-domternal-copy');
    const { result, normalized, blocks } = await pasteAt({}, SEEDS['the middle of a paragraph'] ?? '', copied, 4);
    expect(blocks).toEqual(expected);
    expect(normalized.map(item => item.code)).toEqual([ADAPTED]);
    expect(result.diagnostics.map(item => item.code)).toEqual(kept ? [ADAPTED] : []);
  });

  it('follows the inserted headings in a coordinated image paste', async () => {
    const data = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'), character => character.charCodeAt(0));
    const match = (context: ClipboardImageMatchContext): ReturnType<NonNullable<Exclude<PasteCleanupOptions['imageAssets'], false | undefined>['match']>> =>
      context.references.map(reference => ({ placementId: reference.placementId, itemIndex: 1, evidence: { kind: 'host' as const, matcherId: 'explicit-test-identity' } }));
    const html = '<h5>Chart</h5><p><img src="cid:chart" alt="Chart"></p>';
    for (const [seedHTML, expected, kept] of [
      // The image's alternative text is its text content.
      ['<p>Hello |world</p>', ['paragraph:Hello Chart', 'paragraph:Chartworld'], false],
      ['<p>|</p>', ['h4:Chart', 'paragraph:Chart'], true],
    ] as const) {
      const file = new File([data], 'chart.png', { type: 'image/png' });
      Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(data.slice().buffer) });
      const fixture = mount({ extensions: [Image.configure({ inline: true, uploadHandler: () => Promise.resolve('/unused.png') })],
        options: { imageAssets: { mode: 'embedded', match } } });
      seed(fixture, seedHTML, 4);
      paste(fixture.editor, html, [file]);
      const { result, normalized, blocks } = await outcome(fixture);
      let images = 0;
      fixture.editor.state.doc.descendants(node => { if (node.type.name === 'image') images++; });
      expect(images).toBe(1);
      expect(blocks).toEqual(expected);
      expect(normalized.map(item => item.code)).toContain(ADAPTED);
      expect(result.diagnostics.map(item => item.code).includes(ADAPTED)).toBe(kept);
    }
  });
});
