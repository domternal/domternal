// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@domternal/pm/view';
import {
  getClipboardImageDestination, registerClipboardImageDestination,
} from './clipboardImageDestination.js';
import type { ClipboardImageDestinationPolicy } from './clipboardImageDestination.js';

function viewIdentity(): EditorView & { isDestroyed: boolean } {
  return { isDestroyed: false } as EditorView & { isDestroyed: boolean };
}

function policy(version = 'custom:1'): ClipboardImageDestinationPolicy {
  return {
    nodeTypeName: 'photo', sourceAttribute: 'assetUrl', inline: false, allowEmbedded: true,
    allowedMimeTypes: ['image/png'], maxFileBytes: 1024, policyVersion: version,
  };
}

describe('clipboard image destination registry', () => {
  it('is importable without a DOM and registers without invoking a reader', () => {
    expect(typeof document).toBe('undefined');
    const view = viewIdentity();
    const read = vi.fn(() => policy());
    expect(getClipboardImageDestination(view)).toBeUndefined();
    const dispose = registerClipboardImageDestination(view, read);
    expect(read).not.toHaveBeenCalled();
    expect(getClipboardImageDestination(view)).toEqual(policy());
    expect(read).toHaveBeenCalledTimes(1);
    dispose();
  });

  it('reads fresh policy values and keeps view registrations independent', () => {
    const first = viewIdentity();
    const second = viewIdentity();
    let current = policy();
    const read = vi.fn(() => current);
    const dispose = registerClipboardImageDestination(first, read);
    expect(getClipboardImageDestination(second)).toBeUndefined();
    expect(getClipboardImageDestination(first)).toBe(current);
    current = policy('custom:2');
    expect(getClipboardImageDestination(first)).toBe(current);
    expect(read).toHaveBeenCalledTimes(2);
    const disposeSecond = registerClipboardImageDestination(second, () => policy('other:1'));
    dispose();
    expect(getClipboardImageDestination(first)).toBeUndefined();
    expect(getClipboardImageDestination(second)?.policyVersion).toBe('other:1');
    disposeSecond();
  });

  it('uses the latest active registration and restores an older one when the latest is disposed', () => {
    const view = viewIdentity();
    const older = vi.fn(() => policy('older'));
    const newer = vi.fn(() => policy('newer'));
    const disposeOlder = registerClipboardImageDestination(view, older);
    const disposeNewer = registerClipboardImageDestination(view, newer);
    expect(getClipboardImageDestination(view)?.policyVersion).toBe('newer');
    expect(older).not.toHaveBeenCalled();
    disposeNewer();
    expect(getClipboardImageDestination(view)?.policyVersion).toBe('older');
    disposeOlder();
    expect(getClipboardImageDestination(view)).toBeUndefined();
  });

  it('makes disposal idempotent and prevents older disposers from removing newer registrations', () => {
    const view = viewIdentity();
    const first = registerClipboardImageDestination(view, () => policy('first'));
    const second = registerClipboardImageDestination(view, () => policy('second'));
    const third = registerClipboardImageDestination(view, () => policy('third'));
    second();
    second();
    first();
    expect(getClipboardImageDestination(view)?.policyVersion).toBe('third');
    third();
    expect(getClipboardImageDestination(view)).toBeUndefined();
    const replacement = registerClipboardImageDestination(view, () => policy('replacement'));
    first();
    third();
    expect(getClipboardImageDestination(view)?.policyVersion).toBe('replacement');
    replacement();
  });

  it('fails closed on a throwing or unavailable newest reader without using an older policy', () => {
    const view = viewIdentity();
    const older = vi.fn(() => policy('older'));
    const disposeOlder = registerClipboardImageDestination(view, older);
    const throwing = registerClipboardImageDestination(view, () => { throw new Error('Private application detail'); });
    expect(getClipboardImageDestination(view)).toBeUndefined();
    expect(older).not.toHaveBeenCalled();
    throwing();
    const unavailable = registerClipboardImageDestination(view, () => undefined);
    expect(getClipboardImageDestination(view)).toBeUndefined();
    expect(older).not.toHaveBeenCalled();
    unavailable();
    disposeOlder();
  });

  it('does not read a destroyed view and ignores registrations made after destruction', () => {
    const view = viewIdentity();
    const reader = vi.fn(() => policy());
    const dispose = registerClipboardImageDestination(view, reader);
    view.isDestroyed = true;
    expect(getClipboardImageDestination(view)).toBeUndefined();
    const ignored = registerClipboardImageDestination(view, reader);
    expect(getClipboardImageDestination(view)).toBeUndefined();
    dispose();
    ignored();
    expect(reader).not.toHaveBeenCalled();
  });

  it('discards a policy if the reader destroys its view or disposes itself', () => {
    const view = viewIdentity();
    const dispose = registerClipboardImageDestination(view, () => { view.isDestroyed = true; return policy(); });
    expect(getClipboardImageDestination(view)).toBeUndefined();
    dispose();
    const another = viewIdentity();
    let remove = (): void => undefined;
    remove = registerClipboardImageDestination(another, () => { remove(); return policy(); });
    expect(getClipboardImageDestination(another)).toBeUndefined();
  });

  it('discards a policy when the reader registers a newer policy while running', () => {
    const view = viewIdentity();
    let disposeNewer = (): void => undefined;
    const dispose = registerClipboardImageDestination(view, () => {
      disposeNewer = registerClipboardImageDestination(view, () => policy('newer'));
      return policy('older');
    });
    expect(getClipboardImageDestination(view)).toBeUndefined();
    expect(getClipboardImageDestination(view)?.policyVersion).toBe('newer');
    dispose();
    disposeNewer();
  });

  it('fails closed when the lifecycle getter is unreadable', () => {
    const view = viewIdentity();
    const reader = vi.fn(() => policy());
    Object.defineProperty(view, 'isDestroyed', { get: () => { throw new Error('Unavailable view'); } });
    expect(getClipboardImageDestination(view)).toBeUndefined();
    expect(() => { registerClipboardImageDestination(view, reader)(); }).not.toThrow();
    expect(reader).not.toHaveBeenCalled();
  });
});
