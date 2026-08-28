import { afterEach, describe, expect, it, vi } from 'vitest';
import { Document, Editor, Extension, Paragraph, Text } from '@domternal/core';
import { Plugin } from '@domternal/pm/state';
import { createPasteTracking } from './tracking.js';
import { pasteCleanupKey, receiptStateField } from './operations.js';
import type { NormalizePasteHTMLResult } from './html/types.js';
import type { PasteOperationResult } from './operations.js';

type Tracking = ReturnType<typeof createPasteTracking>;
const editors: Editor[] = [];
afterEach(() => { for (const editor of editors) editor.destroy(); editors.length = 0; });

function mount(tracking: Tracking): Editor {
  const receipts = Extension.create({
    name: 'receiptFixture',
    addProseMirrorPlugins: () => [new Plugin({
      key: pasteCleanupKey, state: receiptStateField,
      view: () => ({ update: view => { tracking.observe(view); } }),
    })],
  });
  const editor = new Editor({ extensions: [Document, Paragraph, Text, receipts], content: '<p>Before</p>' });
  editors.push(editor);
  return editor;
}

function accept(editor: Editor, operationId: string): void {
  editor.view.dispatch(editor.state.tr.insertText('Accepted', 1).setMeta(pasteCleanupKey, { operationId }));
}

describe('asynchronous paste completion tracking', () => {
  it('waits for the caller to finish preparation and emits one terminal cancellation', async () => {
    const observer = vi.fn();
    const tracking = createPasteTracking('preserve', observer);
    const editor = mount(tracking);
    const operation = tracking.create();
    await Promise.resolve();
    expect(observer).not.toHaveBeenCalled();
    const result = await tracking.finish(editor.view, operation, true, { reason: 'cancelled' });
    expect(result).toMatchObject({ operationId: operation.operationId, status: 'rejected', reason: 'cancelled' });
    expect(result.references).toMatchObject({ ranges: [], expired: true });
    expect(editor.state.doc.textContent).toBe('Before');
    expect(observer).toHaveBeenCalledExactlyOnceWith(result);
  });

  it('keeps the first completion promise and result across duplicate and reentrant finish calls', async () => {
    const observer = vi.fn();
    const tracking = createPasteTracking('preserve', observer);
    const editor = mount(tracking);
    const operation = tracking.create();
    const completion = tracking.finish(editor.view, operation, true, { reason: 'superseded' });
    observer.mockImplementation(() => {
      expect(tracking.finish(editor.view, operation, true, { reason: 'cancelled' })).toBe(completion);
    });
    expect(tracking.finish(editor.view, operation, false)).toBe(completion);
    const result = await completion;
    expect(result).toMatchObject({ status: 'rejected', reason: 'superseded' });
    expect(observer).toHaveBeenCalledOnce();
    expect(await tracking.finish(editor.view, operation, false)).toBe(result);
  });

  it('snapshots final normalization before host callbacks and omits source HTML from completion', async () => {
    const tracking = createPasteTracking('adapt', undefined);
    const editor = mount(tracking);
    const operation = tracking.create();
    const normalization: NormalizePasteHTMLResult = {
      status: 'cleaned', html: '<p>Private source</p>', source: 'word', diagnosticsTruncated: false,
      diagnostics: [{ code: 'image-removed', severity: 'warning', offset: 3 }],
    };
    const completion = tracking.finish(editor.view, operation, false, { normalization });
    normalization.source = 'html';
    normalization.diagnostics[0]!.offset = 99;
    normalization.diagnostics.push({ code: 'parse-failed', severity: 'error' });
    accept(editor, operation.operationId);
    const result = await completion;
    expect(result).toMatchObject({ operationId: operation.operationId, formatting: 'adapt', source: 'word', status: 'applied' });
    expect(result.diagnostics).toEqual([{ code: 'image-removed', severity: 'warning', offset: 3 }]);
    expect(Object.isFrozen(result.diagnostics)).toBe(true);
    expect(Object.isFrozen(result.diagnostics[0])).toBe(true);
    expect(JSON.stringify(result)).not.toContain('Private source');
    expect(result).not.toHaveProperty('html');
  });

  it('records a known pre-apply veto discovered after tracking starts without delivering twice', async () => {
    const observer = vi.fn();
    const tracking = createPasteTracking('preserve', observer);
    const editor = mount(tracking);
    const operation = tracking.create();
    const completion = tracking.finish(editor.view, operation, false);
    // This untagged edit represents an application callback changing the target before replay.
    editor.view.dispatch(editor.state.tr.insertText('Changed', 1));
    expect(tracking.finish(editor.view, operation, true, { reason: 'target-changed' })).toBe(completion);
    const result = await completion;
    expect(result).toMatchObject({ status: 'rejected', reason: 'target-changed' });
    expect(observer).toHaveBeenCalledExactlyOnceWith(result);
    expect(await tracking.finish(editor.view, operation, true, { reason: 'cancelled' })).toBe(result);
  });

  it('does not revoke an accepted transaction when rejection is learned before terminal delivery', async () => {
    const tracking = createPasteTracking('preserve', undefined);
    const editor = mount(tracking);
    const operation = tracking.create();
    const completion = tracking.finish(editor.view, operation, false);
    accept(editor, operation.operationId);
    void tracking.finish(editor.view, operation, true, { reason: 'cancelled' });
    const result = await completion;
    expect(result.status).toBe('applied');
    expect(result).not.toHaveProperty('reason');
  });

  it('lets an accepted receipt override a later cancellation or application error', async () => {
    const observer = vi.fn();
    const tracking = createPasteTracking('preserve', observer);
    const editor = mount(tracking);
    const operation = tracking.create();
    const completion = tracking.finish(editor.view, operation, true, { reason: 'asset-read-failed' });
    accept(editor, operation.operationId);
    const result = await completion;
    expect(result.status).toBe('applied');
    expect(result).not.toHaveProperty('reason');
    expect(editor.state.doc.textContent).toBe('AcceptedBefore');
    expect(observer).toHaveBeenCalledExactlyOnceWith(result);
  });

  it('does not attach a known rejection reason to an uncertain custom application', async () => {
    const tracking = createPasteTracking('preserve', undefined);
    const editor = mount(tracking);
    const operation = tracking.create();
    const completion = tracking.finish(editor.view, operation, false, { reason: 'asset-read-failed' });
    editor.view.dispatch(editor.state.tr.insertText('Custom', 1));
    const result = await completion;
    expect(result.status).toBe('untracked');
    expect(result).not.toHaveProperty('reason');
  });

  it('preserves accepted evidence after receipt eviction and view destruction', async () => {
    const tracking = createPasteTracking('preserve', undefined);
    const editor = mount(tracking);
    const operation = tracking.create();
    const completion = tracking.finish(editor.view, operation, false);
    accept(editor, operation.operationId);
    for (let index = 0; index < 20; index++) accept(editor, `other-${String(index)}`);
    editor.destroy();
    const result = await completion;
    expect(result.status).toBe('applied');
    expect(result.references).toMatchObject({ expired: true, ranges: [] });
  });

  it('resolves even if the terminal observer destroys the view and throws', async () => {
    const observer = vi.fn((_result: PasteOperationResult) => { editor.destroy(); throw new Error('Application observer failed'); });
    const tracking = createPasteTracking('preserve', observer);
    const editor = mount(tracking);
    const operation = tracking.create();
    const completion = tracking.finish(editor.view, operation, false);
    accept(editor, operation.operationId);
    const result = await completion;
    expect(result.status).toBe('applied');
    expect(editor.isDestroyed).toBe(true);
    expect(observer).toHaveBeenCalledOnce();
  });

  it('isolates completion from a new operation created by its terminal observer', async () => {
    const results: PasteOperationResult[] = [];
    const tracking = createPasteTracking('preserve', result => {
      results.push(result);
      if (results.length === 1) void tracking.finish(editor.view, tracking.create(), true, { reason: 'target-changed' });
    });
    const editor = mount(tracking);
    const operation = tracking.create();
    await tracking.finish(editor.view, operation, true, { reason: 'cancelled' });
    await Promise.resolve();
    expect(results.map(result => result.reason)).toEqual(['cancelled', 'target-changed']);
    expect(new Set(results.map(result => result.operationId)).size).toBe(2);
  });
});
