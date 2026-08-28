import { DOMParser } from '@domternal/pm/model';
import type { EditorProps, EditorView } from '@domternal/pm/view';

export interface ClipboardHTMLPreparationContext {
  /** Available for synchronous capture only. Deferred work must own a safe snapshot. */
  readonly event: ClipboardEvent | undefined;
  readonly origin: 'native' | 'programmatic';
}

/** Returns ProseMirror's handled status, not a transaction acceptance receipt. */
export type ClipboardHTMLReplay = (html: string, freshEvent: ClipboardEvent) => boolean;

export interface ClipboardHTMLDeferral {
  /** Start deferred work synchronously and return void. Replay becomes available after this callback returns. */
  onDeferred(replay: ClipboardHTMLReplay): void;
  /** Release preparation resources synchronously on completion, cancellation, or replacement. */
  discard?(): void;
}

export type ClipboardHTMLPreparationGate = (
  html: string,
  context: Readonly<ClipboardHTMLPreparationContext>,
) => ClipboardHTMLDeferral | undefined;

interface Registration {
  readonly identity: object;
  readonly gate: ClipboardHTMLPreparationGate;
}

interface ReplayIdentity {
  readonly generation: number;
  readonly registration: object;
  used: boolean;
  ready: boolean;
}

interface PendingPreparation {
  readonly identity: ReplayIdentity;
  onDeferred: ClipboardHTMLDeferral['onDeferred'] | undefined;
  discard: ClipboardHTMLDeferral['discard'];
}

interface Attempt {
  event: ClipboardEvent | undefined;
  origin: ClipboardHTMLPreparationContext['origin'];
  readonly scoped: boolean;
  readonly generation: number;
  readonly bypass: boolean;
  routing: boolean;
  nativeTraversal: DOMTraversal | undefined;
  closed: boolean;
  checked: boolean;
  quarantined: boolean;
  pending: PendingPreparation | undefined;
}

interface DOMTraversal { attempt: Attempt | undefined }

interface ViewPreparation {
  generation: number;
  registration: Registration | undefined;
  readonly attempts: Attempt[];
  readonly domTraversals: DOMTraversal[];
  pending: PendingPreparation | undefined;
  permit: { readonly event: ClipboardEvent } | undefined;
}

const preparations = new WeakMap<EditorView, ViewPreparation>();
// Weak keys remember source identity without keeping native clipboard events alive.
const usedEvents = new WeakMap<ClipboardEvent, WeakSet<EditorView>>();

function recordEvent(view: EditorView, event: ClipboardEvent | undefined): void {
  if (event === undefined) return;
  let views = usedEvents.get(event);
  if (views === undefined) { views = new WeakSet(); usedEvents.set(event, views); }
  views.add(view);
}

function observeInvalidReturn(value: unknown): void {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    // A rejected Promise from an invalid async callback must not become unhandled.
    void Promise.resolve(value).catch(() => undefined);
  }
}

function runDiscard(discard: ClipboardHTMLDeferral['discard']): boolean {
  try {
    const returned: unknown = discard?.();
    if (returned === undefined) return true;
    observeInvalidReturn(returned);
    return false;
  } catch { return false; }
}

function cleanup(pending: PendingPreparation): boolean {
  pending.identity.used = true;
  pending.onDeferred = undefined;
  const discard = pending.discard;
  pending.discard = undefined;
  return runDiscard(discard);
}

function cancelPending(state: ViewPreparation): void {
  const pending = state.pending;
  state.pending = undefined;
  if (pending !== undefined) cleanup(pending);
}

function liveNative(view: EditorView, attempt: Attempt): boolean {
  try { return attempt.event?.currentTarget === view.dom && attempt.event.eventPhase !== 0; }
  catch { return false; }
}

function closeAttempt(state: ViewPreparation, attempt: Attempt): void {
  attempt.closed = true;
  attempt.event = undefined;
  const index = state.attempts.indexOf(attempt);
  if (index >= 0) state.attempts.splice(index, 1);
  if (attempt.pending?.onDeferred !== undefined) {
    if (state.pending === attempt.pending) state.pending = undefined;
    cleanup(attempt.pending);
  }
  attempt.pending = undefined;
}

function currentAttempt(view: EditorView, state: ViewPreparation): Attempt | undefined {
  for (let index = state.attempts.length - 1; index >= 0; index--) {
    const attempt = state.attempts[index];
    if (attempt === undefined) continue;
    if (attempt.closed || (!attempt.scoped && !liveNative(view, attempt))) closeAttempt(state, attempt);
    else return attempt;
  }
  return undefined;
}

/** Synchronous event identity for the active Core paste attempt. Never retain its live clipboard data. */
export function getClipboardPasteAttemptEvent(view: EditorView): ClipboardEvent | undefined {
  const state = preparations.get(view);
  if (state === undefined || view.isDestroyed) return undefined;
  return currentAttempt(view, state)?.event;
}

function openAttempt(view: EditorView, state: ViewPreparation, event: ClipboardEvent | undefined, scoped: boolean): Attempt {
  const bypass = state.permit?.event === event && state.permit !== undefined;
  state.permit = undefined;
  const attempt: Attempt = {
    event, origin: scoped ? 'programmatic' : 'native', scoped,
    generation: ++state.generation, bypass, routing: scoped, nativeTraversal: undefined,
    closed: false, checked: false,
    quarantined: false, pending: undefined,
  };
  recordEvent(view, event);
  state.attempts.push(attempt);
  // Publish this attempt before cleanup calls user code. A paste or registration
  // created by discard is newer and must not be overwritten when cleanup returns.
  cancelPending(state);
  if (state.generation !== attempt.generation) quarantine(attempt);
  // Native composition, read-only, and consuming DOM handlers may skip handlePaste.
  // Identity-based expiry never closes a later or outer attempt.
  queueMicrotask(() => { if (!attempt.closed) closeAttempt(state, attempt); });
  return attempt;
}

/** @internal Scope public pasteHTML, pasteText, and paste dispatchEvent entry points. */
export function runClipboardPasteAttempt<T>(view: EditorView, event: ClipboardEvent | undefined, run: () => T): T {
  const state = preparations.get(view);
  if (state === undefined || (state.registration === undefined && state.attempts.length === 0)) return run();
  const attempt = openAttempt(view, state, event, true);
  try { return run(); } finally { closeAttempt(state, attempt); }
}

/** @internal Called by Core's direct native paste handler before plugin DOM handlers. */
export function beginNativeClipboardPasteAttempt(view: EditorView, event: ClipboardEvent): void {
  const state = preparations.get(view);
  if (state === undefined || (state.registration === undefined && state.attempts.length === 0)) return;
  const traversal = state.domTraversals.at(-1);
  if (traversal === undefined) return;
  // Do not invoke an expired frame's cleanup before publishing a new generation.
  const latest = state.attempts.at(-1);
  const existing = latest !== undefined && !latest.closed && (latest.scoped || liveNative(view, latest)) ? latest : undefined;
  if (existing?.event === event) {
    // Nested ensureListeners or manual prop queries cannot take ownership of an
    // outer native traversal. Explicit dispatchEvent gets its own scoped frame.
    if (existing.nativeTraversal !== undefined) return;
    if (existing.scoped) {
      existing.origin = 'native';
      existing.routing = false;
      existing.nativeTraversal = traversal;
      traversal.attempt = existing;
      return;
    }
  }
  const attempt = openAttempt(view, state, event, false);
  attempt.nativeTraversal = traversal;
  traversal.attempt = attempt;
  if (!liveNative(view, attempt)) closeAttempt(state, attempt);
}

function validPending(view: EditorView, state: ViewPreparation, identity: ReplayIdentity): boolean {
  return !view.isDestroyed && !identity.used && state.pending?.identity === identity &&
    state.generation === identity.generation && state.registration?.identity === identity.registration;
}

function freshReplayEvent(view: EditorView, value: unknown): value is ClipboardEvent {
  return value !== null && typeof value === 'object' && Reflect.get(value, 'type') === 'paste' &&
    Reflect.get(value, 'currentTarget') === null && Reflect.get(value, 'eventPhase') === 0 &&
    typeof Reflect.get(value, 'preventDefault') === 'function' && !usedEvents.get(value as ClipboardEvent)?.has(view);
}

// Keep this factory separate: the returned closure captures no Attempt, native event,
// DataTransfer, or caller callback. A caller must supply a fresh, safe replay event.
function createReplay(view: EditorView, identity: ReplayIdentity): ClipboardHTMLReplay {
  return (html, freshEvent) => {
    const state = preparations.get(view);
    if (state === undefined) return false;
    if (!validPending(view, state, identity)) {
      if (state.pending?.identity === identity) cancelPending(state);
      return false;
    }
    const pending = state.pending;
    let valid = false;
    try {
      valid = identity.ready && typeof html === 'string' && freshReplayEvent(view, freshEvent);
    } catch { /* Invalid event access consumes the preparation without inserting. */ }
    // Event accessors and resource cleanup can synchronously start another paste.
    // Never cancel a newer preparation or replay against its changed target.
    if (pending === undefined || state.pending !== pending || !validPending(view, state, identity)) return false;
    state.pending = undefined;
    if (!cleanup(pending) || !valid || view.isDestroyed || !view.editable ||
      state.generation !== identity.generation || state.registration?.identity !== identity.registration) return false;
    const permit = { event: freshEvent };
    state.permit = permit;
    try { return view.pasteHTML(html, freshEvent); }
    finally { if (state.permit === permit) state.permit = undefined; }
  };
}

function quarantine(attempt: Attempt): void {
  attempt.quarantined = true;
  try { attempt.event?.preventDefault(); } catch { /* Continue consuming the attempt. */ }
}

function isQuarantined(attempt: Attempt): boolean { return attempt.quarantined; }

function inspectHTML(view: EditorView, state: ViewPreparation, attempt: Attempt, html: string): string {
  attempt.checked = true;
  const registration = state.registration;
  if (registration === undefined) return html;
  let returned: unknown;
  let onDeferred: unknown;
  let discard: unknown;
  try {
    returned = registration.gate(html, Object.freeze({ event: attempt.event, origin: attempt.origin }));
    if (returned === undefined) return html;
    quarantine(attempt);
    if (returned === null || typeof returned !== 'object') return '';
    onDeferred = Reflect.get(returned, 'onDeferred');
    discard = Reflect.get(returned, 'discard');
    if (typeof onDeferred !== 'function' || (discard !== undefined && typeof discard !== 'function')) {
      if (typeof discard === 'function') {
        const invalidDiscard = discard as () => void;
        discard = undefined;
        runDiscard(invalidDiscard);
      }
      observeInvalidReturn(returned);
      return '';
    }
    const pending: PendingPreparation = {
      identity: { generation: attempt.generation, registration: registration.identity, used: false, ready: false },
      onDeferred: onDeferred as ClipboardHTMLDeferral['onDeferred'],
      discard: discard as ClipboardHTMLDeferral['discard'],
    };
    if (attempt.closed || view.isDestroyed || state.generation !== attempt.generation || state.registration !== registration) {
      cleanup(pending);
      return '';
    }
    attempt.pending = pending;
    state.pending = pending;
    return '';
  } catch {
    quarantine(attempt);
    if (typeof discard === 'function') runDiscard(discard as () => void);
    observeInvalidReturn(returned);
    return '';
  }
}

function consumeDeferred(view: EditorView, state: ViewPreparation, attempt: Attempt): boolean {
  const pending = attempt.pending;
  // Transfer pending work out of the synchronous frame before closing it.
  attempt.pending = undefined;
  closeAttempt(state, attempt);
  if (pending === undefined) return true;
  queueMicrotask(() => {
    if (!validPending(view, state, pending.identity)) {
      if (state.pending === pending) state.pending = undefined;
      cleanup(pending);
      return;
    }
    const callback = pending.onDeferred;
    pending.onDeferred = undefined;
    try {
      const returned: unknown = callback?.(createReplay(view, pending.identity));
      if (returned !== undefined) {
        if (state.pending === pending) state.pending = undefined;
        cleanup(pending);
        observeInvalidReturn(returned);
        return;
      }
      if (validPending(view, state, pending.identity)) pending.identity.ready = true;
    } catch {
      if (state.pending === pending) state.pending = undefined;
      cleanup(pending);
    }
  });
  return true;
}

/**
 * Register one HTML preparation gate in a Core editor. ProseMirror still selects
 * the text or HTML route. Returning undefined preserves its ordinary pipeline.
 * Deferred HTML uses an empty preliminary parse, then runs ordinary paste hooks
 * once on replay. This is not an asynchronous continuation of ProseMirror parsing.
 * A new attempt, registration replacement, disposal, or destroyed view invalidates
 * replay. The owner must dispose the registration when its plugin view is destroyed.
 * A reentrant paste or registration created by cleanup takes precedence over the
 * outer call that triggered that cleanup.
 * Replay freshness checks do not validate clipboard contents. The caller owns
 * sanitization, destination policy, safe replay data, and async target validation.
 * Ordinary replay hook and dispatch errors keep their usual ProseMirror behavior.
 */
export function registerClipboardHTMLPreparation(view: EditorView, gate: ClipboardHTMLPreparationGate): () => void {
  if (typeof gate !== 'function') throw new TypeError('Expected a clipboard HTML preparation gate');
  if (view.isDestroyed) throw new Error('Cannot prepare clipboard HTML in a destroyed view');
  let state = preparations.get(view);
  if (state === undefined) {
    state = { generation: 0, registration: undefined, attempts: [], domTraversals: [], pending: undefined, permit: undefined };
    preparations.set(view, state);
  }
  const registration = { identity: Object.freeze({}), gate };
  state.registration = registration;
  state.generation++;
  state.permit = undefined;
  cancelPending(state);
  const owned = state;
  return () => {
    if (owned.registration !== registration) return;
    owned.registration = undefined;
    owned.generation++;
    owned.permit = undefined;
    cancelPending(owned);
    // An in-progress empty parse must remain quarantined after self-disposal.
    // Scoped finalizers or native expiry still release its event and frame.
  };
}

/** @internal Delegate EditorView.someProp through the current, explicitly scoped attempt. */
export function clipboardPreparationSomeProp<N extends keyof EditorProps, R>(
  view: EditorView,
  name: N,
  callback: ((value: NonNullable<EditorProps[N]>) => R) | undefined,
  delegate: () => R | NonNullable<EditorProps[N]> | undefined,
): R | NonNullable<EditorProps[N]> | undefined {
  const state = preparations.get(view);
  if (state === undefined) return delegate();
  if (name === 'handleDOMEvents' && callback !== undefined) {
    const traversal: DOMTraversal = { attempt: undefined };
    state.domTraversals.push(traversal);
    let completed = false;
    let handled: unknown;
    try {
      const value = delegate();
      handled = value;
      completed = true;
      return value;
    } finally {
      const index = state.domTraversals.indexOf(traversal);
      if (index >= 0) state.domTraversals.splice(index, 1);
      const native = traversal.attempt;
      if (native !== undefined && !native.closed) {
        let consumed = !completed || Boolean(handled) || view.isDestroyed || !view.editable;
        try { consumed ||= native.event?.defaultPrevented === true; } catch { consumed = true; }
        if (consumed) closeAttempt(state, native);
        else native.routing = true;
      }
    }
  }
  const attempt = currentAttempt(view, state);
  if (attempt === undefined) return delegate();
  const invoke = (value: unknown): R | NonNullable<EditorProps[N]> | undefined => {
    const property = value as NonNullable<EditorProps[N]>;
    return callback === undefined ? property : callback(property);
  };
  if (name === 'transformPastedHTML' && !attempt.quarantined && attempt.routing && state.registration !== undefined && !attempt.bypass && !attempt.checked && callback !== undefined) {
    invoke((html: string) => inspectHTML(view, state, attempt, html));
    if (isQuarantined(attempt)) return undefined;
  }
  if (attempt.quarantined) {
    if (name === 'transformPastedHTML') return invoke(() => '');
    if (name === 'clipboardParser') return invoke(DOMParser.fromSchema(view.state.schema));
    if (name === 'transformPasted') return undefined;
    if (name === 'handlePaste') return invoke(() => consumeDeferred(view, state, attempt));
  }
  if (name === 'handlePaste') {
    try { return delegate(); } finally { closeAttempt(state, attempt); }
  }
  return delegate();
}
