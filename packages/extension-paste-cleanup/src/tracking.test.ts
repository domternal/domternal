import { afterEach, describe, expect, it, vi } from 'vitest';
import { Blockquote, Document, Editor, Extension, Heading, Paragraph, Text } from '@domternal/core';
import { Fragment, Slice } from '@domternal/pm/model';
import type { Node as PMNode } from '@domternal/pm/model';
import { Plugin, TextSelection } from '@domternal/pm/state';
import { createPasteTracking, reconcileHeadingDiagnostics, sliceHeadings } from './tracking.js';
import type { SliceHeadings } from './tracking.js';
import { normalizeClipboardHTML } from './html/normalize.js';
import type { PasteDestinationFeature } from './html/destinationDemand.js';
import { pasteCleanupKey, receiptStateField } from './operations.js';
import type { NormalizePasteHTMLResult, PasteDiagnostic } from './html/types.js';
import type { PasteInsertion, PasteOperationResult } from './operations.js';

type Tracking = ReturnType<typeof createPasteTracking>;
const editors: Editor[] = [];
afterEach(() => { for (const editor of editors) editor.destroy(); editors.length = 0; });

function mount(tracking: Tracking, observe = true): Editor {
  const receipts = Extension.create({
    name: 'receiptFixture',
    addProseMirrorPlugins: () => [new Plugin({
      key: pasteCleanupKey, state: receiptStateField,
      view: () => ({ update: view => { if (observe) tracking.observe(view); } }),
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
  it('reports an operation whose content image files replaced as untracked without findings, unless a receipt says otherwise', async () => {
    const observer = vi.fn();
    const tracking = createPasteTracking('preserve', observer);
    const editor = mount(tracking);
    const { result } = normalizeClipboardHTML('<img src="https://example.com/a.png" alt="A">');
    expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain('image-removed');
    const replaced = tracking.create(result);
    const completion = tracking.finish(editor.view, replaced, false);
    tracking.replacedByFiles(replaced);
    await expect(completion).resolves.toMatchObject({ status: 'untracked', diagnostics: [] });
    expect(observer).toHaveBeenCalledOnce();

    // An accepted receipt still wins, with the cleanup's own findings.
    const accepted = tracking.create(result);
    const acceptedCompletion = tracking.finish(editor.view, accepted, false);
    tracking.replacedByFiles(accepted);
    accept(editor, accepted.operationId);
    await expect(acceptedCompletion).resolves.toMatchObject({ status: 'applied' });
    expect((await acceptedCompletion).diagnostics.map(diagnostic => diagnostic.code)).toContain('image-removed');

    // A drop's files replace even content cleanup rejected: nothing was blocked, and no reason is given.
    const rejected = tracking.create({ ...result, status: 'rejected' });
    const rejectedCompletion = tracking.finish(editor.view, rejected, true, { reason: 'unsupported-content' });
    tracking.replacedByFiles(rejected);
    await expect(rejectedCompletion).resolves.toMatchObject({ status: 'untracked', diagnostics: [] });
    expect(await rejectedCompletion).not.toHaveProperty('reason');

    // A replacement learned after completion changes nothing.
    const late = tracking.create(result);
    const lateCompletion = tracking.finish(editor.view, late, false);
    await lateCompletion;
    tracking.replacedByFiles(late);
    expect((await lateCompletion).diagnostics).toHaveLength(1);
  });

  it('keeps installed no-change acceptance separate from an unaccepted skipped paste', async () => {
    const tracking = createPasteTracking('preserve', undefined);
    const editor = mount(tracking);
    const accepted = tracking.create();
    const completion = tracking.finish(editor.view, accepted, false);
    expect(tracking.hasAcceptedReceipt(accepted)).toBe(false);
    editor.view.dispatch(editor.state.tr.setMeta(pasteCleanupKey, { operationId: accepted.operationId }));
    expect(tracking.hasAcceptedReceipt(accepted)).toBe(true);
    expect((await completion).status).toBe('noop');
    const skipped = tracking.create();
    const skippedCompletion = tracking.finish(editor.view, skipped, false);
    tracking.skip(skipped);
    expect((await skippedCompletion).status).toBe('noop');
    expect(tracking.hasAcceptedReceipt(skipped)).toBe(false);
    for (let index = 0; index < 20; index++) accept(editor, `eviction-${String(index)}`);
    editor.destroy();
    expect(tracking.hasAcceptedReceipt(accepted)).toBe(true);
  });

  it('records acceptance found only by the final installed receipt read', async () => {
    const tracking = createPasteTracking('preserve', undefined);
    const editor = mount(tracking, false);
    const operation = tracking.create();
    const completion = tracking.finish(editor.view, operation, false);
    accept(editor, operation.operationId);
    expect(tracking.hasAcceptedReceipt(operation)).toBe(false);
    expect((await completion).status).toBe('applied');
    expect(tracking.hasAcceptedReceipt(operation)).toBe(true);
    editor.destroy();
    expect(tracking.hasAcceptedReceipt(operation)).toBe(true);
  });
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

describe('heading adaptations reconciled with the inserted headings', () => {
  const schema = ((): Editor['schema'] => {
    const editor = new Editor({ extensions: [Document, Paragraph, Text, Heading] });
    editor.destroy();
    return editor.schema;
  })();
  const h4 = (text: string): PMNode => schema.node('heading', { level: 4 }, text === '' ? undefined : schema.text(text));
  const h2 = (text: string): PMNode => schema.node('heading', { level: 2 }, text === '' ? undefined : schema.text(text));
  const paragraph = (text: string): PMNode => schema.node('paragraph', null, schema.text(text));
  const adapted = (offset: number): PasteDiagnostic => ({ code: 'destination-heading-level-adapted', severity: 'warning', offset });
  const link: PasteDiagnostic = { code: 'link-removed', severity: 'warning', offset: 40 };
  const five = adapted(0);
  const six = adapted(13);
  const openHeading: SliceHeadings = { count: 2, openFirst: h4('Five') };
  const created = (count: number, joined?: PMNode, joinedCovered = false): PasteInsertion =>
    joined === undefined ? { createdHeadings: count, joinedCovered } : { createdHeadings: count, joined, joinedCovered };

  it('keeps the list as it is without every piece of evidence', () => {
    const diagnostics = [five, link, six];
    expect(reconcileHeadingDiagnostics(diagnostics, undefined, openHeading, created(0))).toBe(diagnostics);
    expect(reconcileHeadingDiagnostics(diagnostics, [true, true], undefined, created(0))).toBe(diagnostics);
    expect(reconcileHeadingDiagnostics(diagnostics, [true, true], openHeading, undefined)).toBe(diagnostics);
  });

  it('keeps the list when the parsed slice lost or gained a heading', () => {
    const diagnostics = [five, six];
    expect(reconcileHeadingDiagnostics(diagnostics, [true, true], { ...openHeading, count: 1 }, created(0))).toBe(diagnostics);
    expect(reconcileHeadingDiagnostics(diagnostics, [true, true], { ...openHeading, count: 3 }, created(0))).toBe(diagnostics);
  });

  it('keeps the list when truncation left fewer heading findings than adapted headings', () => {
    const diagnostics = [five];
    expect(reconcileHeadingDiagnostics(diagnostics, [true, true], openHeading, created(0))).toBe(diagnostics);
  });

  it('removes every heading finding, and only those, when no pasted heading became a heading', () => {
    const result = reconcileHeadingDiagnostics([five, link, six], [true, true], openHeading, created(0, paragraph('Hello')));
    expect(result).toEqual([link]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(reconcileHeadingDiagnostics([five], [true], { count: 1 }, created(0))).toEqual([]);
  });

  it('keeps the first finding when the first heading joined a covered heading of its own markup', () => {
    const diagnostics = [five, link, six];
    expect(reconcileHeadingDiagnostics(diagnostics, [true, true], openHeading, created(0, h4(''), true))).toEqual([five, link]);
    expect(reconcileHeadingDiagnostics(diagnostics, [true, true], openHeading, created(1, h4('Old'), true))).toBe(diagnostics);
    const single = [five];
    expect(reconcileHeadingDiagnostics(single, [true], { count: 1, openFirst: h4('Five') }, created(0, h4(''), true))).toBe(single);
    // An uncovered heading of its own markup keeps its other text: the pasted heading merged.
    expect(reconcileHeadingDiagnostics(single, [true], { count: 1, openFirst: h4('Five') }, created(0, h4('Hello')))).toEqual([]);
    // Without a joined first heading, nothing reached the document as a heading.
    expect(reconcileHeadingDiagnostics(single, [true], { count: 1 }, created(0, h4(''), true))).toEqual([]);
  });

  it('keeps the list when a covered joined block has another markup, which the replace would have replaced', () => {
    const single = [five];
    const slice: SliceHeadings = { count: 1, openFirst: h4('Five') };
    expect(reconcileHeadingDiagnostics(single, [true], slice, created(0, h2(''), true))).toBe(single);
    expect(reconcileHeadingDiagnostics(single, [true], slice, created(0, paragraph('x'), true))).toBe(single);
    const diagnostics = [five, six];
    expect(reconcileHeadingDiagnostics(diagnostics, [true, true], openHeading, created(1, h2('Old'), true))).toBe(diagnostics);
  });

  it('keeps every finding when every pasted heading became a heading, or more headings appeared', () => {
    const diagnostics = [five, link, six];
    expect(reconcileHeadingDiagnostics(diagnostics, [true, true], openHeading, created(2, paragraph('Hello')))).toBe(diagnostics);
    expect(reconcileHeadingDiagnostics(diagnostics, [true, true], openHeading, created(3, paragraph('Hello')))).toBe(diagnostics);
  });

  it('removes the first heading finding when only the open first heading merged into the textblock it joined', () => {
    const result = reconcileHeadingDiagnostics([five, link, six], [true, true], openHeading, created(1, paragraph('Hello')));
    expect(result).toEqual([link, six]);
    expect(Object.isFrozen(result)).toBe(true);
    // A first heading that needed no adaptation merged: every adapted one landed.
    const landed = [link, six];
    expect(reconcileHeadingDiagnostics(landed, [false, true], openHeading, created(1, paragraph('Hello')))).toBe(landed);
  });

  it('keeps the list when one heading is missing but the first heading did not join a textblock', () => {
    const diagnostics = [five, six];
    expect(reconcileHeadingDiagnostics(diagnostics, [true, true], { count: 2 }, created(1, paragraph('Hello')))).toBe(diagnostics);
    expect(reconcileHeadingDiagnostics(diagnostics, [true, true], openHeading, created(1))).toBe(diagnostics);
  });

  it('keeps the list when the created count fits neither a merge nor a landing', () => {
    const diagnostics = [five, six, adapted(26)];
    expect(reconcileHeadingDiagnostics(diagnostics, [true, true, true], { count: 3, openFirst: h4('Five') }, created(1, paragraph('Hello')))).toBe(diagnostics);
  });
});

describe('the headings of a parsed slice', () => {
  function schema(): Editor['schema'] {
    const editor = new Editor({ extensions: [Document, Paragraph, Text, Heading, Blockquote] });
    editors.push(editor);
    return editor.schema;
  }

  it('counts every heading at any depth and names the first textblock only when it is a heading open at the start', () => {
    const s = schema();
    const heading = (text: string): PMNode => s.node('heading', { level: 4 }, s.text(text));
    const paragraph = (text: string): PMNode => s.node('paragraph', null, s.text(text));
    const first = heading('A');
    expect(sliceHeadings(new Slice(Fragment.from(first), 1, 1))).toEqual({ count: 1, openFirst: first });
    expect(sliceHeadings(new Slice(Fragment.from(first), 0, 1))).toEqual({ count: 1 });
    expect(sliceHeadings(new Slice(Fragment.from([paragraph('x'), heading('A')]), 1, 1))).toEqual({ count: 1 });
    const quoted = heading('A');
    const fragment = Fragment.from([s.node('blockquote', null, [quoted, heading('B')]), heading('C')]);
    expect(sliceHeadings(new Slice(fragment, 2, 1))).toEqual({ count: 3, openFirst: quoted });
    expect(sliceHeadings(new Slice(fragment, 1, 1))).toEqual({ count: 3 });
    expect(sliceHeadings(new Slice(Fragment.from(s.text('inline')), 0, 0))).toEqual({ count: 0 });
    expect(sliceHeadings(Slice.empty)).toEqual({ count: 0 });
  });
});

describe('a finished paste reports the headings it inserted', () => {
  function mountHeadings(tracking: Tracking, content: string): Editor {
    const receipts = Extension.create({
      name: 'receiptHeadingFixture',
      addProseMirrorPlugins: () => [new Plugin({ key: pasteCleanupKey, state: receiptStateField,
        view: () => ({ update: view => { tracking.observe(view); } }) })],
    });
    const editor = new Editor({ extensions: [Document, Paragraph, Text, Heading, receipts], content });
    editors.push(editor);
    return editor;
  }
  const lacksFiveAndSix = (features: readonly PasteDestinationFeature[]): readonly PasteDestinationFeature[] =>
    features.filter(feature => feature === 'heading-5' || feature === 'heading-6');
  const normalized = (html: string): NormalizePasteHTMLResult => normalizeClipboardHTML(html, {}, undefined, undefined, lacksFiveAndSix).result;
  const openSlice = (editor: Editor, text: string): Slice =>
    new Slice(Fragment.from(editor.schema.node('heading', { level: 4 }, editor.schema.text(text))), 1, 1);
  const codes = (result: PasteOperationResult): string[] => result.diagnostics.map(item => item.code);

  it('drops the finding of a heading merged into the caret paragraph and keeps one that landed', async () => {
    const tracking = createPasteTracking('preserve', undefined);
    const merged = mountHeadings(tracking, '<p>Hello world</p>');
    const result = normalized('<h5>Five</h5>');
    const operation = tracking.create(result);
    tracking.recordSlice(operation, openSlice(merged, 'Five'));
    const completion = tracking.finish(merged.view, operation, false);
    merged.view.dispatch(merged.state.tr.setSelection(TextSelection.create(merged.state.doc, 7)));
    merged.view.dispatch(merged.state.tr.replaceSelection(openSlice(merged, 'Five')).setMeta(pasteCleanupKey, { operationId: operation.operationId }));
    expect(merged.getHTML()).toBe('<p>Hello Fiveworld</p>');
    expect(codes(await completion)).toEqual([]);
    // The normalization itself still reports the adapted heading.
    expect(result.diagnostics.map(item => item.code)).toEqual(['destination-heading-level-adapted']);

    const landed = mountHeadings(tracking, '<p></p>');
    const second = tracking.create(normalized('<h5>Five</h5>'));
    tracking.recordSlice(second, openSlice(landed, 'Five'));
    const secondCompletion = tracking.finish(landed.view, second, false);
    landed.view.dispatch(landed.state.tr.replaceWith(0, 2, openSlice(landed, 'Five').content).setMeta(pasteCleanupKey, { operationId: second.operationId }));
    expect(landed.getHTML()).toBe('<h4>Five</h4>');
    expect(codes(await secondCompletion)).toEqual(['destination-heading-level-adapted']);
  });

  it('reconciles a prepared operation with the outline of its final normalization', async () => {
    const tracking = createPasteTracking('preserve', undefined);
    const editor = mountHeadings(tracking, '<p>Hello world</p>');
    const operation = tracking.create();
    tracking.recordSlice(operation, openSlice(editor, 'Five'));
    const completion = tracking.finish(editor.view, operation, false, { normalization: normalized('<h5>Five</h5>') });
    editor.view.dispatch(editor.state.tr.insertText('Five', 7).setMeta(pasteCleanupKey, { operationId: operation.operationId }));
    expect(codes(await completion)).toEqual([]);
  });

  it('leaves a rejected, noop or untracked paste and one without a recorded slice as normalized', async () => {
    const tracking = createPasteTracking('preserve', undefined);
    const editor = mountHeadings(tracking, '<p>Hello world</p>');
    const finish = async (operation: ReturnType<Tracking['create']>, run: () => void, rejected = false): Promise<string[]> => {
      const completion = tracking.finish(editor.view, operation, rejected);
      run();
      return codes(await completion);
    };
    const rejected = tracking.create(normalized('<h5>Five</h5>'));
    tracking.recordSlice(rejected, openSlice(editor, 'Five'));
    expect(await finish(rejected, () => undefined, true)).toEqual(['destination-heading-level-adapted']);
    const noop = tracking.create(normalized('<h5>Five</h5>'));
    tracking.recordSlice(noop, openSlice(editor, 'Five'));
    expect(await finish(noop, () => { editor.view.dispatch(editor.state.tr.setMeta(pasteCleanupKey, { operationId: noop.operationId })); }))
      .toEqual(['destination-heading-level-adapted']);
    const untracked = tracking.create(normalized('<h5>Five</h5>'));
    tracking.recordSlice(untracked, openSlice(editor, 'Five'));
    expect(await finish(untracked, () => { editor.view.dispatch(editor.state.tr.insertText('Five', 7)); })).toEqual(['destination-heading-level-adapted']);
    const unrecorded = tracking.create(normalized('<h5>Five</h5>'));
    expect(await finish(unrecorded, () => {
      editor.view.dispatch(editor.state.tr.insertText('Five', 7).setMeta(pasteCleanupKey, { operationId: unrecorded.operationId }));
    })).toEqual(['destination-heading-level-adapted']);
    const plain = tracking.create();
    tracking.recordSlice(plain, openSlice(editor, 'Five'));
    expect(await finish(plain, () => {
      editor.view.dispatch(editor.state.tr.insertText('Five', 7).setMeta(pasteCleanupKey, { operationId: plain.operationId }));
    })).toEqual([]);
  });
});
