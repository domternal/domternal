// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { Schema } from '@domternal/pm/model';
import {
  clipboardRasterMime, createClipboardImageDestination, readBuiltinImageDestination,
  sameClipboardImageDestination,
} from './destination.js';
import type { ClipboardDestinationLimits, ClipboardDestinationResult, ClipboardImageDestinationInput } from './destination.js';

const limits: ClipboardDestinationLimits = { maxMetadataLength: 128, maxMimeTypes: 16, maxFileBytes: 1024 };
const profile: ClipboardImageDestinationInput = {
  nodeTypeName: 'image', sourceAttribute: 'src', inline: false, allowEmbedded: true,
  allowedMimeTypes: ['image/png', 'image/jpeg'], maxFileBytes: 512, policyVersion: 'app:1',
};
const builtin = {
  inline: false, allowBase64: true, maxFileSize: 0,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif'],
};

function schema(name = 'image', sourceAttribute = 'src', inline = false): Schema {
  return new Schema({ nodes: {
    doc: { content: 'block+' }, paragraph: { group: 'block', content: 'inline*' }, text: { group: 'inline' },
    [name]: { group: inline ? 'inline' : 'block', inline, attrs: { [sourceAttribute]: { default: null } } },
  } });
}

function available(result: ClipboardDestinationResult): Extract<ClipboardDestinationResult, { status: 'available' }>['destination'] {
  if (result.status !== 'available') throw new Error(`Expected destination: ${result.reason}`);
  return result.destination;
}

describe('clipboard image destination', () => {
  it('freezes a custom profile without freezing the caller or its schema', () => {
    const target = schema();
    const input = { ...profile, allowedMimeTypes: ['image/png', 'image/jpeg'] };
    const result = createClipboardImageDestination(target, input, limits);
    const destination = available(result);
    expect(destination.schema).toBe(target);
    expect(destination.nodeType).toBe(target.nodes['image']);
    expect(destination.sourceAttribute).toBe('src');
    expect(destination.maxFileBytes).toBe(512);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(destination)).toBe(true);
    expect(Object.isFrozen(destination.allowedMimeTypes)).toBe(true);
    expect(Object.isFrozen(input)).toBe(false);
    expect(Object.isFrozen(target)).toBe(false);
    input.allowedMimeTypes.push('image/gif');
    expect(destination.allowedMimeTypes).toEqual(['image/jpeg', 'image/png']);
  });

  it('requires an explicit custom source attribute and accepts a custom node name', () => {
    const target = schema('photo', 'assetUrl');
    const input = { ...profile, nodeTypeName: 'photo', sourceAttribute: 'assetUrl' };
    expect(available(createClipboardImageDestination(target, input, limits)).sourceAttribute).toBe('assetUrl');
    expect(createClipboardImageDestination(target, { ...input, sourceAttribute: 'src' }, limits)).toEqual({
      status: 'unsupported', reason: 'incompatible-schema',
    });
  });

  it('distinguishes disabled embedding from a missing image node', () => {
    const destination = available(createClipboardImageDestination(schema(), { ...profile, allowEmbedded: false }, limits));
    expect(destination.allowEmbedded).toBe(false);
    expect(createClipboardImageDestination(schema('photo'), profile, limits)).toEqual({ status: 'unsupported', reason: 'missing-node' });
  });

  it('checks actual inline schema semantics without claiming to prove insertion context', () => {
    expect(createClipboardImageDestination(schema('image', 'src', true), profile, limits)).toEqual({
      status: 'unsupported', reason: 'incompatible-schema',
    });
    const destination = available(createClipboardImageDestination(schema('image', 'src', true), { ...profile, inline: true }, limits));
    expect(destination.inline).toBe(true);
  });

  it('does not resolve node or attribute names through object prototypes', () => {
    expect(createClipboardImageDestination(schema(), { ...profile, nodeTypeName: 'toString' }, limits)).toEqual({
      status: 'unsupported', reason: 'missing-node',
    });
    expect(createClipboardImageDestination(schema(), { ...profile, sourceAttribute: 'toString' }, limits)).toEqual({
      status: 'unsupported', reason: 'incompatible-schema',
    });
  });

  it('intersects configured MIME types with supported raster formats without guessing aliases', () => {
    const destination = available(createClipboardImageDestination(schema(), {
      ...profile, allowedMimeTypes: ['IMAGE/PNG', 'image/png', 'image/webp', 'image/svg+xml', 'image/avif', 'image/jpg', 'image/png;foo=bar', '*'],
    }, limits));
    expect(destination.allowedMimeTypes).toEqual(['image/png', 'image/webp']);
    expect(available(createClipboardImageDestination(schema(), { ...profile, allowedMimeTypes: ['image/svg+xml'] }, limits)).allowedMimeTypes).toEqual([]);
  });

  it('bounds MIME count and strings before normalizing or fingerprinting', () => {
    expect(createClipboardImageDestination(schema(), profile, { ...limits, maxMimeTypes: 1 })).toEqual({ status: 'unsupported', reason: 'policy-limit' });
    for (const key of ['nodeTypeName', 'sourceAttribute', 'policyVersion']) {
      expect(createClipboardImageDestination(schema(), { ...profile, [key]: 'x'.repeat(129) }, limits)).toEqual({ status: 'unsupported', reason: 'policy-limit' });
    }
    expect(createClipboardImageDestination(schema(), { ...profile, allowedMimeTypes: ['x'.repeat(129)] }, limits)).toEqual({ status: 'unsupported', reason: 'policy-limit' });
    expect(clipboardRasterMime('IMAGE/PNG')).toBe('image/png');
    expect(clipboardRasterMime('x'.repeat(100_000))).toBeUndefined();
  });

  it('uses a fixed MIME entry count without invoking a custom array iterator', () => {
    const mimeTypes = ['image/png'];
    const iterator = vi.fn(() => { throw new Error('Iterator must not run'); });
    Object.defineProperty(mimeTypes, Symbol.iterator, { value: iterator });
    const destination = available(createClipboardImageDestination(schema(), { ...profile, allowedMimeTypes: mimeTypes }, limits));
    expect(destination.allowedMimeTypes).toEqual(['image/png']);
    expect(iterator).not.toHaveBeenCalled();

    const growing = ['image/png'];
    Object.defineProperty(growing, '0', { get: () => { growing.push('image/jpeg'); return 'image/png'; } });
    expect(available(createClipboardImageDestination(schema(), { ...profile, allowedMimeTypes: growing }, { ...limits, maxMimeTypes: 1 })).allowedMimeTypes).toEqual(['image/png']);
  });

  it('keeps zero as a real custom file ceiling and applies the capture maximum', () => {
    expect(available(createClipboardImageDestination(schema(), { ...profile, maxFileBytes: 0 }, limits)).maxFileBytes).toBe(0);
    expect(available(createClipboardImageDestination(schema(), { ...profile, maxFileBytes: 2048 }, limits)).maxFileBytes).toBe(1024);
    expect(available(createClipboardImageDestination(schema(), profile, { ...limits, maxFileBytes: 0 })).maxFileBytes).toBe(0);
  });

  it('reads live built-in options once without discovering extensions or invoking upload callbacks', () => {
    const target = schema();
    const upload = vi.fn(() => { throw new Error('Upload must not run'); });
    const options = { ...builtin };
    Object.defineProperty(options, 'uploadHandler', { get: upload });
    const read = vi.fn(() => options);
    const destination = available(readBuiltinImageDestination(target, read, limits));
    expect(read).toHaveBeenCalledTimes(1);
    expect(upload).not.toHaveBeenCalled();
    expect(destination.sourceAttribute).toBe('src');
    expect(destination.allowedMimeTypes).toEqual(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);
    expect(destination.maxFileBytes).toBe(1024);
  });

  it('translates the legacy unlimited file option into a finite destination ceiling', () => {
    for (const [maxFileSize, maximum] of [[0, 1024], [256, 256], [2048, 1024]] as const) {
      const destination = available(readBuiltinImageDestination(schema(), () => ({ ...builtin, maxFileSize }), limits));
      expect(destination.maxFileBytes).toBe(maximum);
    }
    expect(available(readBuiltinImageDestination(schema(), () => ({ ...builtin, allowBase64: false }), limits)).allowEmbedded).toBe(false);
  });

  it('makes policy keys stable for equivalent MIME sets and sensitive to material changes', () => {
    const target = schema();
    const original = available(createClipboardImageDestination(target, profile, limits));
    const reordered = available(createClipboardImageDestination(target, { ...profile, allowedMimeTypes: ['image/jpeg', 'IMAGE/PNG', 'image/png'] }, limits));
    expect(sameClipboardImageDestination(original, reordered)).toBe(true);
    for (const change of [
      { allowEmbedded: false }, { maxFileBytes: 123 }, { allowedMimeTypes: ['image/png'] }, { policyVersion: 'app:2' },
    ]) {
      expect(sameClipboardImageDestination(original, available(createClipboardImageDestination(target, { ...profile, ...change }, limits)))).toBe(false);
    }
    expect(sameClipboardImageDestination(original, available(createClipboardImageDestination(schema(), profile, limits)))).toBe(false);
  });

  it('rechecks live settings and fingerprints actual custom attributes', () => {
    const target = schema();
    const options = { ...builtin };
    const first = available(readBuiltinImageDestination(target, () => options, limits));
    options.allowBase64 = false;
    const second = available(readBuiltinImageDestination(target, () => options, limits));
    expect(sameClipboardImageDestination(first, second)).toBe(false);
    const attributed = new Schema({ nodes: {
      doc: { content: 'image+' }, text: {}, image: { attrs: { src: { default: null }, asset: { default: null } } },
    } });
    const src = available(createClipboardImageDestination(attributed, profile, limits));
    const asset = available(createClipboardImageDestination(attributed, { ...profile, sourceAttribute: 'asset' }, limits));
    expect(sameClipboardImageDestination(src, asset)).toBe(false);
  });

  it('does not use ambiguous delimiter concatenation for policy fingerprints', () => {
    const target = schema();
    const a = available(createClipboardImageDestination(target, { ...profile, policyVersion: 'a",false,["image/png' }, limits));
    const b = available(createClipboardImageDestination(target, { ...profile, policyVersion: 'a', allowEmbedded: false }, limits));
    expect(sameClipboardImageDestination(a, b)).toBe(false);
  });

  it('rejects malformed custom policy fields without coercing them', () => {
    for (const change of [
      { nodeTypeName: '' }, { sourceAttribute: '' }, { policyVersion: '' },
      { inline: 'false' }, { allowEmbedded: 1 }, { maxFileBytes: NaN },
      { maxFileBytes: Infinity }, { maxFileBytes: -1 }, { maxFileBytes: 0.5 },
      { maxFileBytes: Number.MAX_SAFE_INTEGER + 1 }, { allowedMimeTypes: null }, { allowedMimeTypes: [42] },
    ]) {
      expect(createClipboardImageDestination(schema(), { ...profile, ...change } as ClipboardImageDestinationInput, limits)).toEqual({ status: 'unsupported', reason: 'invalid-policy' });
    }
  });

  it.each([null, [], undefined, { ...builtin, maxFileSize: Infinity }, { ...builtin, allowBase64: 'true' }])('rejects invalid built-in options', value => {
    expect(readBuiltinImageDestination(schema(), () => value, limits)).toEqual({ status: 'unsupported', reason: 'invalid-policy' });
  });

  it('fails closed for throwing readers and policy getters', () => {
    const fail = (): never => { throw new Error('Private application details'); };
    expect(readBuiltinImageDestination(schema(), fail, limits)).toEqual({ status: 'unsupported', reason: 'unreadable-policy' });
    const input = { ...profile };
    Object.defineProperty(input, 'policyVersion', { get: fail });
    expect(createClipboardImageDestination(schema(), input, limits)).toEqual({ status: 'unsupported', reason: 'unreadable-policy' });
    const options = { ...builtin };
    Object.defineProperty(options, 'allowedMimeTypes', { get: fail });
    expect(readBuiltinImageDestination(schema(), () => options, limits)).toEqual({ status: 'unsupported', reason: 'unreadable-policy' });
  });

  it('validates and snapshots limits before calling the live configuration reader', () => {
    const reader = vi.fn(() => builtin);
    for (const key of Object.keys(limits)) {
      for (const value of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, undefined]) {
        expect(() => readBuiltinImageDestination(schema(), reader, { ...limits, [key]: value })).toThrow(RangeError);
      }
    }
    expect(reader).not.toHaveBeenCalled();
    const mutable = { ...limits, maxFileBytes: 10 };
    const destination = available(readBuiltinImageDestination(schema(), () => { mutable.maxFileBytes = 100; return builtin; }, mutable));
    expect(destination.maxFileBytes).toBe(10);
  });
});
