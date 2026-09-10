import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import {
  Blockquote, Bold, BulletList, Document, Editor, FontFamily, FontSize, Heading, Highlight, History, Italic,
  LineHeight, ListItem, Paragraph, StarterKit, Strike, Subscript, Superscript, Text, TextAlign, TextColor,
  OrderedList, TextStyle, Underline,
} from '@domternal/core';
import type { EditorOptions } from '@domternal/core';
import { redoDepth, undoDepth } from '@domternal/pm/history';
import { TextSelection } from '@domternal/pm/state';
import type { Transaction } from '@domternal/pm/state';
import { Image } from '../../extension-image/dist/index.js';
import { Table, TableCell, TableHeader, TableRow } from '../../extension-table/dist/index.js';
import { PasteCleanup, normalizePasteHTML } from './index.js';
import { deMessages } from './locales/de.js';
import type {
  ClipboardImageMatchContext, ClipboardResolverAdapter, PasteCleanupOptions, PasteOperationResult,
} from './index.js';

const editors: Editor[] = [];
const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors) if (!editor.isDestroyed) editor.destroy();
  for (const host of hosts) host.remove();
  editors.length = 0; hosts.length = 0; vi.restoreAllMocks();
});

const marks = [Bold, Italic, Underline, Strike, Subscript, Superscript];
const typography = [TextStyle, FontFamily, FontSize, TextColor, Highlight, TextAlign, LineHeight.configure({ lineHeights: [] })];
const tableHTML = '<table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr></tbody></table>';
const headerHTML = '<table><tbody><tr><th><p>A</p></th><th><p>B</p></th></tr><tr><td><p>C</p></td><td><p>D</p></td></tr></tbody></table>';
const warning = { code: 'destination-formatting-unconfirmed', severity: 'warning' };
const headingAdapted = (offset: number): unknown => ({ code: 'destination-heading-level-adapted', severity: 'warning', offset });
const headingNotice = 'Some headings were changed to a heading level this editor supports.';

interface Fixture {
  editor: Editor;
  normalized: Mock<NonNullable<PasteCleanupOptions['onResult']>>;
  completed: Mock<(result: PasteOperationResult) => void>;
  changes: Transaction[];
  host: HTMLDivElement;
}

function mount(options: PasteCleanupOptions = {}, extensions: NonNullable<EditorOptions['extensions']> = []): Fixture {
  const normalized = vi.fn<NonNullable<PasteCleanupOptions['onResult']>>();
  const completed = vi.fn<(result: PasteOperationResult) => void>();
  const changes: Transaction[] = [];
  const host = document.createElement('div'); document.body.append(host); hosts.push(host);
  const editor = new Editor({ element: host, content: '<p>Before old after</p>',
    extensions: [Document, Paragraph, Text, History, ...extensions,
      PasteCleanup.configure({ ...options, onResult: normalized, onPasteResult: completed })],
    onTransaction: ({ transaction }) => { if (transaction.docChanged) changes.push(transaction); },
  });
  editors.push(editor);
  editor.view.setProps({ handleScrollToSelection: () => true });
  editor.commands.selectAll();
  return { editor, normalized, completed, changes, host };
}
function paste(editor: Editor, html: string, files: readonly File[] = [], route: 'native' | 'programmatic' = 'native'): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    items: [{ kind: 'string', type: 'text/html', getAsFile: () => null },
      ...files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file }))],
    files, getData: (type: string) => type === 'text/html' ? html : '',
  } });
  if (route === 'programmatic') editor.view.pasteHTML(html, event as ClipboardEvent);
  else editor.view.dom.dispatchEvent(event);
  return event as ClipboardEvent;
}

async function terminal(fixture: Fixture, status: PasteOperationResult['status']): Promise<PasteOperationResult> {
  await vi.waitFor(() => { expect(fixture.completed).toHaveBeenCalledOnce(); }, { interval: 1 });
  const result = fixture.completed.mock.calls[0]?.[0];
  if (!result) throw new Error('Expected terminal paste result');
  expect(result.status).toBe(status);
  expect(fixture.normalized).toHaveBeenCalledOnce();
  expect(result.operationId).toBe(fixture.normalized.mock.calls[0]?.[0].operationId);
  expect(result.diagnostics).toEqual(fixture.normalized.mock.calls[0]?.[0].diagnostics);
  return result;
}
function snapshot(editor: Editor): { doc: unknown; selection: unknown; undo: number; redo: number } {
  return { doc: editor.getJSON(), selection: editor.state.selection.toJSON(),
    undo: undoDepth(editor.state), redo: redoDepth(editor.state) };
}
function notice(fixture: Fixture): HTMLElement {
  const element = fixture.host.querySelector<HTMLElement>('.dm-paste-feedback');
  if (!element) throw new Error('Expected default feedback notice');
  return element;
}

describe('destination capability feedback through the editor', () => {
  it.each(['preserve', 'adapt'] as const)('retains explicit list markers and reports missing representation in %s mode', async formatting => {
    for (const supported of [true, false]) {
      const ordered = supported ? OrderedList : OrderedList.extend({ addAttributes() { return { start: { default: 1 } }; } });
      const bullet = supported ? BulletList : BulletList.extend({ addAttributes() { return {}; } });
      const fixture = mount({ formatting }, [ordered, bullet]);
      const before = snapshot(fixture.editor);
      paste(fixture.editor, '<ol style="list-style-type:upper-roman"><li><p>Ordered</p></li></ol><ul style="list-style-type:square"><li><p>Bullet</p></li></ul>');
      const result = await terminal(fixture, 'applied');
      expect(result.diagnostics).toEqual(supported ? [] : [warning]);
      const doc = fixture.editor.state.doc;
      expect(doc.childCount).toBe(2);
      expect(doc.firstChild?.type.name).toBe('orderedList');
      expect(doc.firstChild?.attrs['listStyleType']).toBe(supported ? 'upper-roman' : undefined);
      expect(doc.lastChild?.type.name).toBe('bulletList');
      expect(doc.lastChild?.attrs['listStyleType']).toBe(supported ? 'square' : undefined);
      expect(doc.textContent).toBe('OrderedBullet');
      doc.check();
      const after = fixture.editor.getJSON();
      expect(fixture.changes).toHaveLength(1);
      expect(fixture.editor.commands.undo()).toBe(true);
      expect(fixture.editor.getJSON()).toEqual(before.doc);
      expect(fixture.editor.state.selection.toJSON()).toEqual(before.selection);
      expect(fixture.editor.commands.redo()).toBe(true);
      expect(fixture.editor.getJSON()).toEqual(after);
    }
  });

  it.each(['preserve', 'adapt'] as const)('warns for missing semantic marks while preserving readable text in %s mode', async formatting => {
    const fixture = mount({ formatting });
    const before = snapshot(fixture.editor);
    paste(fixture.editor, '<p><strong>Bold</strong> <em>italic</em> <u>underlined</u></p>');
    expect(fixture.normalized).toHaveBeenCalledOnce();
    expect(fixture.normalized.mock.calls[0]?.[0]).toMatchObject({ status: 'cleaned', diagnostics: [warning] });
    const result = await terminal(fixture, 'applied');
    expect(result.diagnostics).toEqual([warning]);
    expect(fixture.editor.getJSON()).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bold italic underlined' }] }] });
    expect(notice(fixture).hidden).toBe(false);
    expect(notice(fixture).textContent).toContain('This editor may not preserve some pasted formatting.');
    expect(notice(fixture).querySelector('[aria-modal], [role="dialog"]')).toBeNull();
    expect(fixture.changes).toHaveLength(1);
    expect(undoDepth(fixture.editor.state)).toBe(1);
    expect(fixture.editor.commands.undo()).toBe(true);
    expect(fixture.editor.getJSON()).toEqual(before.doc);
    expect(fixture.editor.state.selection.toJSON()).toEqual(before.selection);
  });

  it.each(['preserve', 'adapt'] as const)('keeps full Core marks and supported heading structure without a capability warning in %s mode', async formatting => {
    const fixture = mount({ formatting }, [...marks, ...typography, Heading.configure({ levels: [1, 2, 3] })]);
    paste(fixture.editor, '<h3>Title</h3><p style="text-align:center;line-height:1.5"><span style="font-family:Georgia;font-size:22px;color:#123456;background-color:#abcdef">'
      + '<strong>B</strong><em>I</em><u>U</u><s>S</s><sub>D</sub><sup>P</sup></span></p>');
    const result = await terminal(fixture, 'applied');
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: warning.code }));
    const heading = fixture.editor.state.doc.firstChild;
    expect(heading?.type.name).toBe('heading'); expect(heading?.attrs['level']).toBe(3); expect(heading?.textContent).toBe('Title');
    const paragraph = fixture.editor.state.doc.lastChild;
    expect(paragraph?.textContent).toBe('BIUSDP');
    expect(paragraph?.childCount).toBe(6);
    ['bold', 'italic', 'underline', 'strike', 'subscript', 'superscript'].forEach((mark, index) => {
      expect(paragraph?.child(index).marks.map(item => item.type.name)).toContain(mark);
    });
    const visual = paragraph?.firstChild?.marks.find(mark => mark.type.name === 'textStyle');
    if (formatting === 'preserve') {
      expect(visual?.attrs).toMatchObject({ fontFamily: 'Georgia', fontSize: '22px', color: '#123456', backgroundColor: '#abcdef' });
      expect(paragraph?.attrs).toMatchObject({ textAlign: 'center', lineHeight: '1.5' });
      expect(result.diagnostics).toEqual([]);
    } else {
      expect(visual).toBeUndefined();
      expect(paragraph?.attrs).toMatchObject({ textAlign: 'left', lineHeight: null });
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'formatting-adapted', severity: 'info' }));
    }
    expect(notice(fixture).hidden).toBe(true);
    expect(fixture.changes).toHaveLength(1);
  });

  it('distinguishes a TextStyle carrier from missing typography attributes in the applied result', async () => {
    const fixture = mount({}, [TextStyle]);
    paste(fixture.editor, '<p><span style="font-family:Georgia;font-size:22px;color:#123456">Text</span></p>');
    const result = await terminal(fixture, 'applied');
    expect(result.diagnostics).toEqual([warning]);
    expect(fixture.editor.getHTML()).toBe('<p><span>Text</span></p>');
    expect(fixture.editor.state.doc.firstChild?.firstChild?.marks.map(mark => ({ type: mark.type.name, attrs: mark.attrs })))
      .toEqual([{ type: 'textStyle', attrs: {} }]);
  });

  it('keeps intentional adaptation quiet even when typography extensions are absent', async () => {
    const fixture = mount({ formatting: 'adapt' });
    paste(fixture.editor, '<p style="text-align:center;line-height:1.5"><span style="font-family:Georgia;font-size:22px;color:#123456">Text</span></p>');
    const result = await terminal(fixture, 'applied');
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.every(item => item.code === 'formatting-adapted' && item.severity === 'info')).toBe(true);
    expect(fixture.editor.getHTML()).toBe('<p>Text</p>');
    expect(notice(fixture).hidden).toBe(true);
  });

  it.each([{ level: 2, supported: false }, { level: 3, supported: true }])('uses the configured heading level $level', async ({ level, supported }) => {
    const fixture = mount({}, [Heading.configure({ levels: [1, 3] })]);
    paste(fixture.editor, `<h${String(level)}>Title</h${String(level)}>`);
    const result = await terminal(fixture, 'applied');
    expect(result.diagnostics).toEqual(supported ? [] : [headingAdapted(0)]);
    expect(fixture.editor.getHTML()).toBe('<h3>Title</h3>');
    expect(notice(fixture).hidden).toBe(supported);
  });

  it('does not warn about empty decorative wrappers', async () => {
    const fixture = mount();
    paste(fixture.editor, '<p><strong></strong><span style="font-family:Georgia;color:#123456"></span>Text</p>');
    const result = await terminal(fixture, 'applied');
    expect(result.diagnostics).toEqual([]);
    expect(fixture.editor.getHTML()).toBe('<p>Text</p>');
    expect(notice(fixture).hidden).toBe(true);
  });

  it('delivers a single application-owned warning without mounting default feedback', async () => {
    const fixture = mount({ feedback: 'application' });
    paste(fixture.editor, '<p><strong>Text</strong></p>');
    const result = await terminal(fixture, 'applied');
    expect(result.diagnostics).toEqual([warning]);
    expect(fixture.host.querySelector('.dm-paste-feedback')).toBeNull();
    await Promise.resolve();
    expect(fixture.completed).toHaveBeenCalledOnce(); expect(fixture.normalized).toHaveBeenCalledOnce();
  });
});

describe('heading levels the destination cannot represent', () => {
  function blocks(editor: Editor): { type: string; level?: unknown; text: string }[] {
    const output: { type: string; level?: unknown; text: string }[] = [];
    editor.state.doc.descendants(node => {
      if (!node.isTextblock) return;
      output.push({ type: node.type.name, ...(node.type.name === 'heading' ? { level: node.attrs['level'] } : {}), text: node.textContent });
    });
    return output;
  }

  it.each(['preserve', 'adapt'] as const)('pastes default Heading levels five and six as level four, one reversible step, in %s mode', async formatting => {
    const fixture = mount({ formatting }, [Heading]);
    const before = snapshot(fixture.editor);
    const html = '<h5>Five</h5><h6>Six</h6><h2>Two</h2>';
    paste(fixture.editor, html);
    const result = await terminal(fixture, 'applied');
    expect(result.diagnostics).toEqual([headingAdapted(0), headingAdapted(html.indexOf('<h6'))]);
    expect(fixture.editor.getHTML()).toBe('<h4>Five</h4><h4>Six</h4><h2>Two</h2>');
    expect(() => { fixture.editor.state.doc.check(); }).not.toThrow();
    expect(notice(fixture).hidden).toBe(false);
    expect(notice(fixture).querySelector('.dm-paste-feedback__status')?.textContent).toBe('Review the pasted content.');
    expect(Array.from(notice(fixture).querySelectorAll('li'), row => row.textContent)).toEqual([headingNotice]);
    expect(fixture.changes).toHaveLength(1);
    expect(undoDepth(fixture.editor.state)).toBe(1);
    expect(fixture.editor.commands.undo()).toBe(true);
    expect(fixture.editor.getJSON()).toEqual(before.doc);
    expect(fixture.editor.state.selection.toJSON()).toEqual(before.selection);
  });

  it('pastes into a StarterKit editor at its deepest level', async () => {
    const normalized = vi.fn<NonNullable<PasteCleanupOptions['onResult']>>();
    const completed = vi.fn<(result: PasteOperationResult) => void>();
    const host = document.createElement('div'); document.body.append(host); hosts.push(host);
    const editor = new Editor({ element: host, content: '<p>Old</p>',
      extensions: [StarterKit, PasteCleanup.configure({ onResult: normalized, onPasteResult: completed })] });
    editors.push(editor);
    editor.view.setProps({ handleScrollToSelection: () => true });
    editor.commands.selectAll();
    paste(editor, '<h6>Six</h6><p>Body</p>');
    const result = await terminal({ editor, normalized, completed, changes: [], host }, 'applied');
    expect(result.diagnostics).toEqual([headingAdapted(0)]);
    expect(blocks(editor)).toEqual([{ type: 'heading', level: 4, text: 'Six' }, { type: 'paragraph', text: 'Body' }]);
  });

  it('moves a heading above the first configured level down to it', async () => {
    const fixture = mount({}, [Heading.configure({ levels: [2, 3] })]);
    paste(fixture.editor, '<h1>Page title</h1><h4>Deep</h4>');
    const result = await terminal(fixture, 'applied');
    expect(result.diagnostics).toEqual([headingAdapted(0), headingAdapted('<h1>Page title</h1>'.length)]);
    expect(fixture.editor.getHTML()).toBe('<h2>Page title</h2><h3>Deep</h3>');
  });

  it('keeps a paragraph and the general warning when the editor has no heading node', async () => {
    const fixture = mount();
    paste(fixture.editor, '<h5>Five</h5>');
    const result = await terminal(fixture, 'applied');
    expect(result.diagnostics).toEqual([warning]);
    expect(fixture.editor.getHTML()).toBe('<p>Five</p>');
    expect(notice(fixture).textContent).toContain('This editor may not preserve some pasted formatting.');
    expect(notice(fixture).textContent).not.toContain(headingNotice);
  });

  it.each([
    // A heading cannot open a list item, so the mapped tag parses as the item's text, as an h4 does.
    ['list item', [BulletList, ListItem], '<ul><li><h6>Inside</h6></li></ul>', { type: 'paragraph', text: 'Inside' }],
    ['blockquote', [Blockquote], '<blockquote><h6>Inside</h6></blockquote>', { type: 'heading', level: 4, text: 'Inside' }],
    ['table cell', [Table, TableRow, TableCell, TableHeader], '<table><tbody><tr><td><h6>Inside</h6></td><td><p>B</p></td></tr></tbody></table>',
      { type: 'heading', level: 4, text: 'Inside' }],
  ] as const)('maps a heading inside a %s as a supported heading of that level pastes', async (_, extensions, html, block) => {
    const mapped = mount({}, [Heading, ...extensions]);
    paste(mapped.editor, html);
    const result = await terminal(mapped, 'applied');
    // A heading that parses as the item's text is not renamed, so nothing is reported.
    expect(result.diagnostics).toEqual(block.type === 'paragraph' ? [] : [headingAdapted(html.indexOf('<h6'))]);
    const direct = mount({}, [Heading, ...extensions]);
    paste(direct.editor, html.replace(/h6>/g, 'h4>'));
    expect((await terminal(direct, 'applied')).diagnostics).toEqual([]);
    expect(mapped.editor.getJSON()).toEqual(direct.editor.getJSON());
    expect(blocks(mapped.editor)).toContainEqual(block);
    // The heading notice follows what reached the document.
    if (block.type === 'paragraph') expect(mapped.host.querySelector('.dm-paste-feedback')?.textContent ?? '').not.toContain(headingNotice);
    expect(() => { mapped.editor.state.doc.check(); }).not.toThrow();
  });

  it('keeps the alignment of a mapped heading', async () => {
    const fixture = mount({}, [Heading, TextAlign]);
    paste(fixture.editor, '<h5 style="text-align:center">Centered</h5>');
    const result = await terminal(fixture, 'applied');
    expect(result.diagnostics).toEqual([headingAdapted(0)]);
    expect(fixture.editor.state.doc.firstChild?.attrs).toMatchObject({ level: 4, textAlign: 'center' });
  });

  it('maps an own copy from an editor with six levels', async () => {
    const sourceHost = document.createElement('div'); document.body.append(sourceHost); hosts.push(sourceHost);
    const source = new Editor({ element: sourceHost, content: '<h5>Five</h5><h6>Six</h6>',
      extensions: [Document, Paragraph, Text, Heading.configure({ levels: [1, 2, 3, 4, 5, 6] }), PasteCleanup] });
    editors.push(source);
    source.commands.selectAll();
    const copied = source.view.serializeForClipboard(source.state.selection.content()).dom.innerHTML;
    expect(copied).toContain('data-domternal-copy');
    const fixture = mount({ formatting: 'adapt' }, [Heading]);
    paste(fixture.editor, copied);
    const result = await terminal(fixture, 'applied');
    expect(result.diagnostics.map(item => item.code)).toEqual(['destination-heading-level-adapted', 'destination-heading-level-adapted']);
    expect(blocks(fixture.editor)).toEqual([{ type: 'heading', level: 4, text: 'Five' }, { type: 'heading', level: 4, text: 'Six' }]);
  });

  it('shows the adaptation in the editor locale', async () => {
    const fixture = mount({}, [Heading]);
    fixture.editor.i18n.set({ locale: 'de', messages: deMessages });
    paste(fixture.editor, '<h6>Sechs</h6>');
    await terminal(fixture, 'applied');
    expect(Array.from(notice(fixture).querySelectorAll('li'), row => row.textContent))
      .toEqual([deMessages['pasteCleanup.diagnostic.destinationHeadingLevelAdapted']]);
    expect(notice(fixture).querySelector('li')?.lang).toBe('de');
  });

  it('maps headings in a coordinated image paste', async () => {
    const data = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'), character => character.charCodeAt(0));
    const file = new File([data], 'chart.png', { type: 'image/png' });
    Object.defineProperty(file, 'arrayBuffer', { value: () => Promise.resolve(data.slice().buffer) });
    const match = (context: ClipboardImageMatchContext): ReturnType<NonNullable<Exclude<PasteCleanupOptions['imageAssets'], false | undefined>['match']>> =>
      context.references.map(reference => ({ placementId: reference.placementId, itemIndex: 1, evidence: { kind: 'host' as const, matcherId: 'explicit-test-identity' } }));
    const fixture = mount({ imageAssets: { mode: 'embedded', match } }, [Heading, Image.configure({ inline: true, uploadHandler: () => Promise.resolve('/unused.png') })]);
    const html = '<h5>Chart</h5><p><img src="cid:chart" alt="Chart"></p>';
    paste(fixture.editor, html, [file]);
    const result = await terminal(fixture, 'applied');
    expect(result.diagnostics).toEqual([headingAdapted(0)]);
    expect(fixture.editor.state.doc.firstChild?.attrs['level']).toBe(4);
    let images = 0;
    fixture.editor.state.doc.descendants(node => { if (node.type.name === 'image') images++; });
    expect(images).toBe(1);
  });
});

describe('table capability rejection before application', () => {
  it.each(['table', 'header', 'diagnostic-cap'] as const)('preserves document, selected text and history for unsupported %s', async kind => {
    const extensions = kind === 'header' ? [Table, TableCell, TableRow.extend({ content: 'tableCell*' })] : [];
    const fixture = mount(kind === 'diagnostic-cap' ? { limits: { maxDiagnostics: 1 } } : {}, extensions);
    fixture.editor.view.dispatch(fixture.editor.state.tr.setSelection(TextSelection.create(fixture.editor.state.doc, 8, 11)));
    const before = snapshot(fixture.editor);
    const html = kind === 'header' ? headerHTML : kind === 'diagnostic-cap' ? '<p onclick="unsafe()">New</p>' + tableHTML : tableHTML;
    const event = paste(fixture.editor, html);
    expect(event.defaultPrevented).toBe(true);
    const result = await terminal(fixture, 'rejected');
    expect(result.reason).toBe('unsupported-content');
    expect(fixture.normalized.mock.calls[0]?.[0]).toMatchObject({ status: 'rejected', html: '' });
    expect(snapshot(fixture.editor)).toEqual(before);
    expect(fixture.changes).toEqual([]);
    expect(result.references.ranges).toEqual([]);
    // The terminal refusal replaces the earlier warning, so a full allowance still states the reason.
    expect(result.diagnostics).toEqual([{ code: 'destination-table-unsupported', severity: 'error' }]);
    expect(result.diagnosticsTruncated).toBe(kind === 'diagnostic-cap');
    expect(notice(fixture).hidden).toBe(false);
    expect(notice(fixture).textContent).toContain('Use an editor with table support, or paste as plain text.');
  });

  it('accepts real table and header extensions as one reversible paste', async () => {
    const fixture = mount({}, [Table, TableRow, TableCell, TableHeader]);
    const before = snapshot(fixture.editor);
    paste(fixture.editor, headerHTML);
    const result = await terminal(fixture, 'applied');
    expect(result.diagnostics).toEqual([]);
    const table = fixture.editor.state.doc.firstChild;
    expect(table?.type.name).toBe('table'); expect(table?.childCount).toBe(2);
    expect(table?.child(0).child(0).type.name).toBe('tableHeader');
    expect(table?.child(0).child(1).textContent).toBe('B');
    expect(table?.child(1).child(0).type.name).toBe('tableCell');
    expect(table?.child(1).child(1).textContent).toBe('D');
    expect(() => { fixture.editor.state.doc.check(); }).not.toThrow();
    expect(undoDepth(fixture.editor.state)).toBe(1);
    expect(fixture.editor.commands.undo()).toBe(true);
    expect(fixture.editor.getJSON()).toEqual(before.doc);
    expect(fixture.editor.state.selection.toJSON()).toEqual(before.selection);
  });

  it('leaves standalone HTML normalization schema-less', () => {
    const result = normalizePasteHTML(headerHTML);
    expect(result).toMatchObject({ status: 'cleaned', html: headerHTML, diagnostics: [], diagnosticsTruncated: false });
  });

  it.each([
    { mode: 'embedded', route: 'native' }, { mode: 'embedded', route: 'programmatic' },
    { mode: 'resolver', route: 'native' }, { mode: 'resolver', route: 'programmatic' },
  ] as const)('rejects a $mode $route table with a CID image before matching or reading assets', async ({ mode, route }) => {
    const data = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'), character => character.charCodeAt(0));
    const file = new File([data], 'private.png', { type: 'image/png' });
    const read = vi.fn(() => Promise.resolve(data.slice().buffer));
    Object.defineProperty(file, 'arrayBuffer', { value: read });
    const match = vi.fn((context: ClipboardImageMatchContext) => context.references.map(reference => ({
      placementId: reference.placementId, itemIndex: 1, evidence: { kind: 'host' as const, matcherId: 'explicit-test-identity' },
    })));
    const resolve = vi.fn<ClipboardResolverAdapter['resolve']>(() => Promise.resolve({ status: 'failed', creation: 'none' }));
    const release = vi.fn<ClipboardResolverAdapter['releaseUncommitted']>(() => Promise.resolve({ status: 'released' }));
    const upload = vi.fn(() => Promise.resolve('/legacy.png'));
    const fileReader = vi.spyOn(FileReader.prototype, 'readAsDataURL');
    const imageAssets = mode === 'embedded' ? { mode, match } : { mode, match,
      resolver: { idempotency: 'operation-asset-key' as const, resolve, releaseUncommitted: release },
      sourcePolicy: { allowedOrigins: ['https://assets.example.test'] }, onRecovery: vi.fn() };
    const fixture = mount({ imageAssets, limits: { maxDiagnostics: 1 } }, [Image.configure({ allowBase64: mode === 'embedded', uploadHandler: upload })]);
    fixture.editor.view.dispatch(fixture.editor.state.tr.setSelection(TextSelection.create(fixture.editor.state.doc, 8, 11)));
    const before = snapshot(fixture.editor);
    paste(fixture.editor, '<p onclick="unsafe()">New</p>' + tableHTML + '<p><img src="cid:chart" alt="Chart"></p>', [file], route);
    const result = await terminal(fixture, 'rejected');
    expect(result.reason).toBe('unsupported-content');
    expect(result.diagnosticsTruncated).toBe(true);
    expect(result.diagnostics).toEqual([{ code: 'destination-table-unsupported', severity: 'error' }]);
    expect(fixture.normalized.mock.calls[0]?.[0]).toMatchObject({ status: 'rejected', html: '' });
    expect(snapshot(fixture.editor)).toEqual(before); expect(fixture.changes).toEqual([]);
    expect(match).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled(); expect(fileReader).not.toHaveBeenCalled();
    await new Promise<void>(accept => { setTimeout(accept, 0); });
    expect(fixture.completed).toHaveBeenCalledOnce(); expect(fixture.normalized).toHaveBeenCalledOnce();
  });
});
