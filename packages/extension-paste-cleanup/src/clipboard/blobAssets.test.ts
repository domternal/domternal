/// <reference types="node" />
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Schema } from '@domternal/pm/model';
import { createClipboardImageDestination } from './destination.js';
import type { ClipboardImageDestination } from './destination.js';
import type { ClipboardMatchedImage } from './references.js';
import { prepareClipboardBlobAssets } from './localAssets.js';
import type { ClipboardBlobAssetLimits, ClipboardEmbeddedAssetOptions } from './localAssets.js';

// Synthetic one-pixel PNG; no native Office fidelity is inferred from this fixture.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC'), char => char.charCodeAt(0));
const limits: ClipboardBlobAssetLimits = {
  maxPlacements: 16, maxFiles: 8, maxFileBytes: 4096, maxTotalFileBytes: 8192,
  maxTotalPixels: 100, maxMetadataLength: 128, maxDescriptionLength: 256, maxDimension: 10_000,
};

function destination(overrides: Partial<ClipboardImageDestination> = {}): ClipboardImageDestination {
  const schema = new Schema({ nodes: {
    doc: { content: 'block+' }, paragraph: { group: 'block', content: 'text*' }, text: {},
    image: { group: 'block', attrs: { src: { default: null } } },
  } });
  const result = createClipboardImageDestination(schema, {
    nodeTypeName: 'image', sourceAttribute: 'src', inline: false, allowEmbedded: false,
    allowedMimeTypes: ['image/png'], maxFileBytes: 4096, policyVersion: 'test:1',
  }, { maxMetadataLength: 128, maxMimeTypes: 4, maxFileBytes: 4096 });
  if (result.status !== 'available') throw new Error('Expected destination');
  return { ...result.destination, ...overrides };
}

function match(id = 'a', file = new File([PNG], 'private-image.png', { type: 'image/png' }), itemIndex = 0): ClipboardMatchedImage {
  return {
    reference: { placementId: id, rawReference: 'file:///private/image.png', sourceOffset: 4, alt: 'Image', width: 1, height: 1 },
    file, fileSize: file.size, mimeType: 'image/png', itemIndex,
  };
}

function prepare(
  matches: readonly ClipboardMatchedImage[] = [match()],
  cap: ClipboardBlobAssetLimits = limits,
  options: ClipboardEmbeddedAssetOptions = { signal: new AbortController().signal },
  policy = destination(),
): ReturnType<typeof prepareClipboardBlobAssets> {
  return prepareClipboardBlobAssets(matches, policy, cap, options);
}

function pending<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

afterEach(() => vi.restoreAllMocks());

describe('private clipboard Blob preparation for explicit resolvers', () => {
  it('prepares exact immutable raster bytes when embedding is disabled without base64 or browser URLs', async () => {
    const encode = vi.spyOn(globalThis, 'btoa').mockImplementation(() => { throw new Error('Must not encode'); });
    const objectURL = vi.spyOn(URL, 'createObjectURL');
    const fetch = vi.spyOn(globalThis, 'fetch');
    const input = match();
    const result = await prepare([input]);
    expect(result.status).toBe('prepared');
    if (result.status !== 'prepared') return;
    const resource = result.resources[0]!;
    expect(resource.blob).toBeInstanceOf(Blob);
    expect(resource.blob).not.toBeInstanceOf(File);
    expect(resource.blob).not.toBe(input.file);
    expect(resource.blob.type).toBe('image/png');
    expect(new Uint8Array(await resource.blob.arrayBuffer())).toEqual(PNG);
    expect(resource).toMatchObject({ mimeType: 'image/png', byteLength: PNG.length, pixels: 1 });
    expect(result).toMatchObject({ readBytes: PNG.length, pixelCount: 1, placements: [{ placementId: 'a', resourceIndex: 0, sourceOffset: 4, alt: 'Image', width: 1, height: 1 }] });
    expect(result).not.toHaveProperty('preparedUrlUnits');
    expect(JSON.stringify(result)).not.toContain('private');
    for (const value of [result, result.resources, result.placements, ...result.resources, ...result.placements]) expect(Object.isFrozen(value)).toBe(true);
    expect(encode).not.toHaveBeenCalled();
    expect(objectURL).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('copies the validated snapshot instead of forwarding mutable adapter bytes', async () => {
    const bytes = PNG.slice();
    const result = await prepare([match()], limits, { signal: new AbortController().signal, readFile: () => Promise.resolve(bytes.buffer) });
    bytes.fill(0);
    expect(result.status).toBe('prepared');
    if (result.status === 'prepared') expect(new Uint8Array(await result.resources[0]!.blob.arrayBuffer())).toEqual(PNG);
  });

  it('reads repeated File objects once, deduplicates identical contents and charges all placements', async () => {
    const first = match();
    const inputs = [first, match('b', first.file, 1), match('c', undefined, 2)];
    const readFile = vi.fn((file: File) => file.arrayBuffer());
    const result = await prepare(inputs, limits, { signal: new AbortController().signal, readFile });
    expect(result.status).toBe('prepared');
    if (result.status !== 'prepared') return;
    expect(readFile).toHaveBeenCalledTimes(2);
    expect(result.resources).toHaveLength(1);
    expect(result.placements.map(value => value.resourceIndex)).toEqual([0, 0, 0]);
    expect(result.readBytes).toBe(PNG.length * 2);
    expect(result.pixelCount).toBe(3);
  });

  it('preserves different bytes despite identical name, MIME, size and dimensions', async () => {
    const changed = PNG.slice();
    // A changed CRC stays distinct; the raster preflight does not claim full codec validation.
    changed[29] = changed[29]! ^ 1;
    const result = await prepare([match(), match('b', new File([changed], 'private-image.png', { type: 'image/png' }), 1)]);
    expect(result.status).toBe('prepared');
    if (result.status !== 'prepared') return;
    expect(result.resources).toHaveLength(2);
    expect(new Uint8Array(await result.resources[1]!.blob.arrayBuffer())).toEqual(changed);
  });

  it.each([
    { cap: { maxPlacements: 1 } }, { cap: { maxFiles: 1 } },
    { cap: { maxFileBytes: PNG.length - 1 } }, { cap: { maxTotalFileBytes: PNG.length * 2 - 1 } },
    { cap: { maxMetadataLength: 1 }, id: 'long-id' },
    { cap: { maxDescriptionLength: 1 } },
  ])('enforces complete input budgets before the first read: $cap', async ({ cap, id }) => {
    const readFile = vi.fn(() => Promise.resolve(PNG.slice().buffer));
    expect((await prepare([match(id), match('b', undefined, 1)], { ...limits, ...cap }, { signal: new AbortController().signal, readFile })).status).toBe('rejected');
    expect(readFile).not.toHaveBeenCalled();
  });

  it.each([
    { policy: { allowedMimeTypes: [] }, reason: 'unsupported-image-type' },
    { policy: { maxFileBytes: PNG.length - 1 }, reason: 'image-size-limit' },
  ])('still honors destination restrictions: $reason', async ({ policy, reason }) => {
    const readFile = vi.fn(() => Promise.resolve(PNG.slice().buffer));
    expect(await prepare([match()], limits, { signal: new AbortController().signal, readFile }, destination(policy))).toMatchObject({ status: 'rejected', reason });
    expect(readFile).not.toHaveBeenCalled();
  });

  it.each([
    { buffer: new Uint8Array(PNG.length).buffer, reason: 'invalid-raster' },
    { buffer: new ArrayBuffer(PNG.length - 1), reason: 'size-mismatch' },
    { buffer: new SharedArrayBuffer(PNG.length), reason: 'invalid-buffer' },
    { buffer: PNG.slice(), reason: 'invalid-buffer' },
  ])('rejects unqualified bytes before creating a Blob: $reason', async ({ buffer, reason }) => {
    const result = await prepare([match()], limits, { signal: new AbortController().signal, readFile: () => Promise.resolve(buffer) });
    expect(result).toMatchObject({ status: 'rejected', reason });
  });

  it('charges raster allocations for repeated placements at the exact boundary', async () => {
    const first = match();
    const inputs = [first, match('b', first.file, 1)];
    expect((await prepare(inputs, { ...limits, maxTotalPixels: 2 })).status).toBe('prepared');
    expect(await prepare(inputs, { ...limits, maxTotalPixels: 1 })).toMatchObject({ status: 'rejected', reason: 'pixel-limit' });
  });

  it('cancels promptly during a read and discards its late completion without reading the next file', async () => {
    const controller = new AbortController();
    const gate = pending<ArrayBuffer>();
    const readFile = vi.fn(() => gate.promise);
    const result = prepare([match(), match('b', undefined, 1)], limits, { signal: controller.signal, readFile });
    controller.abort();
    expect(await result).toEqual({ status: 'cancelled' });
    gate.resolve(PNG.slice().buffer);
    await Promise.resolve();
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it('does not read when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const readFile = vi.fn(() => Promise.resolve(PNG.slice().buffer));
    expect(await prepare([match()], limits, { signal: controller.signal, readFile })).toEqual({ status: 'cancelled' });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('rechecks the original signal when cancellation occurs between preparation and publication', async () => {
    const original = new AbortController();
    const options = { signal: original.signal, readFile: () => Promise.resolve(PNG.slice().buffer) };
    const result = prepare([match()], limits, options);
    options.signal = new AbortController().signal;
    queueMicrotask(() => { queueMicrotask(() => { original.abort(); }); });
    expect(await result).toEqual({ status: 'cancelled' });
  });

  it('snapshots destination, limits, placements and read methods before awaiting', async () => {
    const first = match();
    const second = match('b', undefined, 1);
    const gate = pending<ArrayBuffer>();
    Object.defineProperty(first.file, 'arrayBuffer', { configurable: true, value: () => gate.promise });
    const cap = { ...limits };
    const policy = destination();
    const result = prepare([first, second], cap, { signal: new AbortController().signal }, policy);
    Object.assign(policy, { allowedMimeTypes: [], maxFileBytes: 1 });
    cap.maxTotalPixels = 1;
    Object.assign(second.reference, { placementId: 'changed', alt: 'changed' });
    Object.defineProperty(second.file, 'arrayBuffer', { value: () => Promise.reject(new Error('Changed reader')) });
    gate.resolve(PNG.slice().buffer);
    const prepared = await result;
    expect(prepared.status).toBe('prepared');
    if (prepared.status === 'prepared') expect(prepared.placements[1]).toMatchObject({ placementId: 'b', alt: 'Image' });
  });

  it('reports a failed read without exposing its exception', async () => {
    expect(await prepare([match()], limits, { signal: new AbortController().signal, readFile: () => Promise.reject(new Error('private')) })).toEqual({ status: 'rejected', reason: 'read-failed', placementId: 'a' });
  });

  it('accepts an empty set and rejects invalid work limits', async () => {
    expect(await prepare([])).toEqual({ status: 'prepared', resources: [], placements: [], readBytes: 0, pixelCount: 0 });
    await expect(prepare([], { ...limits, maxTotalPixels: Number.NaN })).rejects.toThrow(RangeError);
  });
});
