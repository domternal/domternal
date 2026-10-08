import { describe, expect, it } from 'vitest';
import type { EditorView } from '@domternal/pm/view';
import { getClipboardPasteBehavior, setClipboardPasteBehavior } from './clipboardPasteBehavior.js';

// This transport uses object identities only and never accesses editor or event internals.
const viewIdentity = (): EditorView => ({} as EditorView);
const pasteEvent = (): ClipboardEvent => new Event('paste') as ClipboardEvent;

describe('clipboard paste behavior', () => {
  it('keeps intent scoped to both the event and destination view', () => {
    const firstView = viewIdentity();
    const secondView = viewIdentity();
    const firstEvent = pasteEvent();
    const secondEvent = pasteEvent();

    expect(getClipboardPasteBehavior(firstView, firstEvent)).toBeUndefined();
    setClipboardPasteBehavior(firstView, firstEvent, { preserveOrderedListStart: true });

    expect(getClipboardPasteBehavior(firstView, firstEvent)).toEqual({ preserveOrderedListStart: true });
    expect(getClipboardPasteBehavior(secondView, firstEvent)).toBeUndefined();
    expect(getClipboardPasteBehavior(firstView, secondEvent)).toBeUndefined();
    setClipboardPasteBehavior(secondView, firstEvent, { preserveOrderedListStart: true });
    setClipboardPasteBehavior(firstView, firstEvent, {});
    expect(getClipboardPasteBehavior(firstView, firstEvent)).toBeUndefined();
    expect(getClipboardPasteBehavior(secondView, firstEvent)).toEqual({ preserveOrderedListStart: true });
  });

  it.each([{}, { preserveOrderedListStart: false }])('clears previously enabled intent with %j', behavior => {
    const view = viewIdentity();
    const event = pasteEvent();
    setClipboardPasteBehavior(view, event, behavior);
    expect(getClipboardPasteBehavior(view, event)).toBeUndefined();
    setClipboardPasteBehavior(view, event, { preserveOrderedListStart: true });
    setClipboardPasteBehavior(view, event, behavior);
    expect(getClipboardPasteBehavior(view, event)).toBeUndefined();
  });

  it('copies the supported intent and freezes the returned value', () => {
    const view = viewIdentity();
    const event = pasteEvent();
    const input = { preserveOrderedListStart: true, trusted: true, skipSanitization: true };
    setClipboardPasteBehavior(view, event, input);
    input.preserveOrderedListStart = false;
    const result = getClipboardPasteBehavior(view, event);

    expect(result).toEqual({ preserveOrderedListStart: true });
    expect(result).not.toBe(input);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Reflect.set(result ?? {}, 'preserveOrderedListStart', false)).toBe(false);
    expect(getClipboardPasteBehavior(view, event)).toEqual({ preserveOrderedListStart: true });
  });

  it.each([
    { assetsAlreadyHandled: true },
    { preserveOrderedListStart: true, assetsAlreadyHandled: true },
  ])('transports coordinated asset ownership with %j', behavior => {
    const view = viewIdentity();
    const event = pasteEvent();
    setClipboardPasteBehavior(view, event, behavior);
    expect(getClipboardPasteBehavior(view, event)).toEqual(behavior);
    expect(Object.isFrozen(getClipboardPasteBehavior(view, event))).toBe(true);
    expect(getClipboardPasteBehavior(viewIdentity(), event)).toBeUndefined();
    expect(getClipboardPasteBehavior(view, pasteEvent())).toBeUndefined();
  });

  it('replaces prior intent without retaining disabled flags or an empty object', () => {
    const view = viewIdentity();
    const event = pasteEvent();
    setClipboardPasteBehavior(view, event, { preserveOrderedListStart: true, assetsAlreadyHandled: true });
    setClipboardPasteBehavior(view, event, { assetsAlreadyHandled: true, preserveOrderedListStart: false });
    expect(getClipboardPasteBehavior(view, event)).toEqual({ assetsAlreadyHandled: true });
    setClipboardPasteBehavior(view, event, { preserveOrderedListStart: true, assetsAlreadyHandled: false });
    expect(getClipboardPasteBehavior(view, event)).toEqual({ preserveOrderedListStart: true });
    setClipboardPasteBehavior(view, event, { preserveOrderedListStart: false, assetsAlreadyHandled: false });
    expect(getClipboardPasteBehavior(view, event)).toBeUndefined();
  });
});
