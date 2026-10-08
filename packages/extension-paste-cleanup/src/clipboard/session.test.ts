import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Document, Editor, Extension, History, Node, Paragraph, Text } from '@domternal/core';
import { redoDepth, undoDepth } from '@domternal/pm/history';
import { Schema } from '@domternal/pm/model';
import { EditorState, Plugin, TextSelection } from '@domternal/pm/state';
import { pasteCleanupKey, pasteDocumentRevision, readPasteReceipt, receiptStateField } from '../operations.js';
import { createClipboardImageDestination } from './destination.js';
import type { ClipboardImageDestination, ClipboardImageDestinationInput } from './destination.js';
import { createClipboardSessionController } from './session.js';
import type { ClipboardSession, ClipboardSessionController } from './session.js';

const editors: Editor[] = [];
const controllers: ClipboardSessionController[] = [];
afterEach(() => {
  for (const controller of controllers) controller.destroy();
  for (const editor of editors) if (!editor.isDestroyed) editor.destroy();
  controllers.length = 0;
  editors.length = 0;
  vi.restoreAllMocks();
});

function destination(schema: Schema, override: Partial<ClipboardImageDestinationInput> = {}): ClipboardImageDestination {
  const result = createClipboardImageDestination(schema, {
    nodeTypeName: 'image', sourceAttribute: 'src', inline: false, allowEmbedded: true,
    allowedMimeTypes: ['image/png', 'image/jpeg'], maxFileBytes: 1024, policyVersion: 'test:1', ...override,
  }, { maxFileBytes: 4096, maxMetadataLength: 128, maxMimeTypes: 16 });
  if (result.status !== 'available') throw new Error('Expected image destination');
  return result.destination;
}

interface Fixture {
  readonly editor: Editor;
  readonly policy: ClipboardImageDestination;
  readonly host: { readPolicy: () => ClipboardImageDestination | undefined };
  readonly read: Mock<() => ClipboardImageDestination | undefined>;
  readonly controller: ClipboardSessionController;
}

function mount(withReceipts = true): Fixture {
  const image = Node.create({
    name: 'image', group: 'block', atom: true,
    addAttributes: () => ({ src: { default: null }, assetUrl: { default: null } }),
    parseHTML: () => [{ tag: 'img[src]' }], renderHTML: () => ['img'],
  });
  const receiptHost = Extension.create({
    name: 'sessionReceipts',
    addProseMirrorPlugins: () => withReceipts ? [new Plugin({ key: pasteCleanupKey, state: receiptStateField })] : [],
  });
  const editor = new Editor({
    extensions: [Document, Paragraph, Text, image, History, receiptHost], content: '<p>Original content</p>',
  });
  editors.push(editor);
  const policy = destination(editor.schema);
  const host: { readPolicy: () => ClipboardImageDestination | undefined } = { readPolicy: () => policy };
  const read = vi.fn(() => host.readPolicy());
  const controller = createClipboardSessionController(editor.view, read);
  controllers.push(controller);
  return { editor, policy, host, read, controller };
}

function start(fixture: Fixture, id = 'operation'): ClipboardSession {
  const result = fixture.controller.start(id);
  expect(result.status).toBe('started');
  if (result.status !== 'started') throw new Error(`Expected session: ${result.reason}`);
  return result.session;
}

function snapshot(editor: Editor): { doc: unknown; selection: unknown; html: string; undo: number; redo: number } {
  return {
    doc: editor.getJSON(), selection: editor.state.selection.toJSON(), html: editor.view.dom.innerHTML,
    undo: undoDepth(editor.state), redo: redoDepth(editor.state),
  };
}

describe('clipboard image session lifetime', () => {
  it('guards phases without inserting document content, DOM placeholders or history entries', () => {
    const fixture = mount();
    const before = snapshot(fixture.editor);
    const transactions = vi.fn();
    fixture.editor.on('transaction', transactions);
    const session = start(fixture);
    expect(Object.isFrozen(fixture.controller)).toBe(true);
    expect(Object.isFrozen(session)).toBe(true);
    expect(session.operationId).toBe('operation');
    expect(session.destination).toBe(fixture.policy);
    expect(session.phase).toBe('preparing');
    expect(session.cancellation).toBeUndefined();
    expect(session.signal.aborted).toBe(false);
    expect(session.beginApply()).toBe(false);
    expect(session.phase).toBe('preparing');
    expect(session.check()).toBe(true);
    expect(session.ready()).toBe(true);
    expect(session.phase).toBe('ready');
    expect(session.ready()).toBe(false);
    expect(session.check()).toBe(true);
    expect(session.beginApply()).toBe(true);
    expect(session.phase).toBe('applying');
    expect(session.beginApply()).toBe(false);
    expect(session.ready()).toBe(false);
    expect(session.check()).toBe(false);
    session.finish();
    expect(session.phase).toBe('settled');
    expect(fixture.controller.current).toBeUndefined();
    expect(session.signal.aborted).toBe(false);
    session.cancel();
    session.finish();
    expect(session.check()).toBe(false);
    expect(session.ready()).toBe(false);
    expect(session.beginApply()).toBe(false);
    expect(session.signal.aborted).toBe(false);
    expect(snapshot(fixture.editor)).toEqual(before);
    expect(transactions).not.toHaveBeenCalled();
  });

  it.each(['preparing', 'ready'] as const)('cancels a %s session once and releases only its own identity', phase => {
    const fixture = mount();
    const session = start(fixture);
    if (phase === 'ready') expect(session.ready()).toBe(true);
    const aborted = vi.fn();
    session.signal.addEventListener('abort', aborted);
    session.cancel();
    fixture.controller.cancel();
    session.cancel();
    expect(session.phase).toBe('settled');
    expect(session.cancellation).toBe('cancelled');
    expect(session.signal.aborted).toBe(true);
    expect(aborted).toHaveBeenCalledTimes(1);
    expect(fixture.controller.current).toBeUndefined();
    const next = start(fixture, 'next');
    session.finish();
    session.cancel();
    expect(fixture.controller.current).toBe(next);
    expect(next.signal.aborted).toBe(false);
  });

  it('supersedes the old session without letting its later finish or cancel remove the newest', () => {
    const fixture = mount();
    const first = start(fixture, 'first');
    const latest = start(fixture, 'latest');
    expect(first.phase).toBe('settled');
    expect(first.cancellation).toBe('superseded');
    expect(first.signal.aborted).toBe(true);
    first.cancel();
    first.finish();
    expect(first.check()).toBe(false);
    expect(fixture.controller.current).toBe(latest);
    expect(latest.check()).toBe(true);
  });

  it('keeps controllers for different editor views independent', () => {
    const first = mount();
    const second = mount();
    const a = start(first);
    const b = start(second);
    first.controller.destroy();
    expect(a.cancellation).toBe('destroyed');
    expect(second.controller.current).toBe(b);
    expect(b.check()).toBe(true);
  });

  it('invalidates an edited document even after Undo restores equal content before checking', () => {
    const fixture = mount();
    const session = start(fixture);
    const original = fixture.editor.state.doc;
    const revision = pasteDocumentRevision(fixture.editor.view);
    fixture.editor.view.dispatch(fixture.editor.state.tr.insertText('Changed ', 1));
    expect(fixture.editor.commands.undo()).toBe(true);
    expect(fixture.editor.state.doc.eq(original)).toBe(true);
    expect(pasteDocumentRevision(fixture.editor.view)).toBeGreaterThan(revision);
    expect(session.check()).toBe(false);
    expect(session.cancellation).toBe('document-changed');
    expect(session.phase).toBe('settled');
  });

  it('observes intermediate selection changes so restoring the selection cannot revive the session', () => {
    const fixture = mount();
    const observer = new Plugin({ view: () => ({ update: () => { fixture.controller.observe(); } }) });
    fixture.editor.view.updateState(fixture.editor.state.reconfigure({ plugins: [...fixture.editor.state.plugins, observer] }));
    const session = start(fixture);
    const original = fixture.editor.state.selection;
    fixture.editor.view.dispatch(fixture.editor.state.tr.setSelection(TextSelection.create(fixture.editor.state.doc, 3)));
    fixture.editor.view.dispatch(fixture.editor.state.tr.setSelection(original));
    expect(fixture.editor.state.selection.eq(original)).toBe(true);
    expect(session.phase).toBe('settled');
    expect(session.cancellation).toBe('selection-changed');
    expect(session.check()).toBe(false);
  });

  it('retains a valid session across metadata-only updates and equivalent selections', () => {
    const fixture = mount();
    const session = start(fixture);
    fixture.editor.view.dispatch(fixture.editor.state.tr.setMeta('test', true));
    fixture.controller.observe();
    fixture.editor.view.dispatch(fixture.editor.state.tr.setSelection(TextSelection.create(fixture.editor.state.doc, 1)));
    fixture.controller.observe();
    expect(session.check()).toBe(true);
    expect(session.signal.aborted).toBe(false);
  });

  it('rejects readonly targets before reading a policy and cancels an active readonly target', () => {
    const fixture = mount();
    fixture.editor.view.setProps({ editable: () => false });
    expect(fixture.controller.start('blocked')).toEqual({ status: 'rejected', reason: 'readonly' });
    expect(fixture.read).not.toHaveBeenCalled();
    fixture.editor.view.setProps({ editable: () => true });
    const session = start(fixture);
    fixture.editor.view.setProps({ editable: () => false });
    fixture.controller.observe();
    fixture.editor.view.setProps({ editable: () => true });
    expect(session.cancellation).toBe('readonly');
    expect(session.check()).toBe(false);
  });

  it.each(['view', 'controller'] as const)('cancels on %s destruction and cannot start again', target => {
    const fixture = mount();
    const session = start(fixture);
    if (target === 'view') fixture.editor.destroy();
    else fixture.controller.destroy();
    fixture.controller.observe();
    expect(session.cancellation).toBe('destroyed');
    expect(session.signal.aborted).toBe(true);
    expect(fixture.controller.current).toBeUndefined();
    expect(fixture.controller.start('after')).toEqual({ status: 'rejected', reason: 'destroyed' });
  });

  it('invalidates cross-document adoption but permits movement within the same document', () => {
    const fixture = mount();
    const session = start(fixture);
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.appendChild(fixture.editor.view.dom);
    expect(session.check()).toBe(true);
    const foreign = document.implementation.createHTMLDocument('Other owner');
    foreign.adoptNode(fixture.editor.view.dom);
    expect(session.check()).toBe(false);
    expect(session.cancellation).toBe('adopted');
  });

  it('rejects a replacement schema even when its document JSON is unchanged', () => {
    const fixture = mount();
    const session = start(fixture);
    const schema = new Schema({ nodes: fixture.editor.schema.spec.nodes, marks: fixture.editor.schema.spec.marks });
    fixture.editor.view.updateState(EditorState.create({
      schema, doc: schema.nodeFromJSON(fixture.editor.getJSON()),
      plugins: [new Plugin({ key: pasteCleanupKey, state: receiptStateField })],
    }));
    expect(session.check()).toBe(false);
    expect(session.cancellation).toBe('schema-changed');
  });

  it('requires the installed receipt state and invalidates removal of that state', () => {
    const absent = mount(false);
    expect(absent.controller.start('absent')).toEqual({ status: 'rejected', reason: 'invalid-target' });
    expect(absent.read).not.toHaveBeenCalled();
    const fixture = mount();
    const session = start(fixture);
    fixture.editor.view.updateState(fixture.editor.state.reconfigure({ plugins: [] }));
    expect(session.check()).toBe(false);
    expect(session.cancellation).toBe('invalid-target');
  });

  it.each([
    { allowEmbedded: false }, { allowedMimeTypes: ['image/jpeg'] }, { maxFileBytes: 512 },
    { sourceAttribute: 'assetUrl' }, { policyVersion: 'test:2' },
  ])('invalidates a material destination policy change %j', change => {
    const fixture = mount();
    const session = start(fixture);
    fixture.host.readPolicy = () => destination(fixture.editor.schema, change);
    expect(session.ready()).toBe(false);
    expect(session.cancellation).toBe('destination-changed');
    expect(session.phase).toBe('settled');
  });

  it('accepts an equivalent freshly read policy and revalidates immediately before applying', () => {
    const fixture = mount();
    const session = start(fixture);
    fixture.host.readPolicy = () => destination(fixture.editor.schema, { allowedMimeTypes: ['image/jpeg', 'IMAGE/PNG', 'image/png'] });
    expect(session.ready()).toBe(true);
    fixture.host.readPolicy = () => undefined;
    expect(session.beginApply()).toBe(false);
    expect(session.cancellation).toBe('destination-changed');
  });

  it('rejects an unavailable or foreign-schema destination at start', () => {
    const fixture = mount();
    fixture.host.readPolicy = () => undefined;
    expect(fixture.controller.start('missing')).toEqual({ status: 'rejected', reason: 'unavailable-destination' });
    const other = mount();
    fixture.host.readPolicy = () => other.policy;
    expect(fixture.controller.start('foreign')).toEqual({ status: 'rejected', reason: 'destination-changed' });
    expect(fixture.controller.current).toBeUndefined();
  });

  it('fails closed when the reader throws during start or later validation', () => {
    const fixture = mount();
    fixture.host.readPolicy = () => { throw new Error('Private application detail'); };
    expect(fixture.controller.start('failed')).toEqual({ status: 'rejected', reason: 'invalid-target' });
    fixture.host.readPolicy = () => fixture.policy;
    const session = start(fixture);
    fixture.host.readPolicy = () => { throw new Error('Another private detail'); };
    expect(session.check()).toBe(false);
    expect(session.cancellation).toBe('invalid-target');
    expect(fixture.controller.current).toBeUndefined();
  });

  it.each(['start', 'check'] as const)('revalidates edits made by the policy reader during %s', stage => {
    const fixture = mount();
    const session = stage === 'check' ? start(fixture) : undefined;
    fixture.host.readPolicy = () => {
      fixture.editor.view.dispatch(fixture.editor.state.tr.insertText('Host edit ', 1));
      return fixture.policy;
    };
    if (session === undefined) expect(fixture.controller.start('edited')).toEqual({ status: 'rejected', reason: 'document-changed' });
    else {
      expect(session.check()).toBe(false);
      expect(session.cancellation).toBe('document-changed');
    }
    expect(fixture.controller.current).toBeUndefined();
    expect(fixture.editor.getText()).toContain('Host edit');
  });

  it.each(['readonly', 'selection', 'destroy'] as const)('revalidates %s changes made by the policy reader', change => {
    const fixture = mount();
    const session = start(fixture);
    fixture.host.readPolicy = () => {
      if (change === 'readonly') fixture.editor.view.setProps({ editable: () => false });
      else if (change === 'selection') fixture.editor.view.dispatch(fixture.editor.state.tr.setSelection(TextSelection.create(fixture.editor.state.doc, 3)));
      else fixture.editor.destroy();
      return fixture.policy;
    };
    expect(session.check()).toBe(false);
    expect(session.cancellation).toBe(change === 'selection' ? 'selection-changed' : change === 'destroy' ? 'destroyed' : 'readonly');
  });

  it('lets a reentrant start from the initial policy reader remain the current session', () => {
    const fixture = mount();
    let nested = false;
    let newest: ClipboardSession | undefined;
    fixture.host.readPolicy = () => {
      if (!nested) { nested = true; newest = start(fixture, 'inner'); }
      return fixture.policy;
    };
    expect(fixture.controller.start('outer')).toEqual({ status: 'rejected', reason: 'superseded' });
    expect(fixture.controller.current).toBe(newest);
    expect(newest?.operationId).toBe('inner');
    expect(newest?.check()).toBe(true);
  });

  it('preserves a reentrant newer start from validation when the old session later finishes', () => {
    const fixture = mount();
    const older = start(fixture, 'older');
    let newest: ClipboardSession | undefined;
    fixture.host.readPolicy = () => {
      fixture.host.readPolicy = () => fixture.policy;
      newest = start(fixture, 'newer');
      return fixture.policy;
    };
    expect(older.ready()).toBe(false);
    expect(older.cancellation).toBe('superseded');
    older.cancel();
    older.finish();
    expect(fixture.controller.current).toBe(newest);
    expect(newest?.check()).toBe(true);
  });

  it('does not overwrite a newer start created synchronously by the superseded session abort listener', () => {
    const fixture = mount();
    const old = start(fixture, 'old');
    let inner: ClipboardSession | undefined;
    old.signal.addEventListener('abort', () => { inner = start(fixture, 'abort-listener'); }, { once: true });
    expect(fixture.controller.start('outer')).toEqual({ status: 'rejected', reason: 'superseded' });
    expect(fixture.controller.current).toBe(inner);
    expect(inner?.operationId).toBe('abort-listener');
    old.cancel();
    old.finish();
    expect(inner?.check()).toBe(true);
  });

  it.each(['cancel', 'finish'] as const)('does not advance phase when the policy reader calls session.%s', action => {
    const fixture = mount();
    const session = start(fixture);
    fixture.host.readPolicy = () => { session[action](); return fixture.policy; };
    expect(session.ready()).toBe(false);
    expect(session.phase).toBe('settled');
    expect(fixture.controller.current).toBeUndefined();
  });

  it('bounds recursive validation invoked from a destination reader', () => {
    const fixture = mount();
    const session = start(fixture);
    fixture.host.readPolicy = () => { fixture.controller.observe(); return fixture.policy; };
    expect(session.check()).toBe(false);
    expect(session.cancellation).toBe('invalid-target');
    expect(fixture.read).toHaveBeenCalledTimes(2);
  });

  it.each(['cancel', 'destroy', 'supersede'] as const)('keeps an applying session after %s until finish and preserves its accepted receipt', action => {
    const fixture = mount();
    const before = fixture.editor.getJSON();
    const session = start(fixture, 'accepted');
    expect(session.ready()).toBe(true);
    expect(session.beginApply()).toBe(true);
    fixture.editor.view.dispatch(fixture.editor.state.tr.insertText('Applied ', 1)
      .setMeta(pasteCleanupKey, { operationId: session.operationId }).setMeta('paste', true));
    const accepted = fixture.editor.getJSON();
    expect(accepted).not.toEqual(before);
    fixture.controller.observe();
    expect(session.cancellation).toBeUndefined();
    let newer: ClipboardSession | undefined;
    if (action === 'cancel') fixture.controller.cancel();
    else if (action === 'destroy') fixture.controller.destroy();
    else newer = start(fixture, 'newer');
    expect(session.phase).toBe('applying');
    expect(session.signal.aborted).toBe(true);
    expect(session.cancellation).toBe(action === 'cancel' ? 'cancelled' : action === 'destroy' ? 'destroyed' : 'superseded');
    expect(fixture.editor.getJSON()).toEqual(accepted);
    expect(readPasteReceipt(fixture.editor.view, 'accepted')?.changed).toBe(true);
    expect('status' in session).toBe(false);
    session.finish();
    expect(session.phase).toBe('settled');
    expect(fixture.controller.current).toBe(newer);
    expect(fixture.editor.getJSON()).toEqual(accepted);
    expect(readPasteReceipt(fixture.editor.view, 'accepted')?.changed).toBe(true);
    expect(fixture.editor.commands.undo()).toBe(true);
    expect(fixture.editor.getJSON()).toEqual(before);
  });

  it('does not classify or revert an accepted apply when a post-commit transaction observer throws', () => {
    const fixture = mount();
    const session = start(fixture, 'accepted-throw');
    expect(session.ready()).toBe(true);
    expect(session.beginApply()).toBe(true);
    const observer = (): never => { throw new Error('Host observer failure'); };
    fixture.editor.on('transaction', observer);
    expect(() => {
      fixture.editor.view.dispatch(fixture.editor.state.tr.insertText('Accepted ', 1)
        .setMeta(pasteCleanupKey, { operationId: session.operationId }).setMeta('paste', true));
    }).toThrow('Host observer failure');
    fixture.editor.off('transaction', observer);
    session.cancel();
    expect(session.phase).toBe('applying');
    expect(readPasteReceipt(fixture.editor.view, session.operationId)?.changed).toBe(true);
    session.finish();
    expect(fixture.editor.getText()).toContain('Accepted');
    expect(readPasteReceipt(fixture.editor.view, session.operationId)?.changed).toBe(true);
  });

  it('does not invoke destination readers from observe while applying', () => {
    const fixture = mount();
    const session = start(fixture);
    expect(session.ready()).toBe(true);
    expect(session.beginApply()).toBe(true);
    const count = fixture.read.mock.calls.length;
    fixture.host.readPolicy = () => { throw new Error('Applying must be classified from its receipt'); };
    fixture.controller.observe();
    expect(fixture.read).toHaveBeenCalledTimes(count);
    expect(session.cancellation).toBeUndefined();
    session.finish();
  });

  it('rejects invalid IDs before superseding a valid current operation', () => {
    const fixture = mount();
    const session = start(fixture);
    for (const id of ['', 'x'.repeat(129), undefined, null, 12, {}]) {
      expect(() => fixture.controller.start(id as string)).toThrow(RangeError);
      expect(fixture.controller.current).toBe(session);
      expect(session.signal.aborted).toBe(false);
    }
    expect(start(fixture, 'x'.repeat(128)).operationId).toHaveLength(128);
  });
});
