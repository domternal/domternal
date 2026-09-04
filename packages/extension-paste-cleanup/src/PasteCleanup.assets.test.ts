import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Bold, BulletList, CodeBlock, Document, Editor, Extension, ExtensionConfigurationError, History, ListItem, Node, OrderedList, Paragraph, Text } from '@domternal/core';
import { getClipboardImageDestination } from '@domternal/core/clipboard';
import type { EditorOptions } from '@domternal/core';
import { redoDepth, undoDepth } from '@domternal/pm/history';
import { Plugin, TextSelection } from '@domternal/pm/state';
import type { Transaction } from '@domternal/pm/state';
import { Image } from '../../extension-image/dist/index.js';
import type { ImageOptions } from '../../extension-image/dist/index.js';
import { PasteCleanup } from './PasteCleanup.js';
import type { PasteCleanupOptions } from './PasteCleanup.js';
import type { PasteOperationResult } from './operations.js';

// Synthetic local clipboard fixtures, not native Word captures or codec validation.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
const PNG = atob(PNG_BASE64);
const PNG_URL = 'data:image/png;base64,' + PNG_BASE64;
type AssetOptions = Exclude<NonNullable<PasteCleanupOptions['imageAssets']>, false>;
type Matcher = NonNullable<AssetOptions['match']>;
type Progress = Parameters<NonNullable<PasteCleanupOptions['onPasteProgress']>>[0];
const editors: Editor[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const editor of editors) if (!editor.isDestroyed) editor.destroy();
  for (const host of hosts) host.remove();
  editors.length = 0;
  hosts.length = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function bytes(binary = PNG): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function imageFile(binary = PNG, type = 'image/png', pending?: Promise<ArrayBuffer>): { file: File; read: Mock<() => Promise<ArrayBuffer>> } {
  const file = new File([bytes(binary)], 'private-source-name.png', { type });
  const read = vi.fn(() => pending ?? Promise.resolve(bytes(binary).buffer));
  // JSDOM File lacks arrayBuffer in some versions. The fixture supplies only the
  // trusted native byte-reader method; its captured File metadata stays immutable.
  Object.defineProperty(file, 'arrayBuffer', { value: read, configurable: false, writable: false });
  return { file, read };
}

function explicitMatch(mapping: Readonly<Record<string, number>> = { 'cid:chart': 1 }): Matcher {
  return context => context.references.flatMap(reference => {
    const itemIndex = mapping[reference.rawReference];
    return itemIndex === undefined ? [] : [{
      placementId: reference.placementId, itemIndex, evidence: { kind: 'host' as const, matcherId: 'test-explicit-identity' },
    }];
  });
}

interface ClipboardSource { html?: string; text?: string; files?: readonly (File | null)[]; declaredType?: string }
function clipboard(source: ClipboardSource): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  const fileItems = (source.files ?? []).map(file => ({
    kind: 'file', type: source.declaredType ?? file?.type ?? 'image/png', getAsFile: () => file,
  }));
  Object.defineProperty(event, 'clipboardData', { value: {
    items: [{ kind: 'string', type: 'text/html', getAsFile: () => null }, ...fileItems],
    files: (source.files ?? []).filter(file => file !== null),
    getData: (type: string) => type === 'text/html' ? source.html ?? '' : type === 'text/plain' ? source.text ?? '' : '',
  } });
  return event as ClipboardEvent;
}

function paste(editor: Editor, source: ClipboardSource, route: 'native' | 'programmatic' = 'native'): ClipboardEvent {
  const event = clipboard(source);
  if (route === 'programmatic') editor.view.pasteHTML(source.html ?? '', event);
  else editor.view.dom.dispatchEvent(event);
  return event;
}

interface FixtureOptions {
  cleanup?: PasteCleanupOptions;
  image?: Partial<ImageOptions>;
  withImage?: boolean;
  content?: string;
  additional?: NonNullable<EditorOptions['extensions']>;
  events?: Partial<EditorOptions>;
}

interface Fixture {
  editor: Editor;
  completed: Mock<(result: PasteOperationResult) => void>;
  normalized: Mock<NonNullable<PasteCleanupOptions['onResult']>>;
  progress: Mock<(value: Progress) => void>;
  upload: Mock<() => Promise<string>>;
  changes: Transaction[];
  host: HTMLElement;
}

function mount(options: FixtureOptions = {}): Fixture {
  const completed = vi.fn((result: PasteOperationResult) => { options.cleanup?.onPasteResult?.(result); });
  const normalized = vi.fn<NonNullable<PasteCleanupOptions['onResult']>>(result => { options.cleanup?.onResult?.(result); });
  const progress = vi.fn((value: Progress) => { options.cleanup?.onPasteProgress?.(value); });
  const upload = vi.fn(() => Promise.resolve('/legacy-upload.png'));
  const changes: Transaction[] = [];
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  const editor = new Editor({
    ...options.events,
    element: host,
    content: options.content ?? '<p>Original content</p>',
    extensions: [Document, Paragraph, Text, Bold, CodeBlock, History,
      ...(options.withImage === false ? [] : [Image.configure({ uploadHandler: upload, ...options.image })]),
      PasteCleanup.configure({ imageAssets: { mode: 'embedded', match: explicitMatch() }, ...options.cleanup,
        onPasteResult: completed, onResult: normalized, onPasteProgress: progress }),
      ...options.additional ?? [],
    ],
    onTransaction(event) {
      if (event.transaction.docChanged) changes.push(event.transaction);
      options.events?.onTransaction?.(event);
    },
  });
  editors.push(editor);
  // Browser layout is covered by the browser suite. JSDOM has no Range geometry
  // for PM scrolling; skip only that view hook while keeping dispatch observable.
  editor.view.setProps({ handleScrollToSelection: () => true });
  editor.commands.selectAll();
  return { editor, completed, normalized, progress, upload, changes, host };
}
function snapshot(editor: Editor): { doc: unknown; selection: unknown; undo: number; redo: number } {
  return { doc: editor.getJSON(), selection: editor.state.selection.toJSON(), undo: undoDepth(editor.state), redo: redoDepth(editor.state) };
}

function imageNodes(editor: Editor): { src: unknown; alt: unknown; width: unknown; height: unknown }[] {
  const images: { src: unknown; alt: unknown; width: unknown; height: unknown }[] = [];
  editor.state.doc.descendants(node => {
    if (node.type.name === 'image') images.push({ src: node.attrs['src'], alt: node.attrs['alt'], width: node.attrs['width'], height: node.attrs['height'] });
  });
  return images;
}

async function terminal(fixture: Fixture, status: PasteOperationResult['status'], reason?: PasteOperationResult['reason'], count = 1): Promise<void> {
  await vi.waitFor(() => { expect(fixture.completed).toHaveBeenCalledTimes(count); }, { timeout: 1500, interval: 1 });
  expect(fixture.completed.mock.calls[count - 1]?.[0]).toMatchObject({ status, ...(reason === undefined ? {} : { reason }) });
}

// Drain a task boundary so late settled readers and receipt microtasks can run.
async function drain(): Promise<void> { await new Promise<void>(resolve => { setTimeout(resolve, 0); }); }

describe('coordinated embedded clipboard assets', () => {
  it.each(['native', 'programmatic'] as const)('retains visible Office markers during %s asset preparation with a legacy list schema', async route => {
    const LegacyOrdered = OrderedList.extend({ addAttributes: () => ({ start: {
      default: 1, parseHTML: (element: HTMLElement) => Number(element.getAttribute('start') ?? 1),
    } }) });
    const LegacyBullet = BulletList.extend({ addAttributes: () => ({}) });
    const asset = imageFile();
    const fixture = mount({ image: { inline: true }, additional: [LegacyOrdered, LegacyBullet, ListItem] });
    paste(fixture.editor, {
      html: '<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">7. </span>Outer<img src="cid:chart"></p>'
        + '<p style="mso-list:l0 level2 lfo1"><span style="mso-list:Ignore">◦ </span>Inner</p>',
      files: [asset.file],
    }, route);
    await terminal(fixture, 'applied');
    const types: string[] = [];
    fixture.editor.state.doc.forEach(node => { types.push(node.type.name); });
    expect(types).toEqual(['paragraph', 'paragraph']);
    expect(fixture.editor.state.doc.textContent).toBe('7. Outer◦ Inner');
    expect(imageNodes(fixture.editor)).toHaveLength(1);
    expect(asset.read).toHaveBeenCalledOnce();
    expect(fixture.upload).not.toHaveBeenCalled();
    expect(fixture.normalized).toHaveBeenCalledOnce();
    expect(fixture.normalized.mock.calls[0]?.[0].diagnostics).toContainEqual(expect.objectContaining({ code: 'office-list-unsupported' }));
    expect(fixture.changes).toHaveLength(1);
  });

  it.each(['native', 'programmatic'] as const)('applies a trusted mixed %s paste once after preparation, preserving exact Undo/Redo state', async route => {
    const ready = deferred<ArrayBuffer>();
    const asset = imageFile(PNG, 'image/png', ready.promise);
    const fixture = mount({ content: '<p>Before old after</p>', image: { inline: true } });
    const { editor, changes, completed, normalized, progress, upload } = fixture;
    expect(getClipboardImageDestination(editor.view)?.allowEmbedded).toBe(true);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 8, 11)));
    editor.view.focus();
    const focused = document.activeElement;
    const before = snapshot(editor);
    const domBefore = editor.view.dom.innerHTML;
    const fileReader = vi.spyOn(FileReader.prototype, 'readAsDataURL');
    const event = paste(editor, { html: '<p><strong>New</strong><img src="cid:chart" alt="Chart" width="12" height="8"></p>', files: [asset.file] }, route);
    if (route === 'native') expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => { expect(asset.read).toHaveBeenCalledOnce(); }, { interval: 1 });
    expect(snapshot(editor)).toEqual(before);
    expect(editor.view.dom.innerHTML).toBe(domBefore);
    expect(document.activeElement).toBe(focused);
    expect(completed).not.toHaveBeenCalled();
    expect(progress).toHaveBeenCalledOnce();
    expect(progress.mock.calls[0]?.[0]).toMatchObject({ phase: 'preparing', cancel: expect.any(Function) });
    ready.resolve(bytes().buffer);
    await terminal(fixture, 'applied');
    // Image exposes its alt through leafText, independently of the text nodes.
    expect(editor.state.doc.textContent).toBe('Before NewChart after');
    expect(imageNodes(editor)).toEqual([{ src: PNG_URL, alt: 'Chart', width: '12', height: '8' }]);
    expect(editor.getHTML()).toContain('<strong>New</strong>');
    expect(changes).toHaveLength(1);
    expect(changes[0]?.getMeta('paste')).toBe(true);
    expect(changes[0]?.getMeta('uiEvent')).toBe('paste');
    expect(undoDepth(editor.state)).toBe(1);
    expect(normalized).toHaveBeenCalledOnce();
    expect(normalized.mock.calls[0]?.[0].operationId).toBe(completed.mock.calls[0]?.[0].operationId);
    expect(progress.mock.calls[0]?.[0].operationId).toBe(completed.mock.calls[0]?.[0].operationId);
    expect(upload).not.toHaveBeenCalled();
    expect(fileReader).not.toHaveBeenCalled();
    const after = snapshot(editor);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before.doc);
    expect(editor.state.selection.toJSON()).toEqual(before.selection);
    expect(editor.commands.redo()).toBe(true);
    expect(snapshot(editor)).toEqual(after);
    await drain();
    expect(completed).toHaveBeenCalledOnce();
  });

  it('accepts a local image-only clipboard without invoking a legacy upload', async () => {
    const asset = imageFile();
    const fixture = mount();
    paste(fixture.editor, { files: [asset.file] });
    await terminal(fixture, 'applied');
    expect(imageNodes(fixture.editor)).toHaveLength(1);
    expect(imageNodes(fixture.editor)[0]?.src).toBe(PNG_URL);
    expect(asset.read).toHaveBeenCalledOnce();
    expect(fixture.upload).not.toHaveBeenCalled();
    expect(fixture.changes).toHaveLength(1);
  });

  it('isolates a prepared paste from adjacent preceding and following typing in exact Undo/Redo steps', async () => {
    // Equal timestamps make the grouping assertions independent of machine speed.
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const fixture = mount({ content: '<p></p>', image: { inline: true } });
    const { editor } = fixture;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
    const initial = snapshot(editor);
    editor.view.dispatch(editor.state.tr.insertText('Before '));
    const beforePaste = snapshot(editor);
    expect(undoDepth(editor.state)).toBe(1);
    paste(editor, { html: '<p><strong>Rich</strong><img src="cid:chart"></p>', files: [imageFile().file] });
    await terminal(fixture, 'applied');
    expect(editor.state.doc.textContent).toBe('Before Rich');
    expect(undoDepth(editor.state)).toBe(2);
    const afterPaste = snapshot(editor);
    editor.view.dispatch(editor.state.tr.insertText(' after'));
    const afterTyping = snapshot(editor);
    expect(undoDepth(editor.state)).toBe(3);

    for (const expected of [afterPaste, beforePaste, initial]) {
      expect(editor.commands.undo()).toBe(true);
      expect(editor.getJSON()).toEqual(expected.doc);
      expect(editor.state.selection.toJSON()).toEqual(expected.selection);
    }
    expect(undoDepth(editor.state)).toBe(0);
    for (const expected of [beforePaste, afterPaste, afterTyping]) {
      expect(editor.commands.redo()).toBe(true);
      expect(editor.getJSON()).toEqual(expected.doc);
      expect(editor.state.selection.toJSON()).toEqual(expected.selection);
    }
    expect(redoDepth(editor.state)).toBe(0);
  });

  it('keeps a lower-priority appended normalizer in the paste history group and isolates subsequent typing', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const normalize = Extension.create({ name: 'normalizePreparedPaste', priority: 100,
      addProseMirrorPlugins: () => [new Plugin({
        appendTransaction(transactions, _previous, state) {
          return transactions.some(transaction => transaction.getMeta('paste') === true)
            ? state.tr.insertText('!', state.doc.content.size - 1) : null;
        },
      })],
    });
    const fixture = mount({ image: { inline: true }, additional: [normalize] });
    const { editor } = fixture;
    const before = snapshot(editor);
    paste(editor, { html: '<p>Rich<img src="cid:chart"></p>', files: [imageFile().file] });
    await terminal(fixture, 'applied');
    expect(editor.state.doc.textContent).toBe('Rich!');
    expect(imageNodes(editor)).toHaveLength(1);
    // Editor emits the root transaction event once; its accepted state includes
    // the appended normalization whose visible suffix is asserted above.
    expect(fixture.changes).toHaveLength(1);
    expect(undoDepth(editor.state)).toBe(1);
    const afterPaste = snapshot(editor);
    editor.view.dispatch(editor.state.tr.insertText(' following'));
    const afterTyping = snapshot(editor);
    expect(undoDepth(editor.state)).toBe(2);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(afterPaste.doc);
    expect(editor.state.selection.toJSON()).toEqual(afterPaste.selection);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before.doc);
    expect(editor.state.selection.toJSON()).toEqual(before.selection);
    expect(editor.commands.redo()).toBe(true);
    expect(editor.getJSON()).toEqual(afterPaste.doc);
    expect(editor.state.selection.toJSON()).toEqual(afterPaste.selection);
    expect(editor.commands.redo()).toBe(true);
    expect(editor.getJSON()).toEqual(afterTyping.doc);
    expect(editor.state.selection.toJSON()).toEqual(afterTyping.selection);
    expect(fixture.completed).toHaveBeenCalledOnce();
  });

  it.each(['selection-only', 'empty', 'veto'] as const)('keeps the following typing separate after an intervening %s root without an extra history event', async kind => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const vetoed = vi.fn();
    const filter = Extension.create({ name: 'vetoInterveningRoot', addProseMirrorPlugins: () => [new Plugin({
      filterTransaction(transaction) {
        if (transaction.getMeta('assetTestVeto') !== true) return true;
        vetoed();
        return false;
      },
    })] });
    const fixture = mount({ image: { inline: true }, additional: [filter] });
    const { editor } = fixture;
    const before = snapshot(editor);
    paste(editor, { html: '<p>Rich<img src="cid:chart"></p>', files: [imageFile().file] });
    await terminal(fixture, 'applied');
    const afterPaste = snapshot(editor);
    const selection = editor.state.selection;
    if (kind === 'selection-only') {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
      editor.view.dispatch(editor.state.tr.setSelection(selection));
    } else if (kind === 'empty') editor.view.dispatch(editor.state.tr);
    else editor.view.dispatch(editor.state.tr.insertText('Blocked').setMeta('assetTestVeto', true));
    expect(snapshot(editor)).toEqual(afterPaste);
    expect(vetoed).toHaveBeenCalledTimes(kind === 'veto' ? 1 : 0);
    editor.view.dispatch(editor.state.tr.insertText(' following'));
    expect(undoDepth(editor.state)).toBe(2);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(afterPaste.doc);
    expect(editor.state.selection.toJSON()).toEqual(afterPaste.selection);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before.doc);
    expect(editor.state.selection.toJSON()).toEqual(before.selection);
    expect(undoDepth(editor.state)).toBe(0);
  });

  it('retains the legacy Image upload route when coordinated assets are explicitly disabled', async () => {
    const asset = imageFile();
    const fixture = mount({ cleanup: { imageAssets: false } });
    paste(fixture.editor, { files: [asset.file] });
    await vi.waitFor(() => { expect(imageNodes(fixture.editor)[0]?.src).toBe('/legacy-upload.png'); }, { interval: 1 });
    expect(fixture.upload).toHaveBeenCalledExactlyOnceWith(asset.file);
    expect(asset.read).not.toHaveBeenCalled();
    expect(fixture.progress).not.toHaveBeenCalled();
  });

  it('exposes frozen metadata with original item indices and no Files or filenames to the trusted matcher', async () => {
    const asset = imageFile();
    const match = vi.fn<Matcher>(explicitMatch({ 'cid:chart': 2 }));
    const fixture = mount({ cleanup: { imageAssets: { mode: 'embedded', match } } });
    paste(fixture.editor, { html: '<p>Rich</p><img src="cid:chart">', files: [null, asset.file] });
    await terminal(fixture, 'applied');
    expect(match).toHaveBeenCalledOnce();
    const context = match.mock.calls[0]?.[0];
    expect(context?.items.map(item => item.itemIndex)).toEqual([0, 1, 2]);
    expect(context?.items[1]).toMatchObject({ available: false });
    expect(context?.items[2]).toMatchObject({ kind: 'file', declaredType: 'image/png', fileType: 'image/png', fileSize: PNG.length, available: true });
    expect(JSON.stringify(context)).not.toContain('private-source-name');
    expect(context?.items[2]).not.toHaveProperty('file');
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context?.items)).toBe(true);
    expect(Object.isFrozen(context?.references)).toBe(true);
  });

  it('reads one explicitly bound File once for multiple placements without merging their attributes', async () => {
    const asset = imageFile();
    const fixture = mount({ cleanup: { imageAssets: { mode: 'embedded', match: explicitMatch({ 'cid:first': 1, 'cid:second': 1 }) } } });
    paste(fixture.editor, { html: '<img src="cid:first" alt="First" width="12"><p>Between</p><img src="cid:second" alt="Second" width="20">', files: [asset.file] });
    await terminal(fixture, 'applied');
    expect(asset.read).toHaveBeenCalledOnce();
    expect(imageNodes(fixture.editor).map(image => [image.src, image.alt, image.width])).toEqual([[PNG_URL, 'First', '12'], [PNG_URL, 'Second', '20']]);
    expect(fixture.editor.state.doc.textContent).toBe('FirstBetweenSecond');
  });

  it('preserves two placements for byte-identical distinct Files while reading each File once', async () => {
    const first = imageFile();
    const second = imageFile();
    const fixture = mount({ cleanup: { imageAssets: { mode: 'embedded', match: explicitMatch({ 'cid:first': 1, 'cid:second': 2 }) } } });
    paste(fixture.editor, { html: '<img src="cid:first" alt="First"><img src="cid:second" alt="Second">', files: [first.file, second.file] });
    await terminal(fixture, 'applied');
    expect(imageNodes(fixture.editor).map(image => [image.src, image.alt])).toEqual([[PNG_URL, 'First'], [PNG_URL, 'Second']]);
    expect(first.read).toHaveBeenCalledOnce();
    expect(second.read).toHaveBeenCalledOnce();
    expect(fixture.upload).not.toHaveBeenCalled();
  });

  it('keeps an already embedded HTML image once without appending or reading its duplicate clipboard file', async () => {
    const asset = imageFile();
    const fixture = mount();
    paste(fixture.editor, { html: `<img src="${PNG_URL}" alt="Existing">`, files: [asset.file] });
    await terminal(fixture, 'applied');
    expect(imageNodes(fixture.editor).map(image => [image.src, image.alt])).toEqual([[PNG_URL, 'Existing']]);
    expect(asset.read).not.toHaveBeenCalled();
    expect(fixture.upload).not.toHaveBeenCalled();
  });

  it('rejects unmatched references by default without guessing a one-to-one file association', async () => {
    const asset = imageFile();
    const fixture = mount({ cleanup: { imageAssets: { mode: 'embedded' } } });
    const before = snapshot(fixture.editor);
    paste(fixture.editor, { html: '<p>Rich<img src="cid:1" alt="Missing"></p>', files: [asset.file] });
    await terminal(fixture, 'rejected', 'assets-unavailable');
    expect(snapshot(fixture.editor)).toEqual(before);
    expect(asset.read).not.toHaveBeenCalled();
    expect(fixture.upload).not.toHaveBeenCalled();
  });

  it('rejects unresolved programmatic HTML without clipboardData while exposing references and empty item metadata', async () => {
    // PM creates its default event through the global constructor, absent in JSDOM.
    vi.stubGlobal('ClipboardEvent', class extends Event { readonly clipboardData = null; });
    const match = vi.fn<Matcher>(() => []);
    const fixture = mount({ cleanup: { imageAssets: { mode: 'embedded', match } } });
    const before = snapshot(fixture.editor);
    fixture.editor.view.pasteHTML('<p>Text<img src="cid:chart"></p>');
    await terminal(fixture, 'rejected', 'assets-unavailable');
    expect(snapshot(fixture.editor)).toEqual(before);
    expect(match).toHaveBeenCalledOnce();
    expect(match.mock.calls[0]?.[0].items).toEqual([]);
    expect(match.mock.calls[0]?.[0].references).toEqual([expect.objectContaining({ rawReference: 'cid:chart' })]);
    expect(fixture.changes).toHaveLength(0);
    expect(fixture.upload).not.toHaveBeenCalled();
  });

  it('requires explicit omit policy to preserve text and a warning for an unmatched image', async () => {
    const asset = imageFile();
    const fixture = mount({ cleanup: { imageAssets: { mode: 'embedded', unresolved: 'omit' } } });
    paste(fixture.editor, { html: '<p>Rich<img src="cid:unknown" alt=" Diagram"></p>', files: [asset.file] });
    await terminal(fixture, 'applied');
    expect(fixture.editor.state.doc.textContent).toBe('Rich Diagram');
    expect(imageNodes(fixture.editor)).toHaveLength(0);
    expect(fixture.completed.mock.calls[0]?.[0].diagnostics).toContainEqual(expect.objectContaining({ code: 'image-removed', severity: 'warning' }));
    expect(asset.read).not.toHaveBeenCalled();
    expect(fixture.upload).not.toHaveBeenCalled();
  });

  it('rejects invalid explicit bindings even when an earlier missing reference fills the diagnostic allowance', async () => {
    const asset = imageFile();
    const fixture = mount({ cleanup: {
      limits: { maxDiagnostics: 1 },
      imageAssets: { mode: 'embedded', unresolved: 'omit', match: explicitMatch({ 'cid:invalid': 999 }) },
    } });
    const before = snapshot(fixture.editor);
    paste(fixture.editor, { html: '<p>Text<img src="cid:unbound"><img src="cid:invalid"></p>', files: [asset.file] });
    await terminal(fixture, 'rejected', 'assets-unavailable');
    expect(snapshot(fixture.editor)).toEqual(before);
    expect(asset.read).not.toHaveBeenCalled();
    expect(fixture.upload).not.toHaveBeenCalled();
  });

  it('classifies a structure limit behind a full diagnostic allowance as an asset limit', async () => {
    const asset = imageFile();
    const fixture = mount({ cleanup: { limits: { maxDiagnostics: 1, maxNodes: 21 }, imageAssets: { mode: 'embedded', match: explicitMatch() } } });
    const before = snapshot(fixture.editor);
    const runs = '<span style="color:red">x</span>'.repeat(6);
    paste(fixture.editor, { html: `<p style="position:fixed">A</p><p><img src="cid:chart"></p><p>${runs}</p>`, files: [asset.file] });
    await terminal(fixture, 'rejected', 'asset-limit');
    // The retained terminal error, not the earlier warning, decides the coordinated refusal reason.
    expect(fixture.completed.mock.calls[0]?.[0]).toMatchObject({ diagnostics: [{ code: 'structure-limit', severity: 'error' }], diagnosticsTruncated: true });
    expect(snapshot(fixture.editor)).toEqual(before);
    expect(asset.read).not.toHaveBeenCalled();
    expect(fixture.upload).not.toHaveBeenCalled();
  });

  it.each(['absent', 'unregistered', 'embedding-disabled'] as const)('rejects an %s destination before reading files', async policy => {
    const unregistered = Node.create({ name: 'image', group: 'block', atom: true,
      addAttributes: () => ({ src: { default: null } }), parseHTML: () => [{ tag: 'img' }], renderHTML: () => ['img'],
    });
    const fixture = mount({ withImage: policy === 'embedding-disabled', image: { allowBase64: false }, additional: policy === 'unregistered' ? [unregistered] : [] });
    const asset = imageFile();
    const before = snapshot(fixture.editor);
    paste(fixture.editor, { html: '<p>Rich</p><img src="cid:chart">', files: [asset.file] });
    await terminal(fixture, 'rejected', 'unsupported-destination');
    expect(snapshot(fixture.editor)).toEqual(before);
    expect(asset.read).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'empty file', binary: '', mime: 'image/png', declaredType: 'image/png' },
    { label: 'invalid signature', binary: 'not a PNG image', mime: 'image/png', declaredType: 'image/png' },
    { label: 'MIME disagreement', binary: PNG, mime: 'image/jpeg', declaredType: 'image/png' },
  ])('rejects $label without partial text insertion or upload', async ({ binary, mime, declaredType }) => {
    const asset = imageFile(binary, mime);
    const fixture = mount();
    const before = snapshot(fixture.editor);
    paste(fixture.editor, { html: '<p>Rich</p><img src="cid:chart">', files: [asset.file], declaredType });
    await terminal(fixture, 'rejected');
    expect(snapshot(fixture.editor)).toEqual(before);
    expect(fixture.upload).not.toHaveBeenCalled();
  });

  it.each(['file', 'aggregate', 'output'] as const)('rejects the %s budget before any file read', async limit => {
    const first = imageFile();
    const second = imageFile();
    const limits = limit === 'file' ? { maxFileBytes: PNG.length - 1 } : limit === 'aggregate'
      ? { maxFileBytes: PNG.length, maxTotalFileBytes: PNG.length } : { maxPreparedOutputUnits: 32 };
    const fixture = mount({ cleanup: { imageAssets: { mode: 'embedded', limits, match: explicitMatch({ 'cid:first': 1, 'cid:second': 2 }) } } });
    const before = snapshot(fixture.editor);
    paste(fixture.editor, { html: '<img src="cid:first"><img src="cid:second">', files: [first.file, second.file] });
    await terminal(fixture, 'rejected', 'asset-limit');
    expect(snapshot(fixture.editor)).toEqual(before);
    expect(first.read).not.toHaveBeenCalled();
    expect(second.read).not.toHaveBeenCalled();
  });

  it('fails configuration for a zero asset budget instead of treating it as unlimited', () => {
    expect(() => mount({ cleanup: { imageAssets: { mode: 'embedded', limits: { maxFileBytes: 0 } } } })).toThrow(ExtensionConfigurationError);
  });

  it('reports one read failure and leaves the editor untouched', async () => {
    const ready = deferred<ArrayBuffer>();
    const asset = imageFile(PNG, 'image/png', ready.promise);
    const fixture = mount();
    const before = snapshot(fixture.editor);
    paste(fixture.editor, { html: '<p>Rich</p><img src="cid:chart">', files: [asset.file] });
    await vi.waitFor(() => { expect(asset.read).toHaveBeenCalledOnce(); }, { interval: 1 });
    ready.reject(new Error('Private read failure'));
    await terminal(fixture, 'rejected', 'asset-read-failed');
    expect(snapshot(fixture.editor)).toEqual(before);
    expect(JSON.stringify(fixture.completed.mock.calls)).not.toContain('Private read failure');
  });

  it('cancels a pending read explicitly, reports once and ignores a later successful resolution', async () => {
    const ready = deferred<ArrayBuffer>();
    const asset = imageFile(PNG, 'image/png', ready.promise);
    const fixture = mount();
    const before = snapshot(fixture.editor);
    paste(fixture.editor, { html: '<p>Rich</p><img src="cid:chart">', files: [asset.file] });
    await vi.waitFor(() => { expect(fixture.progress).toHaveBeenCalledOnce(); }, { interval: 1 });
    const progress = fixture.progress.mock.calls[0]?.[0];
    progress?.cancel();
    progress?.cancel();
    await terminal(fixture, 'rejected', 'cancelled');
    ready.resolve(bytes().buffer);
    await drain();
    expect(snapshot(fixture.editor)).toEqual(before);
    expect(fixture.completed).toHaveBeenCalledOnce();
    expect(fixture.host.querySelector<HTMLElement>('.dm-paste-feedback')?.hidden).toBe(true);
  });

  it('honors synchronous cancellation from the progress observer before reading files', async () => {
    const asset = imageFile();
    const fixture = mount({ cleanup: { onPasteProgress: progress => { progress.cancel(); } } });
    const before = snapshot(fixture.editor);
    paste(fixture.editor, { html: '<p>Rich</p><img src="cid:chart">', files: [asset.file] });
    await terminal(fixture, 'rejected', 'cancelled');
    expect(snapshot(fixture.editor)).toEqual(before);
    expect(asset.read).not.toHaveBeenCalled();
    expect(fixture.progress).toHaveBeenCalledOnce();
  });

  it('rejects a stale destination when the file reader synchronously edits the document', async () => {
    const asset = imageFile();
    const fixture = mount();
    asset.read.mockImplementation(() => {
      fixture.editor.view.dispatch(fixture.editor.state.tr.insertText('Reader host edit'));
      return Promise.resolve(bytes().buffer);
    });
    paste(fixture.editor, { html: '<p>Stale</p><img src="cid:chart">', files: [asset.file] });
    await terminal(fixture, 'rejected', 'target-changed');
    expect(fixture.editor.state.doc.textContent).toBe('Reader host edit');
    expect(imageNodes(fixture.editor)).toHaveLength(0);
    expect(fixture.changes).toHaveLength(1);
  });

  it('supersedes a pending image paste with the next paste and ignores the old cancel callback', async () => {
    const ready = deferred<ArrayBuffer>();
    const first = imageFile(PNG, 'image/png', ready.promise);
    const fixture = mount();
    paste(fixture.editor, { html: '<p>Old</p><img src="cid:chart">', files: [first.file] });
    await vi.waitFor(() => { expect(fixture.progress).toHaveBeenCalledOnce(); }, { interval: 1 });
    const old = fixture.progress.mock.calls[0]?.[0];
    paste(fixture.editor, { html: '<p>New content</p>' });
    await vi.waitFor(() => { expect(fixture.completed).toHaveBeenCalledTimes(2); }, { interval: 1 });
    old?.cancel();
    ready.resolve(bytes().buffer);
    await drain();
    expect(fixture.completed.mock.calls.map(call => [call[0].status, call[0].reason])).toEqual(expect.arrayContaining([['rejected', 'superseded'], ['applied', undefined]]));
    expect(fixture.editor.state.doc.textContent).toBe('New content');
    expect(imageNodes(fixture.editor)).toHaveLength(0);
    expect(fixture.changes).toHaveLength(1);
    expect(fixture.completed).toHaveBeenCalledTimes(2);
  });

  it('supersedes a held image-only operation when a higher handler consumes a new empty programmatic paste', async () => {
    const empty = clipboard({});
    const consumed = vi.fn(() => true);
    const earlier = Extension.create({ name: 'consumeEmptyBeforeCleanup', priority: 1300,
      addProseMirrorPlugins: () => [new Plugin({ props: {
        handlePaste: (_view, event) => event === empty ? consumed() : false,
      } })],
    });
    const ready = deferred<ArrayBuffer>();
    const asset = imageFile(PNG, 'image/png', ready.promise);
    const fixture = mount({ additional: [earlier] });
    const before = snapshot(fixture.editor);
    paste(fixture.editor, { files: [asset.file] });
    await vi.waitFor(() => { expect(asset.read).toHaveBeenCalledOnce(); }, { interval: 1 });
    expect(fixture.editor.view.pasteHTML('', empty)).toBe(true);
    expect(consumed).toHaveBeenCalledOnce();
    await terminal(fixture, 'rejected', 'superseded');
    ready.resolve(bytes().buffer);
    await drain();
    expect(snapshot(fixture.editor)).toEqual(before);
    expect(fixture.completed).toHaveBeenCalledOnce();
    expect(fixture.changes).toHaveLength(0);
  });

  it.each(['edit-and-undo', 'selection-and-restore', 'read-only', 'adoption', 'policy-change'] as const)('invalidates a pending destination after %s without revival', async change => {
    const ready = deferred<ArrayBuffer>();
    const asset = imageFile(PNG, 'image/png', ready.promise);
    const fixture = mount();
    const { editor } = fixture;
    const docBefore = editor.getJSON();
    const selection = editor.state.selection;
    paste(editor, { html: '<p>Stale</p><img src="cid:chart">', files: [asset.file] });
    await vi.waitFor(() => { expect(asset.read).toHaveBeenCalledOnce(); }, { interval: 1 });
    if (change === 'edit-and-undo') {
      editor.view.dispatch(editor.state.tr.insertText('Changed', 1));
      expect(editor.commands.undo()).toBe(true);
    } else if (change === 'selection-and-restore') {
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
      editor.view.dispatch(editor.state.tr.setSelection(selection));
    } else if (change === 'read-only') editor.setEditable(false);
    else if (change === 'adoption') {
      const owner = document.implementation.createHTMLDocument('Adopted');
      const host = owner.createElement('div');
      owner.body.append(host);
      hosts.push(host);
      editor.adoptDom(host);
    } else {
      const image = editor.extensionManager.extensions.find(extension => extension.name === 'image');
      if (image === undefined) throw new Error('Expected installed Image extension');
      Object.defineProperty(image, 'options', { value: { ...image.options as ImageOptions, allowBase64: false }, configurable: true });
    }
    ready.resolve(bytes().buffer);
    await terminal(fixture, 'rejected', 'target-changed');
    expect(editor.getJSON()).toEqual(docBefore);
    expect(imageNodes(editor)).toHaveLength(0);
  });

  it('settles pending destruction once and does not reattach UI or insert late images', async () => {
    const ready = deferred<ArrayBuffer>();
    const asset = imageFile(PNG, 'image/png', ready.promise);
    const fixture = mount();
    paste(fixture.editor, { html: '<p>Stale</p><img src="cid:chart">', files: [asset.file] });
    await vi.waitFor(() => { expect(asset.read).toHaveBeenCalledOnce(); }, { interval: 1 });
    fixture.editor.destroy();
    ready.resolve(bytes().buffer);
    await terminal(fixture, 'rejected', 'target-changed');
    await drain();
    expect(fixture.changes).toHaveLength(0);
    expect(fixture.completed).toHaveBeenCalledOnce();
    expect(fixture.host.querySelector('.dm-paste-feedback')).toBeNull();
  });

  it.each(['document', 'policy'] as const)('revalidates the target after a lower paste handler changes the %s', async change => {
    const lower = vi.fn(() => {
      if (change === 'document') fixture.editor.view.dispatch(fixture.editor.state.tr.insertText('Host edit'));
      else {
        const image = fixture.editor.extensionManager.extensions.find(extension => extension.name === 'image');
        if (image === undefined) throw new Error('Expected installed Image extension');
        Object.defineProperty(image, 'options', { value: { ...image.options as ImageOptions, allowBase64: false }, configurable: true });
      }
      return false;
    });
    const extension = Extension.create({ name: 'changeAssetTargetBeforeInsertion', priority: 1100,
      addProseMirrorPlugins: () => [new Plugin({ props: { handlePaste: lower } })],
    });
    const fixture: Fixture = mount({ additional: [extension] });
    paste(fixture.editor, { html: '<p>Stale</p><img src="cid:chart">', files: [imageFile().file] });
    await terminal(fixture, 'rejected', 'target-changed');
    expect(lower).toHaveBeenCalledOnce();
    expect(fixture.editor.state.doc.textContent).toBe(change === 'document' ? 'Host edit' : 'Original content');
    expect(imageNodes(fixture.editor)).toHaveLength(0);
    expect(fixture.changes).toHaveLength(change === 'document' ? 1 : 0);
  });

  it.each(['cancel', 'adopt'] as const)('rejects an owned replay when a lower handler performs %s before the claimed dispatch', async action => {
    let cancel: (() => void) | undefined;
    const lower = vi.fn(() => {
      if (action === 'cancel') {
        if (cancel === undefined) throw new Error('Expected preparation cancellation callback');
        cancel();
      } else {
        const owner = document.implementation.createHTMLDocument('Adopted during replay');
        const host = owner.createElement('div');
        owner.body.append(host);
        hosts.push(host);
        fixture.editor.adoptDom(host);
      }
      return false;
    });
    const extension = Extension.create({ name: 'stopOwnedReplayBeforeDispatch', priority: 1100,
      addProseMirrorPlugins: () => [new Plugin({ props: { handlePaste: lower } })],
    });
    const fixture: Fixture = mount({ additional: [extension], cleanup: { onPasteProgress: progress => { cancel = progress.cancel; } } });
    const before = snapshot(fixture.editor);
    paste(fixture.editor, { html: '<p>Stale</p><img src="cid:chart">', files: [imageFile().file] });
    await terminal(fixture, 'rejected', action === 'cancel' ? 'cancelled' : 'target-changed');
    expect(snapshot(fixture.editor)).toEqual(before);
    expect(lower).toHaveBeenCalledOnce();
    expect(fixture.changes).toHaveLength(0);
    expect(fixture.upload).not.toHaveBeenCalled();
    await drain();
    expect(fixture.completed).toHaveBeenCalledOnce();
  });

  it('reports an insertion veto as untracked without accepted content or history', async () => {
    const veto = Extension.create({ name: 'vetoAssetPaste', addProseMirrorPlugins: () => [new Plugin({
      filterTransaction: transaction => transaction.getMeta('paste') !== true,
    })] });
    const fixture = mount({ additional: [veto] });
    const before = snapshot(fixture.editor);
    paste(fixture.editor, { html: '<p>Rich</p><img src="cid:chart">', files: [imageFile().file] });
    await terminal(fixture, 'untracked');
    expect(snapshot(fixture.editor)).toEqual(before);
    expect(fixture.changes).toHaveLength(0);
    expect(fixture.completed.mock.calls[0]?.[0]).not.toHaveProperty('reason');
  });

  it('keeps accepted images and applied receipt when a host observer throws after commit', async () => {
    const fixture = mount({ events: { onTransaction: ({ transaction }) => {
      if (transaction.docChanged) throw new Error('Host failed after commit');
    } } });
    paste(fixture.editor, { html: '<p>Accepted</p><img src="cid:chart">', files: [imageFile().file] });
    await terminal(fixture, 'applied');
    expect(fixture.editor.state.doc.textContent).toBe('Accepted');
    expect(imageNodes(fixture.editor)).toHaveLength(1);
    expect(undoDepth(fixture.editor.state)).toBe(1);
    expect(fixture.completed.mock.calls[0]?.[0]).not.toHaveProperty('reason');
  });

  it('completes each receipt once when its result observer starts another paste and throws', async () => {
    let nested = false;
    const fixture: Fixture = mount({ cleanup: { onPasteResult: () => {
      if (!nested) { nested = true; paste(fixture.editor, { html: '<p>Next</p>' }); }
      throw new Error('Observer failure');
    } } });
    paste(fixture.editor, { html: '<p>Accepted</p><img src="cid:chart">', files: [imageFile().file] });
    await vi.waitFor(() => { expect(fixture.completed).toHaveBeenCalledTimes(2); }, { interval: 1 });
    expect(fixture.completed.mock.calls.every(call => call[0].status === 'applied')).toBe(true);
    expect(new Set(fixture.completed.mock.calls.map(call => call[0].operationId)).size).toBe(2);
    await drain();
    expect(fixture.completed).toHaveBeenCalledTimes(2);
  });

  it('invalidates the captured target when a normalization observer edits it before application', async () => {
    let changed = false;
    const fixture: Fixture = mount({ cleanup: { onResult: () => {
      if (changed) return;
      changed = true;
      fixture.editor.view.dispatch(fixture.editor.state.tr.insertText('Host change'));
    } } });
    paste(fixture.editor, { html: '<p>Stale</p><img src="cid:chart">', files: [imageFile().file] });
    await terminal(fixture, 'rejected', 'target-changed');
    expect(fixture.editor.state.doc.textContent).toBe('Host change');
    expect(imageNodes(fixture.editor)).toHaveLength(0);
    expect(fixture.normalized).toHaveBeenCalledOnce();
  });

  it('does not prepare files when a code block requests literal clipboard text', async () => {
    const asset = imageFile();
    const fixture = mount({ content: '<pre><code>Old</code></pre>' });
    fixture.editor.view.dispatch(fixture.editor.state.tr.setSelection(TextSelection.create(fixture.editor.state.doc, 1, 4)));
    paste(fixture.editor, { html: '<p>Rich<img src="cid:chart"></p>', text: '  literal\n\ttext', files: [asset.file] });
    await terminal(fixture, 'applied');
    expect(fixture.editor.state.doc.textContent).toBe('  literal\n\ttext');
    expect(asset.read).not.toHaveBeenCalled();
    expect(fixture.progress).not.toHaveBeenCalled();
    expect(fixture.upload).not.toHaveBeenCalled();
  });
});
