import { describe, expect, it, vi } from 'vitest';
import { createPasteFormattingPolicy } from './pasteFormatting.js';
import type { PasteFormattingContext, PasteFormattingResolver } from './pasteFormatting.js';

describe('per-attempt paste formatting policy', () => {
  it('captures one choice from a bounded frozen context without clipboard data', () => {
    const resolver = vi.fn((context: Readonly<PasteFormattingContext>) => {
      expect(Object.isFrozen(context)).toBe(true);
      expect(Reflect.ownKeys(context)).toEqual(['defaultFormatting', 'origin']);
      expect(context).toEqual({ defaultFormatting: 'preserve', origin: 'native' });
      return 'adapt' as const;
    });
    const policy = createPasteFormattingPolicy('preserve', resolver);
    const attempt = Object.freeze({});
    const snapshot = policy.capture(attempt, 'native');
    expect(snapshot).toEqual({ formatting: 'adapt' });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(policy.capture(attempt, 'programmatic')).toBe(snapshot);
    expect(policy.read(attempt)).toBe(snapshot);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('keeps a host UI choice stable until the next attempt', () => {
    let selected: 'preserve' | 'adapt' = 'adapt';
    const policy = createPasteFormattingPolicy('preserve', () => selected);
    const first = {};
    const original = policy.capture(first, 'native');
    selected = 'preserve';
    expect(policy.capture(first, 'native')).toBe(original);
    expect(policy.capture({}, 'native')).toEqual({ formatting: 'preserve' });
    expect(original).toEqual({ formatting: 'adapt' });
  });

  it('isolates nested attempts and invokes a reentrant same-attempt callback once', () => {
    const outer = {};
    const inner = {};
    const observations: unknown[] = [];
    const resolver: PasteFormattingResolver = context => {
      observations.push(context.origin);
      if (context.origin === 'native') {
        observations.push(policy.capture(outer, 'native').formatting);
        observations.push(policy.capture(inner, 'programmatic').formatting);
        return 'adapt';
      }
      return 'preserve';
    };
    const policy = createPasteFormattingPolicy('preserve', resolver);
    expect(policy.capture(outer, 'native')).toEqual({ formatting: 'adapt' });
    expect(policy.read(inner)).toEqual({ formatting: 'preserve' });
    expect(observations).toEqual(['native', 'preserve', 'programmatic', 'preserve']);
  });

  it('carries an authorized snapshot into a fresh replay without invoking the host again', () => {
    const resolver = vi.fn(() => 'adapt' as const);
    const policy = createPasteFormattingPolicy('preserve', resolver);
    const original = policy.capture({}, 'native');
    const replay = {};
    expect(policy.inherit(replay, original)).toBe(true);
    expect(policy.capture(replay, 'programmatic')).toBe(original);
    expect(policy.inherit(replay, original)).toBe(false);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('refuses a forged snapshot, a different editor policy and an already captured attempt', () => {
    const policy = createPasteFormattingPolicy('preserve', () => 'adapt');
    const other = createPasteFormattingPolicy('preserve');
    expect(policy.inherit({}, { formatting: 'adapt' })).toBe(false);
    expect(policy.inherit({}, other.capture({}, 'native'))).toBe(false);
    const captured = {};
    policy.capture(captured, 'programmatic');
    expect(policy.inherit(captured, policy.read(undefined))).toBe(false);
    expect(policy.inherit(undefined, policy.read(undefined))).toBe(false);
  });

  it('does not call a paste resolver for unregistered transforms or drops', () => {
    const resolver = vi.fn(() => 'preserve' as const);
    const policy = createPasteFormattingPolicy('adapt', resolver);
    expect(policy.capture(undefined, 'programmatic')).toEqual({ formatting: 'adapt' });
    expect(policy.read({})).toEqual({ formatting: 'adapt' });
    expect(resolver).not.toHaveBeenCalled();
  });

  it.each([undefined, null, false, 'invalid', 1])('retains the configured default for invalid runtime result %s', value => {
    const resolver = vi.fn(() => value) as unknown as PasteFormattingResolver;
    const policy = createPasteFormattingPolicy('adapt', resolver);
    const attempt = {};
    expect(policy.capture(attempt, 'native')).toEqual({ formatting: 'adapt' });
    policy.capture(attempt, 'native');
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('retains the default after a callback failure without retrying it in the same attempt', () => {
    const resolver = vi.fn(() => { throw new Error('Host failed'); });
    const policy = createPasteFormattingPolicy('adapt', resolver);
    const attempt = {};
    expect(policy.capture(attempt, 'native')).toEqual({ formatting: 'adapt' });
    expect(policy.capture(attempt, 'native')).toEqual({ formatting: 'adapt' });
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it.each(['resolve', 'reject', 'getter'] as const)('contains an invalid asynchronous %s policy without changing the snapshot', async mode => {
    const value = mode === 'resolve' ? Promise.resolve('adapt') : mode === 'reject'
      ? Promise.reject(new Error('Host rejected')) : { get then(): never { throw new Error('Invalid thenable'); } };
    const policy = createPasteFormattingPolicy('preserve', (() => value) as unknown as PasteFormattingResolver);
    const attempt = {};
    const snapshot = policy.capture(attempt, 'programmatic');
    await Promise.resolve();
    await Promise.resolve();
    expect(policy.read(attempt)).toBe(snapshot);
    expect(snapshot).toEqual({ formatting: 'preserve' });
  });
});
