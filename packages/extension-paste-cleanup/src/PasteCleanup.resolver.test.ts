import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, Editor, Extension, ExtensionConfigurationError, History, Paragraph, Text } from '@domternal/core';
import type { EditorOptions } from '@domternal/core';
import { undoDepth } from '@domternal/pm/history';
import type { Slice } from '@domternal/pm/model';
import { Plugin } from '@domternal/pm/state';
import { Image } from '../../extension-image/dist/index.js';
import { PasteCleanup } from './PasteCleanup.js';
import type { PasteCleanupOptions } from './PasteCleanup.js';
import type { ClipboardAssetRecoveryReport, ClipboardResolvedImageAssetOptions, PastePreparationProgress } from './clipboard/types.js';
import type { ClipboardResolverAdapter, ClipboardResolverAdapterResult, ClipboardResolverRequest } from './clipboard/resolverTypes.js';
import type { PasteOperationResult } from './operations.js';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'), character => character.charCodeAt(0));
const SRC = 'https://assets.example.test/chart.png';
const editors: Editor[] = [];
afterEach(() => { for (const editor of editors) if (!editor.isDestroyed) editor.destroy(); editors.length = 0; vi.restoreAllMocks(); });

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(accept => { resolve = accept; }), resolve: value => { resolve(value); } };
}
function file(): File {
  const result = new File([PNG], 'private.png', { type: 'image/png' });
  Object.defineProperty(result, 'arrayBuffer', { value: () => Promise.resolve(PNG.slice().buffer), configurable: true });
  return result;
}
function paste(editor: Editor, html = '<p>Chart <img src="cid:chart" alt="Chart"></p>', files = [file()]): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    items: [{ kind: 'string', type: 'text/html', getAsFile: () => null }, ...files.map(value => ({ kind: 'file', type: value.type, getAsFile: () => value }))],
    files, getData: (type: string) => type === 'text/html' ? html : '',
  } });
  editor.view.pasteHTML(html, event as ClipboardEvent);
}
function adapter(resolve?: ClipboardResolverAdapter['resolve']): ClipboardResolverAdapter {
  return { idempotency: 'operation-asset-key',
    resolve: resolve ?? vi.fn<ClipboardResolverAdapter['resolve']>(request => {
      const resource = request.registerCreated('private-storage-handle');
      if (resource === undefined) throw new Error('Registration refused');
      return Promise.resolve({ status: 'resolved', ownership: 'created', src: SRC, resource });
    }),
    releaseUncommitted: vi.fn(() => Promise.resolve({ status: 'released' as const })),
  };
}
interface Fixture {
  editor: Editor; adapter: ClipboardResolverAdapter; reports: ClipboardAssetRecoveryReport[];
  results: PasteOperationResult[]; progress: PastePreparationProgress[];
  upload: ReturnType<typeof vi.fn<() => Promise<string>>>;
}
function fixture(options: {
  adapter?: ClipboardResolverAdapter;
  assets?: Partial<ClipboardResolvedImageAssetOptions>;
  cleanup?: PasteCleanupOptions;
  extensions?: NonNullable<EditorOptions['extensions']>;
} = {}): Fixture {
  const resourceAdapter = options.adapter ?? adapter();
  const reports: ClipboardAssetRecoveryReport[] = [];
  const results: PasteOperationResult[] = [];
  const progress: PastePreparationProgress[] = [];
  const upload = vi.fn(() => Promise.resolve('/legacy.png'));
  const editor = new Editor({ content: '<p>Before</p>', extensions: [Document, Paragraph, Text, History,
    Image.configure({ allowBase64: false, uploadHandler: upload }),
    PasteCleanup.configure({ ...options.cleanup,
      imageAssets: { mode: 'resolver', resolver: resourceAdapter, sourcePolicy: { allowedOrigins: ['https://assets.example.test'] },
        match: context => context.references.map(reference => ({ placementId: reference.placementId, itemIndex: 1,
          evidence: { kind: 'host', matcherId: 'test-identity' } })),
        onRecovery: report => { reports.push(report); }, ...options.assets },
      onPasteResult: result => { results.push(result); options.cleanup?.onPasteResult?.(result); },
      onPasteProgress: value => { progress.push(value); options.cleanup?.onPasteProgress?.(value); },
    }), ...options.extensions ?? []],
  });
  editors.push(editor);
  editor.view.setProps({ handleScrollToSelection: () => true });
  editor.commands.selectAll();
  return { editor, adapter: resourceAdapter, reports, results, progress, upload };
}
async function terminal(value: Fixture, status: PasteOperationResult['status']): Promise<void> {
  await vi.waitFor(() => { expect(value.results).toHaveLength(1); expect(value.results[0]?.status).toBe(status); }, { interval: 1 });
}
async function recovery(value: Fixture, phase: ClipboardAssetRecoveryReport['phase']): Promise<void> {
  await vi.waitFor(() => { expect(value.reports.at(-1)).toMatchObject({ phase, settled: true }); }, { interval: 1 });
}
function images(editor: Editor): unknown[] {
  const found: unknown[] = [];
  editor.state.doc.descendants(node => { if (node.type.name === 'image') found.push(node.attrs['src']); });
  return found;
}

describe('persistent clipboard resolver integration', () => {
  it('resolves qualified immutable bytes once for repeated placements and retains after Undo and destroy', async () => {
    const value = fixture();
    const before = value.editor.getJSON();
    paste(value.editor, '<p><img src="cid:chart"><img src="cid:chart"></p>');
    await terminal(value, 'applied');
    await recovery(value, 'accepted');
    expect(images(value.editor)).toEqual([SRC, SRC]);
    expect(value.adapter.resolve).toHaveBeenCalledOnce();
    const request = vi.mocked(value.adapter.resolve).mock.calls[0]?.[0];
    expect(request).toMatchObject({ mimeType: 'image/png', assetId: 'asset-1' });
    expect(request?.blob.size).toBe(PNG.byteLength);
    expect(request?.idempotencyKey).toMatch(/^paste:[a-f0-9]{32}:1$/u);
    expect(value.reports.at(-1)).toMatchObject({ ownership: 'retained', registeredResources: 1, releasedResources: 0 });
    expect(undoDepth(value.editor.state)).toBe(1);
    value.editor.commands.undo();
    expect(value.editor.getJSON()).toEqual(before);
    value.editor.destroy();
    await Promise.resolve();
    expect(value.adapter.releaseUncommitted).not.toHaveBeenCalled();
    expect(value.upload).not.toHaveBeenCalled();
  });

  it('accepts an existing persistent resource without authorizing compensation', async () => {
    const value = fixture({ adapter: adapter(vi.fn<ClipboardResolverAdapter['resolve']>(() => Promise.resolve({ status: 'resolved', ownership: 'existing', src: SRC }))) });
    paste(value.editor);
    await terminal(value, 'applied');
    await recovery(value, 'accepted');
    expect(value.reports.at(-1)?.registeredResources).toBe(0);
    expect(value.adapter.releaseUncommitted).not.toHaveBeenCalled();
  });

  it('runs trusted HTML and slice transforms once through the normal replay pipeline', async () => {
    const html = vi.fn((value: string) => value.replace('Chart ', 'Transformed '));
    const slice = vi.fn((value: Slice) => value);
    const handler = vi.fn(() => false);
    const hooks = Extension.create({ name: 'resolverHooks', priority: 1400, addProseMirrorPlugins: () => [new Plugin({ props: {
      transformPastedHTML: html, transformPasted: slice, handlePaste: handler,
    } })] });
    const value = fixture({ extensions: [hooks] });
    paste(value.editor);
    await terminal(value, 'applied');
    await recovery(value, 'accepted');
    expect(html).toHaveBeenCalledOnce();
    expect(slice).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledOnce();
    expect(value.editor.state.doc.textContent).toBe('TransformedChart');
    expect(images(value.editor)).toEqual([SRC]);
  });

  it('does not resolve or read files in the plain-text paste path', async () => {
    const value = fixture();
    const image = file();
    const read = vi.spyOn(image, 'arrayBuffer');
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { items: [{ kind: 'file', type: image.type, getAsFile: () => image }],
      getData: () => '', files: [image] } });
    value.editor.view.pasteText('Plain', event as ClipboardEvent);
    await terminal(value, 'applied');
    expect(value.editor.state.doc.textContent).toBe('Plain');
    expect(read).not.toHaveBeenCalled();
    expect(value.adapter.resolve).not.toHaveBeenCalled();
  });

  it('does not publish partial content and promptly reports cancellation while a resolver remains pending', async () => {
    const pending = deferred<ClipboardResolverAdapterResult>();
    let request!: Readonly<ClipboardResolverRequest>;
    const value = fixture({ adapter: adapter(vi.fn(input => { request = input; return pending.promise; })) });
    const before = value.editor.getJSON();
    paste(value.editor);
    await vi.waitFor(() => { expect(value.adapter.resolve).toHaveBeenCalledOnce(); }, { interval: 1 });
    expect(value.results).toHaveLength(0);
    expect(value.editor.getJSON()).toEqual(before);
    value.progress[0]?.cancel();
    await terminal(value, 'rejected');
    expect(value.results[0]?.reason).toBe('cancelled');
    expect(request.signal.aborted).toBe(true);
    expect(value.reports.at(-1)?.settled).toBe(false);
    const resource = request.registerCreated('late-private-handle');
    expect(resource).toBeDefined();
    expect(value.adapter.releaseUncommitted).not.toHaveBeenCalled();
    pending.resolve({ status: 'resolved', ownership: 'created', src: SRC, resource: resource! });
    await recovery(value, 'unapplied');
    expect(value.adapter.releaseUncommitted).toHaveBeenCalledOnce();
    expect(value.reports.at(-1)?.ownership).toBe('released');
    expect(value.editor.getJSON()).toEqual(before);
    expect(undoDepth(value.editor.state)).toBe(0);
  });

  it('publishes late recovery after destruction without waiting for cleanup to complete', async () => {
    const pending = deferred<ClipboardResolverAdapterResult>();
    const cleanup = deferred<{ status: 'cleanup-pending'; retryToken: string }>();
    let request!: Readonly<ClipboardResolverRequest>;
    const resourceAdapter = { ...adapter(vi.fn(input => { request = input; return pending.promise; })),
      releaseUncommitted: vi.fn(() => cleanup.promise) };
    const value = fixture({ adapter: resourceAdapter });
    paste(value.editor);
    await vi.waitFor(() => { expect(resourceAdapter.resolve).toHaveBeenCalledOnce(); }, { interval: 1 });
    value.editor.destroy();
    await terminal(value, 'rejected');
    const resource = request.registerCreated('late-after-destroy');
    pending.resolve({ status: 'resolved', ownership: 'created', src: SRC, resource: resource! });
    await vi.waitFor(() => { expect(resourceAdapter.releaseUncommitted).toHaveBeenCalledOnce(); }, { interval: 1 });
    expect(value.results).toHaveLength(1);
    cleanup.resolve({ status: 'cleanup-pending', retryToken: 'host-private-recovery' });
    await recovery(value, 'unapplied');
    expect(value.reports.at(-1)?.recovery).toContainEqual(expect.objectContaining({ reason: 'cleanup-pending', token: 'host-private-recovery' }));
    expect(JSON.stringify(value.results)).not.toContain('host-private-recovery');
  });

  it.each(['https://unapproved.test/image.png', 'data:image/png;base64,AAAA', 'blob:https://assets.example.test/id', 'https://user:secret@assets.example.test/image'])('compensates a created resource with disallowed source %s', async src => {
    const value = fixture({ adapter: adapter(vi.fn<ClipboardResolverAdapter['resolve']>(request => {
      const resource = request.registerCreated('created-invalid-source');
      return Promise.resolve({ status: 'resolved', ownership: 'created', src, resource: resource! });
    })) });
    paste(value.editor);
    await terminal(value, 'rejected');
    await recovery(value, 'unapplied');
    expect(value.editor.state.doc.textContent).toBe('Before');
    expect(value.adapter.releaseUncommitted).toHaveBeenCalledOnce();
  });

  it('retains unknown ownership after a throwing adapter and successful known-resource cleanup', async () => {
    const value = fixture({ adapter: adapter(vi.fn<ClipboardResolverAdapter['resolve']>(request => { request.registerCreated('known-handle'); return Promise.reject(new Error('Private adapter failure')); })) });
    paste(value.editor);
    await terminal(value, 'rejected');
    await recovery(value, 'unapplied');
    expect(value.adapter.releaseUncommitted).toHaveBeenCalledOnce();
    expect(value.reports.at(-1)?.ownership).toBe('recovery-pending');
    expect(JSON.stringify(value.reports)).not.toContain('Private adapter failure');
  });

  it('compensates a fully resolved set when final serialized output exceeds its bound before exposure', async () => {
    const normalized = vi.fn<NonNullable<PasteCleanupOptions['onResult']>>();
    const value = fixture({ assets: { limits: { maxPreparedOutputUnits: 1 } }, cleanup: { onResult: normalized } });
    paste(value.editor);
    await terminal(value, 'rejected');
    await recovery(value, 'unapplied');
    expect(value.adapter.resolve).toHaveBeenCalledOnce();
    expect(value.adapter.releaseUncommitted).toHaveBeenCalledOnce();
    expect(value.results[0]?.reason).toBe('asset-limit');
    expect(normalized).toHaveBeenCalledOnce();
    expect(normalized.mock.calls[0]?.[0].html).toBe('');
    expect(value.editor.state.doc.textContent).toBe('Before');
  });

  it('retains resources when onResult inserts an untagged reference then throws', async () => {
    const value = fixture({ cleanup: { onResult: result => {
      expect(result.html).toContain(SRC);
      value.editor.view.dispatch(value.editor.state.tr.replaceSelectionWith(value.editor.state.schema.nodes['image']!.create({ src: SRC })));
      throw new Error('Host inserted independently');
    } } });
    paste(value.editor);
    await terminal(value, 'rejected');
    await recovery(value, 'uncertain');
    expect(images(value.editor)).toEqual([SRC]);
    expect(value.adapter.releaseUncommitted).not.toHaveBeenCalled();
  });

  it('keeps a vetoed replay uncertain once its persistent HTML reached host hooks', async () => {
    const veto = Extension.create({ name: 'resolverVeto', addProseMirrorPlugins: () => [new Plugin({
      filterTransaction: transaction => transaction.getMeta('paste') !== true,
    })] });
    const value = fixture({ extensions: [veto] });
    paste(value.editor);
    await terminal(value, 'untracked');
    await recovery(value, 'uncertain');
    expect(value.editor.state.doc.textContent).toBe('Before');
    expect(value.adapter.releaseUncommitted).not.toHaveBeenCalled();
  });

  it.each([false, true])('distinguishes skipped noop from an accepted no-change receipt: accepted=%s', async accepted => {
    const handler = Extension.create({ name: 'resolverNoop', priority: 90, addProseMirrorPlugins: () => [new Plugin({ props: {
      handlePaste(view) { if (accepted) view.dispatch(view.state.tr.setMeta('paste', true).setMeta('uiEvent', 'paste')); return true; },
    } })] });
    const value = fixture({ extensions: [handler] });
    paste(value.editor);
    await terminal(value, accepted ? 'noop' : 'untracked');
    await recovery(value, accepted ? 'accepted' : 'uncertain');
    expect(value.adapter.releaseUncommitted).not.toHaveBeenCalled();
  });

  it('retains accepted resources when the terminal observer destroys the editor and throws', async () => {
    const value = fixture({ cleanup: { onPasteResult: () => { value.editor.destroy(); throw new Error('Host observer failed'); } } });
    paste(value.editor);
    await terminal(value, 'applied');
    await recovery(value, 'accepted');
    expect(value.adapter.releaseUncommitted).not.toHaveBeenCalled();
  });

  it('creates distinct nonce-based idempotency keys for separate pastes', async () => {
    const value = fixture();
    paste(value.editor);
    await terminal(value, 'applied');
    const first = vi.mocked(value.adapter.resolve).mock.calls[0]?.[0].idempotencyKey;
    value.editor.commands.selectAll();
    paste(value.editor);
    await vi.waitFor(() => { expect(value.results).toHaveLength(2); }, { interval: 1 });
    const second = vi.mocked(value.adapter.resolve).mock.calls[1]?.[0].idempotencyKey;
    expect(first).not.toBe(second);
    expect(first).toMatch(/^paste:[a-f0-9]{32}:1$/u);
    expect(second).toMatch(/^paste:[a-f0-9]{32}:1$/u);
  });

  it('fails before any resolver call when secure randomness is unavailable', async () => {
    const value = fixture();
    vi.spyOn(window.crypto, 'getRandomValues').mockImplementation(() => { throw new Error('Unavailable'); });
    paste(value.editor);
    await terminal(value, 'rejected');
    expect(value.adapter.resolve).not.toHaveBeenCalled();
    expect(value.editor.state.doc.textContent).toBe('Before');
  });

  it.each([1, 100])('reports unsupported source data images without reading an accompanying duplicate File, diagnostic cap %s', async maxDiagnostics => {
    const normalized = vi.fn<NonNullable<PasteCleanupOptions['onResult']>>();
    const value = fixture({ cleanup: { limits: { maxDiagnostics }, onResult: normalized } });
    const image = file();
    const read = vi.spyOn(image, 'arrayBuffer');
    const source = 'data:image/png;base64,' + btoa(String.fromCharCode(...PNG));
    paste(value.editor, `<p><span onclick="untrusted()">Before</span> <img src="${source}" alt="Local chart"> after</p>`, [image]);
    await terminal(value, 'applied');
    expect(images(value.editor)).toEqual([]);
    expect(value.editor.state.doc.textContent).toContain('Local chart');
    expect(value.adapter.resolve).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(normalized).toHaveBeenCalledOnce();
    expect(normalized.mock.calls[0]?.[0].html).not.toContain('data:image');
    if (maxDiagnostics > 1) expect(value.results[0]?.diagnostics).toContainEqual(expect.objectContaining({ code: 'image-removed' }));
    else {
      expect(value.results[0]?.diagnosticsTruncated).toBe(true);
      expect(value.results[0]?.diagnostics.some(diagnostic => diagnostic.code === 'image-removed')).toBe(false);
    }
  });

  it('removes an unsupported source data image even when no File accompanies the HTML', async () => {
    const value = fixture();
    const source = 'data:image/png;base64,' + btoa(String.fromCharCode(...PNG));
    paste(value.editor, `<p>Text <img src="${source}" alt="Preserved alternative"></p>`, []);
    await terminal(value, 'applied');
    expect(value.editor.state.doc.textContent).toContain('Preserved alternative');
    expect(value.results[0]?.diagnostics).toContainEqual(expect.objectContaining({ code: 'image-removed' }));
    expect(value.adapter.resolve).not.toHaveBeenCalled();
  });

  it('snapshots adapter callbacks and allowed origins before asynchronous preparation', async () => {
    const mutable = { ...adapter() };
    const originalResolve = mutable.resolve;
    const origins = ['https://assets.example.test'];
    const value = fixture({ adapter: mutable, assets: { sourcePolicy: { allowedOrigins: origins } } });
    mutable.resolve = vi.fn(() => Promise.reject(new Error('Replaced adapter')));
    origins[0] = 'https://other.example.test';
    paste(value.editor);
    await terminal(value, 'applied');
    await recovery(value, 'accepted');
    expect(originalResolve).toHaveBeenCalledOnce();
    expect(mutable.resolve).not.toHaveBeenCalled();
  });

  it('keeps recovery observer errors isolated from accepted paste ownership', async () => {
    const callback = vi.fn<(report: ClipboardAssetRecoveryReport) => Promise<never>>(() => Promise.reject(new Error('Private recovery callback failure')));
    // Runtime hosts can violate the synchronous observer type; rejected returns
    // still must not become unhandled rejections or change resource ownership.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    const value = fixture({ assets: { onRecovery: callback } });
    paste(value.editor);
    await terminal(value, 'applied');
    await vi.waitFor(() => { expect(callback.mock.calls.some(call => call[0].phase === 'accepted')).toBe(true); }, { interval: 1 });
    expect(images(value.editor)).toEqual([SRC]);
    expect(value.adapter.releaseUncommitted).not.toHaveBeenCalled();
  });

  it('compensates a creation cancelled by a recovery observer before HTML exposure', async () => {
    const reports: ClipboardAssetRecoveryReport[] = [];
    const value = fixture({ assets: { onRecovery: report => {
      reports.push(report);
      if (report.registeredResources > 0 && report.phase === 'preparing') value.progress[0]?.cancel();
    } } });
    paste(value.editor);
    await terminal(value, 'rejected');
    await vi.waitFor(() => { expect(reports.at(-1)).toMatchObject({ phase: 'unapplied', settled: true }); }, { interval: 1 });
    expect(value.adapter.releaseUncommitted).toHaveBeenCalledOnce();
    expect(value.editor.state.doc.textContent).toBe('Before');
  });

  it('retains resources cancelled in a lower replay handler before dispatch', async () => {
    const handler = Extension.create({ name: 'cancelResolverReplay', priority: 90, addProseMirrorPlugins: () => [new Plugin({ props: {
      handlePaste() { value.progress[0]?.cancel(); return false; },
    } })] });
    const value = fixture({ extensions: [handler] });
    paste(value.editor);
    await terminal(value, 'rejected');
    await recovery(value, 'uncertain');
    expect(value.results[0]?.reason).toBe('cancelled');
    expect(value.editor.state.doc.textContent).toBe('Before');
    expect(value.adapter.releaseUncommitted).not.toHaveBeenCalled();
  });

  it.each([
    { resolver: undefined }, { onRecovery: undefined }, { sourcePolicy: { allowedOrigins: ['https://*.example.test'] } },
    { resolver: { idempotency: 'automatic' } },
  ])('rejects invalid resolver configuration before clipboard access: %j', invalid => {
    expect(() => fixture({ assets: invalid as Partial<ClipboardResolvedImageAssetOptions> })).toThrow(ExtensionConfigurationError);
  });
});
