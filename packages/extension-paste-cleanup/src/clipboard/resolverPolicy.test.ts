// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createClipboardResolvedSourcePolicy, readClipboardResolvedSource } from './resolverPolicy.js';
import type { ClipboardResolvedSourcePolicy } from './resolverPolicy.js';

describe('private declarative resolved image URL policy', () => {
  it('accepts canonical exact origins, including an explicitly selected development origin', () => {
    const policy = createClipboardResolvedSourcePolicy(['HTTPS://CDN.EXAMPLE:443/', 'http://localhost:3000']);
    expect(readClipboardResolvedSource(policy, 'https://cdn.example/image.png?version=1#part')).toBe('https://cdn.example/image.png?version=1#part');
    expect(readClipboardResolvedSource(policy, 'http://localhost:3000/image.png')).toBe('http://localhost:3000/image.png');
    for (const value of ['http://cdn.example/image.png', 'https://sub.cdn.example/image.png', 'https://cdn.example:444/image.png', 'http://localhost:3001/image.png']) {
      expect(readClipboardResolvedSource(policy, value)).toBeUndefined();
    }
  });

  it('snapshots origin values and keeps the policy opaque', () => {
    const input = ['https://cdn.example'];
    const policy = createClipboardResolvedSourcePolicy(input);
    input[0] = 'https://other.example';
    expect(readClipboardResolvedSource(policy, 'https://cdn.example/image.png')).toBeDefined();
    expect(readClipboardResolvedSource(policy, 'https://other.example/image.png')).toBeUndefined();
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.getPrototypeOf(policy)).toBeNull();
    expect(Reflect.ownKeys(policy)).toEqual([]);
    expect(readClipboardResolvedSource(Object.freeze({}) as ClipboardResolvedSourcePolicy, 'https://cdn.example/image.png')).toBeUndefined();
  });

  it.each([
    '', '*', 'https://*.example', '//cdn.example', 'cdn.example', 'https://cdn.example/path',
    'https://cdn.example/../', 'https://cdn.example?key=1', 'https://cdn.example#fragment',
    'https://name:password@cdn.example', 'https://cdn.example\\path',
    ' https://cdn.example', 'https://cdn.example\n', 'https://cdn.example\u007f',
    'file:///private', 'blob:https://cdn.example/id', 'javascript:alert(1)', 'https://[invalid',
  ])('refuses invalid origin configuration: %j', value => {
    expect(() => createClipboardResolvedSourcePolicy([value])).toThrow(RangeError);
  });

  it.each([
    '', '/image.png', '//cdn.example/image.png', 'data:image/png;base64,AA==', 'file:///private.png',
    'blob:https://cdn.example/id', 'javascript:alert(1)', 'https://name@cdn.example/image.png',
    'https://cdn.example\\image.png', 'https://cdn.example/\nimage.png', 'https://cdn.example/ image.png',
    ' https://cdn.example/image.png', 'https://[invalid',
  ])('refuses invalid resolved URLs: %j', value => {
    const policy = createClipboardResolvedSourcePolicy(['https://cdn.example']);
    expect(readClipboardResolvedSource(policy, value)).toBeUndefined();
  });

  it('matches normalized international domains without accepting lookalike hosts', () => {
    const policy = createClipboardResolvedSourcePolicy(['https://bücher.example']);
    expect(readClipboardResolvedSource(policy, 'https://xn--bcher-kva.example/image.png')).toBeDefined();
    expect(readClipboardResolvedSource(policy, 'https://bucher.example/image.png')).toBeUndefined();
  });

  it('bounds the entire supplied list before deduplication', () => {
    expect(() => createClipboardResolvedSourcePolicy([])).toThrow(RangeError);
    expect(() => createClipboardResolvedSourcePolicy(Array.from({ length: 33 }, () => 'https://cdn.example'))).toThrow(RangeError);
    expect(() => createClipboardResolvedSourcePolicy(Array.from({ length: 32 }, () => `https://${'a'.repeat(255)}.example`))).toThrow(RangeError);
    expect(() => createClipboardResolvedSourcePolicy([`https://${'a'.repeat(2048)}.example`])).toThrow(RangeError);
    expect(() => createClipboardResolvedSourcePolicy(['https://cdn.example', 'https://cdn.example/'])).not.toThrow();
  });

  it('bounds both the input and canonical URL length', () => {
    const policy = createClipboardResolvedSourcePolicy(['https://cdn.example']);
    const prefix = 'https://cdn.example/';
    expect(readClipboardResolvedSource(policy, prefix + 'a'.repeat(8192 - prefix.length))).toHaveLength(8192);
    expect(readClipboardResolvedSource(policy, prefix + 'a'.repeat(8193 - prefix.length))).toBeUndefined();
    expect(readClipboardResolvedSource(policy, prefix + 'é'.repeat(2000))).toBeUndefined();
  });

  it('quarantines unreadable configuration without leaking exceptions', () => {
    const input: string[] = [];
    Object.defineProperty(input, 0, { get: () => { throw new Error('Private source'); } });
    expect(() => createClipboardResolvedSourcePolicy(input)).toThrow('Invalid clipboard resolved image origins');
    expect(readClipboardResolvedSource(createClipboardResolvedSourcePolicy(['https://cdn.example']), { toString: () => { throw new Error('Must not coerce'); } })).toBeUndefined();
  });
});
