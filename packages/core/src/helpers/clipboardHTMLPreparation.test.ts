import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { DOMParser, Schema } from '@domternal/pm/model';
import { EditorState, Plugin, TextSelection } from '@domternal/pm/state';
import { EditorView } from '@domternal/pm/view';
import type { EditorProps } from '@domternal/pm/view';
import { history, undo } from '@domternal/pm/history';
import {
  beginNativeClipboardPasteAttempt,
  clipboardPreparationSomeProp,
  registerClipboardHTMLPreparation,
  runClipboardPasteAttempt,
  type ClipboardHTMLPreparationGate,
  type ClipboardHTMLReplay,
} from './clipboardHTMLPreparation.js';

class PreparationView extends EditorView {
  override pasteHTML(html: string, event?: ClipboardEvent): boolean {
    return runClipboardPasteAttempt(this, event, () => super.pasteHTML(html, event));
  }

  override pasteText(text: string, event?: ClipboardEvent): boolean {
    return runClipboardPasteAttempt(this, event, () => super.pasteText(text, event));
  }

  override dispatchEvent(event: Event): void {
    if (event.type === 'paste') runClipboardPasteAttempt(this, event as ClipboardEvent, () => { super.dispatchEvent(event); });
    else super.dispatchEvent(event);
  }

  override someProp<N extends keyof EditorProps, R>(name: N, callback: (value: NonNullable<EditorProps[N]>) => R): R | undefined;
  override someProp<N extends keyof EditorProps>(name: N): NonNullable<EditorProps[N]> | undefined;
  override someProp<N extends keyof EditorProps, R>(name: N, callback?: (value: NonNullable<EditorProps[N]>) => R): R | NonNullable<EditorProps[N]> | undefined {
    return clipboardPreparationSomeProp(this, name, callback,
      () => callback === undefined ? super.someProp(name) : super.someProp(name, callback));
  }
}

const schema = new Schema({ nodes: {
  doc: { content: 'block+' },
  paragraph: { content: 'inline*', group: 'block', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
  code: { content: 'text*', group: 'block', code: true, marks: '', parseDOM: [{ tag: 'pre' }], toDOM: () => ['pre', 0] },
  text: { group: 'inline' },
} });

const views: PreparationView[] = [];
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  for (const view of views.splice(0)) if (!view.isDestroyed) view.destroy();
  document.body.replaceChildren();
});

function event(html = '<p>Original</p>', text = 'Original'): ClipboardEvent {
  const value = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(value, 'clipboardData', { value: {
    getData: (type: string): string => type === 'text/html' ? html : type === 'text/plain' ? text : '',
  } });
  return value as ClipboardEvent;
}

function fixture(options: { code?: boolean; dom?: EditorProps['handleDOMEvents']; extra?: EditorProps } = {}): {
  view: PreparationView;
  calls: Record<'html' | 'text' | 'slice' | 'handle' | 'parser' | 'update', ReturnType<typeof vi.fn>>;
} {
  const calls = { html: vi.fn(), text: vi.fn(), slice: vi.fn(), handle: vi.fn(), parser: vi.fn(), update: vi.fn() };
  const parser = new DOMParser(schema, [{ tag: 'p', node: 'paragraph' }, { tag: 'pre', node: 'code' }]);
  const originalParse = parser.parseSlice.bind(parser);
  parser.parseSlice = (dom, parseOptions) => { calls.parser(); return originalParse(dom, parseOptions); };
  const props: EditorProps = {
    transformPastedHTML(html) { calls.html(html); return html; },
    transformPastedText(text, plain) { calls.text(text, plain); return text; },
    transformPasted(slice) { calls.slice(); return slice; },
    clipboardParser: parser,
    handlePaste(_view, _event, slice) { calls.handle(slice); return false; },
    ...options.extra,
    ...(options.dom === undefined ? {} : { handleDOMEvents: options.dom }),
  };
  const doc = schema.node('doc', null, schema.node(options.code === true ? 'code' : 'paragraph', null, schema.text('Keep')));
  const host = document.body.appendChild(document.createElement('div'));
  const view = new PreparationView(host, {
    state: EditorState.create({ doc, selection: TextSelection.create(doc, 1, 5), plugins: [history(), new Plugin({ props })] }),
    handleDOMEvents: { paste(current, source) { beginNativeClipboardPasteAttempt(current, source); return false; } },
    dispatchTransaction(transaction) { view.updateState(view.state.apply(transaction)); calls.update(transaction); },
  });
  views.push(view);
  return { view, calls };
}

function install(view: EditorView, gate: ClipboardHTMLPreparationGate): () => void {
  const dispose = registerClipboardHTMLPreparation(view, gate);
  disposers.push(dispose);
  return dispose;
}

function deferred(view: EditorView): {
  gate: Mock<ClipboardHTMLPreparationGate>;
  onDeferred: Mock<(replay: ClipboardHTMLReplay) => void>;
  discard: Mock<() => void>;
  dispose: () => void;
  replay: ClipboardHTMLReplay;
} {
  let resume: ClipboardHTMLReplay | undefined;
  const discard = vi.fn();
  const onDeferred = vi.fn((replay: ClipboardHTMLReplay) => { resume = replay; });
  const gate = vi.fn<ClipboardHTMLPreparationGate>(() => ({ onDeferred, discard }));
  const dispose = install(view, gate);
  return { gate, onDeferred, discard, dispose, replay: (html: string, source: ClipboardEvent): boolean => {
    if (resume === undefined) throw new Error('Deferred replay is not ready');
    return resume(html, source);
  } };
}

describe('clipboard HTML preparation cooperation', () => {
  it('preserves ordinary public and native paste behavior without a registration', () => {
    const { view, calls } = fixture();
    expect(view.pasteHTML('<p>First</p>', event())).toBe(true);
    view.dom.dispatchEvent(event('<p>Second</p>', 'Second'));
    expect(calls.html).toHaveBeenCalledTimes(2);
    expect(calls.parser).toHaveBeenCalledTimes(2);
    expect(calls.slice).toHaveBeenCalledTimes(2);
    expect(calls.handle).toHaveBeenCalledTimes(2);
  });

  it('leaves the ordinary pipeline intact when the gate declines', () => {
    const { view, calls } = fixture();
    const gate = vi.fn(() => undefined);
    install(view, gate);
    view.pasteHTML('<p>Accepted</p>', event());
    expect(gate).toHaveBeenCalledExactlyOnceWith('<p>Accepted</p>', expect.objectContaining({ origin: 'programmatic' }));
    expect(calls.html).toHaveBeenCalledExactlyOnceWith('<p>Accepted</p>');
    expect(calls.parser).toHaveBeenCalledTimes(1);
    expect(calls.slice).toHaveBeenCalledTimes(1);
    expect(calls.handle).toHaveBeenCalledTimes(1);
    expect(view.state.doc.textContent).toBe('Accepted');
  });

  it('quarantines the initial parse and runs normal transformations and history once on replay', async () => {
    const { view, calls } = fixture();
    const pending = deferred(view);
    const source = event();
    view.dom.dispatchEvent(source);
    expect(source.defaultPrevented).toBe(true);
    expect(view.state.doc.textContent).toBe('Keep');
    for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled();
    expect(pending.onDeferred).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(pending.onDeferred).toHaveBeenCalledTimes(1);
    expect(pending.replay('<p>Complete</p>', event('<p>Complete</p>', 'Complete'))).toBe(true);
    expect(pending.gate).toHaveBeenCalledTimes(1);
    expect(calls.html).toHaveBeenCalledExactlyOnceWith('<p>Complete</p>');
    expect(calls.parser).toHaveBeenCalledTimes(1);
    expect(calls.slice).toHaveBeenCalledTimes(1);
    expect(calls.handle).toHaveBeenCalledTimes(1);
    expect(calls.update).toHaveBeenCalledTimes(1);
    expect(calls.update.mock.calls[0]?.[0].getMeta('paste')).toBe(true);
    expect(calls.update.mock.calls[0]?.[0].getMeta('uiEvent')).toBe('paste');
    expect(view.state.doc.textContent).toBe('Complete');
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.textContent).toBe('Keep');
    expect(pending.discard).toHaveBeenCalledTimes(1);
    expect(pending.replay('<p>Again</p>', event())).toBe(false);
  });

  it.each(['plain shortcut', 'code', 'public text'] as const)('lets ProseMirror select the %s route without invoking the HTML gate', mode => {
    const { view, calls } = fixture({ code: mode === 'code' });
    const pending = deferred(view);
    if (mode === 'public text') view.pasteText('Literal', event());
    else {
      if (mode === 'plain shortcut') view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'V', keyCode: 86, ctrlKey: true, shiftKey: true, bubbles: true }));
      view.dom.dispatchEvent(event('<p>Rich</p>', 'Literal'));
    }
    expect(view.state.doc.textContent).toBe('Literal');
    expect(pending.gate).not.toHaveBeenCalled();
    expect(calls.html).not.toHaveBeenCalled();
    expect(calls.text).toHaveBeenCalledExactlyOnceWith('Literal', true);
    expect(calls.slice).toHaveBeenCalledTimes(1);
    expect(calls.handle).toHaveBeenCalledTimes(1);
  });

  it('does not claim HTML-free image-only or empty attempts', () => {
    const { view, calls } = fixture({ extra: { handlePaste: () => true } });
    const pending = deferred(view);
    view.dom.dispatchEvent(event('', ''));
    expect(pending.gate).not.toHaveBeenCalled();
    expect(calls.html).not.toHaveBeenCalled();
    expect(calls.slice).not.toHaveBeenCalled();
    expect(view.state.doc.textContent).toBe('Keep');
  });

  it('scopes the public dispatchEvent helper without requiring native eventPhase', async () => {
    const { view, calls } = fixture();
    const pending = deferred(view);
    const source = event();
    expect(source.eventPhase).toBe(0);
    view.dispatchEvent(source);
    expect(pending.gate.mock.calls[0]?.[1]).toMatchObject({ origin: 'native', event: source });
    await Promise.resolve();
    expect(pending.replay('<p>Ready</p>', event())).toBe(true);
    expect(calls.html).toHaveBeenCalledTimes(1);
  });

  it.each(['empty HTML', 'empty text', 'text', 'native consumed'] as const)('cancels a pending replay on a newer %s attempt', async mode => {
    let consume = false;
    const { view } = fixture({ dom: { paste: () => consume } });
    const pending = deferred(view);
    view.pasteHTML('<p>First</p>', event());
    await Promise.resolve();
    if (mode === 'empty HTML') view.pasteHTML('', event('', ''));
    else if (mode === 'empty text') view.pasteText('', event('', ''));
    else if (mode === 'text') view.pasteText('New', event('', 'New'));
    else { consume = true; view.dom.dispatchEvent(event()); }
    expect(pending.replay('<p>Stale</p>', event())).toBe(false);
    expect(view.state.doc.textContent).not.toContain('Stale');
    expect(pending.discard).toHaveBeenCalledTimes(1);
  });

  it('does not let an earlier consuming native handler leave a same-task deferred gate armed', () => {
    const { view, calls } = fixture({ dom: { paste: () => true } });
    const pending = deferred(view);
    view.dom.dispatchEvent(event());
    // A drop can also query transformPastedHTML. No native paste frame remains live.
    view.someProp('transformPastedHTML', transform => { transform('<p>Unrelated</p>', view); });
    expect(pending.gate).not.toHaveBeenCalled();
    expect(calls.html).toHaveBeenCalledExactlyOnceWith('<p>Unrelated</p>');
  });

  it('does not retain a native frame when editability prevents ProseMirror routing', () => {
    const { view, calls } = fixture();
    const pending = deferred(view);
    view.setProps({ editable: () => false });
    view.dom.dispatchEvent(event());
    view.someProp('transformPastedHTML', transform => { transform('<p>Unrelated</p>', view); });
    expect(pending.gate).not.toHaveBeenCalled();
    expect(calls.html).toHaveBeenCalledExactlyOnceWith('<p>Unrelated</p>');
    expect(view.state.doc.textContent).toBe('Keep');
  });

  it('does not mistake a DOM handler inspecting HTML for ProseMirror choosing the HTML route', () => {
    const { view, calls } = fixture({ dom: { paste(current) {
      // updateProps invokes ensureListeners, which makes its own handleDOMEvents query.
      current.setProps({ attributes: { 'data-probe': 'ready' } });
      current.someProp('transformPastedHTML', transform => { transform('<p>Inspection</p>', current); });
      return false;
    } } });
    const pending = deferred(view);
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'V', keyCode: 86, ctrlKey: true, shiftKey: true, bubbles: true }));
    view.dom.dispatchEvent(event('<p>Rich</p>', 'Literal'));
    expect(pending.gate).not.toHaveBeenCalled();
    expect(calls.html).toHaveBeenCalledExactlyOnceWith('<p>Inspection</p>');
    expect(calls.text).toHaveBeenCalledExactlyOnceWith('Literal', true);
    expect(view.state.doc.textContent).toBe('Literal');
  });

  it('closes native attempts when a DOM handler prevents default but returns false', () => {
    const { view, calls } = fixture({ dom: { paste(_current, source) { source.preventDefault(); return false; } } });
    const pending = deferred(view);
    view.dom.dispatchEvent(event());
    view.someProp('transformPastedHTML', transform => { transform('<p>Unrelated</p>', view); });
    expect(pending.gate).not.toHaveBeenCalled();
    expect(calls.html).toHaveBeenCalledExactlyOnceWith('<p>Unrelated</p>');
    expect(view.state.doc.textContent).toBe('Keep');
  });

  it('prunes a nested consumed native event and restores the outer routing frame', async () => {
    let nested = false;
    const { view, calls } = fixture({ dom: { paste: () => nested } });
    let resume: ClipboardHTMLReplay | undefined;
    const gate = vi.fn(() => {
      nested = true;
      view.dom.dispatchEvent(event('<p>Nested</p>', 'Nested'));
      nested = false;
      return { onDeferred(replay: ClipboardHTMLReplay) { resume = replay; } };
    });
    install(view, gate);
    view.dom.dispatchEvent(event());
    await Promise.resolve();
    // The nested attempt supersedes the outer preparation, even when it is consumed.
    expect(resume).toBeUndefined();
    expect(view.state.doc.textContent).toBe('Keep');
    expect(calls.html).not.toHaveBeenCalled();
    expect(calls.handle).not.toHaveBeenCalled();
  });

  it('does not pass the replay bypass to a nested public HTML paste', async () => {
    let nested = false;
    const { view } = fixture({ extra: { transformPastedHTML(html) {
      if (!nested) { nested = true; view.pasteHTML('<p>Nested</p>', event()); }
      return html;
    } } });
    const pending = deferred(view);
    view.pasteHTML('<p>First</p>', event());
    await Promise.resolve();
    expect(pending.replay('<p>Complete</p>', event())).toBe(true);
    expect(pending.gate).toHaveBeenCalledTimes(2);
    expect(pending.gate.mock.calls[1]?.[0]).toBe('<p>Nested</p>');
  });

  it('requires a fresh event without retaining or reusing the original source event', async () => {
    const { view } = fixture();
    const pending = deferred(view);
    const source = event();
    view.pasteHTML('<p>Original</p>', source);
    await Promise.resolve();
    expect(pending.replay('<p>Denied</p>', source)).toBe(false);
    expect(pending.replay('<p>Expired</p>', event())).toBe(false);
    expect(view.state.doc.textContent).toBe('Keep');
  });

  it.each([null, undefined, {}, new Event('click')])('rejects a malformed replay event and expires its token: %j', async invalid => {
    const { view } = fixture();
    const pending = deferred(view);
    view.pasteHTML('<p>Original</p>', event());
    await Promise.resolve();
    expect(pending.replay('<p>Denied</p>', invalid as ClipboardEvent)).toBe(false);
    expect(pending.replay('<p>Expired</p>', event())).toBe(false);
    expect(view.state.doc.textContent).toBe('Keep');
  });

  it('rejects a non-string replay payload before ordinary HTML hooks', async () => {
    const { view, calls } = fixture();
    const pending = deferred(view);
    view.pasteHTML('<p>Original</p>', event());
    await Promise.resolve();
    expect(pending.replay({ html: '<p>Forged</p>' } as unknown as string, event())).toBe(false);
    expect(calls.html).not.toHaveBeenCalled();
    expect(view.state.doc.textContent).toBe('Keep');
  });

  it('does not cancel a newer preparation started by a replay event getter', async () => {
    const { view } = fixture();
    const replays: ClipboardHTMLReplay[] = [];
    install(view, () => ({ onDeferred(replay) { replays.push(replay); } }));
    view.pasteHTML('<p>Original</p>', event());
    await Promise.resolve();
    const hostile = event();
    Object.defineProperty(hostile, 'type', { get() {
      view.pasteHTML('<p>Newer</p>', event());
      return 'paste';
    } });
    expect(replays[0]?.('<p>Stale</p>', hostile)).toBe(false);
    await Promise.resolve();
    expect(replays).toHaveLength(2);
    expect(replays[1]?.('<p>Newer</p>', event())).toBe(true);
    expect(view.state.doc.textContent).toBe('Newer');
  });

  it('keeps registration and cancellation scoped to the destination view', async () => {
    const first = fixture();
    const second = fixture();
    const one = deferred(first.view);
    const two = deferred(second.view);
    first.view.pasteHTML('<p>One</p>', event());
    second.view.pasteHTML('<p>Two</p>', event());
    await Promise.resolve();
    first.view.pasteText('', event('', ''));
    expect(one.replay('<p>Stale</p>', event())).toBe(false);
    expect(two.replay('<p>Second</p>', event())).toBe(true);
    expect(second.view.state.doc.textContent).toBe('Second');
  });

  it.each(['dispose', 'replacement', 'destroy'] as const)('invalidates replay after %s and releases resources once', async mode => {
    const { view } = fixture();
    const pending = deferred(view);
    view.pasteHTML('<p>Original</p>', event());
    await Promise.resolve();
    if (mode === 'dispose') { pending.dispose(); pending.dispose(); }
    else if (mode === 'replacement') { install(view, () => undefined); pending.dispose(); }
    else view.destroy();
    expect(pending.replay('<p>Stale</p>', event())).toBe(false);
    if (mode === 'destroy') pending.dispose();
    expect(pending.discard).toHaveBeenCalledTimes(1);
  });

  it.each(['gate', 'onDeferred', 'discard'] as const)('fails closed when %s throws', async stage => {
    const { view, calls } = fixture();
    let resume: ClipboardHTMLReplay | undefined;
    const discard = vi.fn(() => { if (stage === 'discard') throw new Error('Cleanup failed'); });
    install(view, () => {
      if (stage === 'gate') throw new Error('Preparation failed');
      return {
        onDeferred(replay) { resume = replay; if (stage === 'onDeferred') throw new Error('Observer failed'); },
        discard,
      };
    });
    expect(() => view.pasteHTML('<p>Original</p>', event())).not.toThrow();
    await Promise.resolve();
    if (resume !== undefined) expect(resume('<p>Denied</p>', event())).toBe(false);
    expect(view.state.doc.textContent).toBe('Keep');
    expect(calls.update).not.toHaveBeenCalled();
    if (stage !== 'gate') expect(discard).toHaveBeenCalledTimes(1);
  });

  it.each([null, true, {}, { onDeferred: 'bad' }, { onDeferred() { /* Invalid cleanup contract. */ }, discard: true }])('fails closed for a malformed gate result: %j', async malformed => {
    const { view, calls } = fixture();
    install(view, (() => malformed) as unknown as ClipboardHTMLPreparationGate);
    view.pasteHTML('<p>Original</p>', event());
    await Promise.resolve();
    expect(view.state.doc.textContent).toBe('Keep');
    expect(calls.html).not.toHaveBeenCalled();
    expect(calls.handle).not.toHaveBeenCalled();
  });

  it('discards malformed gate resources only once even if discard throws', async () => {
    const { view } = fixture();
    const discard = vi.fn(() => { throw new Error('Cleanup failed'); });
    install(view, (() => ({ onDeferred: null, discard })) as unknown as ClipboardHTMLPreparationGate);
    view.pasteHTML('<p>Original</p>', event());
    await Promise.resolve();
    expect(discard).toHaveBeenCalledTimes(1);
    expect(view.state.doc.textContent).toBe('Keep');
  });

  it.each(['gate', 'onDeferred', 'discard'] as const)('rejects an invalid async %s callback without an unhandled rejection', async stage => {
    const { view, calls } = fixture();
    let replay: ClipboardHTMLReplay | undefined;
    install(view, (() => {
      if (stage === 'gate') return Promise.reject(new Error('Invalid async gate'));
      return {
        onDeferred(value: ClipboardHTMLReplay) {
          replay = value;
          if (stage === 'onDeferred') return Promise.reject(new Error('Invalid async observer'));
          return undefined;
        },
        discard() {
          if (stage === 'discard') return Promise.reject(new Error('Invalid async cleanup'));
          return undefined;
        },
      };
    }) as unknown as ClipboardHTMLPreparationGate);
    view.pasteHTML('<p>Original</p>', event());
    await Promise.resolve();
    if (replay !== undefined) expect(replay('<p>Denied</p>', event())).toBe(false);
    await Promise.resolve();
    expect(view.state.doc.textContent).toBe('Keep');
    expect(calls.update).not.toHaveBeenCalled();
  });

  it('does not cancel a newer operation when the prior onDeferred callback throws', async () => {
    const { view } = fixture();
    const replays: ClipboardHTMLReplay[] = [];
    let first = true;
    install(view, () => ({ onDeferred(replay) {
      replays.push(replay);
      if (first) {
        first = false;
        view.pasteHTML('<p>Newer</p>', event());
        throw new Error('Old observer failed');
      }
    } }));
    view.pasteHTML('<p>Original</p>', event());
    await Promise.resolve();
    await Promise.resolve();
    expect(replays[0]?.('<p>Stale</p>', event())).toBe(false);
    expect(replays[1]?.('<p>Newer</p>', event())).toBe(true);
    expect(view.state.doc.textContent).toBe('Newer');
  });

  it('does not permit synchronous replay before onDeferred finishes successfully', async () => {
    const { view, calls } = fixture();
    install(view, () => ({ onDeferred(replay) {
      expect(replay('<p>Too early</p>', event())).toBe(false);
      throw new Error('Observer failed after trying to replay');
    } }));
    view.pasteHTML('<p>Original</p>', event());
    await Promise.resolve();
    expect(view.state.doc.textContent).toBe('Keep');
    expect(calls.update).not.toHaveBeenCalled();
  });

  it('does not resume after discard starts a newer attempt', async () => {
    const { view } = fixture();
    let replay: ClipboardHTMLReplay | undefined;
    install(view, () => ({ onDeferred(value) { replay = value; }, discard() { view.pasteText('Newer', event('', 'Newer')); } }));
    view.pasteHTML('<p>Old</p>', event());
    await Promise.resolve();
    expect(replay?.('<p>Stale</p>', event())).toBe(false);
    expect(view.state.doc.textContent).toBe('Newer');
  });

  it.each(['HTML', 'text', 'native HTML', 'native text'] as const)('keeps the newest deferred paste when discard reenters while a new %s attempt opens', async route => {
    const { view } = fixture();
    const replays = new Map<string, ClipboardHTMLReplay>();
    const released: string[] = [];
    const gate = vi.fn<ClipboardHTMLPreparationGate>(html => ({
      onDeferred(replay) { replays.set(html, replay); },
      discard() {
        released.push(html);
        if (html === '<p>Old</p>') view.pasteHTML('<p>Newest</p>', event());
      },
    }));
    install(view, gate);
    view.pasteHTML('<p>Old</p>', event());
    await Promise.resolve();
    if (route === 'HTML') view.pasteHTML('<p>Middle</p>', event());
    else if (route === 'text') view.pasteText('Middle', event('', 'Middle'));
    else view.dom.dispatchEvent(event(route === 'native HTML' ? '<p>Middle</p>' : '', 'Middle'));
    await Promise.resolve();
    expect(gate.mock.calls.map(call => call[0])).toEqual(['<p>Old</p>', '<p>Newest</p>']);
    expect(view.state.doc.textContent).toBe('Keep');
    expect(replays.get('<p>Middle</p>')).toBeUndefined();
    expect(replays.get('<p>Old</p>')?.('<p>Stale</p>', event())).toBe(false);
    expect(replays.get('<p>Newest</p>')?.('<p>Newest ready</p>', event())).toBe(true);
    expect(view.state.doc.textContent).toBe('Newest ready');
    expect(released).toEqual(['<p>Old</p>', '<p>Newest</p>']);
  });

  it.each(['replacement', 'disposal'] as const)('keeps a newer registration and its pending resources when discard reenters during %s', async action => {
    const { view } = fixture();
    let newestReplay: ClipboardHTMLReplay | undefined;
    const newestDiscard = vi.fn();
    const newestGate = vi.fn<ClipboardHTMLPreparationGate>(() => ({
      onDeferred(replay) { newestReplay = replay; }, discard: newestDiscard,
    }));
    const oldDiscard = vi.fn(() => {
      install(view, newestGate);
      view.pasteHTML('<p>Newest</p>', event());
    });
    const disposeOld = install(view, () => ({ onDeferred() { /* Wait for replacement. */ }, discard: oldDiscard }));
    view.pasteHTML('<p>Old</p>', event());
    await Promise.resolve();
    const middleGate = vi.fn<ClipboardHTMLPreparationGate>(() => undefined);
    const disposeMiddle = action === 'replacement' ? install(view, middleGate) : undefined;
    if (action === 'disposal') disposeOld();
    disposeMiddle?.();
    disposeOld();
    await Promise.resolve();
    expect(oldDiscard).toHaveBeenCalledTimes(1);
    expect(middleGate).not.toHaveBeenCalled();
    expect(newestGate).toHaveBeenCalledTimes(1);
    expect(newestReplay?.('<p>Newest ready</p>', event())).toBe(true);
    expect(view.state.doc.textContent).toBe('Newest ready');
    expect(newestDiscard).toHaveBeenCalledTimes(1);
  });

  it('blocks an outer preparation even when the gate disposes its registration', async () => {
    const { view, calls } = fixture();
    const discard = vi.fn();
    const dispose = install(view, () => { dispose(); return { onDeferred() { /* Superseded before activation. */ }, discard }; });
    view.pasteHTML('<p>Original</p>', event());
    await Promise.resolve();
    expect(view.state.doc.textContent).toBe('Keep');
    expect(calls.html).not.toHaveBeenCalled();
    expect(calls.handle).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledTimes(1);
  });
});
